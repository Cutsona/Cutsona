// Finds black bars (letterbox / pillarbox) baked into a clip so every edit can crop them away.
// Works per sampled frame, then smooths over time, so compilations that switch between
// letterboxed and full-frame shots get the right crop for each shot.
// Real bars are flat, near-pure black; dark parts of a night scene are noisy and a little brighter.
const DARK = 12;        // a pixel at most this bright (every channel) can belong to a pure-black bar
const BAR_LINE = 0.965; // share of bar-black pixels a row/column needs to count as bar
const MAX_BAR = 0.45;   // never treat more than this share of one side as a bar

const lum = (p, k) => Math.max(p[k], p[k + 1], p[k + 2]);

// Some encodes have dark-grey bars instead of pure black: if an outer edge line is perfectly
// flat and dark, take its level as this frame's bar black.
function barBlack(p, w, h) {
  let level = -1;
  for (const [x0, y0, dx, dy, n] of [[0, 0, 1, 0, w], [0, h - 1, 1, 0, w], [0, 0, 0, 1, h], [w - 1, 0, 0, 1, h]]) {
    const v = [];
    for (let i = 0; i < n; i++) v.push(lum(p, ((y0 + dy * i) * w + x0 + dx * i) * 4));
    v.sort((a, b) => a - b);
    const med = v[n >> 1];
    if (med <= 40 && v.filter((x) => Math.abs(x - med) <= 3).length >= n * 0.95) level = Math.max(level, med);
  }
  return Math.max(DARK, level + 6);
}

// The picture is the band of non-bar lines with the most lit pixels. Short dark stripes inside
// the picture are bridged; text or logos floating inside a bar are separated by bar and dropped.
function band(bar, mass, n, gapMax) {
  const runs = [];
  let s = -1;
  for (let i = 0; i <= n; i++) {
    const content = i < n && !bar[i];
    if (content && s < 0) s = i;
    if (!content && s >= 0) { runs.push([s, i]); s = -1; }
  }
  if (!runs.length) return null;
  const merged = [runs[0].slice()];
  for (let k = 1; k < runs.length; k++) {
    const last = merged[merged.length - 1];
    if (runs[k][0] - last[1] <= gapMax) last[1] = runs[k][1]; else merged.push(runs[k].slice());
  }
  let best = null, bestMass = -1;
  for (const [a, b] of merged) {
    let m = 0;
    for (let i = a; i < b; i++) m += mass[i];
    if (m > bestMass) { bestMass = m; best = [a, b]; }
  }
  return best;
}

// Picture bounds of one frame in pixel units, or null when the frame is too dark to judge.
export function frameBounds(pixels, width, height) {
  const black = barBlack(pixels, width, height);
  const isDark = (p, k) => lum(p, k) <= black;
  const rowDark = new Float32Array(height), rowLit = new Float32Array(height);
  let lit = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (isDark(pixels, (y * width + x) * 4)) rowDark[y]++; else { rowLit[y]++; lit++; }
  }
  if (lit < width * height * 0.06) return null;
  const rows = band(Array.from(rowDark, (d) => d >= width * BAR_LINE), rowLit, height, Math.max(1, Math.round(height * 0.04)));
  if (!rows) return null;
  const [top, bottom] = rows;
  const colDark = new Float32Array(width), colLit = new Float32Array(width);
  for (let y = top; y < bottom; y++) for (let x = 0; x < width; x++) {
    if (isDark(pixels, (y * width + x) * 4)) colDark[x]++; else colLit[x]++;
  }
  const cols = band(Array.from(colDark, (d) => d >= (bottom - top) * BAR_LINE), colLit, width, Math.max(1, Math.round(width * 0.04)));
  if (!cols) return null;
  return { left: cols[0], right: cols[1], top, bottom };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// bar sizes as fractions of the frame: [left, right, top, bottom]
function bars(b, width, height) {
  return [b.left / width, (width - b.right) / width, b.top / height, (height - b.bottom) / height];
}

// Real bars come in matching pairs; a lopsided reading next to a symmetric norm is dark picture.
function evenOut(e, norm) {
  const out = e.slice();
  for (const [a, b] of [[0, 1], [2, 3]]) {
    if (Math.abs(out[a] - out[b]) > 0.03 && !(norm && Math.abs(norm[a] - norm[b]) > 0.03)) out[a] = out[b] = Math.min(out[a], out[b]);
  }
  return out;
}

function toRect(e, width, height) {
  const [l, r, t, b] = e.map((v) => (v > MAX_BAR ? 0 : v));
  // step one sample line past each bar so the soft edge of the bar never shows
  const x = l > 0 ? l + 1 / width : 0, y = t > 0 ? t + 1 / height : 0;
  const x1 = r > 0 ? 1 - r - 1 / width : 1, y1 = b > 0 ? 1 - b - 1 / height : 1;
  if (x1 - x < 0.2 || y1 - y < 0.2) return [0, 0, 1, 1];
  return [x, y, x1 - x, y1 - y];
}

function edgesOf(bounds, width, height) {
  const valid = bounds.filter(Boolean);
  if (valid.length < 2) return null;
  const all = valid.map((b) => bars(b, width, height));
  return [0, 1, 2, 3].map((k) => median(all.map((e) => e[k])));
}

// One crop for the whole clip (median over frames, so one bright title card can't cancel it).
export function contentRect(bounds, width, height) {
  const e = edgesOf(bounds, width, height);
  return e ? toRect(e, width, height) : [0, 0, 1, 1];
}

// Crop per sampled moment: median over neighbouring samples, then snapped to the clip's usual crop.
export function barTimeline(bounds, times, width, height) {
  const norm = edgesOf(bounds, width, height);
  if (!norm) return [];
  const per = bounds.map((b) => (b ? bars(b, width, height) : null));
  const snap = [1.5 / width, 1.5 / width, 1.5 / height, 1.5 / height];
  return per.map((_, i) => {
    const win = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(per.length - 1, i + 2); j++) if (per[j]) win.push(per[j]);
    let e = win.length ? [0, 1, 2, 3].map((k) => median(win.map((w) => w[k]))) : norm.slice();
    e = evenOut(e, norm).map((v, k) => (Math.abs(v - norm[k]) <= snap[k] ? norm[k] : v));
    return { t: times[i], rect: toRect(e, width, height) };
  });
}

// The crop for a stretch of source [a, b]: the tightest crop of the samples it touches, so no
// bar can appear anywhere in the shot and the crop never jumps mid-shot.
export function rectBetween(timeline, a, b, fallback = [0, 0, 1, 1]) {
  if (!timeline || !timeline.length) return fallback;
  const step = timeline.length > 1 ? (timeline[timeline.length - 1].t - timeline[0].t) / (timeline.length - 1) : 1;
  let picked = timeline.filter((s) => s.t >= a - step / 2 && s.t <= b + step / 2);
  if (!picked.length) {
    const mid = (a + b) / 2;
    picked = [timeline.reduce((best, s) => (Math.abs(s.t - mid) < Math.abs(best.t - mid) ? s : best))];
  }
  let x0 = 0, y0 = 0, x1 = 1, y1 = 1;
  for (const { rect: [x, y, w, h] } of picked) { x0 = Math.max(x0, x); y0 = Math.max(y0, y); x1 = Math.min(x1, x + w); y1 = Math.min(y1, y + h); }
  if (x1 - x0 < 0.2 || y1 - y0 < 0.2) return fallback;
  return [x0, y0, x1 - x0, y1 - y0];
}
