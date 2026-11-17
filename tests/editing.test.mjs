import test from 'node:test';
import assert from 'node:assert/strict';
import { planEdit, frameAt, makeCtx, srcOffset } from '../app/js/edit.js';
import { syntheticMusic } from '../app/js/audio.js';
import { STYLES, styleWith, allParts } from '../app/js/styles.js';
import { findMoments, speechPhrases, chooseWindow } from '../app/js/moments.js';
import { buildTrack, focusAt, selectSubject, detectFaces, subjectGroup, cameraAt } from '../app/js/track.js';
import { frameChange } from '../app/js/scene.js';
import { captionAt, captionGroups } from '../app/js/captions.js';
import { frameBounds, contentRect, barTimeline, rectBetween } from '../app/js/framing.js';

function clip(duration = 20, words = []) {
  const interest = new Float32Array(Math.ceil(duration * 10)).fill(0.4);
  return { id: 'test', duration, usableEnd: duration, w: 1920, h: 1080, words, interest,
    moments: findMoments(interest, duration, { words }) };
}
const words = Array.from({ length: 36 }, (_, i) => ({ start: i * 0.45 + 0.1, end: i * 0.45 + 0.42, text: (i + 1) % 6 ? `word${i}` : 'ending.' }));

test('a visible body wins over an unrelated facecam', () => {
  const subject = selectSubject([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, score: 1 }],
    [{ x: 0.8, y: 0.55, w: 0.22, h: 0.8, score: 0.8 }], null);
  assert.equal(subject.kind, 'body'); assert.equal(subject.x, 0.8); assert.equal(subject.y, 0.55);
});

test('tracking uses actual times, holds brief dropouts and resets at cuts', () => {
  const pick = x => ({ x, y: 0.5, w: 0.2, h: 0.8, kind: 'body' });
  const track = buildTrack([{ t: 0.2, pick: pick(0.2) }, { t: 0.5 },
    { t: 0.9, pick: pick(0.8), cut: true }, { t: 2.5, cut: true }], 3);
  assert.ok(focusAt(track, 0.7).x < 0.3);
  assert.ok(focusAt(track, 0.9).x > 0.7);
  assert.equal(focusAt(track, 2.5).x, 0.5);
  assert.equal(track.zs[0], 1);
});

test('even a brief person detection is retained rather than discarded globally', () => {
  const raw = Array.from({ length: 40 }, (_, i) => ({ t: i / 4,
    pick: i === 10 ? { x: 0.8, y: 0.5, w: 0.2, h: 0.7, kind: 'body' } : null }));
  assert.equal(buildTrack(raw, 10).kind, 'body');
});

test('a blinking or missed animated face does not send the crop into empty space', () => {
  const pick = { x: 0.24, y: 0.5, w: 0.2, h: 0.4, kind: 'face' };
  const track = buildTrack([{ t: 0 }, { t: 0.25, pick }, { t: 1 }, { t: 2 }, { t: 3, pick }, { t: 3.25, cut: true }], 4);
  for (const t of [0, 0.25, 1, 2, 3]) assert.ok(Math.abs(focusAt(track, t).x - 0.24) < 0.001);
  assert.equal(focusAt(track, 3.25).x, 0.5, 'An unknown new shot must not inherit the last actor');
});

test('face tiles map detections back to full-frame coordinates', () => {
  const canvas = { width: 640, height: 360 };
  const tile = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
  const face = { detections: [{ boundingBox: { originX: 100, originY: 130, width: 110, height: 110 }, categories: [{ score: 0.85 }] }] };
  const answers = [{ detections: [] }, face, { detections: [] }, { detections: [] }];
  const detector = { detect: () => answers.shift() };
  const found = detectFaces(detector, canvas, [], tile);
  assert.equal(found.length, 1);
  assert.equal(found[0].x, 155 / 640); assert.equal(found[0].y, 185 / 360);
  assert.equal(found[0].score, 0.85);
});

test('dark scene changes reset framing while a lighting change keeps the same shot', () => {
  const width = 16, height = 8;
  const pixels = flip => Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : ((Math.floor(i / 4) % width < 6) !== flip ? 40 : 3));
  const a = pixels(false), b = pixels(true);
  const change = frameChange(a, b, width, height);
  assert.ok(change.amount < 0.2); assert.equal(change.cut, true);
  const brighter = a.map((value, i) => i % 4 === 3 ? 255 : value + 10);
  assert.equal(frameChange(a, brighter, width, height).cut, false);
});

test('manual framing takes precedence over an automatic track in preview and export', () => {
  const c = clip(10); c.manualCrop = true; c.cropX = 0.7;
  c.track = buildTrack([{ t: 0, pick: { x: 0.2, y: 0.5, w: 0.2, h: 0.8, kind: 'body' } }], 10);
  const music = syntheticMusic();
  const plan = planEdit({ clips: [c], music, musicStart: 0, length: 7, styleId: 'impact', seed: 2 });
  const ctx = makeCtx({ focus: 'on', framing: 'fill', format: '9:16' }, music, [c]);
  const manual = frameAt(plan, 1, ctx);
  assert.equal(manual.U.focus, 1); assert.equal(manual.U.crop[0], 0.7);
  c.manualCrop = false;
  assert.ok(Math.abs(frameAt(plan, 1, ctx).U.crop[0] - 0.2) < 0.002);
});

test('caption phrases use actual word timing, punctuation and silent gaps', () => {
  const groups = captionGroups(words);
  assert.ok(groups.every(g => g.words.length <= 5));
  assert.equal(captionAt(words, 0), null);
  assert.equal(captionAt(words, words[1].start + 0.02).active, 1);
  assert.equal(captionAt(words, words.at(-1).end + 1), null);
  assert.ok(speechPhrases(words).every(p => p.text.endsWith('ending.')));
});

test('visual moment selection rejects blank footage and respects source scene boundaries', () => {
  const interest = new Float32Array(100).fill(0.1); interest[20] = 1; interest[70] = 0.7;
  const c = { ...clip(10), interest, moments: findMoments(interest, 10, { scenes: [5], quality: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1] }) };
  const window = chooseWindow([c], 3, [[]], null);
  assert.ok(window.start >= 5); assert.ok(window.end <= 10);
});

test('speech plays normally and beat segments retain consecutive source time', () => {
  const c = clip(20, words);
  const plan = planEdit({ clips: [c], music: syntheticMusic(), musicStart: 0, length: 10, styleId: 'velocity', seed: 7, preserveSpeech: true });
  assert.ok(plan.segments.length > 2);
  plan.segments.forEach((s, i) => {
    assert.equal(s.profile.type, 'const'); assert.equal(s.profile.r, 1);
    if (i && s.run === plan.segments[i - 1].run) {
      const prev = plan.segments[i - 1];
      assert.ok(Math.abs(s.srcStart - (prev.srcStart + prev.srcDur)) < 0.00001);
      assert.equal(s.transIn, null);
      assert.equal(s.deck, prev.deck, 'Continuous source playback must retain its decoder');
    }
  });
});

