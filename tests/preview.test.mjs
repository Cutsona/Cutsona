import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../app/js/player.js';
import { planEdit, makeCtx } from '../app/js/edit.js';
import { syntheticMusic } from '../app/js/audio.js';

function fixture(playing = false) {
  const clip = { id: 'fixture', url: '/original.mp4', duration: 20, usableEnd: 20, w: 1920, h: 1080,
    interest: new Float32Array(200).fill(0.5), moments: [{ t: 3, start: 0, end: 20, score: 0.8 }] };
  const music = syntheticMusic(), settings = { focus: 'off', framing: 'fill', format: '9:16', clipVol: 0 };
  const plan = planEdit({ clips: [clip], music, musicStart: 0, length: 10, styleId: 'impact', seed: 2, noSpeed: true });
  const ctx = makeCtx(settings, music, [clip]);
  const video = { currentTime: plan.segments[0].srcStart, paused: !playing, seeking: false, muted: true,
    readyState: 4, _frameVersion: 1, playbackRate: 1, pause() { this.paused = true; } };
  const counts = { draws: 0, uploads: 0, decoders: new Set() };
  const renderer = { texCache: new Map(), setText() {}, setCaption() {}, setHook() {}, render(el, U, fresh) {
    counts.draws++; if (fresh) { counts.uploads++; this.texCache.set(el, {}); }
  } };
  const view = { canvas: { width: 270, height: 480 }, renderer, pool: new Map([['fixture:0', video]]) };
  const player = Object.create(Player.prototype);
  Object.assign(player, { views: [view], playing, loop: false, getCtx: () => ctx, getEff: () => settings, getText: () => null,
    // count the decoder that shows the current shot (the 2nd call per frame pre-rolls the NEXT shot)
    _el: (view, clip, deck, keep) => { if (!keep.length) counts.decoders.add(deck); return video; } });
  const state = { variants: [{ plan }], clips: [clip], settings, focused: 0, solo: false };
  return { player, video, counts, state, plan, settings };
}

test('paused previews settle after one draw and refresh when a setting changes', () => {
  const f = fixture();
  for (let i = 0; i < 30; i++) f.player._renderView(0, 0, f.state, 10);
  assert.equal(f.counts.draws, 1); assert.equal(f.counts.uploads, 1);
  f.player.views[0].dirty = true;
  f.player._renderView(0, 0, f.state, 10);
  assert.equal(f.counts.draws, 2); assert.equal(f.counts.uploads, 1);
});

test('animated effects reuse a decoded video frame instead of uploading it again', () => {
  const f = fixture(true);
  f.player._renderView(0, 0, f.state, 10);
  f.player._renderView(0, 0.02, f.state, 10);
  assert.equal(f.counts.draws, 2); assert.equal(f.counts.uploads, 1);
  f.video._frameVersion++;
  f.player._renderView(0, 0.03, f.state, 10);
  assert.equal(f.counts.uploads, 2);
});

test('continuous source playback retains one decoder across beat segments', () => {
  const f = fixture(true);
  const run = f.plan.segments[0].run;
  for (const seg of f.plan.segments.filter(s => s.run === run)) {
    f.video.currentTime = seg.srcStart;
    f.player._renderView(0, seg.start, f.state, 10);
  }
  assert.equal(f.counts.decoders.size, 1);
});
