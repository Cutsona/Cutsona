// Stream clips (Twitch / Kick highlights). Not edits: one real moment from the stream with its own audio,
// laid out for phones (streamer cam on top, gameplay below, or full frame following the streamer),
// dead air cut out, word-by-word captions, a title, and the platform bar.
//
// Which moments: the "clip brain". The best evidence of a great moment is people clipping it, so when the
// stream's own viewer clips are known (Twitch / Kick, with their views and where in the stream they were
// clipped from) those moments come first. Then: what the channel's most-viewed clips are about (title words),
// YouTube "Most replayed" / comment timestamps, and the stream itself (laughs, yelling, big reactions, hooks).
import { speechPhrases, quoteScore } from './moments.js';
import { STYLES } from './styles.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const STREAM_LAYOUTS = [['auto', 'Auto'], ['stack', 'Cam + screen'], ['full', 'Full frame']];

// a plain look (no effects): what you'd post as a clip
STYLES.stream = {
  name: 'Stream clip', color: '#53fc18', desc: 'A highlight of the stream', hidden: true,
  cutBeats: { 4: 1 }, speed: [{ type: 'const', r: 1, p: 1 }],
  trans: { cut: 1 }, impactTrans: { cut: 1 }, transDur: 0.1,
  beat: { punch: 0, decay: 0.1 }, impact: {}, cont: { card: 1 },
  look: { contrast: 1.05, sat: 1.08, vignette: 0, grain: 0, sharp: 0.2 }, run: 8, parts: [],
};

// reaction words: what people say when something clip-worthy just happened
const REACT = /^(ha(ha)+h?|haha|lol|lmao+|lmfao|bro+|broo+|what+|wha+t|no+|nah+|yo+|oh+|omg|wtf|dude|stop+|bruh|wait|hell|damn|crazy|insane|why|holy|sheesh|ayo+|chat)[!?.,]*$/i;
const LAUGH = /^(ha(ha)+h?|lol|lmao+|lmfao|hah+)[!?.,]*$/i;
const STOP = new Set('the a an and or to of in on for with is are was were be been it its this that i you he she they we me my your his her our their not no yes so but if at as by from just like get got do did have has had what who how why when where there here all one'.split(' '));

// ---------------- where the streamer's camera is ----------------
// From the people tracking: a face/person that sits in the same small spot most of the time = a facecam overlay.
// A big person filling the frame = a full-cam / IRL stream (no split).
export function findCam(clip) {
  const tr = clip.track;
  if (!tr || !tr.boxes) return null;
  const cells = new Map();
  let seen = 0;
  tr.boxes.forEach((list) => {
    if (!list || !list.length) return;
    seen++;
    for (const [x, y, w, h] of list) {
      const key = Math.round(x * 8) + ',' + Math.round(y * 8);
      let c = cells.get(key);
      if (!c) cells.set(key, (c = { n: 0, xs: [], ys: [], ws: [], hs: [] }));
      c.n++; c.xs.push(x); c.ys.push(y); c.ws.push(w); c.hs.push(h);
    }
  });
  if (!seen) return null;
  const best = [...cells.values()].sort((a, b) => b.n - a.n)[0];
  const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
  const box = { x: med(best.xs), y: med(best.ys), w: med(best.ws), h: med(best.hs), share: best.n / Math.max(1, tr.n) };
  // big + central = the streamer IS the picture (IRL, full cam)
  box.full = box.h > 0.55 || (box.w * box.h > 0.16 && Math.abs(box.x - 0.5) < 0.2);
  // a facecam overlay sits in a corner; someone sitting still in the middle of a room camera is not one
  box.corner = Math.abs(box.x - 0.5) > 0.2 && Math.abs(box.y - 0.5) > 0.15;
  box.steady = box.share > 0.35 && box.corner;
  return box;
}

