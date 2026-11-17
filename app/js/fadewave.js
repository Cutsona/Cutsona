// Fades you set on the sound's wave, fully custom: where the fade in starts and ends, where the fade out starts
// and ends (the sound is silent before / after them), and the fade's shape. Used by the song's Edit panel and a
// clip's Audio panel; fadeAt / fadeParam play it the same way in the previews and the exports.
//   f = { fadeIn, fadeOut, inAt, outAt, curve }   (seconds: inAt = silence before the fade in, outAt = after the fade out)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const FADE_CURVES = [['linear', 'Straight'], ['smooth', 'Smooth'], ['fast', 'Fast start'], ['slow', 'Slow start']];
export function shape(curve, x) {
  x = clamp(x, 0, 1);
  if (curve === 'smooth') return x * x * (3 - 2 * x);
  if (curve === 'fast') return 1 - (1 - x) * (1 - x);
  if (curve === 'slow') return x * x;
  return x;
}
// the fades' gain (0..1) at time t of something S seconds long
export function fadeAt(t, S, f) {
  const fi = Math.max(0, Number(f.fadeIn) || 0), fo = Math.max(0, Number(f.fadeOut) || 0);
  const a = clamp(Number(f.inAt) || 0, 0, S), e = S - clamp(Number(f.outAt) || 0, 0, S), c = f.curve || 'linear';
  if (t < a || t > e) return 0;
  let k = 1;
  if (fi > 0) k = Math.min(k, shape(c, (t - a) / fi));
  if (fo > 0) k = Math.min(k, shape(c, (e - t) / fo));
  return k;
}
export const hasFade = (f) => (Number(f.fadeIn) || 0) > 0 || (Number(f.fadeOut) || 0) > 0 || (Number(f.inAt) || 0) > 0 || (Number(f.outAt) || 0) > 0;
// the same fades on a Web Audio gain (preview playback and offline export): vol x fade, from time t0, S seconds
export function fadeParam(param, vol, t0, S, f) {
  if (!hasFade(f)) { param.setValueAtTime(vol, t0); return; }
  const n = Math.max(16, Math.min(2000, Math.round(S * 60)));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = Math.max(0.0001, vol * fadeAt((i / (n - 1)) * S, S, f));
  try { param.setValueCurveAtTime(curve, t0, Math.max(0.01, S)); } catch { param.setValueAtTime(vol, t0); }
}

