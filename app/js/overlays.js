import { snapTo, guides } from './snap.js';
// Photos and videos laid over a take: small items you drag anywhere on the picture, resize from the corner and
// remove with the × that shows when you point at them. Adding one puts it on every take; removing it from a take
// removes it from that take only. They show in the previews and are drawn into every export.
//
// Each take keeps its own list in custom.overlays: { id, media, x, y, w, ar } where x / y are the item's center
// and w its width, as shares of the picture, and ar is the media's width / height. The media itself (a photo as a
// small data URL, or a video for this session) sits in one shared store, so four takes don't keep four copies.
const MEDIA_KEY = 'cutsona.ovMedia';
const media = new Map(); // id -> { kind: 'image' | 'video', src, name, ar }
try {
  const saved = JSON.parse(localStorage.getItem(MEDIA_KEY) || '{}');
  for (const [id, m] of Object.entries(saved)) if (m && m.kind === 'image' && /^data:image\//.test(m.src)) media.set(id, m);
} catch {}
function saveMedia() {
  const o = {};
  for (const [id, m] of media) if (m.kind === 'image') o[id] = m; // videos only last until Cutsona closes
  try { localStorage.setItem(MEDIA_KEY, JSON.stringify(o)); } catch {}
}
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// a photo, made small enough to keep (longest side 1280 px, WebP keeps see-through parts)
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ src: c.toDataURL('image/webp', 0.9), ar: c.width / c.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} isn’t a picture Cutsona can read`)); };
    img.src = url;
  });
}
function videoInfo(file) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file), v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => resolve({ src, ar: (v.videoWidth || 16) / (v.videoHeight || 9), dur: v.duration || 0 });
    v.onerror = () => reject(new Error(`${file.name} isn’t a video Cutsona can play`));
    v.src = src;
  });
}

export function createOverlays({ state, cards, save, toast, now, playing }) {
  const listOf = (i) => (state.variants[i]?.custom?.overlays || []).filter((o) => media.has(o.media));

  async function addFiles(files, only = null) {
    let n = 0;
    for (const f of files) {
      try {
        let m;
        if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name)) m = { kind: 'image', name: f.name, ...(await shrinkImage(f)) };
        else if (/^video\//.test(f.type) || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name)) m = { kind: 'video', name: f.name, ...(await videoInfo(f)) };
        else { toast(`${f.name}: pick a photo or a video`, true); continue; }
        const id = uid();
        media.set(id, m);
        // a small item near the top, a little lower for each one added
        const w = m.ar >= 1 ? 0.42 : 0.3;
        const takes = only == null ? state.variants.map((_, i) => i) : [only];
        for (const i of takes) {
          const c = state.variants[i].custom;
          c.overlays = [...(c.overlays || []), { id: uid(), media: id, x: 0.5, y: clamp(0.3 + 0.06 * (c.overlays?.length || 0), 0.15, 0.85), w, ar: m.ar }];
        }
        n++;
      } catch (e) { toast(e.message, true); }
    }
    if (!n) return;
    saveMedia(); save(); render();
    toast(only == null ? `Added to all ${state.variants.length} takes: drag it anywhere, drag the corner to resize, × removes it from one take`
      : `Added to take ${only + 1}`);
  }

  function remove(i, id) {
    const c = state.variants[i]?.custom; if (!c?.overlays) return;
    c.overlays = c.overlays.filter((o) => o.id !== id);
    if (!c.overlays.length) delete c.overlays;
    save(); render();
    toast(`Removed from take ${i + 1} only`);
  }

  // keep each take's items on screen in step with its list
  function render() {
    cards().forEach((card, i) => {
      const screen = card.querySelector('.screen'); if (!screen) return;
      let layer = screen.querySelector('.ov-layer');
      if (!layer) { layer = document.createElement('div'); layer.className = 'ov-layer'; screen.appendChild(layer); bindLayer(layer, card); }
      const list = listOf(i), keep = new Set(list.map((o) => o.id));
      layer.querySelectorAll('.ov-item').forEach((el) => { if (!keep.has(el.dataset.id)) el.remove(); });
      for (const o of list) {
        let el = layer.querySelector(`.ov-item[data-id="${o.id}"]`);
        const m = media.get(o.media);
        if (!el) {
          el = document.createElement('div');
          el.className = 'ov-item ' + m.kind; el.dataset.id = o.id;
          el.innerHTML = (m.kind === 'video' ? `<video muted loop playsinline preload="auto"></video>` : '<img alt="" draggable="false">')
            + '<button class="ov-x" title="Remove from this take" aria-label="Remove from this take">×</button><i class="ov-rs" title="Drag to resize"></i>';
          const md = el.firstElementChild; md.src = m.src;
          layer.appendChild(el);
        }
        Object.assign(el.style, { left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, aspectRatio: String(o.ar || m.ar || 1) });
      }
      layer.hidden = !list.length;
    });
  }

  function bindLayer(layer, card) {
    const idx = () => cards().indexOf(card);
    layer.addEventListener('pointerdown', (ev) => {
      const el = ev.target.closest('.ov-item'); if (!el) return;
      ev.stopPropagation(); ev.preventDefault();
      if (ev.target.closest('.ov-x')) return;
      const i = idx(), o = state.variants[i]?.custom?.overlays?.find((x) => x.id === el.dataset.id); if (!o) return;
      const r = layer.getBoundingClientRect(), resize = !!ev.target.closest('.ov-rs');
      const d = { x0: ev.clientX, y0: ev.clientY, ox: o.x, oy: o.y, ow: o.w, moved: false };
      el.classList.add('active'); el.setPointerCapture(ev.pointerId);
      const move = (e) => {
        const dx = (e.clientX - d.x0) / r.width, dy = (e.clientY - d.y0) / r.height;
        if (Math.abs(dx) + Math.abs(dy) > 0.003) d.moved = true;
        if (resize) o.w = clamp(d.ow + dx * 2, 0.05, 1.5);
        else {
          // centers lock onto the middle / thirds of the picture (Alt: move freely)
          const sx = snapTo(clamp(d.ox + dx, -0.2, 1.2), e), sy = snapTo(clamp(d.oy + dy, -0.2, 1.2), e);
          o.x = sx.v; o.y = sy.v; guides(layer, sx.line, sy.line);
        }
        el.style.left = `${o.x * 100}%`; el.style.top = `${o.y * 100}%`; el.style.width = `${o.w * 100}%`;
      };
      const up = () => {
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        el.classList.remove('active'); guides(layer, null, null);
        if (d.moved) save();
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    layer.addEventListener('click', (ev) => {
      const x = ev.target.closest('.ov-x'); if (x) { ev.stopPropagation(); remove(idx(), x.closest('.ov-item').dataset.id); return; }
      if (ev.target.closest('.ov-item')) ev.stopPropagation(); // don't pick the take / start the solo view
    });
    layer.addEventListener('dblclick', (ev) => { if (ev.target.closest('.ov-item')) ev.stopPropagation(); });
  }

  // videos on the takes play along with the edit (looping), and stop when it stops
  function sync() {
    const t = now(), on = playing();
    document.querySelectorAll('.ov-item.video video').forEach((v) => {
      if (!v.duration) return;
      const want = t % v.duration;
      if (on) { if (v.paused) { v.currentTime = want; v.play().catch(() => {}); } else if (Math.abs(v.currentTime - want) > 0.35) v.currentTime = want; }
      else { if (!v.paused) v.pause(); if (Math.abs(v.currentTime - want) > 0.05) v.currentTime = want; }
    });
  }

  // what an export of take i draws on top of every frame
  function forExport(i) {
    return listOf(i).map((o) => ({ ...o, ...media.get(o.media), ar: o.ar || media.get(o.media).ar }));
  }

  return { addFiles, render, sync, forExport, count: (i) => listOf(i).length };
}

// ---- export: draw the items over a rendered frame ----
export async function loadExportOverlays(list, poolEl) {
  const out = [];
  for (const o of list || []) {
    if (o.kind === 'video') {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = o.src;
      poolEl.appendChild(v);
      await new Promise((r) => { if (v.readyState >= 2) r(); else { v.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 8000); } });
      out.push({ ...o, el: v });
    } else {
      const img = new Image(); img.src = o.src;
      try { await img.decode(); } catch {}
      out.push({ ...o, el: img });
    }
  }
  return out;
}
export async function drawExportOverlays(g, list, W, H, t) {
  for (const o of list) {
    if (o.kind === 'video') {
      const v = o.el, want = v.duration ? t % v.duration : 0;
      if (Math.abs(v.currentTime - want) > 0.0005) {
        await new Promise((r) => { const done = () => r(); v.addEventListener('seeked', done, { once: true }); setTimeout(done, 3000); v.currentTime = want; });
      }
    }
    const w = o.w * W, h = w / (o.ar || 1);
    try { g.drawImage(o.el, o.x * W - w / 2, o.y * H - h / 2, w, h); } catch {}
  }
}
export function releaseExportOverlays(list) {
  for (const o of list || []) if (o.kind === 'video') { try { o.el.pause(); o.el.removeAttribute('src'); o.el.load(); o.el.remove(); } catch {} }
}
