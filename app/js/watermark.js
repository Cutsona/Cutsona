// Your watermark: a line of text (@name) or your logo, drawn on the overlay layer of every take and export.
// Returns where it landed (0..1 box + center) so it can be dragged on the preview.

const imgCache = new Map(); // logo data URL -> loaded image
export function logoImage(src, onLoad) {
  if (!src) return null;
  let e = imgCache.get(src);
  if (!e) {
    e = { img: new Image(), ready: false };
    e.img.onload = () => { e.ready = true; onLoad?.(); };
    e.img.src = src;
    imgCache.set(src, e);
  }
  return e.ready ? e.img : null;
}

// shrink an uploaded logo to at most 512 px (PNG keeps transparency) so it's light to keep and draw
export function shrinkLogo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 512 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a picture Cutsona can read (use PNG, JPG or WebP).')); };
    img.src = url;
  });
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// o: { kind: 'text' | 'logo', text, family, weight, color, size (0.5..2.5), opacity (0..1), style: plain|shadow|outline|box, x, y }
export function drawWatermark(g, W, H, o, logo) {
  const size = clamp(Number(o.size) || 1, 0.3, 3), S = Math.min(W, H);
  let w, h, draw;
  if (o.kind === 'logo') {
    if (!logo) return null;
    h = S * 0.09 * size; w = h * logo.width / logo.height;
    if (w > W * 0.9) { w = W * 0.9; h = w * logo.height / logo.width; }
    draw = (x0, y0) => g.drawImage(logo, x0, y0, w, h);
  } else {
    const text = String(o.text || '').trim();
    if (!text) return null;
    const px = Math.round(S * 0.04 * size);
    g.font = `${o.weight || 800} ${px}px ${o.family || '"Segoe UI", Arial, sans-serif'}`;
    w = g.measureText(text).width; h = px * 1.15;
    draw = (x0, y0) => {
      g.textBaseline = 'middle'; g.textAlign = 'left'; g.lineJoin = 'round';
      const y = y0 + h / 2;
      if (o.style === 'outline') { g.lineWidth = px * 0.16; g.strokeStyle = isLight(o.color) ? '#000' : '#fff'; g.strokeText(text, x0, y); }
      if (o.style === 'shadow') { g.shadowColor = 'rgba(0,0,0,0.75)'; g.shadowBlur = px * 0.35; g.shadowOffsetY = px * 0.05; }
      g.fillStyle = o.color || '#ffffff'; g.fillText(text, x0, y);
      g.shadowBlur = 0; g.shadowOffsetY = 0;
    };
  }
  const padX = o.style === 'box' ? h * 0.35 : 0, padY = o.style === 'box' ? h * 0.18 : 0;
  const bw = w + padX * 2, bh = h + padY * 2;
  const cx = clamp((Number.isFinite(o.x) ? o.x : 0.84) * W, bw / 2 + 4, W - bw / 2 - 4);
  const cy = clamp((Number.isFinite(o.y) ? o.y : 0.92) * H, bh / 2 + 4, H - bh / 2 - 4);
  const x0 = cx - bw / 2, y0 = cy - bh / 2;
  g.save();
  g.globalAlpha = clamp(Number(o.opacity) || 0.7, 0.05, 1);
  if (o.style === 'box') { g.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(g, x0, y0, bw, bh, Math.min(bh / 2, h * 0.3)); g.fill(); }
  draw(x0 + padX, y0 + padY);
  g.restore();
  return { box: [x0 / W, y0 / H, (x0 + bw) / W, (y0 + bh) / H], center: [cx / W, cy / H] };
}
function isLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return true;
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}
