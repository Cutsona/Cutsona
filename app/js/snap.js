// Grid snapping for things you drag on a take (title box, hook text, banner, watermark, captions, photos and videos):
// near the middle or a third of the picture, they lock onto it, and a guide line shows where. Hold Alt to move freely.
export const SNAP_LINES = [0.5, 1 / 3, 2 / 3];
export function snapTo(v, ev, lines = SNAP_LINES, th = 0.022) {
  if (ev?.altKey) return { v, line: null };
  let best = null;
  for (const l of lines) { const d = Math.abs(v - l); if (d < th && (!best || d < best.d)) best = { d, l }; }
  return best ? { v: best.l, line: best.l } : { v, line: null };
}
// the guide lines (one across, one down) inside a take's picture; null hides one
export function guides(host, x, y) {
  if (!host) return;
  let gx = host.querySelector(':scope > .snap-g.v'), gy = host.querySelector(':scope > .snap-g.h');
  if (!gx) { gx = document.createElement('i'); gx.className = 'snap-g v'; host.appendChild(gx); }
  if (!gy) { gy = document.createElement('i'); gy.className = 'snap-g h'; host.appendChild(gy); }
  gx.hidden = x == null; gy.hidden = y == null;
  if (x != null) gx.style.left = `${x * 100}%`;
  if (y != null) gy.style.top = `${y * 100}%`;
}