test('an eight second sentence is retained instead of being cut at the pacing target', () => {
  const speech = Array.from({ length: 16 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.42, text: i === 15 ? 'payoff.' : 'setup' }));
  const c = clip(10, speech);
  const plan = planEdit({ clips: [c], music: syntheticMusic(), musicStart: 0, length: 10, styleId: 'impact', seed: 2, preserveSpeech: true });
  const first = plan.segments.filter(s => s.run === 0);
  assert.ok(first.at(-1).end >= speech.at(-1).end);
  assert.equal(first[0].srcStart, 0);
});

test('styles, speeds and short clips never read past source end, rewind within a shot, or end early', () => {
  for (const styleId of Object.keys(STYLES)) for (const duration of [0.3, 1, 3, 8, 25]) for (const seed of [1, 22, 782]) {
    const clips = [clip(duration), { ...clip(duration * 0.7), id: 'other' }];
    const plan = planEdit({ clips, music: syntheticMusic(), musicStart: 0, length: 15, styleId, seed, preserveSpeech: false });
    let last = 0, run = -1;
    const sourceEnds = [0, 0];
    for (const segment of plan.segments) {
      assert.ok(Math.abs(segment.start - last) < 0.0001);
      assert.ok(segment.end > segment.start);
      if (segment.run === run) assert.ok(segment.srcStart >= sourceEnds[segment.clip] - 0.0001, `${styleId}: source rewound inside a shot`);
      run = segment.run;
      const sourceEnd = segment.srcStart + srcOffset(segment, segment.end - segment.start);
      assert.ok(sourceEnd <= clips[segment.clip].duration + 0.001, `${styleId}: source exceeded duration`);
      sourceEnds[segment.clip] = sourceEnd;
      last = segment.end;
    }
    assert.ok(plan.duration <= 15.5);
    assert.ok(Math.abs(plan.duration - last) < 0.0001);
    if (duration >= 1) assert.ok(plan.duration >= 14, `${styleId} ${duration}s clips: edit ended early at ${plan.duration.toFixed(1)}s`);
  }
});

test('all four edits run the full length even from one short clip', () => {
  const clips = [clip(9)], music = syntheticMusic(), avoid = [];
  const lengths = [];
  for (const [i, styleId] of ['beat', 'dimension', 'velocity', 'glitch'].entries()) {
    const plan = planEdit({ clips, music, musicStart: 0, length: 30, styleId, seed: 100 + i, preserveSpeech: false, avoid: avoid.length ? avoid : null });
    for (const s of plan.segments) (avoid[s.clip] ||= []).push([s.srcStart, s.srcStart + s.srcDur]);
    lengths.push(plan.duration);
  }
  assert.ok(lengths.every((d) => d >= 29 && Math.abs(d - lengths[0]) < 0.01), `lengths ${lengths.map((d) => d.toFixed(1))}`);
});

test('still pictures (end cards, posters) never make it into an edit', () => {
  const c = clip(40);
  c.stills = [[12, 16], [33, 40]]; c.usableEnd = 33;
  const music = syntheticMusic();
  for (const mode of ['auto', 'scenes']) for (const seed of [1, 5, 9]) {
    const plan = planEdit({ clips: [c], music, musicStart: 0, length: 30, styleId: 'cinematic', seed, preserveSpeech: false, mode });
    assert.ok(plan.duration >= 29, 'still full length');
    for (const s of plan.segments) {
      const a = s.srcStart, b = s.srcStart + srcOffset(s, s.end - s.start);
      for (const [x, y] of c.stills) assert.ok(Math.min(b, y) - Math.max(a, x) <= 0.001, `${mode}: shot ${a.toFixed(2)}–${b.toFixed(2)} shows a still`);
    }
  }
});

test('body framing fills the chosen format without letterboxing, and beat effects still work', () => {
  const c = clip(10);
  c.track = buildTrack([{ t: 0, pick: { x: 0.8, y: 0.5, w: 0.4, h: 0.85, kind: 'body' } }], 10);
  const plan = planEdit({ clips: [c], music: syntheticMusic(), musicStart: 0, length: 7, styleId: 'impact', seed: 3 });
  const ctx = makeCtx({ format: '9:16', framing: 'fill', focus: 'on' }, syntheticMusic(), [c]);
  const frame = frameAt(plan, 0.7, ctx);
  assert.equal(frame.U.fit, 0); assert.equal(frame.U.bars, 0);
  assert.ok(Math.abs(frame.U.crop[0] - 0.8) < 0.002);
});

test('the auto-focus camera keeps two people in frame and does not move while they stay put', () => {
  const people = [{ x: 0.42, y: 0.5, top: 0.15, w: 0.1, h: 0.7, score: 0.9 }, { x: 0.58, y: 0.5, top: 0.18, w: 0.1, h: 0.66, score: 0.9 }];
  const group = subjectGroup([], people);
  const raw = Array.from({ length: 40 }, (_, i) => ({ t: i / 4, pick: { x: 0.42, y: 0.5, w: 0.1, h: 0.7, kind: 'body' }, group }));
  const track = buildTrack(raw, 10);
  const win = 0.316; // 9:16 window out of a 16:9 frame
  const xs = [1, 3, 5, 7, 9].map(t => cameraAt(track, t, win, 1).x);
  for (const x of xs) { assert.ok(x - win / 2 <= group.x0 + 1e-6 && x + win / 2 >= group.x1 - 1e-6, 'both people inside'); }
  assert.ok(Math.max(...xs) - Math.min(...xs) < 0.001, 'a still scene keeps a locked-off camera');
});

test('the four edits pick different footage from the same clips', () => {
  const clips = [clip(40), { ...clip(40), id: 'b' }];
  const music = syntheticMusic();
  const a = planEdit({ clips, music, musicStart: 0, length: 12, styleId: 'beat', seed: 11, preserveSpeech: false });
  const avoid = [];
  for (const s of a.segments) (avoid[s.clip] ||= []).push([s.srcStart, s.srcStart + s.srcDur]);
  const b = planEdit({ clips, music, musicStart: 0, length: 12, styleId: 'velocity', seed: 12, preserveSpeech: false, avoid });
  let shared = 0, total = 0;
  for (const s of b.segments) {
    total += s.srcDur;
    for (const [x, y] of avoid[s.clip] || []) shared += Math.max(0, Math.min(s.srcStart + s.srcDur, y) - Math.max(s.srcStart, x));
  }
  assert.ok(shared / total < 0.2, `edits overlap ${(shared / total * 100).toFixed(0)}%`);
});

test('style parts can be ticked off', () => {
  const dim = styleWith('dimension', ['tilt', 'echo', 'flips']);
  assert.equal(dim.cont.card, 1); assert.equal(dim.cont.ghosts, 0); assert.ok(!dim.trans.flip);
  assert.equal(STYLES.dimension.cont.card, 0.86, 'the original style is untouched');
  for (const [id, s] of Object.entries(STYLES)) if (!s.hidden && !s.pure) assert.ok(s.parts?.length >= 2, `${id} has tickable parts`);
  // effects a style doesn't have can be added ('+key'), without touching the original
  const added = styleWith('pure', ['+flips', '+detail', '+shock']);
  assert.ok(added.trans.flip > 0 && added.fx.detail === 1 && added.beat.shockBeat === 1);
  assert.ok(!STYLES.pure.trans.flip && !STYLES.pure.fx, 'Beat Sync itself stays plain');
  assert.ok(allParts('pure').length >= 40 && allParts('pure').every((p) => !p.native), 'every effect is listed for any style');
});

