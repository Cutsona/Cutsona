// Planner (builds an edit decision list) + per-frame effect evaluation.
import { STYLES, FILTERS, FX_KEYS, styleWith } from './styles.js';
import { sampleCurve } from './audio.js';
import { cameraAt } from './track.js';
import { rectBetween } from './framing.js';
import { framingAt, aimFor } from './reframe.js';
import { chooseWindow, speechPhrases, quoteMoments, sceneMoments, storyTimeline, chooseInOrder } from './moments.js';
import { stackRects } from './stream.js';

// crop for the source stretch a segment plays, computed once per segment
const SEG_RECT = new WeakMap();
function segRect(seg, clip) {
  const full = clip.contentRect || [0, 0, 1, 1];
  if (!clip.barTimeline || !clip.barTimeline.length) return full;
  const hit = SEG_RECT.get(seg);
  if (hit && hit.tl === clip.barTimeline) return hit.rect;
  const used = Math.max(seg.srcDur || 0, srcOffset(seg, seg.end - seg.start));
  const rect = rectBetween(clip.barTimeline, seg.srcStart, seg.srcStart + used, full);
  SEG_RECT.set(seg, { tl: clip.barTimeline, rect });
  return rect;
}

export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickWeighted(r, obj) {
  const entries = Array.isArray(obj) ? obj.map((o) => [o, o.p]) : Object.entries(obj);
  const total = entries.reduce((s, e) => s + e[1], 0);
  let x = r() * total;
  for (const [k, w] of entries) { x -= w; if (x <= 0) return k; }
  return entries[entries.length - 1][0];
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeOut = (u) => 1 - (1 - u) ** 3;
const easeIn = (u) => u * u * u;

// ---------------- speed profiles ----------------
function makeProfile(spec, d) {
  const p = { ...spec };
  delete p.p;
  if (p.type === 'velocity' || p.type === 'ramp') {
    const n = 48, tab = new Float32Array(n + 1);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      let v;
      if (p.type === 'velocity') v = p.lo + (p.hi - p.lo) * Math.sin(Math.PI * u) ** 2;
      else { const s = u * u * (3 - 2 * u); v = p.from + (p.to - p.from) * s; }
      acc += v * (d / n);
      tab[i + 1] = acc;
    }
    p.tab = tab;
  }
  return p;
}
export function srcOffset(seg, tau) {
  const p = seg.profile, d = seg.end - seg.start;
  tau = clamp(tau, 0, d);
  switch (p.type) {
    case 'velocity': case 'ramp': {
      const n = p.tab.length - 1, f = (tau / d) * n, i = Math.min(n - 1, Math.floor(f)), a = f - i;
      return p.tab[i] * (1 - a) + p.tab[i + 1] * a;
    }
    case 'stutter': {
      const sd = d * p.until;
      return tau < sd ? p.r * (tau % p.q) : p.r * (tau - sd);
    }
    default: return (p.r || 1) * tau;
  }
}
export function srcRate(seg, tau) {
  const p = seg.profile, d = seg.end - seg.start;
  if (p.type === 'velocity') return p.lo + (p.hi - p.lo) * Math.sin(Math.PI * clamp(tau / d, 0, 1)) ** 2;
  if (p.type === 'ramp') { const u = clamp(tau / d, 0, 1); return p.from + (p.to - p.from) * u * u * (3 - 2 * u); }
  return p.r || 1;
}
function profileSrcDur(prof, d) {
  return srcOffset({ profile: prof, start: 0, end: d }, d) + (prof.type === 'stutter' ? prof.q : 0);
}

