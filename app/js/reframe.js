// Framing you choose for parts of a clip: "aim here", "follow her", "face close-up", "zoom in".
// Stored on the clip as source-time ranges, so every edit that shows that part of the clip uses it,
// in the live preview and in exports alike.
//   clip.framing = [{ a, b, mode, z, x, y, seed }]
//     mode 'auto'   — the automatic camera (only stored when you zoom)
//          'lock'   — fixed aim point x, y (full-frame 0..1)
//          'main'   — follow the main person
//          'face'   — close-up on the main person's face
//          'person' — follow the person you clicked (seed = { t, x, y })
//          'keys'   — your own camera move: keyframes [{ s, o, x, y, z }] (s = source time, o = seconds into
//                     the cut); the camera glides from one to the next and holds before the first / after the last
//     z — extra zoom (1 = none)
import { cameraAt, focusAt, steadyFocusAt, medianOf, gaussSmooth, CAM } from './track.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const FRAME_MODES = [
  ['auto', 'Auto', 'The automatic camera keeps every face in the shot'],
  ['main', 'Main face', 'Follows the face seen most in this cut, with room around it'],
  ['face', 'Face close-up', 'Zooms in close on the main face'],
  ['person', 'Pick a face', 'Follows just the face you pick: click one of the faces below, or a box in the picture'],
  ['lock', 'Lock here', 'The camera holds still where you aim it'],
];

export function framingAt(clip, t) {
  const L = clip && clip.framing;
  if (!L || !L.length) return null;
  for (let i = L.length - 1; i >= 0; i--) if (t >= L[i].a - 1e-3 && t < L[i].b) return L[i];
  return null;
}

// Set (props) or clear (null) the framing for source range [a, b]; overlapping ranges are trimmed.
export function setFraming(clip, a, b, props) {
  const out = [];
  for (const f of clip.framing || []) {
    if (f.b <= a + 1e-3 || f.a >= b - 1e-3) { out.push(f); continue; }
    if (f.a < a) out.push({ ...f, b: a });
    if (f.b > b) out.push({ ...f, a: b });
  }
  let made = null;
  if (props) { made = { z: 1, ...props, a, b }; out.push(made); }
  clip.framing = out.filter((f) => f.b - f.a > 0.01).sort((p, q) => p.a - q.a);
  return made;
}
export function framingIn(clip, a, b) { return (clip.framing || []).filter((f) => f.b > a + 1e-3 && f.a < b - 1e-3); }

const nearestSample = (track, t) => {
  const times = track.times;
  let lo = 0, hi = track.n - 1;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (times[m] <= t) lo = m; else hi = m - 1; }
  return lo < track.n - 1 && Math.abs(times[lo + 1] - t) < Math.abs(times[lo] - t) ? lo + 1 : lo;
};