test('Beat Sync is only cuts on the beat: no zooms, flashes or effects', () => {
  const c = clip(40, []);
  const music = syntheticMusic();
  const plan = planEdit({ clips: [c], music, musicStart: 0, length: 15, styleId: 'pure', seed: 3 });
  assert.ok(plan.segments.length > 4);
  assert.ok(plan.segments.every((s) => (!s.transIn || s.transIn.type === 'cut') && s.profile.type === 'const' && s.profile.r === 1));
  const ctx = makeCtx({ intensity: 1, framing: 'fill', filter: 'none', fx: [], format: '9:16' }, music, [c]);
  for (let t = 0; t < plan.duration; t += 0.1) {
    const { U } = frameAt(plan, t, ctx);
    assert.equal(U.zoom, 1); assert.equal(U.flash, 0); assert.equal(U.rgb, 0); assert.equal(U.shock || 0, 0);
  }
});

test('best quote mode plays the inspiring line in full', () => {
  const say = (t0, text) => text.split(' ').map((w, i) => ({ start: t0 + i * 0.35, end: t0 + i * 0.35 + 0.3, text: w }));
  const words = [...say(0.5, 'so yeah we went to the store yesterday.'), ...say(5, 'never give up on your dreams because your life can change tomorrow.'),
    ...say(11, 'okay um that is it guys.')];
  const c = clip(16, words);
  const plan = planEdit({ clips: [c], music: syntheticMusic(), musicStart: 0, length: 15, styleId: 'beat', seed: 4, mode: 'quotes' });
  const first = plan.segments.filter(s => s.run === 0);
  assert.ok(Math.abs(first[0].srcStart - (5 - 0.12)) < 0.05, 'starts on the quote');
  assert.ok(first.at(-1).srcStart + first.at(-1).srcDur >= 5 + 11 * 0.35, 'plays the whole quote');
  assert.ok(first.every(s => s.profile.type === 'const' && s.profile.r === 1));
});

test('captions highlight the key word like GitHubReelMaker', () => {
  const ws = ['this', 'is', 'the', 'secret', 'to'].map((text, i) => ({ start: i * 0.3, end: i * 0.3 + 0.25, text }));
  const g = captionGroups(ws)[0];
  assert.equal(g.words.length, 5); assert.equal(g.highlight, 3);
});

const BW = 160, BH = 160;
// synthetic frame: picture in [x0,x1)×[y0,y1), black elsewhere, optional extra painted boxes
function frame(x0, y0, x1, y1, extra = [], fill = () => [100, 150, 200]) {
  const p = new Uint8ClampedArray(BW * BH * 4);
  const paint = (a, b, c, d, col) => { for (let y = b; y < d; y++) for (let x = a; x < c; x++) { const i = (y * BW + x) * 4; [p[i], p[i + 1], p[i + 2]] = col(x, y); p[i + 3] = 255; } };
  paint(x0, y0, x1, y1, fill);
  for (const [a, b, c, d, col] of extra) paint(a, b, c, d, () => col);
  return frameBounds(p, BW, BH);
}
const near = (a, b, eps = 1e-6) => a.every((v, k) => Math.abs(v - b[k]) < eps);

test('black bars baked into a clip are cropped off', () => {
  const lb = frame(0, 30, BW, 130);
  assert.deepEqual(lb, { left: 0, right: BW, top: 30, bottom: 130 });
  assert.ok(near(contentRect([lb, lb, lb], BW, BH), [0, 31 / BH, 1, 98 / BH]));
  // one bright title card no longer cancels the crop
  assert.ok(near(contentRect([lb, lb, frame(0, 0, BW, BH)], BW, BH), [0, 31 / BH, 1, 98 / BH]));
  // pillarbox: phone video sitting in a 16:9 frame
  const pb = frame(55, 0, 105, BH);
  assert.ok(near(contentRect([pb, pb, pb], BW, BH), [56 / BW, 0, 48 / BW, 1]));
  // a title or logo written inside the bar is not mistaken for picture
  assert.deepEqual(frame(0, 30, BW, 130, [[40, 8, 120, 16, [255, 255, 255]], [130, 140, 150, 148, [240, 240, 0]]]), lb);
  // dark but noisy picture (night sky) on one side is not a bar
  const noisy = (x, y) => { const v = 4 + ((x * 7 + y * 13) % 24); return [v, v, v + 2]; };
  assert.deepEqual(frame(0, 30, BW, 130, [], (x, y) => (x >= 110 ? noisy(x, y) : [100, 150, 200])), lb);
  // dark-grey bars from a sloppy encode still count
  const grey = new Uint8ClampedArray(BW * BH * 4).fill(18);
  for (let y = 30; y < 130; y++) for (let x = 0; x < BW; x++) { const i = (y * BW + x) * 4; grey[i] = 100; grey[i + 1] = 150; grey[i + 2] = 200; }
  assert.deepEqual(frameBounds(grey, BW, BH), lb);
  // a fully dark frame tells us nothing
  assert.equal(frame(0, 0, 0, 0), null);
  // no bars, no crop
  const full = frame(0, 0, BW, BH);
  assert.deepEqual(contentRect([full, full, full], BW, BH), [0, 0, 1, 1]);
});

test('bar crop follows the shot: letterboxed parts crop, full-frame parts stay whole', () => {
  const lb = frame(0, 30, BW, 130), full = frame(0, 0, BW, BH);
  // dark night shot inside the letterbox: lower picture rows black too
  const night = frame(0, 30, BW, 100);
  const bounds = [lb, lb, night, lb, lb, lb, full, full, full, full, full, full];
  const times = bounds.map((_, i) => i + 0.5);
  const tl = barTimeline(bounds, times, BW, BH);
  const lbRect = [0, 31 / BH, 1, 98 / BH];
  assert.ok(near(rectBetween(tl, 0.5, 3), lbRect), 'dark frame inside the letterbox does not over-crop');
  assert.deepEqual(rectBetween(tl, 8, 11), [0, 0, 1, 1]);
  assert.ok(near(rectBetween(tl, 3, 9), lbRect), 'a shot that crosses into the letterbox keeps bars out');

  const c = clip(12); c.barTimeline = tl; c.contentRect = contentRect(bounds, BW, BH);
  const music = syntheticMusic();
  const plan = planEdit({ clips: [c], music, musicStart: 0, length: 8, styleId: 'impact', seed: 3 });
  for (const seg of plan.segments) {
    const fr = frameAt(plan, seg.start + 0.01, makeCtx({ framing: 'fill', format: '9:16' }, music, [c]));
    const end = seg.srcStart + Math.max(seg.srcDur || 0, srcOffset(seg, seg.end - seg.start));
    assert.deepEqual(fr.U.sourceRect, rectBetween(tl, seg.srcStart, end, c.contentRect));
  }
});