// ---------------- planner ----------------
// off: style parts switched off · avoid: per-clip source windows used by the other edits
// mode: 'auto' | 'quotes' (best spoken lines, played in full) | 'scenes' (best visual moments)
// clip.trim = [start, end]: the part of the clip the user picked (from the Clips list). The planner sees only
// that part: everything before it counts as unusable (like a still picture) and the clip "ends" at its end.
// clip.parts = [{ a, b, on }]: the clip cut into parts; the parts that are on are used together (a group), the
// rest are skipped exactly like still pictures.
export function partsOff(c) { return (c.parts || []).filter((p) => !p.on).map((p) => [p.a, p.b]); }
export function trimView(c) {
  const t = c.trim, hasTrim = t && t[1] > t[0], off = partsOff(c);
  if (!hasTrim && !off.length) return c;
  const full = Math.min(c.duration || 0, c.usableEnd ?? c.duration ?? 0);
  let a = 0, b = full;
  if (hasTrim) { a = Math.max(0, Math.min(t[0], full - 0.3)); b = Math.max(a + 0.3, Math.min(full, t[1])); }
  // parts switched off: the clip starts at the first part used, ends after the last one, skips the ones between
  const offR = off.map(([s, e]) => [Math.max(s, a), Math.min(e, b)]).filter(([s, e]) => e - s > 0.01).sort((x, y) => x[0] - y[0]);
  for (const [s, e] of offR) if (s <= a + 0.02 && e > a) a = e;
  for (const [s, e] of [...offR].reverse()) if (e >= b - 0.02 && s < b) b = s;
  if (b - a < 0.3) b = Math.min(full, a + 0.3);
  if (a < 0.05 && b > full - 0.05 && !offR.length) return c;
  const stills = (c.stills || []).map(([s, e]) => [Math.max(s, a), Math.min(e, b)]).filter(([s, e]) => e - s > 0.01);
  for (const [s, e] of offR) if (s >= a - 0.02 && e <= b + 0.02 && e - s > 0.01) stills.push([Math.max(s, a), Math.min(e, b)]);
  stills.sort((x, y) => x[0] - y[0]);
  if (a >= 0.05) stills.unshift([0, a]);
  return { ...c, trimIn: a, usableEnd: b, stills };
}
export function planEdit({ clips, music, musicStart, length, styleId, seed, pacing = 0.3, noSpeed = false, preserveSpeech = true,
  off = [], avoid = null, mode = 'auto', order = 'scattered' }) {
  clips = clips.map(trimView);
  const style = styleWith(styleId, off);
  const r = rng(seed);
  // when the best quotes are used up, fill the rest of the edit with scenes (never repeat a quote)
  const fillClips = mode === 'quotes' ? clips.map((c) => ({ ...c, words: [], moments: sceneMoments(c) })) : null;
  if (mode === 'quotes' || mode === 'scenes') {
    clips = clips.map((c) => {
      const m = mode === 'quotes' ? quoteMoments(c) : sceneMoments(c);
      if (m.length) return { ...c, moments: m };
      return mode === 'quotes' ? { ...c, moments: sceneMoments(c) } : c; // no speech in this clip -> its best scenes
    });
    if (mode === 'quotes') { preserveSpeech = true; noSpeed = true; }
  }
  const beats = [];
  for (const b of music.beats) {
    const t = b.t - musicStart;
    if (t >= -0.02 && t <= length + 4) beats.push({ ...b, t: Math.max(0, t) });
  }
  if (beats.length < 2) {
    for (let t = 0; t < length + 2; t += 0.5) beats.push({ t, strength: 0.6, bar: 0, down: false });
  }
  const period = beats.length > 2 ? (beats[beats.length - 1].t - beats[0].t) / (beats.length - 1) : 0.5;

  // choose the end on a downbeat close to the requested length
  let end = length;
  {
    // the length you asked for, to the tenth of a second (it used to snap to a downbeat anywhere from 75% of
    // it, so "30 s" came out as 23 to 31 s); a beat right at that moment is used so the last cut lands on it
    let best = Infinity;
    for (const b of beats) { const d = Math.abs(b.t - length); if (d <= 0.12 && d < best) { best = d; end = b.t; } }
    if (end < 1) end = length;
  }
  const energyAt = (t) => sampleCurve(music.energy, music.hop, t + musicStart);
  const lenMul = Math.pow(2, Math.round((pacing - 0.3) * 4));

  // cut points on beats
  const cuts = [0];
  let k = beats.findIndex((b) => b.t > 0.05);
  if (k < 0) k = 0;
  // first shot: lasts until a beat chosen like the others
  let idx = k - 1;
  // Movie / Caption edits: hold one moment while the song builds and cut on the first drop
  // (or, with no clear drop, on the downbeat nearest the middle of the allowed range)
  let introT = 0;
  if (style.intro && mode !== 'quotes' && length >= style.intro.min + 4) {
    const { min, max } = style.intro, mid = (min + max) / 2;
    const drop = beats.find((b) => b.impact && b.t >= min && b.t <= Math.min(max, length - 3));
    const downs = beats.filter((b) => b.down && b.t >= min && b.t <= Math.min(max, length - 3));
    const pick = drop || downs.sort((a, b) => Math.abs(a.t - mid) - Math.abs(b.t - mid))[0];
    if (pick) { introT = pick.t; idx = beats.indexOf(pick); cuts.push(introT); }
  }
  while (true) {
    let n = Number(pickWeighted(r, style.cutBeats));
    n = Math.max(1, Math.round(n * lenMul));
    const e = energyAt(beats[Math.max(0, idx)]?.t || 0);
    if (!style.everyBeat) {
      if (e < 0.35 && pacing < 0.7 && r() < 0.6) n *= 2;
      if (e > 0.85 && n > 1 && r() < 0.35) n = Math.max(1, n >> 1);
    }
    let next = idx + n;
    // cut on impacts (drops) inside this shot
    for (let j = Math.max(idx + 1, 0); j < next && j < beats.length; j++) {
      if (beats[j].impact && beats[j].t - (cuts[cuts.length - 1]) > 0.2) { next = j; break; }
    }
    if (next >= beats.length) break;
    const t = beats[next].t;
    if (t >= end - Math.max(0.25, period * 0.6)) break;
    if (t - cuts[cuts.length - 1] >= 0.2) cuts.push(t);
    idx = next;
  }
  cuts.push(end);

  // Choose a complete source moment first. Beat cuts inside it retain chronological continuity.
  const used = clips.map(() => []), segments = [];
  const previousByClip = clips.map(() => 0);
  let cursor = 0, previous = null, run = 0, stalls = 0;
  // how much of each clip the edit has used, vs. its fair share (by usable length, capped so one long clip can't dominate)
  const clipUse = clips.map(() => 0);
  const lens = clips.map((c) => Math.min(Math.max(0, Math.min(c.duration || 0, c.usableEnd ?? c.duration ?? 0) - (c.trimIn || 0)), length * 1.5));
  const lenSum = lens.reduce((a, b) => a + b, 0) || 1, clipShare = lens.map((l) => l / lenSum);
  // order 'story': follow the clips in order instead of picking moments from anywhere
  const story = order === 'story' ? { ...storyTimeline(clips), from: 0, pass: 0, passAt: 0 } : null;
  // each style jumps to new footage at its own rhythm (Simple Beat every couple of beats, Cinematic rarely)
  const runLen = style.run ? Math.max(0.6, period * style.run * (0.55 + pacing * 1.5)) : 4 + pacing * 7;
  while (cursor < end - 0.08) {
    // quotes: look for any quote start (short need), then play the whole quote below
    const intro = introT > 0 && cursor < introT - 0.05;
    const target = intro ? introT - cursor : Math.min(end - cursor, mode === 'quotes' ? 1.2 : runLen);
    let window = null;
    if (story) story.intro = intro;
    if (story) {
      // In order: only forward along the clips (Clips-list order), paced so the edit spans all of them
      // pace: spread the whole story over the edit (or play it at real speed when there's less footage than edit)
      const span = Math.max(0.01, Math.min(end - story.passAt, Math.max(story.total, 1)));
      const goal = Math.min(1, (cursor - story.passAt) / span) * Math.max(0, story.total - runLen);
      story.left = story.pass ? 0 : end - cursor;
      for (let need = target; need >= Math.min(0.5, target) - 0.001 && !window; need -= Math.min(0.5, target)) {
        window = chooseInOrder(clips, need, used, story.from, Math.max(goal, story.from), story, seed, avoid, story.pass > 0);
      }
      if (!window && story.pass < 3 + Math.ceil(end / Math.max(1, story.total)) * 2) {
        // reached the end of the last clip with time left: go around again from the first clip
        // (in the last few seconds, replay the end of the story instead of jumping back to the very start)
        const left = end - cursor;
        story.pass++; story.from = left < 3 && !story.tail ? Math.max(0, story.total - left * 4 - 2) : 0; story.passAt = cursor;
        if (left < 3) story.tail = true; // only try that once; if it fails, go round from the start as before
        continue;
      }
    } else for (let need = target; need >= Math.min(0.5, target) - 0.001; need -= Math.min(0.5, target)) {
      // editor's judgement: hook first, energy of this part of the song (and any drop in it), clip variety
      const sense = { first: cursor < 0.05, intro, impact: beats.some((b) => b.impact && b.t >= cursor - 0.05 && b.t < cursor + need * 0.6),
        use: clipUse, share: clipShare, spread: order !== 'story' };
      const energy = Math.max(energyAt(cursor), energyAt(cursor + need * 0.5));
      window = chooseWindow(clips, need, used, previous, energy, seed, avoid, false, sense);
      if (window) break;
    }
    // If peaks are exhausted, continue unshown footage from the same source before switching.
    if (!window && !story) {
      for (let ci = 0; ci < clips.length; ci++) {
        const c = clips[ci];
        let start = Math.max(previousByClip[ci], c.trimIn || 0), limit = Math.min(c.duration, c.usableEnd ?? c.duration) - 0.04;
        // hop over still pictures, and stop before the next one
        for (const [s, e] of c.stills || []) if (start >= s - 0.04 && start < e) start = e + 0.04;
        for (const [s] of c.stills || []) if (s >= start && s - 0.04 < limit) limit = s - 0.04;
        if (limit - start < 0.25) continue;
        window = { ci, start, end: Math.min(limit, start + target), speech: !!c.words?.length, reason: 'Continue the source moment' };
        break;
      }
    }
    // Out of fresh footage: cut to another moment (least-shown first) so every edit runs its full length
    // (in order too: never a short edit because the story ran out of new moments)
    if (!window) {
      const pool = fillClips || clips;
      for (const prev of [previous, null]) { // tiny clips: last resort may even replay the last shot
        for (let need = target; need >= Math.min(0.5, target) - 0.001; need -= Math.min(0.5, target)) {
          window = chooseWindow(pool, need, used, prev, energyAt(cursor), seed + (run + 1) * 7919, avoid, true);
          if (window) break;
        }
        if (window) break;
      }
    }
    // Clips too short to use at all.
    if (!window) break;
    const c = clips[window.ci];
    let duration = Math.min(end - cursor, window.end - window.start);
    // (Movie Edit keeps dialogue whole only in its opening hold — unless the edit is set to "Best quotes")
    const speech = preserveSpeech && window.speech && (!style.speechOnlyIntro || intro || mode === 'quotes');
    if (mode === 'quotes' && speech && window.mEnd > window.start) {
      duration = Math.min(end - cursor, window.mEnd - window.start); // the whole quote, start to finish
    } else if (speech) {
      const phrases = speechPhrases(c.words, c.duration);
      const nearby = phrases.filter(p => p.end > window.start + 0.7 && p.end - window.start <= end - cursor + 0.001)
        .sort((a, b) => Math.abs(a.end - window.end) - Math.abs(b.end - window.end));
      if (nearby.length) duration = nearby[0].end - window.start;
    }
    // the opening hold runs right up to the drop (a line of dialogue gets cut on the drop, like the real edits)
    if (intro) duration = Math.min(introT - cursor, window.end - window.start);
    duration = Math.min(duration, Math.max(0, (c.usableEnd ?? c.duration) - 0.04 - window.start));
    const nextStill = (c.stills || []).find(([s, e]) => e > window.start + 0.04);
    if (nextStill) duration = Math.min(duration, Math.max(0, nextStill[0] - 0.04 - window.start));
    // a photo stays up for its own time: the one you set for it, or a few beats of the song
    const photoHold = c.photo ? (c.hold > 0 ? c.hold : Math.max(0.8, Math.min(2.5, period * (period < 0.45 ? 4 : 2)))) : 0;
    if (photoHold && !intro) duration = Math.min(end - cursor, photoHold, Math.max(0, (c.usableEnd ?? c.duration) - 0.04 - window.start));
    // every change of shot lands on a beat cut: stretch or trim this shot to the nearest cut the footage allows
    // (a photo with your own time only moves to a beat that's close to it)
    if ((mode !== 'quotes' || !speech) && duration >= 0.08 && !(c.photo && c.hold > 0 && !cuts.some((t) => Math.abs(t - cursor - duration) < period * 0.5))) {
      const avail = Math.min((c.usableEnd ?? c.duration) - 0.04, nextStill ? nextStill[0] - 0.04 : Infinity) - window.start;
      const want = cursor + duration;
      let best = null, bd = Infinity;
      for (const t of cuts) {
        if (t <= cursor + 0.2) continue;
        if (t - cursor > avail + 0.001) break;
        // with speech, prefer a cut just after the sentence ends over one that chops it
        const d = Math.abs(t - want) + (speech && t < want - 0.05 ? 0.6 : 0);
        if (d < bd) { bd = d; best = t; }
      }
      if (best != null && Math.abs(best - want) < (c.photo && c.hold > 0 ? period * 0.5 : Math.max(period * 1.6, 0.6))) duration = best - cursor;
    }
    if (duration < 0.08) {
      // unusable spot: mark it and look elsewhere rather than ending the edit early
      if (++stalls > 40) break;
      used[window.ci].push([window.start, Math.max(window.end, window.start + 0.5)]);
      previousByClip[window.ci] = Math.max(previousByClip[window.ci], window.end);
      if (story) story.from = Math.max(story.from, story.offs[window.ci] + window.end);
      continue;
    }
    const runEnd = cursor + duration;
    // (a photo is one shot: no beat cuts inside it)
    const points = c.photo ? [cursor, runEnd] : [cursor, ...cuts.filter(t => t > cursor + 0.15 && t < runEnd - 0.15), runEnd];
    let source = window.start;
    for (let j = 0; j < points.length - 1; j++) {
      const start = points[j], segEnd = points[j + 1], d = segEnd - start;
      const beat = beats.find(b => Math.abs(b.t - start) < 0.03);
      const isImpact = !!beat?.impact;
      let spec = noSpeed || speech || c.photo ? { type: 'const', r: 1 } : pickWeighted(r, style.speed);
      // Stuttering loses the chronology of an action; reserve variation for ramps and effects.
      if (spec.type === 'stutter') spec = { type: 'const', r: 1 };
      let profile = makeProfile(spec, d);
      let need = profileSrcDur(profile, d);
      const available = Math.max(0.001, window.start + duration - source);
      const reserve = (runEnd - segEnd) * 0.25;
      if (need > available - reserve + 1e-6) {
        profile = makeProfile({ type: 'const', r: Math.max(0.05, (available - reserve) / d) }, d);
        need = profileSrcDur(profile, d);
      }
      const prev = segments.at(-1);
      segments.push({ start, end: segEnd, clip: window.ci, srcStart: source, srcDur: need, profile,
        deck: prev?.clip === window.ci ? (Math.abs(prev.srcStart + prev.srcDur - source) < 0.001 ? prev.deck : 1 - prev.deck) : 0, impact: isImpact,
        mirror: style.cont.mirrorChance && (isImpact || r() < style.cont.mirrorChance) ? 1 + Math.floor(r() * 2) : 0,
        push: r() < 0.5 ? 1 : -1, orbitPhase: r() * 6.28, transIn: null, transOut: null,
        run, reason: intro ? `Opening hold until the drop, ${window.reason}` : window.reason, speech,
        // dialogue in the opening hold is heard over the song (the song dips under it)
        voice: !!(intro && speech) });
      source += need;
    }
    used[window.ci].push([window.start, window.start + duration]);
    clipUse[window.ci] += duration;
    previousByClip[window.ci] = window.start + duration;
    previous = { ci: window.ci, start: window.start, end: window.start + duration };
    if (story) story.from = story.offs[window.ci] + window.start + duration;
    cursor = runEnd; run++;
  }
  end = cursor;

  // transitions between shots
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1], b = segments[i];
    if (a.run === b.run) continue; // effects follow beats; the action itself stays continuous
    const type = pickWeighted(r, b.impact ? style.impactTrans : style.trans);
    if (type === 'cut') continue;
    const dir = type === 'whip' ? dirs[r() < 0.7 ? Math.floor(r() * 2) : 2 + Math.floor(r() * 2)] : dirs[Math.floor(r() * 2)];
    const td = Math.min(style.transDur, 0.6 * (a.end - a.start), 0.7 * (b.end - b.start));
    a.transOut = { type, dur: td * 0.5, dir };
    b.transIn = { type, dur: td, dir };
  }
  return { styleId, style, seed, mode, off, order, intro: introT, voice: segments.some((s) => s.voice), duration: end, segments, beats: beats.filter((b) => b.t <= end + 0.01), musicStart, period };
}