//   fadeWave(canvas, { span, peak, get, set, max, label, onDone, muted })
//   span(): seconds the wave shows (the edit for the song, one cut for a clip)
//   peak(t0, t1): loudness 0..1 of the sound between two times (seconds from the left edge)
//   get(): the fades f, set(key, seconds) while dragging (keys: fadeIn, fadeOut, inAt, outAt), onDone() when let go
export function fadeWave(cv, { span, peak, get, set, max = 5, label = '', onDone = () => {}, muted = () => false }) {
  let drag = null;
  const css = (k, d) => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d;
  // the four handles, in seconds from the left
  const marks = () => {
    const S = Math.max(0.1, span()), f = get();
    const a = clamp(Number(f.inAt) || 0, 0, S), fi = Math.max(0, Number(f.fadeIn) || 0);
    const e = S - clamp(Number(f.outAt) || 0, 0, S), fo = Math.max(0, Number(f.fadeOut) || 0);
    return { S, inAt: a, inEnd: Math.min(e, a + fi), outStart: Math.max(a, e - fo), outEnd: e };
  };
  function draw() {
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (!r.width) return;
    cv.width = Math.max(10, Math.round(r.width * dpr)); cv.height = Math.max(10, Math.round(r.height * dpr));
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, m = marks(), S = m.S, f = get();
    const X = (t) => (t / S) * W;
    g.clearRect(0, 0, W, H);
    const top = 15 * dpr, h0 = H - top - 3 * dpr, mid = top + h0 / 2;
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, top, X(m.inEnd), h0); g.fillRect(X(m.outStart), top, W - X(m.outStart), h0);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, top, X(m.inAt), h0); g.fillRect(X(m.outEnd), top, W - X(m.outEnd), h0);
    // the wave: grey as it is, colored as loud as it will play
    const acc = css('--tape', '#ffc933'), mute = muted();
    for (let x = 0; x < W; x += 2 * dpr) {
      const t0 = (x / W) * S, t1 = ((x + 2 * dpr) / W) * S, v = clamp(peak(t0, t1), 0, 1), k = fadeAt((t0 + t1) / 2, S, f);
      const hFull = Math.max(1, v * h0 * 0.92), h = Math.max(k > 0 ? 1 : 0, hFull * k);
      g.fillStyle = 'rgba(168,165,157,0.32)'; g.fillRect(x, mid - hFull / 2, 1.3 * dpr, hFull);
      if (h) { g.fillStyle = mute ? 'rgba(242,240,234,0.25)' : acc; g.fillRect(x, mid - h / 2, 1.3 * dpr, h); }
    }
    // the volume line (with the fade's shape)
    g.strokeStyle = 'rgba(242,240,234,0.9)'; g.lineWidth = 1.4 * dpr; g.beginPath();
    for (let x = 0; x <= W; x += 2 * dpr) { const y = top + h0 * (1 - fadeAt((x / W) * S, S, f)); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    // handles: round knobs on top for where a fade starts / ends
    const on = css('--on', '#34d17a');
    const knob = (t, k, y) => {
      const x = clamp(X(t), 5 * dpr, W - 5 * dpr), hot = drag?.k === k;
      g.fillStyle = hot ? on : '#f2f0ea';
      g.fillRect(x - 0.75 * dpr, top, 1.5 * dpr, h0);
      g.beginPath(); g.arc(x, y, (hot ? 6 : 5) * dpr, 0, Math.PI * 2); g.fill();
    };
    knob(m.inAt, 'inAt', top + h0); knob(m.inEnd, 'inEnd', top); knob(m.outStart, 'outStart', top); knob(m.outEnd, 'outEnd', top + h0);
    g.font = `600 ${10.5 * dpr}px Segoe UI, system-ui, sans-serif`; g.textBaseline = 'top'; g.fillStyle = 'rgba(242,240,234,0.85)';
    const fi = m.inEnd - m.inAt, fo = m.outEnd - m.outStart;
    g.textAlign = 'left'; g.fillText(fi > 0.02 ? `In ${m.inAt.toFixed(1)}–${m.inEnd.toFixed(1)}s` : m.inAt > 0.02 ? `Starts at ${m.inAt.toFixed(1)}s` : 'No fade in', 2 * dpr, 0);
    g.textAlign = 'right'; g.fillText(fo > 0.02 ? `Out ${m.outStart.toFixed(1)}–${m.outEnd.toFixed(1)}s` : m.outEnd < S - 0.02 ? `Ends at ${m.outEnd.toFixed(1)}s` : 'No fade out', W - 2 * dpr, 0);
    if (label) { g.textAlign = 'center'; g.fillStyle = 'rgba(168,165,157,0.8)'; g.font = `${10 * dpr}px Segoe UI, system-ui, sans-serif`; g.fillText(label, W / 2, 0); }
  }
  const tAt = (ev) => { const r = cv.getBoundingClientRect(); return clamp((ev.clientX - r.left) / r.width, 0, 1) * span(); };
  // the handle under the pointer: the nearest one, top knobs for the inner ends, bottom knobs for the outer ones
  const pick = (ev) => {
    const r = cv.getBoundingClientRect(), m = marks(), px = (t) => r.left + (t / m.S) * r.width, low = ev.clientY > r.top + r.height * 0.55;
    const cands = [['inAt', m.inAt, low], ['inEnd', m.inEnd, !low], ['outStart', m.outStart, !low], ['outEnd', m.outEnd, low]];
    let best = null;
    for (const [k, t, pref] of cands) { const d = Math.abs(ev.clientX - px(t)) - (pref ? 6 : 0); if (!best || d < best[1]) best = [k, d]; }
    return best[1] <= 14 ? best[0] : (ev.clientX - r.left < r.width / 2 ? 'inEnd' : 'outStart'); // a click anywhere moves the nearer fade's inner end
  };
  const apply = (ev) => {
    const m = marks(), S = m.S, t = tAt(ev), r1 = (v) => Math.round(clamp(v, 0, S) * 10) / 10, z = (v) => (v < 0.06 ? 0 : v);
    // the bottom handles move where the sound starts / stops, and their fade goes along; the top ones set the fade's length
    if (drag.k === 'inAt') set('inAt', r1(z(clamp(t, 0, m.outStart - (m.inEnd - m.inAt)))));
    else if (drag.k === 'inEnd') set('fadeIn', r1(z(clamp(t, m.inAt, Math.min(m.outStart, m.inAt + max)) - m.inAt)));
    else if (drag.k === 'outStart') set('fadeOut', r1(z(m.outEnd - clamp(t, Math.max(m.inEnd, m.outEnd - max), m.outEnd))));
    else if (drag.k === 'outEnd') set('outAt', r1(z(S - clamp(t, m.inEnd + (m.outEnd - m.outStart), S))));
    draw();
  };
  cv.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    drag = { k: pick(ev) }; cv.setPointerCapture(ev.pointerId); apply(ev);
  });
  cv.addEventListener('pointermove', (ev) => {
    if (drag) { if (!(ev.buttons & 1)) return end(); apply(ev); return; }
    const r = cv.getBoundingClientRect(), m = marks(), px = (t) => r.left + (t / m.S) * r.width;
    const near = [m.inAt, m.inEnd, m.outStart, m.outEnd].some((t) => Math.abs(ev.clientX - px(t)) <= 14);
    cv.style.cursor = near ? 'ew-resize' : 'pointer';
  });
  const end = () => { if (!drag) return; drag = null; draw(); onDone(); };
  for (const e of ['pointerup', 'pointercancel', 'lostpointercapture']) cv.addEventListener(e, end);
  cv.addEventListener('dblclick', () => { for (const k of ['fadeIn', 'fadeOut', 'inAt', 'outAt']) set(k, 0); draw(); onDone(); });
  cv.title = 'Top handles: where the fade in ends and the fade out starts. Bottom handles: where the sound starts and stops. Double-click: no fades';
  return { draw };
}