test('focus coordinates are transformed after trimming source bars', () => {
  const c = clip(10); c.contentRect = [0.1, 0.1, 0.8, 0.8];
  c.track = buildTrack([{ t: 0, pick: { x: 0.7, y: 0.5, w: 0.4, h: 0.8, kind: 'body' } }], 10);
  const music = syntheticMusic();
  const plan = planEdit({ clips: [c], music, musicStart: 0, length: 7, styleId: 'cinematic', seed: 1 });
  const frame = frameAt(plan, 1, makeCtx({ focus: 'on', framing: 'fill', format: '9:16', fx: ['bars'] }, music, [c]));
  assert.ok(Math.abs(frame.U.crop[0] - 0.75) < 0.001);
  assert.equal(frame.U.bars, 0); assert.equal(frame.U.fit, 0);
  assert.deepEqual(frame.U.sourceRect, c.contentRect);
});

import { setFraming, framingAt, aimFor, personAt } from '../app/js/reframe.js';

test('shot editor: framing ranges split cleanly and the newest choice wins', () => {
  const c = clip(20);
  setFraming(c, 0, 20, { mode: 'lock', x: 0.2, y: 0.5 });
  setFraming(c, 5, 8, { mode: 'main', z: 1.5 });
  assert.deepEqual(c.framing.map((f) => [f.a, f.b, f.mode]), [[0, 5, 'lock'], [5, 8, 'main'], [8, 20, 'lock']]);
  assert.equal(framingAt(c, 6).mode, 'main');
  assert.equal(framingAt(c, 9).x, 0.2);
  setFraming(c, 4, 9, null); // back to auto for that part
  assert.equal(framingAt(c, 6), null);
  assert.deepEqual(c.framing.map((f) => [f.a, f.b]), [[0, 4], [9, 20]]);
});

test('shot editor: a locked aim and zoom reach the rendered frame (preview and export)', () => {
  const c = clip(10);
  c.track = buildTrack([{ t: 0, pick: { x: 0.8, y: 0.5, w: 0.3, h: 0.8, kind: 'body' } }], 10);
  const music = syntheticMusic();
  const plan = planEdit({ clips: [c], music, musicStart: 0, length: 7, styleId: 'beat', seed: 4 });
  const ctx = makeCtx({ focus: 'on', framing: 'fill', format: '9:16', intensity: 0 }, music, [c]);
  const s0 = plan.segments[0];
  const before = frameAt(plan, s0.start + 0.05, ctx);
  setFraming(c, 0, 10, { mode: 'lock', x: 0.25, y: 0.4, z: 2 });
  const after = frameAt(plan, s0.start + 0.05, ctx);
  assert.ok(Math.abs(before.U.crop[0] - 0.8) < 0.05, 'auto followed the person on the right');
  assert.ok(Math.abs(after.U.crop[0] - 0.25) < 1e-6 && Math.abs(after.U.crop[1] - 0.4) < 1e-6, 'aim moved where you put it');
  assert.ok(after.U.zoom > before.U.zoom * 1.9, 'zoomed in');
  // fit mode always shows the whole picture
  const fit = frameAt(plan, s0.start + 0.05, makeCtx({ focus: 'on', framing: 'fit', format: '9:16' }, music, [c]));
  assert.equal(fit.U.fit, 1);
});

test('shot editor: "pick a person" keeps following that person, not the bigger one', () => {
  // A (big, left, still) and B (smaller, starts right, walks left toward the middle)
  const raw = Array.from({ length: 20 }, (_, i) => ({ t: i * 0.5, pick: { x: 0.25, y: 0.5, w: 0.3, h: 0.9, kind: 'body' },
    boxes: [[0.25, 0.5, 0.3, 0.9], [0.8 - i * 0.012, 0.55, 0.15, 0.6]] }));
  const c = clip(10); c.track = buildTrack(raw, 10);
  setFraming(c, 0, 10, { mode: 'person', seed: { t: 2, x: 0.776, y: 0.55 } });
  const fo = framingAt(c, 5);
  for (const t of [0.5, 3, 6, 9]) {
    const p = personAt(c.track, fo, t);
    assert.ok(Math.abs(p.x - (0.8 - (t / 0.5) * 0.012)) < 0.02, `t=${t}: follows B (got ${p.x.toFixed(3)})`);
  }
  const aim = aimFor({ mode: 'main', z: 1 }, c, 3, 0.3, 1);
  assert.ok(Math.abs(aim.x - 0.25) < 0.01, 'main person is still A');
});

test('shot editor: framing set on one cut changes only that cut, not the rest of the clip or other edits', () => {
  const c = clip(20);
  c.track = buildTrack([{ t: 0, pick: { x: 0.8, y: 0.5, w: 0.3, h: 0.8, kind: 'body' } }], 20);
  const music = syntheticMusic();
  const a = planEdit({ clips: [c], music, musicStart: 0, length: 10, styleId: 'beat', seed: 7 });
  const b = planEdit({ clips: [c], music, musicStart: 0, length: 10, styleId: 'glitch', seed: 8 });
  const ctx = makeCtx({ focus: 'on', framing: 'fill', format: '9:16', intensity: 0 }, music, [c]);
  const [s0, s1, s2] = a.segments;
  s1.framing = { mode: 'lock', x: 0.2, y: 0.5, z: 1 };
  const at = (plan, s) => frameAt(plan, s.start + 0.02, ctx).U.crop[0];
  assert.ok(Math.abs(at(a, s1) - 0.2) < 1e-6, 'the chosen cut is aimed where you set it');
  assert.ok(Math.abs(at(a, s0) - 0.8) < 0.05 && Math.abs(at(a, s2) - 0.8) < 0.05, 'the cuts around it keep the automatic camera');
  for (const s of b.segments) assert.ok(Math.abs(at(b, s) - 0.8) < 0.05, 'other edits are untouched');
});

import { styleParts } from '../app/js/styles.js';
import { FX_KEYS } from '../app/js/styles.js';

test('every effect a style uses can be ticked off — with all of them off, nothing is left', () => {
  const music = syntheticMusic();
  const c = clip(30);
  for (const styleId of Object.keys(STYLES)) {
    const off = styleParts(styleId).map(([k]) => k);
    const plan = planEdit({ clips: [c], music, musicStart: 0, length: 12, styleId, seed: 5, off, preserveSpeech: false });
    const ctx = makeCtx({ framing: 'fill', format: '9:16', intensity: 1 }, music, [c]);
    for (const s of plan.segments) {
      assert.equal(s.profile.type, 'const', `${styleId}: speed`); assert.ok(Math.abs((s.profile.r ?? 1) - 1) < 1e-9, `${styleId}: speed ${s.profile.r}`);
      assert.ok(!s.transIn || s.transIn.type === 'cut', `${styleId}: transition ${s.transIn && s.transIn.type}`);
      assert.equal(s.mirror, 0, `${styleId}: mirror`);
    }
    for (let t = 0.05; t < plan.duration; t += 0.37) {
      const U = frameAt(plan, t, ctx).U, at = `${styleId} @${t.toFixed(2)}`;
      assert.ok(Math.abs(U.zoom - 1) < 1e-9, `${at}: zoom ${U.zoom}`);
      for (const k of ['rgb', 'flash', 'glow', 'vignette', 'grain', 'scan', 'ghosts', 'glitch', 'invert', 'bw', 'hue', 'radial', 'rot', 'mirror'])
        assert.ok(!U[k], `${at}: ${k} = ${U[k]}`);
      for (const k of FX_KEYS) assert.ok(!U[k], `${at}: ${k} = ${U[k]}`);
      assert.equal(U.card, 1, `${at}: card`); assert.ok(!U.tilt[0] && !U.tilt[1], `${at}: tilt`);
      assert.ok(!U.offset[0] && !U.offset[1], `${at}: shake`); assert.ok(!U.blur[0] && !U.blur[1], `${at}: blur`);
      assert.equal(U.contrast, 1, `${at}: contrast`); assert.equal(U.sat, 1, `${at}: sat`);
    }
  }
});