// the two crops for the "cam on top" layout, in source coordinates (0..1 inside the picture area)
// opts.game: 'fill' (biggest crop of the middle) or 'whole' (the whole stream screen, fitted to the panel)
// opts.cam: 'face' (close on the streamer) or 'whole' (the whole webcam box)
export function stackRects(clip, outAspect, stackY = 0.5, cam = clip.cam, opts = {}) {
  const va = (clip.w || 16) / (clip.h || 9);
  const panel = (y) => outAspect / y; // width / height of a panel in output space
  const rectAround = (cx, cy, h, aspect) => {
    let rh = clamp(h, 0.05, 1), rw = rh * aspect / va;
    if (rw > 1) { rw = 1; rh = rw * va / aspect; }
    return [clamp(cx - rw / 2, 0, 1 - rw), clamp(cy - rh / 2, 0, 1 - rh), rw, rh];
  };
  const camA = panel(stackY), gameA = panel(1 - stackY);
  // cam: around the face/person box, a bit of room above the head (or the whole webcam box around it)
  const camH = opts.cam === 'whole' ? 2.9 : 1.7;
  const camRect = cam ? rectAround(cam.x, cam.y - cam.h * 0.05, cam.h * camH, camA) : rectAround(0.5, 0.5, 1, camA);
  // gameplay: the middle of the frame (the biggest crop that fits the panel)
  const gameFill = rectAround(0.5, 0.5, 1, gameA);
  let gameRect = gameFill;
  if (opts.game === 'whole') {
    // the whole picture, as wide as the panel (or as tall, for a tall video); the rest is filled behind it
    gameRect = va >= gameA ? [0, 0.5 - va / gameA / 2, 1, va / gameA] : [0.5 - gameA / va / 2, 0, gameA / va, 1];
  }
  return { camRect, gameRect, gameFill };
}

// ---------------- finding the highlights ----------------
const wordsIn = (clip, a, b) => (clip.words || []).filter((w) => w.start >= a && w.end <= b);
// matches of the channel's top viewer clips inside this clip: [{ t0, t1, views, title }]
function provenIn(clip) {
  const b = clip.crowd?.brain;
  return (b?.matches || []).filter((m) => m.t1 > 0 && m.t0 < (clip.duration || 0));
}
// words the channel's most-viewed clips are about, weighted by views (the "what works here" part of the brain)
export function brainWords(brain) {
  const wts = new Map();
  if (!brain?.clips?.length) return wts;
  const total = brain.clips.reduce((s, c) => s + Math.log10((c.views || 0) + 10), 0) || 1;
  for (const c of brain.clips) {
    const w = Math.log10((c.views || 0) + 10) / total;
    for (const t of String(c.title || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/)) {
      if (t.length < 3 || STOP.has(t)) continue;
      wts.set(t, (wts.get(t) || 0) + w);
    }
  }
  const mx = Math.max(...wts.values(), 1e-9);
  for (const [k, v] of wts) wts.set(k, v / mx);
  return wts;
}