// ---------------- per-frame evaluation ----------------
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1; }

export function findSegment(plan, t) {
  const s = plan.segments;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m].start <= t) lo = m; else hi = m - 1; }
  return lo;
}
function lastBeat(beats, t) {
  let lo = 0, hi = beats.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (beats[m].t <= t + 1e-4) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

export function defaultUniforms() {
  return { zoom: 1, offset: [0, 0], rot: 0, tilt: [0, 0], card: 1, fit: 0, crop: [0.5, 0.5], rgb: 0, blur: [0, 0], radial: 0,
    glitch: 0, flash: 0, invert: 0, bw: 0, contrast: 1, sat: 1, bright: 0, tint: [1, 1, 1], hue: 0, vignette: 0, grain: 0,
    scan: 0, glow: 0, mirror: 0, ghosts: 0, bars: 0, round: 0, shadow: 0, wrap: 0, text: 0, textScale: 1, time: 0,
    pixel: 0, poster: 0, fish: 0, wave: 0, crt: 0, kaleido: 0, bleed: 0, edge: 0, ink: 0, halftone: 0, duo: 0, duoA: [0, 0, 0], duoB: [1, 1, 1],
    sepia: 0, leak: 0, film: 0, split: 0, fade: 0, focus: 0, sourceRect: [0, 0, 1, 1],
    hook: 0, hookScale: 1, hookAnchor: [0.5, 0.8], gameWhole: 0, gameFill: [0, 0, 1, 1], outside: 0 };
}

// ---- hook text timing: shown from `start` to `end` seconds (end 0 = to the end), quick fade in / out ----
export function hookAlpha(t, D, h) {
  if (!h) return 0;
  const end = h.end > h.start ? Math.min(h.end, D) : D;
  if (t < h.start || t > end) return 0;
  return Math.min(clamp((t - h.start) / 0.25, 0, 1), h.end > h.start ? clamp((end - t) / 0.2, 0, 1) : 1);
}

// ---- keyframes: your own card motion (an opening move, a zoom out at the end...) ----
// keys: [{ t, scale, x, y, rot, tiltX, tiltY, opacity, ease }]; between keys the values glide, before the first
// and after the last they hold. x / y move the card (1 = a full screen height), rot / tilt in degrees.
export const KEY_PROPS = { scale: 1, x: 0, y: 0, rot: 0, tiltX: 0, tiltY: 0, opacity: 1 };
const EASES = {
  smooth: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k) => 1 - Math.pow(1 - k, 3),
  in: (k) => k * k * k,
  linear: (k) => k,
  snap: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
};
export function keyValues(keys, t) {
  if (!keys?.length) return null;
  const val = (k, p) => (k[p] ?? KEY_PROPS[p]);
  const pick = (k) => Object.fromEntries(Object.keys(KEY_PROPS).map((p) => [p, val(k, p)]));
  if (t <= keys[0].t) return pick(keys[0]);
  const last = keys[keys.length - 1];
  if (t >= last.t) return pick(last);
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1], k = (EASES[b.ease] || EASES.smooth)(clamp((t - a.t) / Math.max(1e-4, b.t - a.t), 0, 1));
  return Object.fromEntries(Object.keys(KEY_PROPS).map((p) => [p, val(a, p) + (val(b, p) - val(a, p)) * k]));
}
function applyKeys(U, kv) {
  if (!kv) return;
  U.card *= Math.max(0.05, kv.scale);
  U.offset = [U.offset[0] + kv.x, U.offset[1] + kv.y];
  U.rot += (kv.rot * Math.PI) / 180;
  U.tilt = [U.tilt[0] + (kv.tiltX * Math.PI) / 180, U.tilt[1] + (kv.tiltY * Math.PI) / 180];
  if (kv.opacity < 1) U.fade = 1 - (1 - (U.fade || 0)) * clamp(kv.opacity, 0, 1);
  if (kv.scale < 0.999) U.round = Math.max(U.round, 0.03);
}