test('"In order" edits follow the clips in list order and move forward through each video', () => {
  const music = syntheticMusic();
  const a = { ...clip(40), id: 'a' }, b = { ...clip(25), id: 'b' }, c = { ...clip(30), id: 'c' };
  for (const styleId of ['beat', 'dimension', 'cinematic', 'glitch']) for (const seed of [1, 9, 42]) {
    const plan = planEdit({ clips: [a, b, c], music, musicStart: 0, length: 30, styleId, seed, order: 'story', preserveSpeech: false });
    const offs = [0, 40, 65];
    let last = -1, runs = 0;
    for (const s of plan.segments) {
      const g = offs[s.clip] + s.srcStart;
      assert.ok(g >= last - 0.05, `${styleId}/${seed}: went back in the story (${last.toFixed(2)} -> ${g.toFixed(2)})`);
      last = g + srcOffset(s, s.end - s.start);
    }
    runs = new Set(plan.segments.map((s) => s.run)).size;
    assert.ok(plan.duration >= 29, `${styleId}: full length`);
    const first = plan.segments[0], lastSeg = plan.segments.at(-1);
    assert.equal(first.clip, 0, 'starts with the first clip'); assert.equal(lastSeg.clip, 2, 'ends with the last clip');
    assert.ok(offs[first.clip] + first.srcStart < 95 * 0.2, `${styleId}: starts near the beginning`);
    assert.ok(offs[lastSeg.clip] + lastSeg.srcStart > 95 * 0.65, `${styleId}: reaches the end (${(offs[lastSeg.clip] + lastSeg.srcStart).toFixed(1)})`);
    assert.ok(runs >= 2);
  }
  // scattered (default) is unchanged and still jumps around
  const sc = planEdit({ clips: [a, b, c], music, musicStart: 0, length: 30, styleId: 'beat', seed: 3, preserveSpeech: false });
  assert.equal(sc.order, 'scattered');
});

test('"In order" with less footage than the edit goes around again instead of ending early', () => {
  const music = syntheticMusic();
  const plan = planEdit({ clips: [clip(6), { ...clip(5), id: 'z' }], music, musicStart: 0, length: 30, styleId: 'beat', seed: 2, order: 'story', preserveSpeech: false });
  assert.ok(plan.duration >= 29, `ended at ${plan.duration.toFixed(1)}`);
});

test('a trimmed clip (start + length picked in the Clips list) is only used inside that part', () => {
  const music = syntheticMusic();
  const a = { ...clip(60), id: 'a', trim: [20, 32] }, b = { ...clip(40), id: 'b', trim: [5, 15] };
  for (const order of ['scattered', 'story']) for (const mode of ['auto', 'scenes']) for (const styleId of ['beat', 'cinematic', 'glitch']) for (const seed of [1, 7]) {
    const plan = planEdit({ clips: [a, b], music, musicStart: 0, length: 30, styleId, seed, order, mode, preserveSpeech: false });
    assert.ok(plan.duration >= 29, `${order}/${mode}/${styleId}: full length (${plan.duration.toFixed(1)})`);
    for (const s of plan.segments) {
      const [t0, t1] = [a, b][s.clip].trim, end = s.srcStart + srcOffset(s, s.end - s.start);
      assert.ok(s.srcStart >= t0 - 0.05 && end <= t1 + 0.05, `${order}/${mode}/${styleId}: clip ${s.clip} used ${s.srcStart.toFixed(2)}-${end.toFixed(2)} outside ${t0}-${t1}`);
    }
  }
  // the whole clip again when the trim covers everything
  const whole = planEdit({ clips: [{ ...clip(60), trim: [0, 60] }], music, musicStart: 0, length: 30, styleId: 'beat', seed: 1, preserveSpeech: false });
  assert.ok(whole.segments.some((s) => s.srcStart > 32), 'untrimmed clip uses its whole length');
});

test('the auto-focus camera stays steady through detector wobble and glides (no whip) when the main person changes', () => {
  const win = 0.316, raw = [];
  // 12s at 4 samples/s: person A (x≈0.3) wobbles, a few flicker samples jump to B, then from 6s B (x≈0.7) is the subject
  for (let i = 0; i < 48; i++) {
    const t = i / 4, wob = Math.sin(i * 2.7) * 0.025;
    let x = (t < 6 ? 0.3 : 0.7) + wob;
    if (i === 9 || i === 14 || i === 15) x = 0.7; // detector briefly locks onto someone else
    const people = [{ x, y: 0.5, top: 0.15, w: 0.12, h: 0.7, score: 0.9 }];
    raw.push({ t, pick: { x, y: 0.5, w: 0.12, h: 0.7, kind: 'body' }, group: subjectGroup([], people) });
  }
  const track = buildTrack(raw, 12);
  const xs = [];
  for (let t = 0; t <= 11.75; t += 1 / 30) xs.push(cameraAt(track, t, win, 1).x);
  const before = xs.slice(0, Math.round(4.25 * 30)), after = xs.slice(8 * 30);
  assert.ok(Math.max(...before) - Math.min(...before) < 0.03, `steady on A (moved ${(Math.max(...before) - Math.min(...before)).toFixed(3)})`);
  assert.ok(Math.max(...after) - Math.min(...after) < 0.03, 'steady on B');
  // the change of subject is one smooth move: limited speed per frame and no reversals
  let maxStep = 0, reversals = 0, lastSign = 0;
  for (let k = 1; k < xs.length; k++) {
    const d = xs[k] - xs[k - 1];
    maxStep = Math.max(maxStep, Math.abs(d));
    if (Math.abs(d) > 0.0005) { const sg = Math.sign(d); if (lastSign && sg !== lastSign) reversals++; lastSign = sg; }
  }
  assert.ok(maxStep < 0.02, `no whip pan (max ${maxStep.toFixed(4)}/frame)`);
  assert.ok(reversals <= 1, `no back-and-forth (${reversals} reversals)`);
  // and the person stays in frame the whole time
  for (let k = 0; k < xs.length; k++) {
    const t = k / 30, px = t < 6 ? 0.3 : 0.7;
    if (Math.abs(t - 6) < 1.2) continue; // during the hand-over
    assert.ok(Math.abs(xs[k] - px) < win / 2, `subject in frame at ${t.toFixed(2)}s`);
  }
});