// "excitement" over time (10 samples / s): loud / busy footage, laughs and reactions, what people replay,
// and the moments viewers actually clipped
export function excitement(clip) {
  const n = Math.max(1, Math.ceil((clip.duration || 0) * 10));
  const base = clip.baseInterest || clip.interest || new Float32Array(n);
  const c = new Float32Array(n), kw = brainWords(clip.crowd?.brain);
  const sorted = Array.from(base).sort((a, b) => a - b), p90 = sorted[Math.floor(sorted.length * 0.9)] || 1;
  for (let i = 0; i < n; i++) c[i] = 0.55 * clamp((base[i] || 0) / Math.max(0.05, p90), 0, 1.4) + 0.8 * (clip.replay?.[i] || 0);
  const bump = (t, amt, before = 1, after = 3) => {
    for (let i = Math.max(0, Math.floor((t - before) * 10)); i < Math.min(n, Math.ceil((t + after) * 10)); i++) c[i] += amt;
  };
  for (const w of clip.words || []) {
    const t = String(w.text).trim();
    if (LAUGH.test(t)) bump(w.start, 0.45, 1, 2.5);
    else if (REACT.test(t)) bump(w.start, 0.22, 1, 2);
    else if (/[!?]$/.test(t)) bump(w.start, 0.1, 0.5, 1.5);
    const k = kw.get(t.toLowerCase().replace(/[^a-z0-9']/g, ''));
    if (k) bump(w.start, 0.3 * k, 2, 4);
  }
  for (const m of provenIn(clip)) {
    const v = 0.9 + 0.25 * Math.log10((m.views || 0) + 10);
    for (let i = Math.max(0, Math.floor(m.t0 * 10)); i < Math.min(n, Math.ceil(m.t1 * 10)); i++) c[i] += v;
  }
  return c;
}

function laughAt(clip, a, b) { return wordsIn(clip, a, b).filter((w) => LAUGH.test(String(w.text).trim())).length; }

// the title on the clip: a viewer clip's own title if people clipped this moment, else the best line said
// a real title, not "gg1" / "lol" / "clip 3"
export const goodTitle = (t) => { const s = String(t || '').trim(); return s.replace(/[^a-z]/gi, '').length >= 8 && s.split(/\s+/).length >= 2 && !/^clip\b/i.test(s); };
const SLUR = /\bn[i1]gg|\bf[a@]gg|\br[e3]tard/i;
function titleFor(clip, a, b, proven, useSelf = true) {
  if (goodTitle(proven?.title)) return proven.title;
  const self = clip.crowd?.brain?.self?.title;
  if (useSelf && goodTitle(self) && (clip.duration || 0) < 90) return self;
  const ph = speechPhrases(wordsIn(clip, a, b), b);
  let best = null, bs = -1;
  for (const p of ph) {
    if (SLUR.test(p.text)) continue;
    const s = quoteScore(p.text) + (p.text.split(' ').length <= 9 ? 0.15 : 0);
    if (s > bs) { bs = s; best = p.text; }
  }
  const emoji = laughAt(clip, a, b) >= 2 ? ' 😭' : /!|\?/.test(best || '') ? ' 😳' : ' 👀';
  if (!best) return '';
  const w = best.replace(/^[^a-z0-9"']+/i, '').split(' ');
  return (w.length > 9 ? w.slice(0, 9).join(' ') + '…' : w.join(' ')).replace(/[.,]$/, '') + emoji;
}

// cut out dead air: pauses between words longer than `gap` where nothing else is happening
export function removeDeadAir(clip, a, b, gap = 0.7) {
  const ws = wordsIn(clip, a - 0.05, b + 0.05);
  const base = clip.audioCurve?.length ? clip.audioCurve : clip.baseInterest || clip.interest || [];
  const loud = (t0, t1) => { let m = 0; for (let t = t0; t < t1; t += 0.1) m = Math.max(m, base[Math.floor(t * 10)] || 0); return m; };
  const sorted = Array.from(base).sort((x, y) => x - y), p75 = sorted[Math.floor(sorted.length * 0.75)] || 1;
  const med = sorted[Math.floor(sorted.length * 0.5)] || 0;
  // a quiet gap is dead air; keep it only if something loud happens in it (a scream, an explosion)
  const eventful = (g0, g1) => { const l = loud(g0, g1); return l > p75 && l > med * 1.25 + 0.02; };
  const pieces = [];
  let s = a;
  for (let i = 1; i < ws.length; i++) {
    const g0 = ws[i - 1].end, g1 = ws[i].start;
    if (g1 - g0 > gap && !eventful(g0, g1)) { pieces.push([s, g0 + 0.12]); s = g1 - 0.12; }
  }
  pieces.push([s, b]);
  return pieces.filter(([x, y]) => y - x > 0.15);
}

// The best moments across the clips, best first: [{ ci, a, b, score, title, why, pieces, punches }]
export function findHighlights(clips, { count = 4, maxLen = 30, minLen = 8 } = {}) {
  const cands = [];
  clips.forEach((clip, ci) => {
    const d = Math.min(clip.duration || 0, clip.usableEnd ?? clip.duration ?? 0), from = clip.trimIn || 0;
    if (d - from < 1) return;
    const c = excitement(clip), ph = speechPhrases(clip.words || [], d), proven = provenIn(clip);
    const brain = clip.crowd?.brain;
    // a viewer clip is already a highlight: keep it whole (minus dead air)
    if (d - from <= maxLen + 6) {
      cands.push({ ci, a: from, b: d, score: 2 + (brain?.self?.views ? Math.log10(brain.self.views + 10) * 0.3 : 0), why: brain?.self ? `Viewer clip, ${fmtViews(brain.self.views)} views` : 'Whole clip' });
      return;
    }
    // smooth (1s) and find peaks at least 8s apart (then smaller ones 4s apart, as spares)
    const n = c.length, sm = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0, k = 0; for (let j = Math.max(0, i - 5); j <= Math.min(n - 1, i + 5); j++) { s += c[j]; k++; } sm[i] = s / k; }
    const peaks = [], spare = new Set();
    for (const R of [40, 20]) for (let i = Math.floor(from * 10); i < Math.floor(d * 10); i++) {
      let top = true;
      for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R) && top; j++) if (sm[j] > sm[i] || (j < i && sm[j] === sm[i])) top = false;
      if (top && sm[i] > 0.05 && !peaks.some((q) => Math.abs(q - i / 10) < 1)) { peaks.push(i / 10); if (R === 20) spare.add(i / 10); }
    }
    // a viewer clip (the clip itself was clipped by viewers) counts for all its moments
    const selfBonus = brain?.self?.views ? 0.15 * Math.log10(brain.self.views + 10) : 0;
    // the viewer-clipped moments themselves are peaks too
    for (const m of proven) peaks.push((m.t0 + m.t1) / 2);
    const target = clamp(brain?.typicalLength || maxLen * 0.8, minLen, maxLen);
    for (const p of peaks) {
      const pm = proven.find((m) => p >= m.t0 - 1 && p <= m.t1 + 1);
      // setup before the peak, reaction after it; start / end on whole sentences
      let a = pm ? pm.t0 - 2 : p - clamp(target * 0.45, 3, 12), b = pm ? Math.max(pm.t1 + 2, a + minLen) : a + target;
      const st = ph.filter((x) => x.start >= a - 3 && x.start <= a + 1.5).sort((x, y) => Math.abs(x.start - a) - Math.abs(y.start - a))[0];
      if (st) a = st.start;
      const en = ph.filter((x) => x.end >= b - 3 && x.end <= b + 3 && x.end > p + 1).sort((x, y) => Math.abs(x.end - b) - Math.abs(y.end - b))[0];
      if (en) b = en.end;
      a = clamp(a, from, d); b = clamp(b, a + Math.min(minLen, d - a), Math.min(d, a + maxLen));
      if (b - a < Math.min(minLen, 3)) continue;
      let mean = 0, k = 0, pk = 0;
      for (let t = a; t < b; t += 0.1) { const v = c[Math.floor(t * 10)] || 0; mean += v; k++; pk = Math.max(pk, v); }
      mean /= Math.max(1, k);
      const first = ph.find((x) => x.start >= a - 0.1 && x.start < a + 2);
      const hook = first && (/[!?]/.test(first.text) || REACT.test(first.text.split(' ')[0] || '')) ? 0.15 : 0;
      const spoken = wordsIn(clip, a, b).length / Math.max(1, b - a);
      const score = (mean + 0.5 * pk + hook + (pm ? 0.6 + 0.25 * Math.log10((pm.views || 0) + 10) : 0) + Math.min(0.2, spoken * 0.05)) * (spare.has(p) ? 0.8 : 1) + selfBonus;
      const why = pm ? `Viewers clipped this, ${fmtViews(pm.views)} views` : laughAt(clip, a, b) >= 2 ? 'Big laugh'
        : clip.replay && mean > 0.8 ? 'Most replayed' : brain?.self?.views ? `From a viewer clip, ${fmtViews(brain.self.views)} views` : 'Big reaction';
      cands.push({ ci, a, b, score, why, proven: pm });
    }
  });
  // best first, no two highlights from the same stretch of the same clip
  // (if that leaves fewer than `count`, allow more overlap so every card still gets its own moment)
  cands.sort((x, y) => y.score - x.score);
  const out = [];
  for (const lim of [0.3, 0.65]) {
    for (const h of cands) {
      if (out.length >= count) break;
      if (out.includes(h) || out.some((o) => o.ci === h.ci && Math.min(o.b, h.b) - Math.max(o.a, h.a) > lim * Math.min(o.b - o.a, h.b - h.a))) continue;
      out.push(h);
    }
  }
  return out.map((h) => {
    const clip = clips[h.ci];
    // the viewer clip's own title goes on its best moment; the others get the best line said in them
    const useSelf = out.find((o) => o.ci === h.ci) === h;
    return { ...h, title: titleFor(clip, h.a, h.b, h.proven, useSelf), pieces: removeDeadAir(clip, h.a, h.b), punches: punchesFor(clip, h.a, h.b) };
  });
}
// a highlight's pieces minus the parts of the clip you switched off (cut & group in the Clips list)
export function keepParts(pieces, off) {
  if (!off?.length) return pieces;
  let out = pieces.map((p) => [...p]);
  for (const [s, e] of off) {
    const next = [];
    for (const [a, b] of out) {
      if (e <= a || s >= b) { next.push([a, b]); continue; }
      if (s > a) next.push([a, s]);
      if (e < b) next.push([e, b]);
    }
    out = next;
  }
  return out.filter(([a, b]) => b - a > 0.15);
}
// "Match clip": each clip in full, from its first live frame to its last (frozen / black stretches at the ends dropped)
export function wholeHighlights(clips) {
  return clips.map((clip, ci) => {
    let a = clip.trimIn || 0, b = Math.min(clip.duration || 0, clip.usableEnd ?? clip.duration ?? 0);
    const stills = [...(clip.stills || [])].sort((x, y) => x[0] - y[0]);
    for (const [s, e] of stills) if (s <= a + 0.05 && e > a) a = e;
    for (const [s, e] of [...stills].reverse()) if (e >= b - 0.05 && s < b) b = s;
    if (b - a < 0.5) return null;
    const self = clip.crowd?.brain?.self;
    const h = { ci, a, b, score: 1, why: self?.views ? `Viewer clip, ${fmtViews(self.views)} views` : 'Whole clip' };
    return { ...h, title: titleFor(clip, a, b, null, true), pieces: removeDeadAir(clip, a, b), punches: punchesFor(clip, a, b) };
  }).filter(Boolean);
}
// a shorter cut of a highlight: just its most exciting stretch (whole sentences), for "short & punchy" versions
export function tightCut(h, clip, frac = 0.55, label = 'short cut') {
  const len = h.b - h.a, L = clamp(len * frac, Math.min(5, len), 15);
  if (len - L < 2) return null;
  const c = excitement(clip);
  // the most exciting window; among (nearly) equal ones, the one centred on the peak (setup + reaction)
  const wins = [];
  for (let a = h.a; a + L <= h.b + 1e-6; a += 0.5) {
    let s = 0; for (let t = a; t < a + L; t += 0.1) s += c[Math.floor(t * 10)] || 0;
    wins.push([a, s]);
  }
  let pk = h.a, pv = -1, ws = 0, wt = 0;
  for (let t = h.a; t < h.b; t += 0.1) { const v = c[Math.floor(t * 10)] || 0; if (v > pv) pv = v; }
  for (let t = h.a; t < h.b; t += 0.1) { const v = c[Math.floor(t * 10)] || 0; if (v >= pv * 0.9) { ws += t; wt++; } }
  pk = wt ? ws / wt : h.a;
  const top = Math.max(...wins.map((w) => w[1]));
  const best = wins.filter((w) => w[1] >= top * 0.97).sort((x, y) => Math.abs(x[0] + L / 2 - pk) - Math.abs(y[0] + L / 2 - pk))[0][0];
  const ph = speechPhrases(wordsIn(clip, h.a, h.b), h.b);
  let a = best, b = best + L;
  const st = ph.filter((x) => x.start >= a - 2 && x.start <= a + 1).sort((x, y) => Math.abs(x.start - a) - Math.abs(y.start - a))[0];
  if (st) a = Math.max(h.a, st.start);
  const en = ph.filter((x) => x.end >= b - 2 && x.end <= b + 2).sort((x, y) => Math.abs(x.end - b) - Math.abs(y.end - b))[0];
  if (en) b = Math.min(h.b, en.end);
  if (b - a < 4) return null;
  return { ...h, a, b, why: h.why + ', ' + label, pieces: removeDeadAir(clip, a, b), punches: punchesFor(clip, a, b) };
}
// a longer cut of a highlight: more of the build-up before it (and a bit after), still one moment, within maxLen
export function longCut(h, clip, maxLen = 30) {
  const len = h.b - h.a, from = clip.trimIn || 0;
  const d = Math.min(clip.duration || 0, clip.usableEnd ?? clip.duration ?? 0);
  const target = Math.min(len * 1.5, maxLen);
  if (target - len < 3) return null;
  const extra = target - len;
  let a = Math.max(from, h.a - extra * 0.7), b = Math.min(d, h.b + extra * 0.3);
  const spare = target - (b - a); // whatever didn't fit on one side goes to the other
  if (spare > 0.1) { a = Math.max(from, a - spare); b = Math.min(d, a + target); }
  const ph = speechPhrases(wordsIn(clip, a - 1, b + 1), b + 1);
  const st = ph.filter((x) => x.start >= a - 1 && x.start <= Math.min(h.a, a + 2)).sort((x, y) => Math.abs(x.start - a) - Math.abs(y.start - a))[0];
  if (st) a = Math.max(from, st.start);
  const en = ph.filter((x) => x.end >= Math.max(h.b, b - 2) && x.end <= b + 1).sort((x, y) => Math.abs(x.end - b) - Math.abs(y.end - b))[0];
  if (en) b = Math.min(d, en.end);
  if (b - a - len < 3) return null;
  return { ...h, a, b, why: h.why + ', longer', pieces: removeDeadAir(clip, a, b), punches: punchesFor(clip, a, b) };
}
const fmtViews = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n || 0));