// the fade's shape and exact times, under the wave: returns HTML; wire it with bindFadeFields
export function fadeFieldsHtml(f, S) {
  const v = (x) => (Math.round((Number(x) || 0) * 10) / 10).toFixed(1);
  const a = Number(f.inAt) || 0, fi = Number(f.fadeIn) || 0, e = S - (Number(f.outAt) || 0), fo = Number(f.fadeOut) || 0;
  return `<div class="fw-curves">${FADE_CURVES.map(([k, n]) => `<button class="chip${(f.curve || 'linear') === k ? ' on' : ''}" data-fcurve="${k}">${n}</button>`).join('')}</div>
    <div class="fw-times">
      <label>Fade in <input type="number" step="0.1" min="0" data-ft="inAt" value="${v(a)}"><span>to</span><input type="number" step="0.1" min="0" data-ft="inEnd" value="${v(a + fi)}">s</label>
      <label>Fade out <input type="number" step="0.1" min="0" data-ft="outStart" value="${v(e - fo)}"><span>to</span><input type="number" step="0.1" min="0" data-ft="outEnd" value="${v(e)}">s</label>
    </div>`;
}
// a typed time or a picked shape: turned into the fade keys (k = the field, value in seconds from the left)
export function fadeFromField(f, S, k, val) {
  const a = Number(f.inAt) || 0, fi = Number(f.fadeIn) || 0, e = S - (Number(f.outAt) || 0), fo = Number(f.fadeOut) || 0;
  const t = clamp(Number(val) || 0, 0, S), r1 = (x) => Math.round(Math.max(0, x) * 10) / 10;
  if (k === 'inAt') return { inAt: r1(Math.min(t, e - fo - fi)) };
  if (k === 'inEnd') return { fadeIn: r1(clamp(t, a, e - fo) - a) };
  if (k === 'outStart') return { fadeOut: r1(e - clamp(t, a + fi, e)) };
  if (k === 'outEnd') return { outAt: r1(S - clamp(t, a + fi + fo, S)) };
  return {};
}

// loudness of an AudioBuffer between two times (seconds), for fadeWave's peak()
export function bufferPeak(buf, from, t0, t1) {
  if (!buf) return 0.25;
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const i0 = Math.max(0, Math.floor((from + t0) * sr)), i1 = Math.min(d.length, Math.ceil((from + t1) * sr));
  let m = 0; const step = Math.max(1, Math.floor((i1 - i0) / 64));
  for (let i = i0; i < i1; i += step) { const v = Math.abs(d[i]); if (v > m) m = v; }
  return m;
}