test('smarter picks: opens on the strongest moment, spreads across the clips, avoids blurry parts', () => {
  const music = syntheticMusic();
  const peaky = (dur, id, peaks, poor = []) => {
    const interest = new Float32Array(dur * 10).fill(0.25);
    for (const [t, v] of peaks) for (let i = Math.max(0, (t - 1.5) * 10); i < Math.min(dur * 10, (t + 1.5) * 10); i++) interest[i] = Math.max(interest[i], v * (1 - Math.abs(i / 10 - t) / 2));
    const quality = Array.from({ length: dur }, (_, s) => (poor.some(([a, b]) => s >= a && s < b) ? 0.05 : 0.8));
    return { id, duration: dur, usableEnd: dur, w: 1920, h: 1080, words: [], interest, quality, moments: findMoments(interest, dur, {}) };
  };
  // clip A has the single best moment (at 30s) and lots of good ones; clip B is decent all over
  const A = peaky(60, 'A', [[8, 0.6], [18, 0.62], [30, 1], [44, 0.6], [52, 0.58]]);
  const B = peaky(60, 'B', [[10, 0.5], [25, 0.52], [40, 0.5]], [[0, 6]]);
  let hook = 0, n = 0;
  for (const styleId of ['beat', 'velocity', 'cinematic', 'glitch']) for (const seed of [1, 2, 3]) {
    const plan = planEdit({ clips: [A, B], music, musicStart: 0, length: 20, styleId, seed, preserveSpeech: false });
    const first = plan.segments[0];
    if (first.clip === 0 && first.srcStart > 27 && first.srcStart < 31.5) hook++;
    n++;
    // neither clip takes (almost) the whole edit
    const t = [0, 0];
    for (const s of plan.segments) t[s.clip] += s.end - s.start;
    assert.ok(t[1] / plan.duration > 0.2, `${styleId}/${seed}: clip B gets screen time (${(t[1] / plan.duration * 100).toFixed(0)}%)`);
    assert.ok(t[0] / plan.duration > 0.2, `${styleId}/${seed}: clip A gets screen time`);
    // blurry start of B is avoided
    for (const s of plan.segments) if (s.clip === 1) assert.ok(s.srcStart >= 5.5, `${styleId}/${seed}: used blurry footage at ${s.srcStart.toFixed(1)}`);
  }
  assert.ok(hook >= n * 0.6, `opens on the best moment in most edits (${hook}/${n})`);
});

test('the auto-focus camera follows a person walking across the frame (smoothly, without falling behind)', () => {
  const win = 0.316, raw = [];
  const walkX = (t) => (t < 2 ? 0.25 : t > 7 ? 0.75 : 0.25 + (t - 2) / 5 * 0.5);
  for (let i = 0; i < 40; i++) {
    const t = i / 4, x = walkX(t) + Math.sin(i * 2.7) * 0.015; // detector noise on top of the walk
    raw.push({ t, pick: { x, y: 0.5, w: 0.12, h: 0.7, kind: 'body' }, group: subjectGroup([], [{ x, y: 0.5, top: 0.15, w: 0.12, h: 0.7, score: 0.9 }]) });
  }
  const track = buildTrack(raw, 10);
  let lag = 0, lagMax = 0, k = 0, reversals = 0, lastSign = 0, prev = null;
  for (let t = 0; t <= 9.75; t += 1 / 30) {
    const x = cameraAt(track, t, win, 1).x, e = Math.abs(x - walkX(t));
    lag += e; lagMax = Math.max(lagMax, e); k++;
    if (prev != null && Math.abs(x - prev) > 0.0008) { const sg = Math.sign(x - prev); if (lastSign && sg !== lastSign) reversals++; lastSign = sg; }
    prev = x;
  }
  assert.ok(lag / k < win * 0.05, `keeps the walker near the center (avg off by ${(lag / k / win * 100).toFixed(1)}% of the frame)`);
  assert.ok(lagMax < win * 0.15, `never falls far behind (max ${(lagMax / win * 100).toFixed(1)}%)`);
  assert.equal(reversals, 0, 'one smooth move, no shake');
});

test('Movie Edit: holds the opening moment until the drop, then a new shot on every beat, all on the beat', () => {
  const music = syntheticMusic();
  const A = { ...clip(60), id: 'A' }, B = { ...clip(50), id: 'B' };
  for (const seed of [1, 2, 3]) for (const order of ['story', 'scattered']) {
    const plan = planEdit({ clips: [A, B], music, musicStart: 0, length: 20, styleId: 'movie', seed, order, preserveSpeech: false });
    assert.ok(plan.intro >= 3.2 && plan.intro <= 6.5, `intro ${plan.intro}`);
    const first = plan.segments.filter((s) => s.run === plan.segments[0].run);
    assert.ok(Math.abs(first.at(-1).end - plan.intro) < 0.01, 'one unbroken shot until the drop');
    assert.equal(first.length, 1, 'no cuts inside the opening hold');
    const bt = plan.beats.map((b) => b.t);
    const shots = plan.segments.filter((s, i) => i && s.run !== plan.segments[i - 1].run);
    for (const s of shots) assert.ok(bt.some((b) => Math.abs(b - s.start) < 0.03), `shot change at ${s.start.toFixed(2)} is on a beat`);
    const after = plan.segments.filter((s) => s.start >= plan.intro - 0.01);
    const avg = after.reduce((a, s) => a + s.end - s.start, 0) / after.length;
    assert.ok(avg < plan.period * 1.35, `about one beat per shot after the drop (${(avg / plan.period).toFixed(2)} beats)`);
    assert.ok(plan.duration >= 19, 'full length');
  }
});

test('Movie Edit: a line of dialogue opens the edit and is marked to be heard over the song', () => {
  const talk = clip(20, words), quiet = { ...clip(40), id: 'q' };
  const plan = planEdit({ clips: [talk, quiet], music: syntheticMusic(), musicStart: 0, length: 20, styleId: 'movie', seed: 4, order: 'scattered', preserveSpeech: true });
  assert.ok(plan.intro > 0);
  assert.equal(plan.segments[0].clip, 0, 'opens on the clip with dialogue');
  assert.ok(plan.segments[0].voice && plan.voice, 'opening dialogue is voiced');
  assert.ok(plan.segments.filter((s) => s.start >= plan.intro).every((s) => !s.voice), 'only the opening is voiced');
  // switching the "hold until the drop" part off removes the intro
  const noIntro = planEdit({ clips: [talk, quiet], music: syntheticMusic(), musicStart: 0, length: 20, styleId: 'movie', seed: 4, off: ['intro'], preserveSpeech: true });
  assert.equal(noIntro.intro, 0);
});