// punch in on the streamer's face for the big reactions (laughs, yells)
function punchesFor(clip, a, b) {
  const times = [];
  for (const w of wordsIn(clip, a, b)) if (LAUGH.test(String(w.text).trim()) || /^[A-Z!?]{4,}$/.test(String(w.text).trim())) times.push(w.start);
  // the loudest spikes (yells, screams) — transcripts rarely write laughs down
  const base = clip.audioCurve?.length ? clip.audioCurve : clip.baseInterest || clip.interest;
  if (base?.length) {
    const all = Array.from(base).sort((x, y) => x - y), p80 = all[Math.floor(all.length * 0.8)] || 1;
    // a spike = the moment it gets loud: loud now, and a big jump from the second before (the yell starts)
    const spikes = [];
    for (let i = Math.ceil((a + 1) * 10); i < Math.floor((b - 1) * 10); i++) {
      const v = base[i] || 0;
      let before = 0; for (let j = i - 12; j < i - 2; j++) before += base[j] || 0;
      before /= 10;
      const jump = v - before;
      if (v >= p80 && jump > 0.12 && v >= (base[i - 1] || 0) && v >= (base[i + 1] || 0)) spikes.push([i / 10, jump]);
    }
    spikes.sort((x, y) => y[1] - x[1]);
    for (const [t] of spikes.slice(0, Math.max(1, Math.round((b - a) / 10)))) times.push(t - 0.15);
  }
  times.sort((x, y) => x - y);
  const out = [];
  for (const t of times) if (!out.length || t - out.at(-1).t >= 3) out.push({ t, k: 1.28 });
  return out.slice(0, 6);
}