// Per-edit settings -> what frameAt needs. Used by the live preview and the exporter so both match.
export function makeCtx(e, music, clips) {
  return { music, clips, intensity: e.intensity ?? 1, framing: e.framing, hasText: !!(e.text || '').trim(),
    filter: FILTERS[e.filter] || FILTERS.none, fx: new Set(e.fx || []), fadeIn: Number(e.fadeIn) || 0, fadeOut: Number(e.fadeOut) || 0,
    focus: e.focus === 'on', aspect: String(e.format || '9:16').split(':').map(Number).reduce((a, b) => a / b),
    hook: (e.text || '').trim() ? { start: Math.max(0, Number(e.hookStart) || 0), end: Math.max(0, Number(e.hookEnd) || 0),
      anchor: [Number(e.hookX ?? 0.5), 1 - Number(e.hookY ?? 0.2)] } : null,
    keys: Array.isArray(e.keys) && e.keys.length ? [...e.keys].sort((a, b) => a.t - b.t) : null,
    stack: e.stackOpts || null, pan: e.pan || null, panKeys: e.panKeys || null };
}
// where you dragged the picture on a take (the Pan in each part): moves a crop box [x, y, w, h] by a share of its own
// size, kept inside the frame
function panRect(r, p) {
  if (!p) return r;
  // p = [x, y, zoom]: the zoom (scroll on the take) shrinks the box around its middle, then the drag moves it
  const z = Math.max(1, p[2] || 1), w = r[2] / z, h = r[3] / z, cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
  const x = clamp(cx - w / 2 - (p[0] || 0) * w, 0, Math.max(0, 1 - w)), y = clamp(cy - h / 2 - (p[1] || 0) * h, 0, Math.max(0, 1 - h));
  return [x, y, w, h];
}
// the same for the full picture: shifts what the camera looks at by a share of what shows
function panFull(U, p, clip, ctx) {
  if (!p || U.fit > 0.5) return;
  if (p[2] > 1) U.zoom *= p[2]; // scrolled in on this take
  if (!(p[0] || p[1])) return;
  const [, , w, h] = U.sourceRect;
  const va = ((clip.w || 16) * w) / ((clip.h || 9) * h), oa = ctx.aspect || 9 / 16;
  const sCover = Math.max(oa / va, 1), z = Math.max(1, U.zoom || 1);
  if (U.focus) {
    // the crop is where the camera points (share of the picture): move it by what the window shows
    U.crop = [clamp(U.crop[0] - p[0] * oa / (va * sCover * z), 0, 1), clamp(U.crop[1] - p[1] / (sCover * z), 0, 1)];
  } else {
    const ox = va * sCover - oa, oy = sCover - 1;
    U.crop = [ox > 1e-3 ? clamp(U.crop[0] - p[0] * oa / ox, 0, 1) : U.crop[0], oy > 1e-3 ? clamp(U.crop[1] - p[1] / oy, 0, 1) : U.crop[1]];
  }
}