test('crowd ratings: lines fans quote / Wikiquote lists win "Best quote", most-replayed parts win "Best scene"', async () => {
  const { quoteMoments, sceneMoments, applyCrowd, crowdBoost } = await import('../app/js/moments.js');
  // 4 sentences; the 3rd is the famous one, the 2nd is what fans quote in the comments
  const lines = ['we should probably get going now before it gets dark.', 'you know what I think about all of this honestly man.',
    'I am not in danger I am the danger.', 'okay fine let us just go home then alright.'];
  const w = [];
  lines.forEach((l, k) => l.split(' ').forEach((t, j) => w.push({ start: k * 6 + j * 0.4, end: k * 6 + j * 0.4 + 0.35, text: t })));
  const c = { ...clip(30, w), id: 'crowd' };
  const before = quoteMoments(c)[0];
  c.crowd = { quotes: ['Skyler: Who are you talking to right now? I am not in danger, Skyler. I am the danger!'],
    comments: [{ text: '"you know what I think about all of this" lmao', likes: 5200 }],
    heatmap: [[0, 10, 0.1], [10, 20, 0.15], [20, 30, 1]], marks: [] };
  applyCrowd(c);
  const qs = quoteMoments(c);
  assert.match(qs[0].text, /i am the danger/i, `famous line first (was "${before?.text}")`);
  assert.match(qs[0].reason, /Wikiquote/);
  const fan = qs.find((q) => /what i think/i.test(q.text));
  assert.ok(fan && /Fans quote this \(5\.2K likes\)/.test(fan.reason), 'fan-quoted line is marked');
  assert.ok(qs.indexOf(fan) < qs.findIndex((q) => /get going/i.test(q.text)), 'fan-quoted line beats an ordinary one');
  // scenes: the most replayed stretch (20-30s) comes first
  const sc = sceneMoments(c);
  assert.ok(sc[0].start >= 18, `most replayed scene first (${sc[0].start})`);
  // unrelated text gets nothing
  assert.equal(crowdBoost(c, 'completely different words here today', 0, 2).famous, 0);
});

test('stream clips: viewer-clipped moments and big laughs become highlights, dead air is cut, cam found', async () => {
  const { findHighlights, planHighlight, findCam, removeDeadAir, stackRects } = await import('../app/js/stream.js');
  // a 5 minute stream: calm talking, a big laugh at 1:40, and a moment viewers clipped at 3:30 (80K views)
  const D = 300, interest = new Float32Array(D * 10).fill(0.2);
  for (let i = 980; i < 1060; i++) interest[i] = 0.75;
  const w = [];
  for (let t = 2; t < D - 2; t += 3) ['so', 'anyway', 'chat', 'we', 'are', 'just', 'playing'].forEach((x, k) => w.push({ start: t + k * 0.3, end: t + k * 0.3 + 0.25, text: x }));
  ['HAHAHA', 'bro', 'what', 'HAHAHA', 'no', 'way'].forEach((x, k) => w.push({ start: 100 + k * 0.5, end: 100 + k * 0.5 + 0.4, text: x }));
  w.sort((a, b) => a.start - b.start);
  const stream = { id: 's', duration: D, usableEnd: D, w: 1920, h: 1080, words: w, interest,
    crowd: { brain: { platform: 'kick', name: 'Cuffem', clips: [{ title: 'Cuffem reacts to his Minecraft skin', views: 80000, duration: 20 }],
      matches: [{ t0: 208, t1: 228, views: 80000, title: 'Cuffem reacts to his Minecraft skin 👀' }], typicalLength: 22 } } };
  const hs = findHighlights([stream], { count: 4, maxLen: 30 });
  assert.ok(hs.length >= 2);
  assert.ok(hs[0].a <= 210 && hs[0].b >= 226, `viewer-clipped moment first (${hs[0].a.toFixed(1)}-${hs[0].b.toFixed(1)})`);
  assert.match(hs[0].title, /Minecraft skin/);
  assert.match(hs[0].why, /Viewers clipped this, 80K views/);
  assert.ok(hs.some((h) => h.a <= 100 && h.b >= 102 && /laugh/i.test(h.why)), 'the big laugh is a highlight');
  for (const h of hs) assert.ok(h.b - h.a <= 30.01, 'not longer than the max');
  // dead air: a 3s pause between words is cut out
  const talk = { duration: 20, interest: new Float32Array(200).fill(0.1),
    words: [{ start: 1, end: 1.4, text: 'yo' }, { start: 1.5, end: 1.9, text: 'chat' }, { start: 5, end: 5.4, text: 'look' }, { start: 5.5, end: 5.9, text: 'at' }] };
  const pieces = removeDeadAir(talk, 0.8, 6.2);
  assert.equal(pieces.length, 2);
  assert.ok(pieces[0][1] < 2.2 && pieces[1][0] > 4.7, JSON.stringify(pieces));
  // facecam in the top-left corner of a gameplay stream -> stacked layout
  const boxes = Array.from({ length: 50 }, () => [[0.12, 0.2, 0.14, 0.26]]);
  const g = { ...stream, track: { n: 50, boxes } };
  const cam = findCam(g);
  assert.ok(cam.steady && !cam.full, JSON.stringify(cam));
  const plan = planHighlight(hs[0], [g], { layout: 'auto', outAspect: 9 / 16 });
  assert.equal(plan.highlight.layout, 'stack');
  assert.ok(plan.noMusic && plan.mode === 'stream');
  const { camRect } = stackRects(g, 9 / 16, 0.5, cam);
  assert.ok(camRect[0] <= 0.12 && camRect[0] + camRect[2] >= 0.12 && camRect[2] < 0.6, `cam crop around the facecam ${camRect.map((v) => v.toFixed(2))}`);
  // an IRL stream (person fills the frame) -> full frame
  const irl = { ...stream, track: { n: 50, boxes: Array.from({ length: 50 }, () => [[0.5, 0.55, 0.4, 0.8]]) } };
  assert.equal(planHighlight(hs[0], [irl], { layout: 'auto' }).highlight.layout, 'full');
  // a room camera where someone sits still mid-left is not a facecam overlay -> full frame
  const room = { ...stream, track: { n: 50, boxes: Array.from({ length: 50 }, () => [[0.24, 0.5, 0.11, 0.32]]) } };
  room.cam = findCam(room);
  assert.ok(!room.cam.steady);
  assert.equal(planHighlight(hs[0], [room], { layout: 'auto' }).highlight.layout, 'full');
});

test('stream clips: a short cut keeps the most exciting part on whole sentences', async () => {
  const { tightCut, removeDeadAir } = await import('../app/js/stream.js');
  const interest = new Float32Array(300).fill(0.2);
  for (let i = 180; i < 230; i++) interest[i] = 0.9;
  const words = [];
  for (let t = 0.5; t < 29; t += 2.5) ['this', 'is', 'a', 'line.'].forEach((x, k) => words.push({ start: t + k * 0.4, end: t + k * 0.4 + 0.3, text: x }));
  const clip = { duration: 30, interest, words };
  const h = { ci: 0, a: 0, b: 30, why: 'Viewer clip · 1M views', title: 't', pieces: removeDeadAir(clip, 0, 30), punches: [] };
  const c = tightCut(h, clip);
  assert.ok(c && c.b - c.a <= 17 && c.b - c.a >= 6, `${c?.a}-${c?.b}`);
  assert.ok(c.a <= 18 && c.b >= 23, 'covers the exciting part');
  assert.match(c.why, /short cut/);
});