// Follow one person through the clip: start from the box you clicked, then keep picking the box
// closest to where that person just was (both directions in time), and smooth the result.
export function personPath(track, seed) {
  if (!track || !track.n || !track.boxes) return null;
  const n = track.n, xs = new Float32Array(n), ys = new Float32Array(n), hs = new Float32Array(n);
  const near = (i, p, maxD) => {
    let best = null, bd = maxD;
    for (const b of track.boxes[i] || []) {
      const d = Math.hypot(b[0] - p.x, (b[1] - p.y) * 0.7) + Math.abs((b[3] || 0) - (p.h || b[3] || 0)) * 0.3;
      if (d < bd) { bd = d; best = { x: b[0], y: b[1], w: b[2], h: b[3] }; }
    }
    return best;
  };
  const i0 = nearestSample(track, seed.t);
  const start = near(i0, seed, 0.3) || { x: seed.x, y: seed.y, h: 0 };
  const walk = (from, to, step) => {
    let p = start;
    for (let i = from; i !== to; i += step) {
      // across a hard cut people jump around: allow a bigger search, otherwise only small moves
      const cut = step > 0 ? track.cuts?.[i] && i !== i0 : track.cuts?.[i + 1];
      const b = near(i, p, cut ? 0.3 : 0.16);
      if (b) p = b;
      xs[i] = p.x; ys[i] = p.y; hs[i] = p.h || 0;
    }
  };
  walk(i0, n, 1); walk(i0 - 1, -1, -1);
  // steady following inside each shot (never across cuts): drop detector flicker, then glide
  const times = track.times || Array.from({ length: n }, (_, i) => (i + 0.5) / n * track.dur);
  for (let s = 0; s < n;) {
    let e = s + 1;
    while (e < n && !track.cuts?.[e]) e++;
    const ts = times.slice(s, e), dt = e - s > 1 ? (ts.at(-1) - ts[0]) / (e - s - 1) : 0.25, r = Math.max(CAM.median, dt * 1.6);
    for (const arr of [xs, ys]) {
      const part = arr.slice(s, e), med = new Float32Array(e - s);
      for (let k = 0; k < e - s; k++) med[k] = medianOf(part, ts, k, r);
      const sm = gaussSmooth(med, ts, CAM.sigma);
      for (let k = 0; k < e - s; k++) arr[s + k] = sm[k];
    }
    s = e;
  }
  return { xs, ys, hs };
}
const PATHS = new WeakMap();
export function personAt(track, fo, t) {
  if (!track || !fo.seed) return null;
  let hit = PATHS.get(fo);
  if (!hit || hit.track !== track) { hit = { track, path: personPath(track, fo.seed) }; PATHS.set(fo, hit); }
  const P = hit.path;
  if (!P) return null;
  const times = track.times;
  let lo = 0, hi = track.n - 1;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (times[m] <= t) lo = m; else hi = m - 1; }
  const i = lo, j = Math.min(track.n - 1, i + 1);
  const a0 = track.cuts?.[j] ? 0 : clamp((t - times[i]) / Math.max(0.001, times[j] - times[i]), 0, 1), u = a0 * a0 * (3 - 2 * a0);
  return { x: P.xs[i] + (P.xs[j] - P.xs[i]) * u, y: P.ys[i] + (P.ys[j] - P.ys[i]) * u, h: P.hs[i] + (P.hs[j] - P.hs[i]) * u };
}

// Where to aim (full-frame coordinates) and how much extra zoom, for a framing entry at source time t.
// winW/winH: the visible window as a fraction of the frame (from the edit's output size).
export function aimFor(fo, clip, t, winW, winH) {
  const z = clamp(Number(fo.z) || 1, 1, 4), tr = clip.track;
  if (fo.mode === 'keys' && fo.keys?.length) { const k = keyAim(fo.keys, t); return { x: k.x, y: k.y, z: clamp(k.z, 1, 4) }; }
  if (fo.mode === 'lock') return { x: fo.x ?? 0.5, y: fo.y ?? 0.5, z };
  if (fo.mode === 'person') {
    const p = personAt(tr, fo, t);
    if (p) return { x: p.x, y: p.y - p.h * 0.15, z };
    return { x: fo.seed?.x ?? 0.5, y: fo.seed?.y ?? 0.5, z };
  }
  if (fo.mode === 'main' || fo.mode === 'face') {
    const f = tr ? steadyFocusAt(tr, t) : null;
    if (!f) return { x: 0.5, y: 0.5, z };
    // the main subject's box: faces sit about a third of the way down it
    if (fo.mode === 'face') return { x: f.x, y: f.h > 0 ? f.y - f.h * 0.3 : f.y, z };
    return { x: f.x, y: f.y, z };
  }
  // auto (with zoom): the automatic camera solved for the smaller, zoomed-in window
  return tr ? { ...cameraAt(tr, t, winW / z, winH / z), z } : { x: 0.5, y: 0.5, z };
}

// Camera keyframes: where the camera is (aim x, y and zoom z) at source time t. Between two keyframes it glides
// (eased, zoom changes evenly); before the first and after the last it holds still.
export function keyAim(keys, t) {
  const at = (k) => ({ x: k.x ?? 0.5, y: k.y ?? 0.5, z: k.z || 1 });
  if (!keys?.length) return { x: 0.5, y: 0.5, z: 1 };
  if (t <= keys[0].s) return at(keys[0]);
  const last = keys[keys.length - 1];
  if (t >= last.s) return at(last);
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].s <= t) i++;
  const a = at(keys[i]), b = at(keys[i + 1]), k = clamp((t - keys[i].s) / Math.max(1e-4, keys[i + 1].s - keys[i].s), 0, 1);
  const e = keys[i + 1].ease === 'linear' ? k : k * k * (3 - 2 * k);
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z * Math.pow(b.z / a.z, e) };
}