// fade-in / fade-out multiplier (0..1) at time t of an edit that lasts D seconds
export function fadeGain(t, D, fin, fout) {
  let k = 1;
  if (fin > 0) k = Math.min(k, clamp(t / fin, 0, 1));
  if (fout > 0) k = Math.min(k, clamp((D - t) / fout, 0, 1));
  return k;
}

// ctx: see makeCtx
// Stream clips: no beat effects, just the layout (cam on top / full frame following the streamer),
// a punch-in on the big reactions, the overlay (bar + title) and the filter if one is picked.
// where a part (cam / game / full) is moved to at time t: its camera keyframes when it has some (they glide
// smoothly from one to the next), else the one fixed move you made
function panOf(ctx, part, t) {
  const ks = ctx.panKeys?.[part];
  if (!ks?.length) return ctx.pan?.[part];
  if (t <= ks[0].t) return [ks[0].x, ks[0].y, ks[0].z ?? 1];
  const last = ks[ks.length - 1];
  if (t >= last.t) return [last.x, last.y, last.z ?? 1];
  let i = 0; while (i < ks.length - 2 && ks[i + 1].t <= t) i++;
  const a = ks[i], b = ks[i + 1], u = clamp((t - a.t) / Math.max(1e-4, b.t - a.t), 0, 1), k = u * u * (3 - 2 * u);
  return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, (a.z ?? 1) + ((b.z ?? 1) - (a.z ?? 1)) * k];
}
function frameStream(plan, t, ctx) {
  const si = findSegment(plan, t), seg = plan.segments[si];
  const clip = ctx.clips[seg.clip] || {};
  const src = clamp(seg.srcStart + (t - seg.start), 0, Math.max(0, (clip.duration || 1e9) - 0.04));
  const U = defaultUniforms();
  U.time = t; U.sourceRect = segRect(seg, clip);
  const F = ctx.filter || {}, L = F.look ? { ...plan.style.look, ...F.look } : plan.style.look;
  U.contrast = L.contrast ?? 1; U.sat = L.sat ?? 1; U.tint = L.tint || [1, 1, 1]; U.bright = L.bright || 0;
  U.vignette = L.vignette || 0; U.grain = L.grain || 0; U.scan = L.scan || 0; U.sharp = L.sharp || 0;
  const ffx = F.fx || {};
  U.lut = F.lut || ''; U.lutAmt = F.lutAmt ?? 1;
  for (const k of FX_KEYS) U[k] = ffx[k] || 0;
  if (ffx.duo) { U.duoA = ffx.duoA; U.duoB = ffx.duoB; }
  const H = plan.highlight || {};
  // punch-in: quick zoom on the streamer for a big laugh / yell, then back
  let pz = 1;
  for (const p of H.punches || []) {
    const d = t - p.t;
    if (d > -0.12 && d < 1.2) pz = Math.max(pz, 1 + (p.k - 1) * (d < 0 ? (d + 0.12) / 0.12 : d < 0.8 ? 1 : 1 - (d - 0.8) / 0.4));
  }
  const [x, y, w, h] = U.sourceRect;
  const rel = (r) => [(r[0] - x) / w, (r[1] - y) / h, r[2] / w, r[3] / h];
  if (H.layout === 'cam') {
    // webcam + screen: the webcam cropped exactly to its own box (not a zoom on the face) in one panel, as tall as
    // its shape needs, and the stream screen in the rest ("Screen": filling it, or the whole screen fitted;
    // "Which half is on top" swaps them)
    const so = ctx.stack || {}, area = U.sourceRect, oa = ctx.aspect || 9 / 16, va = (clip.w || 16) / (clip.h || 9);
    U.sourceRect = [0, 0, 1, 1];
    const cam = H.cam || {};
    let cb = cam.box ? [...cam.box] : stackRects(clip, oa, 0.4, H.cam, { cam: 'whole', area }).camRect;
    const camPix = (cb[2] * va) / Math.max(1e-4, cb[3]);
    const split = clamp(oa / camPix, 0.26, 0.58), want = oa / split; // the panel's shape (width / height)
    // the box is wider or taller than its panel can show: trim it to the panel's shape around the streamer
    if (camPix > want + 0.01) { const nw = (cb[3] * want) / va; cb = [clamp((cam.x ?? cb[0] + cb[2] / 2) - nw / 2, cb[0], cb[0] + cb[2] - nw), cb[1], nw, cb[3]]; }
    else if (camPix < want - 0.01) { const nh = (cb[2] * va) / want; cb = [cb[0], clamp((cam.y ?? cb[1] + cb[3] / 2) - nh / 2, cb[1], cb[1] + cb[3] - nh), cb[2], nh]; }
    let cr = panRect(cb, panOf(ctx, 'cam', t));
    if (pz > 1) { const s = 1 / pz; cr = [cr[0] + cr[2] * (1 - s) / 2, cr[1] + cr[3] * (1 - s) * 0.4, cr[2] * s, cr[3] * s]; }
    // the screen panel: the rest of the picture's height, the whole stream picture fitted into it
    const whole = so.game === 'whole', g2 = stackRects(clip, oa, split, H.cam, { game: whole ? 'whole' : 'fill', area });
    const gr = whole ? g2.gameRect : panRect(g2.gameRect, panOf(ctx, 'game', t));
    U.stack = 1; U.gameFill = g2.gameFill; U.outside = so.edge === 'blur' ? 0 : 1;
    if (so.swap) { U.stackY = 1 - split; U.camRect = gr; U.gameRect = cr; U.gameWhole = whole ? 2 : 0; }
    else { U.stackY = split; U.camRect = cr; U.gameRect = gr; U.gameWhole = whole ? 1 : 0; }
  } else if (H.layout === 'stack') {
    // cam / screen template: cam share of the height, which side is on top, whole screen or a crop, face or whole webcam
    const so = ctx.stack || {}, split = so.split || 0.5;
    // every crop here is in whole-frame coordinates (the picture area only limits the "fill" crop), so the source is the whole frame
    const area = U.sourceRect;
    U.sourceRect = [0, 0, 1, 1];
    const { camRect, gameRect, gameFill } = stackRects(clip, ctx.aspect || 9 / 16, split, H.cam, { game: so.game, cam: so.cam, area });
    const P = { cam: panOf(ctx, 'cam', t), game: panOf(ctx, 'game', t) };
    let cr = panRect(camRect, P.cam);
    if (pz > 1) { const s = 1 / pz; cr = [cr[0] + cr[2] * (1 - s) / 2, cr[1] + cr[3] * (1 - s) * 0.4, cr[2] * s, cr[3] * s]; }
    const gr = so.game === 'whole' ? gameRect : panRect(gameRect, P.game);
    U.stack = 1; U.gameFill = gameFill; U.outside = so.edge === 'blur' ? 0 : 1;
    if (so.swap) { U.stackY = 1 - split; U.camRect = gr; U.gameRect = cr; U.gameWhole = so.game === 'whole' ? 2 : 0; }
    else { U.stackY = split; U.camRect = cr; U.gameRect = gr; U.gameWhole = so.game === 'whole' ? 1 : 0; }
  } else {
    // full frame: the auto-focus camera keeps the streamer in the picture (or the whole video, with bars around it)
    U.fit = 0; U.crop = [0.5, 0.5]; U.zoom = pz;
    const so = ctx.stack || {};
    if (so.fullFit === 'whole') { U.fit = 1; U.outside = so.edge === 'blur' ? 0 : 1; }
    // follows the streamer only when there is one on camera (an IRL / full-cam stream, or a facecam); gameplay
    // without one stays still, centered, instead of chasing whoever the game shows
    else if (clip.track && (H.cam?.full || H.cam?.steady)) {
      const va = ((clip.w || 16) * w) / ((clip.h || 9) * h), oa = ctx.aspect || 9 / 16;
      const cam = cameraAt(clip.track, src, Math.min(1, oa / va) * w / pz, Math.min(1, va / oa) * h / pz);
      U.crop = [clamp((cam.x - x) / w, 0, 1), clamp((cam.y - y) / h, 0, 1)]; U.focus = 1;
    }
    panFull(U, panOf(ctx, 'full', t), clip, ctx);
  }
  U.text = 1; U.textScale = 1;
  if (ctx.hook) { U.hook = hookAlpha(t, plan.duration, ctx.hook); U.hookAnchor = ctx.hook.anchor; }
  if (ctx.fadeIn || ctx.fadeOut) U.fade = 1 - fadeGain(t, plan.duration, ctx.fadeIn, ctx.fadeOut);
  // card motion (keyframes) moves the whole picture in every layout (cam + screen too)
  applyKeys(U, keyValues(ctx.keys, t));
  return { si, seg, src, U };
}
// how much of a cut shows at time t because of its own fade in / out (1 = all of it)
export function cutFades(plan, si, clips) {
  const seg = plan.segments[si]; if (!seg) return [0, 0];
  const clip = clips?.[seg.clip] || {}, d = seg.end - seg.start, vf = clip.vfade || {};
  const prev = plan.segments[si - 1], next = plan.segments[si + 1];
  const joins = (a, b) => a && b && a.clip === b.clip; // still the same clip: no fade in between (a cut's own fade still can)
  let fi = seg.fade?.in ?? (vf.in && !joins(prev, seg) ? vf.in : 0), fo = seg.fade?.out ?? (vf.out && !joins(seg, next) ? vf.out : 0);
  // a short cut keeps some of its picture: the fades share at most 80% of it
  const room = d * 0.8; if (fi + fo > room && fi + fo > 0) { const k = room / (fi + fo); fi *= k; fo *= k; }
  return [fi, fo];
}
function cutFade(plan, si, ctx) {
  const seg = plan.segments[si]; if (!seg) return 1;
  const [fi, fo] = cutFades(plan, si, ctx.clips), tau = ctx.__t - seg.start, d = seg.end - seg.start;
  let g = 1;
  if (fi > 0.01) g = Math.min(g, clamp(tau / fi, 0, 1));
  if (fo > 0.01) g = Math.min(g, clamp((d - tau) / fo, 0, 1));
  return g * g * (3 - 2 * g);
}
export function frameAt(plan, t, ctx) {
  if (plan.mode === 'stream') return frameStream(plan, t, ctx);
  ctx.__t = t;
  const st = plan.style;
  const I = ctx.intensity ?? 1;
  const si = findSegment(plan, t);
  const seg = plan.segments[si];
  const tau = t - seg.start;
  const d = seg.end - seg.start;
  const clip = ctx.clips[seg.clip] || {};
  let src = seg.srcStart + srcOffset(seg, tau);
  if (seg.loop && clip.duration > 0) src %= clip.duration;
  if (clip.duration) {
    src = clamp(src, 0, clip.duration - 0.04);
  }

  const U = defaultUniforms();
  U.time = t;
  // Auto-focus off: no camera following anyone, the whole picture stays in view (unless you framed it by hand)
  const handFramed = clip.manualCrop || !!seg.framing || !!clip.framing?.length;
  U.fit = ctx.framing === 'fit' || (ctx.focus === false && !handFramed) ? 1 : 0;
  U.crop = [clip.cropX ?? 0.5, clip.cropY ?? 0.5];
  U.sourceRect = segRect(seg, clip);
  // framed by hand in the clip list: the window's center (cropX / cropY of the picture) and its zoom
  if (clip.manualCrop) { U.focus = 1; if (!seg.framing) U.zoom *= clamp(Number(clip.cropZoom) || 1, 1, 3); }
  const F = ctx.filter || {}, X = ctx.fx || new Set();
  const c = st.cont, B = st.beat, IM = st.impact;
  const L = F.look ? { ...st.look, ...F.look } : st.look;
  U.card = c.card || 1;
  U.contrast = L.contrast ?? 1; U.sat = L.sat ?? 1; U.tint = L.tint || [1, 1, 1]; U.bright = L.bright || 0;
  U.vignette = L.vignette || 0; U.grain = L.grain || 0; U.scan = L.scan || 0; U.sharp = L.sharp || 0;
  U.lut = F.lut || ''; U.lutAmt = F.lutAmt ?? 1; // a film look (colour table)
  U.glow = Math.max(c.glow || 0, F.glow || 0); U.ghosts = c.ghosts || 0; U.bars = c.bars || 0; U.round = c.round || 0; U.shadow = c.shadow || 0;
  U.mirror = seg.mirror || 0;
  // always-on shader effects from the style + the filter
  const sfx = st.fx || {}, ffx = F.fx || {};
  for (const k of FX_KEYS) U[k] = Math.max(sfx[k] || 0, ffx[k] || 0);
  if (ffx.duo) { U.duoA = ffx.duoA; U.duoB = ffx.duoB; } else if (sfx.duo) { U.duoA = sfx.duoA; U.duoB = sfx.duoB; }
  if (U.card < 1 || U.fit > 0.5) U.round = Math.max(U.round, 0.02);

  // auto-focus: an invisible camera operator that keeps everyone in frame and only moves when it has to
  if (ctx.focus && !clip.manualCrop && clip.track && U.fit < 0.5) {
    const [x, y, w, h] = U.sourceRect;
    const va = ((clip.w || 16) * w) / ((clip.h || 9) * h), oa = ctx.aspect || 9 / 16;
    const cam = cameraAt(clip.track, src, Math.min(1, oa / va) * w, Math.min(1, va / oa) * h);
    U.crop = [clamp((cam.x - x) / w, 0, 1), clamp((cam.y - y) / h, 0, 1)]; U.focus = 1;
  }
  // framing you chose for this cut in the shot editor wins over the automatic camera
  const fo = seg.framing || (clip.framing?.length ? framingAt(clip, src) : null);
  if (fo && U.fit < 0.5) {
    const [x, y, w, h] = U.sourceRect;
    const va = ((clip.w || 16) * w) / ((clip.h || 9) * h), oa = ctx.aspect || 9 / 16;
    const aim = aimFor(fo, clip, src, Math.min(1, oa / va) * w, Math.min(1, va / oa) * h);
    U.crop = [clamp((aim.x - x) / w, 0, 1), clamp((aim.y - y) / h, 0, 1)]; U.focus = 1; U.zoom *= aim.z;
  }
  panFull(U, panOf(ctx, 'full', t), clip, ctx);

  // continuous motion
  const mt = t + plan.musicStart;
  const bass = ctx.music ? sampleCurve(ctx.music.bass, ctx.music.hop, mt) : 0;
  U.zoom *= 1 + (c.bassZoom || 0) * bass * I;
  if (c.push) U.zoom *= 1 + c.push * (tau / Math.max(d, 0.01)) * (seg.push > 0 ? 1 : -0.6);
  if (c.orbit) {
    U.tilt[0] += c.orbit * 0.55 * Math.sin(t * 0.9 + seg.orbitPhase) * I;
    U.tilt[1] += c.orbit * Math.sin(t * 0.63 + seg.orbitPhase * 1.3) * I;
  }
  if (c.hueSpeed) U.hue = t * c.hueSpeed;

  // beat reactions
  const bi = lastBeat(plan.beats, t);
  if (bi >= 0) {
    const b = plan.beats[bi];
    const dt = t - b.t;
    const env = Math.exp(-dt / (B.decay || 0.14));
    const s = b.strength * I;
    const sign = bi % 2 ? 1 : -1;
    if (B.punch) U.zoom *= 1 + B.punch * env * s;
    if (B.shake) { U.offset[0] += B.shake * env * s * noise(t * 34) * 2; U.offset[1] += B.shake * env * s * noise(t * 31 + 9) * 2; U.rot += B.shake * env * s * noise(t * 23 + 3) * 2; }
    if (B.rgb) U.rgb += B.rgb * env * s;
    if (B.tilt) { U.tilt[1] += B.tilt * env * s * sign; U.tilt[0] += B.tilt * 0.35 * env * s; }
    if (B.glitch && env > 0.45) U.glitch += B.glitch * (env - 0.45) * 1.8 * s;
    if (B.flashDown && b.down) U.flash += B.flashDown * env ** 3 * s;
    if (B.bwAlt) U.bw = Math.max(U.bw, bi % 2 ? 1 : 0);
    if (b.impact) {
      const e2 = Math.exp(-dt / 0.18) * I;
      if (IM.flash) U.flash += IM.flash * Math.exp(-dt / 0.09) * I;
      if (IM.punch) U.zoom *= 1 + IM.punch * e2;
      if (IM.shake) { U.offset[0] += IM.shake * e2 * noise(t * 40) * 2; U.offset[1] += IM.shake * e2 * noise(t * 37 + 4) * 2; U.rot += IM.shake * e2 * noise(t * 29) * 1.5; }
      if (IM.rgb) U.rgb += IM.rgb * e2;
      if (IM.glitch) U.glitch += IM.glitch * (dt < 0.22 ? 1 : 0) * I;
      if (IM.invert && dt < 0.07) U.invert = 1;
      if (IM.bw && dt < 0.35) U.bw = 1;
    }
    if (B.pixelBeat) U.pixel = Math.max(U.pixel, B.pixelBeat * env * env * s);
    if (B.fishBeat) U.fish += B.fishBeat * env * s;
    if (B.moshBeat) U.mosh = Math.max(U.mosh, B.moshBeat * (b.down || b.impact ? env : env * 0.4) * s);
    // a shockwave ring rushes out on the drops; slices of the picture jump sideways on the hits
    const hitBeat = b.down || b.impact;
    if ((B.shockBeat || X.has('shockwave')) && hitBeat && dt < 0.5) U.shock = Math.max(U.shock || 0, Math.exp(-dt / 0.22) * Math.min(1, I));
    if ((B.sliceBeat || X.has('slices')) && hitBeat && dt < 0.25) U.slice = Math.max(U.slice || 0, (B.sliceBeat || 1) * (1 - dt / 0.25) * I);
    if (X.has('prism') || st.fx?.prism) U.prism = Math.max(U.prism || 0, (st.fx?.prism || 0.55) + 0.6 * env * s);
    if (X.has('datamosh')) U.mosh = Math.max(U.mosh, 0.3 + 0.6 * env * s);

    // ---- extra effects picked by the user ----
    if (X.size) {
      const hit = b.impact || (b.down && bi % 8 === 0);
      if (X.has('pulse')) U.zoom *= 1 + 0.08 * env * s;
      if (X.has('shake')) { U.offset[0] += 0.022 * env * s * noise(t * 36 + 2) * 2; U.offset[1] += 0.022 * env * s * noise(t * 33 + 5) * 2; U.rot += 0.02 * env * s * noise(t * 25) * 2; }
      if (X.has('flash') && (b.down || b.impact)) U.flash += (b.impact ? 0.8 : 0.45) * Math.exp(-dt / 0.08) * I;
      if (X.has('rgb')) U.rgb += 0.016 * env * s + 0.002 * I;
      if (X.has('glitchHits') && (b.down || b.impact) && dt < 0.2) U.glitch += 0.9 * (1 - dt / 0.2) * I;
      if (X.has('pixelHits')) U.pixel = Math.max(U.pixel, 0.035 * env * env * s);
      if (X.has('blurHits')) U.radial += 0.3 * env * env * s;
      if (X.has('spin') && b.down) U.rot += 0.3 * env * s * sign;
      if (X.has('tilt3d')) {
        U.tilt[0] += 0.09 * Math.sin(t * 0.9 + seg.orbitPhase) * I + 0.06 * env * s;
        U.tilt[1] += 0.16 * Math.sin(t * 0.63 + seg.orbitPhase) * I + 0.12 * env * s * sign;
        U.card = Math.min(U.card, 0.9); U.round = Math.max(U.round, 0.025); U.shadow = Math.max(U.shadow, 0.6);
      }
      if (X.has('strobe')) U.bw = Math.max(U.bw, bi % 2 ? 1 : 0);
      if (X.has('invertHits') && hit && dt < 0.08) U.invert = 1;
    }
  }
  if (X.size) {
    if (X.has('fisheye')) U.fish += 0.35;
    if (X.has('wave')) U.wave = Math.max(U.wave, 0.9);
    if (X.has('kaleido')) U.kaleido = 6;
    if (X.has('mirror')) U.mirror = Math.max(U.mirror, 1);
    if (X.has('vhs')) { U.bleed = Math.max(U.bleed, 1); U.track = Math.max(U.track, 0.7); U.scan = Math.max(U.scan, 0.25); U.grain = Math.max(U.grain, 0.06); }
    if (X.has('pixdisplace')) U.pixdisp = Math.max(U.pixdisp, 0.55);
    if (X.has('print')) U.print = 1;
    if (X.has('stars')) U.stars = Math.max(U.stars, 1);
    if (X.has('datamosh') && bi < 0) U.mosh = Math.max(U.mosh, 0.35);
    if (X.has('crt')) { U.crt = Math.max(U.crt, 0.5); U.scan = Math.max(U.scan, 0.2); }
    if (X.has('leaks')) U.leak = Math.max(U.leak, 0.7);
    if (X.has('neon')) U.edge = Math.max(U.edge, 0.85);
    if (X.has('film')) { U.film = 1; U.grain = Math.max(U.grain, 0.07); }
    if (X.has('hue')) U.hue += t * 1.2;
    if (X.has('glow')) U.glow = Math.max(U.glow, 0.8);
    if (X.has('bars')) U.bars = Math.max(U.bars, 0.11);
    if (X.has('vignette')) U.vignette = Math.max(U.vignette, 0.75);
    if (X.has('detail')) { U.detail = Math.max(U.detail || 0, 0.95); U.sharp = Math.max(U.sharp, 0.5); }
    if (X.has('chroma')) U.chroma = Math.max(U.chroma || 0, 0.8);
    if (X.has('prism')) U.prism = Math.max(U.prism || 0, 0.55);
  }
  if (F.hueSpin) U.hue += t * F.hueSpin;

  // transitions
  const tin = seg.transIn, tout = seg.transOut;
  if (tin && tau < tin.dur) applyTrans(U, tin, 1 - easeOut(tau / tin.dur), 'in', I);
  if (tout && d - tau < tout.dur) applyTrans(U, tout, easeIn(1 - (d - tau) / tout.dur), 'out', I);

  // parts of the style that were ticked off on the card
  if (st.noBlur) { U.blur = [0, 0]; U.radial = 0; }
  if (st.noRgb && !X.has('rgb')) U.rgb = 0;
  U.bars = plan.quick && X.has('bars') ? 0.13 : 0;
  if (plan.quick) {
    const q = clamp(tau / Math.max(d, 0.001), 0, 1);
    if (seg.quickMotion === 0) U.zoom *= 1 + 0.13 * q;
    if (seg.quickMotion === 1) U.zoom *= 1.13 - 0.13 * q;
    if (seg.quickMotion === 2 || seg.quickMotion === 3) {
      U.zoom *= 1.12;
      U.offset[0] += (seg.quickMotion === 2 ? 0.5 - q : q - 0.5) * 0.12;
    }
    if (plan.quick.tint) U.lut = FILTERS[plan.quick.tint]?.lut || U.lut;
  }

  // hook text: its own layer, shown for the time you set, with a little pop on the beat
  if (ctx.hook) {
    U.hook = hookAlpha(t, plan.duration, ctx.hook); U.hookAnchor = ctx.hook.anchor;
    if (bi >= 0) U.hookScale = 1 + 0.05 * Math.exp(-(t - plan.beats[bi].t) / 0.12) * plan.beats[bi].strength;
  }
  // fade from / to black
  const fout = Math.max(ctx.fadeOut || 0, st.endFade || 0); // Movie / Caption edits end on a fade to black
  if (ctx.fadeIn || fout) U.fade = 1 - fadeGain(t, plan.duration, ctx.fadeIn, fout);
  // fades of a cut (right-click the FX row) or of its clip (set in the clip's preview): the clip fades in where it
  // comes on and out where it goes off; back-to-back cuts of the same clip don't blink in between
  const cf = cutFade(plan, si, ctx);
  if (cf < 1) U.fade = 1 - (1 - (U.fade || 0)) * cf;
  if (plan.quick) U.fade = Math.max(U.fade || 0, 1 - fadeGain(tau, d, seg.quickFadeIn || 0, seg.quickFadeOut || 0));
  // your keyframes (card motion) go on top of everything the style does
  applyKeys(U, keyValues(ctx.keys, t));
  return { si, seg, src, U };
}