test('stream clips: a longer version adds build-up, stays one piece in time and within the max length', async () => {
  const { longCut } = await import('../app/js/stream.js');
  const words = [];
  for (let t = 0.5; t < 59; t += 2.5) ['so', 'then', 'he', 'said.'].forEach((x, k) => words.push({ start: t + k * 0.4, end: t + k * 0.4 + 0.3, text: x }));
  const clip = { duration: 60, interest: new Float32Array(600).fill(0.3), words };
  const h = { ci: 0, a: 30, b: 42, why: 'Big laugh', title: 't', pieces: [[30, 42]], punches: [] };
  const L = longCut(h, clip, 30);
  assert.ok(L, 'made a longer cut');
  assert.ok(L.a < h.a - 2 && L.b >= h.b, `more build-up before the moment (${L.a}-${L.b})`);
  assert.ok(L.b - L.a <= 30.5, 'within the max length');
  assert.match(L.why, /longer/);
  // already at the max length: no longer version
  assert.equal(longCut({ ...h, a: 10, b: 40 }, clip, 30), null);
});

test('match clip: the whole clip without frozen ends, and cut parts that are switched off get skipped', async () => {
  const { wholeHighlights, keepParts } = await import('../app/js/stream.js');
  const { trimView, partsOff } = await import('../app/js/edit.js');
  const words = [];
  for (let t = 1.2; t < 10; t += 1.5) ['ok', 'chat', 'look.'].forEach((x, k) => words.push({ start: t + k * 0.4, end: t + k * 0.4 + 0.3, text: x }));
  // 11s clip, frozen for the first second and the last 1.5s
  const clip = { duration: 11, usableEnd: 11, interest: new Float32Array(110).fill(0.4), words, stills: [[0, 1], [9.5, 11]],
    crowd: { brain: { self: { views: 12000 } } } };
  const [h] = wholeHighlights([clip]);
  assert.equal(h.a, 1); assert.equal(h.b, 9.5);
  assert.match(h.why, /Viewer clip, 12K views/);
  // keepParts takes the switched-off stretches out of the pieces
  assert.deepEqual(keepParts([[0, 10]], [[3, 5]]), [[0, 3], [5, 10]]);
  assert.deepEqual(keepParts([[0, 4], [6, 10]], [[3, 7]]), [[0, 3], [7, 10]]);
  assert.deepEqual(keepParts([[0, 10]], []), [[0, 10]]);
  // parts: the first part off moves the start, a middle part off becomes a skip
  const c = { duration: 12, usableEnd: 12, parts: [{ a: 0, b: 2, on: false }, { a: 2, b: 6, on: true }, { a: 6, b: 8, on: false }, { a: 8, b: 12, on: true }] };
  assert.deepEqual(partsOff(c), [[0, 2], [6, 8]]);
  const v = trimView(c);
  assert.equal(v.trimIn, 2); assert.equal(v.usableEnd, 12);
  assert.ok(v.stills.some(([s, e]) => s === 6 && e === 8), JSON.stringify(v.stills));
  // the last part off moves the end
  const v2 = trimView({ ...c, parts: [{ a: 0, b: 6, on: true }, { a: 6, b: 12, on: false }] });
  assert.equal(v2.usableEnd, 6);
  // all parts on: the clip is untouched
  const all = { duration: 12, parts: [{ a: 0, b: 6, on: true }, { a: 6, b: 12, on: true }] };
  assert.equal(trimView(all), all);
});

test('keyframes glide between values and hold before the first and after the last; hook text shows only in its window', async () => {
  const { keyValues, hookAlpha, KEY_PROPS } = await import('../app/js/edit.js');
  assert.equal(keyValues(null, 1), null);
  const keys = [{ t: 0, scale: 0.5, opacity: 0 }, { t: 1, scale: 1, opacity: 1, ease: 'linear' }, { t: 2, rot: 90, ease: 'linear' }];
  assert.equal(keyValues(keys, -1).scale, 0.5);
  const mid = keyValues(keys, 0.5);
  assert.ok(Math.abs(mid.scale - 0.75) < 1e-9 && Math.abs(mid.opacity - 0.5) < 1e-9, JSON.stringify(mid));
  assert.equal(keyValues(keys, 1.5).rot, 45);
  assert.equal(keyValues(keys, 1.5).scale, 1, 'unset values fall back to the default');
  const end = keyValues(keys, 9);
  assert.equal(end.rot, 90); assert.equal(end.x, KEY_PROPS.x);
  // the default ease starts slow
  assert.ok(keyValues([{ t: 0, x: 0 }, { t: 1, x: 1 }], 0.25).x < 0.25);
  // hook: 1s to 3s with a fade in and out; no end = until the end of the video
  const h = { start: 1, end: 3 };
  assert.equal(hookAlpha(0.5, 10, h), 0);
  assert.equal(hookAlpha(2, 10, h), 1);
  assert.equal(hookAlpha(3.5, 10, h), 0);
  assert.ok(hookAlpha(1.1, 10, h) > 0 && hookAlpha(1.1, 10, h) < 1);
  assert.equal(hookAlpha(9.9, 10, { start: 0, end: 0 }), 1);
  assert.equal(hookAlpha(5, 10, null), 0);
});

test('cam / screen template: swapping puts the screen on top, whole screen keeps the full picture', async () => {
  const { stackRects } = await import('../app/js/stream.js');
  const clip = { w: 1920, h: 1080, duration: 10 };
  const cam = { x: 0.12, y: 0.2, w: 0.08, h: 0.14, steady: true };
  const fill = stackRects(clip, 9 / 16, 0.5, cam, { game: 'fill' });
  const whole = stackRects(clip, 9 / 16, 0.5, cam, { game: 'whole' });
  // filled: the game is cropped (less than the full width); whole: the full width shows
  assert.ok(fill.gameRect[2] < 0.99, `fill crops ${fill.gameRect}`);
  assert.ok(whole.gameRect[2] >= 0.99 || whole.gameRect[3] > 1, `whole shows everything ${whole.gameRect}`);
  const faceCam = stackRects(clip, 9 / 16, 0.5, cam, { cam: 'face' }).camRect, wholeCam = stackRects(clip, 9 / 16, 0.5, cam, { cam: 'whole' }).camRect;
  assert.ok(wholeCam[3] > faceCam[3], 'whole webcam shows more than the face close-up');
});

test('camera keyframes: the camera glides between keyframes and holds before the first and after the last', async () => {
  const { keyAim, aimFor } = await import('../app/js/reframe.js');
  const keys = [{ s: 10, o: 0, x: 0.2, y: 0.5, z: 1 }, { s: 12, o: 2, x: 0.8, y: 0.3, z: 2 }];
  assert.deepEqual(keyAim(keys, 9), { x: 0.2, y: 0.5, z: 1 });
  assert.deepEqual(keyAim(keys, 13), { x: 0.8, y: 0.3, z: 2 });
  const mid = keyAim(keys, 11);
  assert.ok(Math.abs(mid.x - 0.5) < 1e-9 && Math.abs(mid.y - 0.4) < 1e-9, JSON.stringify(mid));
  assert.ok(Math.abs(mid.z - Math.SQRT2) < 1e-9, 'zoom changes evenly (half way = x1.41, not x1.5)');
  // eased: a quarter of the way in time is less than a quarter of the way across
  assert.ok(keyAim(keys, 10.5).x < 0.2 + 0.6 * 0.25);
  // the framing entry: aimFor uses the keyframes
  const a = aimFor({ mode: 'keys', z: 1, keys }, { track: null }, 12.5, 0.3, 1);
  assert.deepEqual(a, { x: 0.8, y: 0.3, z: 2 });
});