// A highlight -> a plan the player / exporter understand (same shape as an edit's plan, without beat effects)
export function planHighlight(h, clips, { layout = 'auto', outAspect = 9 / 16, channel = '', platform = '' } = {}) {
  const clip = clips[h.ci];
  const segments = [];
  let t = 0;
  h.pieces.forEach(([s, e], i) => {
    const d = e - s, prev = segments.at(-1);
    segments.push({ start: t, end: t + d, clip: h.ci, srcStart: s, srcDur: d, profile: { type: 'const', r: 1 },
      deck: prev ? (Math.abs(prev.srcStart + prev.srcDur - s) < 0.001 ? prev.deck : 1 - prev.deck) : 0,
      impact: false, mirror: 0, push: 1, orbitPhase: 0, transIn: null, transOut: null, run: i, reason: h.why, speech: true });
    t += d;
  });
  // punch times: source -> output time
  const toOut = (src) => { for (const g of segments) if (src >= g.srcStart && src <= g.srcStart + g.srcDur) return g.start + (src - g.srcStart); return -1; };
  const punches = (h.punches || []).map((p) => ({ t: toOut(p.t), k: p.k })).filter((p) => p.t >= 0);
  const cam = clip.cam || findCam(clip);
  const use = layout === 'auto' ? (cam && cam.steady && !cam.full ? 'stack' : 'full') : layout;
  return { styleId: 'stream', style: STYLES.stream, seed: 0, mode: 'stream', off: [], order: 'story', intro: 0, voice: false,
    duration: t, segments, beats: [], musicStart: 0, period: 1, noMusic: true,
    highlight: { ...h, title: h.title, layout: use, cam, punches, channel, platform } };
}