function applyTrans(U, tr, k, phase, I) {
  // k: 1 = full effect, 0 = none
  const [dx, dy] = tr.dir;
  const inn = phase === 'in';
  switch (tr.type) {
    case 'flash': U.flash += k * k * (inn ? 0.95 : 0.5) * I; break;
    case 'dip': U.bright -= k * (inn ? 1 : 0.9); break;
    case 'zoom': U.zoom *= 1 + (inn ? 0.55 : 0.4) * k; U.radial += 0.28 * k * I; break;
    case 'zoomOut': U.zoom *= 1 - (inn ? 0.32 : 0.22) * k; U.radial += 0.2 * k * I; U.wrap = 1; break;
    case 'whip': {
      const m = inn ? -1 : 1;
      U.offset[0] += m * dx * k * 0.9; U.offset[1] += m * dy * k * 0.9;
      U.blur[0] += dx * k * 0.11 * I; U.blur[1] += dy * k * 0.11 * I; U.wrap = 1; break;
    }
    case 'spin': U.rot += (inn ? -1 : 1) * dx * k * Math.PI * 0.45; U.zoom *= 1 + 0.25 * k; U.radial += 0.22 * k * I; U.wrap = 1; break;
    case 'flip': U.tilt[1] += (inn ? -1 : 1) * dx * k * 1.35; U.card *= 1 - 0.18 * Math.sin(Math.PI * Math.min(1, k)); break;
    case 'glitch': U.glitch += k * 1.2 * I; U.rgb += k * 0.03 * I; U.offset[0] += noise(U.time * 47) * 0.03 * k; break;
    case 'rgb': U.rgb += k * 0.045 * I; U.zoom *= 1 + 0.08 * k; break;
    case 'blur': U.radial += k * 0.4; U.bright -= k * 0.35; break;
    case 'shake': U.offset[0] += noise(U.time * 41) * 0.045 * k * I; U.offset[1] += noise(U.time * 43 + 7) * 0.045 * k * I; U.zoom *= 1 + 0.1 * k; break;
  }
}