// ---------------- the overlay: platform bar, title box, header ----------------
const PLATFORM = { kick: { logo: 'KICK', color: '#53fc18', site: 'KICK.COM/' }, twitch: { logo: 'twitch', color: '#9146ff', site: 'TWITCH.TV/' } };
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function fitLines(g, text, maxW, font, size, maxLines = 2) {
  for (let s = size; s >= 20; s = Math.round(s * 0.9)) {
    g.font = font(s);
    const lines = [];
    let cur = '';
    for (const w of text.split(/\s+/)) {
      const t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines) return { lines, size: s };
  }
  g.font = font(20);
  return { lines: [text], size: 20 };
}
// the banner: how the platform + streamer name looks (stream clips)
export const BANNER_THEMES = [
  ['classic', 'Classic', 'Logo left, channel link right, black bar'],
  ['center', 'Name in the middle', 'Logo and name centered on a black bar'],
  ['brand', 'Brand color', 'The bar in Twitch purple or Kick green'],
  ['nametag', 'Name tag', 'A white tag with the logo and @name'],
  ['live', 'Live', 'A broadcast bar with a red LIVE tag'],
  ['minimal', 'Minimal', 'Just @name, no bar'],
];
// layout 'stack': the banner sits on the line between the two halves (divider = where that line is, 0..1 from
// the top) and the title box just under it. 'full': title box near the top, banner near the bottom.
export function drawStreamOverlay(aspect, { layout = 'stack', platform = '', channel = '', title = '', banner = 'on', theme = 'classic', divider = 0.5, pos = null } = {}) {
  const H = 1280, W = Math.round(H * aspect);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const P = PLATFORM[platform];
  const stack = layout === 'stack';
  const sans = (s, wt = 800) => `${wt} ${s}px "Segoe UI", Arial, sans-serif`;
  const logoFont = (s) => (platform === 'kick' ? `900 ${s}px Impact, "Arial Black", sans-serif` : `800 italic ${s}px "Segoe UI", Arial, sans-serif`);
  const barH = Math.round(H * 0.038);
  // moved by hand (pos = its center, 0..1): a compact banner just as wide as what's on it, sitting where you put it
  const floating = !!(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y));
  let barY = stack ? Math.round(H * divider - barH / 2) : H - barH - Math.round(H * 0.035);
  if (floating) barY = Math.round(Math.min(H - barH - 2, Math.max(2, pos.y * H - barH / 2)));
  const mid = barY + barH * 0.53;
  let below = stack ? (floating ? Math.round(H * divider) + 2 : barY + barH) : barY; // where the title box goes (stack)
  c.bannerBox = null;
  if (banner !== 'off' && P && channel) {
    g.textBaseline = 'middle';
    const name = channel, link = (P.site + channel).toUpperCase();
    const fLogo = (k) => { g.font = logoFont(Math.round(barH * k)); return g.measureText(P.logo).width; };
    const fText = (t, k, wt = 800) => { g.font = sans(Math.round(barH * k), wt); return g.measureText(t).width; };
    // how wide the banner's contents are (for a moved, compact banner)
    const tagW = fText('LIVE', 0.46, 900) + barH * 0.5;
    const content = {
      classic: fLogo(0.82) + barH * 0.8 + fText(link, 0.42),
      center: fLogo(0.72) + barH * 0.35 + fText(name.toUpperCase(), 0.5),
      brand: fLogo(0.72) + barH * 0.35 + fText(name.toUpperCase(), 0.5),
      live: tagW + barH * 0.6 + fText(name.toUpperCase(), 0.5) + barH * 0.6 + fLogo(0.62),
    }[theme] || 0;
    const pad = barH * 0.55;
    let bx0, bw;
    if (floating) {
      bw = Math.min(W * 0.96, content + pad * 2);
      bx0 = Math.min(W - bw - 2, Math.max(2, pos.x * W - bw / 2));
    } else { bx0 = stack ? 0 : W * 0.04; bw = stack ? W : W * 0.92; }
    const CX = bx0 + bw / 2;
    if (stack && floating) { g.fillStyle = '#000'; g.fillRect(0, Math.round(H * divider) - 2, W, 4); } // the split line stays
    // the bar itself: full width on the split line, a rounded pill when it floats over the picture
    const bar = (fill) => {
      g.fillStyle = fill;
      if (stack && !floating) g.fillRect(0, barY, W, barH); else { roundRect(g, bx0, barY, bw, barH, barH / 2); g.fill(); }
    };
    const L = floating ? bx0 + pad : stack ? W * 0.035 : W * 0.07, R = floating ? bx0 + bw - pad : stack ? W * 0.965 : W * 0.93;
    let box = [bx0, barY, bx0 + bw, barY + barH];
    if (theme === 'classic') {
      bar(stack && !floating ? '#000' : 'rgba(0,0,0,0.6)');
      g.font = logoFont(Math.round(barH * 0.82)); g.fillStyle = P.color; g.textAlign = 'left'; g.fillText(P.logo, L, mid);
      g.font = sans(Math.round(barH * 0.42)); g.fillStyle = '#fff'; g.textAlign = 'right'; g.fillText(link, R, mid);
    } else if (theme === 'center' || theme === 'brand') {
      const brand = theme === 'brand', ink = brand && platform === 'kick' ? '#000' : '#fff';
      bar(brand ? P.color : stack && !floating ? '#000' : 'rgba(0,0,0,0.65)');
      g.font = logoFont(Math.round(barH * 0.72)); const lw = g.measureText(P.logo).width;
      g.font = sans(Math.round(barH * 0.5), 800); const nw = g.measureText(name.toUpperCase()).width;
      const gap = barH * 0.35, x0 = CX - (lw + gap + nw) / 2;
      g.textAlign = 'left';
      g.font = logoFont(Math.round(barH * 0.72)); g.fillStyle = brand ? ink : P.color; g.fillText(P.logo, x0, mid);
      g.font = sans(Math.round(barH * 0.5), 800); g.fillStyle = ink; g.fillText(name.toUpperCase(), x0 + lw + gap, mid);
    } else if (theme === 'nametag') {
      if (stack && !floating) { g.fillStyle = '#000'; g.fillRect(0, Math.round(H * divider) - 3, W, 6); }
      g.font = logoFont(Math.round(barH * 0.66)); const lw = g.measureText(P.logo).width;
      g.font = sans(Math.round(barH * 0.5), 800); const nw = g.measureText('@' + name).width;
      const padX = barH * 0.45, gap = barH * 0.3, tw = lw + gap + nw + padX * 2, th = barH * 1.05;
      const tx = floating ? Math.min(W - tw - 2, Math.max(2, pos.x * W - tw / 2)) : (W - tw) / 2, ty = mid - th / 2;
      g.fillStyle = '#fff'; roundRect(g, tx, ty, tw, th, th / 2); g.fill();
      g.textAlign = 'left';
      g.font = logoFont(Math.round(barH * 0.66)); g.fillStyle = platform === 'kick' ? '#1a9e00' : P.color; g.fillText(P.logo, tx + padX, mid);
      g.font = sans(Math.round(barH * 0.5), 800); g.fillStyle = '#111'; g.fillText('@' + name, tx + padX + lw + gap, mid);
      box = [tx, ty, tx + tw, ty + th];
      if (!floating) below = ty + th;
    } else if (theme === 'live') {
      bar(stack && !floating ? '#141414' : 'rgba(20,20,20,0.82)');
      g.font = sans(Math.round(barH * 0.46), 900);
      g.fillStyle = '#e8262a'; roundRect(g, L - barH * 0.05, barY + barH * 0.18, tagW, barH * 0.64, barH * 0.12); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText('LIVE', L + barH * 0.2, mid);
      g.font = sans(Math.round(barH * 0.5), 800); g.textAlign = 'center';
      g.fillText(name.toUpperCase(), floating ? (L + tagW + R - fLogo(0.62)) / 2 : W / 2, mid);
      g.font = logoFont(Math.round(barH * 0.62)); g.fillStyle = P.color; g.textAlign = 'right'; g.fillText(P.logo, R, mid);
    } else { // minimal
      if (stack && !floating) { g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, Math.round(H * divider) - 1, W, 2); }
      g.font = sans(Math.round(barH * 0.55), 800); g.textAlign = 'center';
      const tw = g.measureText('@' + name).width, tx = floating ? Math.min(W - tw / 2 - 4, Math.max(tw / 2 + 4, pos.x * W)) : W / 2;
      const ty = floating ? mid : stack ? barY - barH * 0.25 : mid;
      g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = barH * 0.35; g.fillStyle = '#fff';
      g.fillText('@' + name, tx, ty);
      g.shadowBlur = 0;
      box = [tx - tw / 2, ty - barH * 0.45, tx + tw / 2, ty + barH * 0.45];
    }
    // where the banner is (0..1), so it can be grabbed and dragged on the preview
    c.bannerBox = [box[0] / W, box[1] / H, box[2] / W, box[3] / H];
    c.bannerCenter = [(box[0] + box[2]) / 2 / W, (box[1] + box[3]) / 2 / H];
  } else if (stack) {
    // no banner: just a clean line between the two halves
    g.fillStyle = '#000'; g.fillRect(0, Math.round(H * divider) - 2, W, 4);
    below = H * divider + 2;
  }
  // title: black text in a white rounded box
  if (title && title.trim()) {
    const { lines, size } = fitLines(g, title.trim(), W * 0.78, (s) => sans(s, 800), Math.round(H * 0.03));
    g.font = sans(size, 800);
    const lw = Math.max(...lines.map((l) => g.measureText(l).width)), padX = size * 0.6, padY = size * 0.32, lh = size * 1.18;
    const bw = lw + padX * 2, bh = lines.length * lh + padY * 2;
    const by = stack ? below + H * 0.018 : H * 0.12;
    g.fillStyle = '#ffffff'; roundRect(g, (W - bw) / 2, by, bw, bh, size * 0.35); g.fill();
    g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, W / 2, by + padY + lh * (i + 0.5)));
  }
  return c;
}
