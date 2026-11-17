// Quick Mode's editor for a topic video: up to 4 takes side by side (each its own pictures, camera moves, look,
// caption style and song), playing live; a timeline of the take you're on (pictures, captions, voice, music), where any
// picture can be swapped (another one found for that line, a search, or your own file), moved differently, added or
// removed, and any caption rewritten. Export renders the take on the server exactly as you see it.
import { fmtT } from './words.js';
import { FILTERS } from './styles.js';
import { TOPIC_CAPTION_STYLES as STYLE_NAMES, TOPIC_CAPTION_FONTS as FONT_NAMES, captionSampleHtml, drawTopicCaption, paintCaptionSample } from './captions.js';
import { createFilterPreview } from './filter-preview.js';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = fmtT;

export const LOOK_NAMES = { '': 'No look', portra: 'Portra 400', kodachrome: 'Kodachrome', velvia: 'Velvia', cine2383: 'Cinema', fuji3510: 'Film print', polaroid: 'Polaroid', trix: 'Black & white', hp5: 'B&W soft', animelut: 'Anime' };
// the preview's stand-in for each film look (the export uses the real film LUT)
const LOOK_CSS = { portra: 'sepia(0.14) saturate(1.06) contrast(0.95) brightness(1.04)', kodachrome: 'contrast(1.14) saturate(1.28) sepia(0.06)', velvia: 'saturate(1.5) contrast(1.1)',
  cine2383: 'contrast(1.16) saturate(0.84) sepia(0.16) hue-rotate(-8deg)', fuji3510: 'contrast(1.1) saturate(0.9) hue-rotate(6deg)', polaroid: 'sepia(0.26) contrast(0.9) brightness(1.08) saturate(0.85)',
  trix: 'grayscale(1) contrast(1.25)', hp5: 'grayscale(1) contrast(1.08)', animelut: 'saturate(1.35) brightness(1.06) contrast(1.05)' };
const MOVES = [['0', 'Zoom in'], ['1', 'Zoom out'], ['2', 'Slide left'], ['3', 'Slide right'], ['4', 'Still']];
const LOOKS = Object.keys(LOOK_NAMES).filter((k) => k !== 'hp5');
const EFFECTS = [['grain', 'Film grain'], ['vignette', 'Dark corners'], ['bars', 'Cinematic bars'], ['vhs', 'VHS']];
const PLAY_ICON = 'M7 5v14l12-7z', PAUSE_ICON = 'M6 5h4v14H6z M14 5h4v14h-4z';

export function initDocEditor({ toast, onExported, onBack, openFinder, addToEdit, sidebar, pick, filterChips }) {
  let P = null, host = null, focus = 0, sel = null, t = 0, playing = false, raf = 0, pps = 40, saveT = 0, alive = false;
  const found = new Map(); // scene → pictures found with a search there (shown with its own)
  const filters = Array.from({ length: 4 }, () => createFilterPreview(() => { if (!playing) drawAll(); }));
  const els = new Map(); // picture / clip elements for the previews
  const voice = new Audio(), music = new Audio();
  music.loop = true;
  const api = async (url, body) => { const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; };
  const V = () => P.H > P.W;

  // ---- timing: each picture's share of its line (the same rule the export uses) ----
  function pieceTimes(take) {
    const n = P.scenes.map((_, i) => take.pieces.filter((x) => x.scene === i).length);
    let at = 0;
    return take.pieces.map((x) => { const d = (P.scenes[x.scene].len + (x.scene === 0 ? 0.6 : 0) + (x.scene === P.scenes.length - 1 ? 1.6 : 0)) / Math.max(1, n[x.scene]); const o = { ...x, a: at, d }; at += d; return o; });
  }
  const timesCache = new Map();
  const times = (k) => { const tk = P.takes[k], key = JSON.stringify(tk.pieces); const c = timesCache.get(k); if (c?.key === key) return c.v; const v = pieceTimes(tk); timesCache.set(k, { key, v }); return v; };

  // ---- the previews ----
  function elFor(k, mid) {
    const m = P.media[mid]; if (!m) return null;
    const key = m.kind === 'vid' ? `${k}:${mid}` : String(mid);
    let e = els.get(key);
    if (!e || e.src !== m.url) {
      if (m.kind === 'vid') { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.loop = true; v.onloadeddata = v.onseeked = () => { if (!playing) drawAll(); }; v.src = m.url; e = { src: m.url, el: v, vid: true }; }
      else { const im = new Image(); im.decoding = 'async'; im.src = m.url; im.onload = () => { if (!playing) drawAll(); }; e = { src: m.url, el: im }; }
      els.set(key, e);
    }
    return e;
  }
  // the camera move at a point of the picture's time (matches the export: push in, pull out, slide, still)
  function drawPic(g, e, W, H, mv, f, tk) {
    const el = e.el, iw = e.vid ? el.videoWidth : el.naturalWidth, ih = e.vid ? el.videoHeight : el.naturalHeight;
    if (!iw || !ih) return;
    const ar = iw / ih, fit = !e.vid && (ar / (W / H) < 0.72 || ar / (W / H) > 1.6);
    let z = 1, dx = 0;
    if (mv === 0) z = 1 + 0.13 * f; else if (mv === 1) z = 1.13 - 0.13 * f;
    else if (mv === 2 || mv === 3) { z = 1.12; dx = (mv === 2 ? 0.5 - f : f - 0.5) * (W * 0.12); }
    g.save();
    g.translate(W / 2 + dx, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2);
    const css = LOOK_CSS[tk.look] || '';
    g.filter = css || 'none';
    const cover = (sw) => { const s = Math.max(W / iw, H / ih) * sw; g.drawImage(el, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s); };
    if (fit) {
      g.filter = `blur(${Math.round(W / 40)}px) brightness(0.82) saturate(0.8) ${css}`;
      cover(1.06);
      g.filter = css || 'none';
      const s = Math.min((W * 0.9) / iw, (H * 0.9) / ih); g.drawImage(el, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    } else cover(1);
    g.restore();
  }
  // captions: the line's words a few at a time, like the export's
  function capAt(time) {
    if (!P.opts.captions) return null;
    for (const s of P.scenes) {
      if (time < s.start || time >= s.start + s.dur) continue;
      const ws = String(s.cap || s.text).split(/\s+/).filter(Boolean), chunks = [];
      for (let k = 0; k < ws.length;) { let n = Math.min(V() ? 3 : 5, ws.length - k); if (ws.length - (k + n) === 1) n++; chunks.push(ws.slice(k, k + n).join(' ')); k += n; }
      const tot = chunks.reduce((a, c) => a + c.length + 2, 0);
      let at = s.start;
      for (const c of chunks) { const d = s.dur * (c.length + 2) / tot; if (time < at + d) return c; at += d; }
    }
    return null;
  }
  function wrap(g, text, maxW) {
    const ws = text.split(' '), lines = []; let cur = '';
    for (const w of ws) { const n = cur ? cur + ' ' + w : w; if (g.measureText(n).width > maxW && cur) { lines.push(cur); cur = w; } else cur = n; }
    if (cur) lines.push(cur);
    return lines;
  }
  function drawText(g, W, H, time, tk) {
    const v = V();
    // the title card at the start
    if (P.opts.titleCard && time > 0.2 && time < 3.4) {
      const a = Math.min(1, (time - 0.2) / 0.35, (3.4 - time) / 0.45), sz = (v ? H * 0.06 : H * 0.12) * (0.92 + 0.08 * Math.min(1, (time - 0.2) / 3.2));
      g.save(); g.globalAlpha = Math.max(0, a); g.font = `900 ${sz}px "Arial Black", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = H * 0.012; g.strokeStyle = '#000'; g.fillStyle = '#fff'; g.lineJoin = 'round';
      const lines = wrap(g, String(P.title || '').toUpperCase(), W * 0.84);
      lines.forEach((l, i) => { const y = H / 2 + (i - (lines.length - 1) / 2) * sz * 1.08; g.strokeText(l, W / 2, y); g.fillText(l, W / 2, y); });
      g.restore();
    }
    if (tk.banner && P.title) {
      g.save(); g.font = `700 ${H * 0.028}px Arial`; g.textAlign = 'center'; g.textBaseline = 'top';
      const bannerWidth = Math.min(W * 0.82, g.measureText(P.title).width) + H * 0.028;
      g.fillStyle = 'rgba(14,14,14,0.8)'; g.fillRect((W - bannerWidth) / 2, H * 0.032, bannerWidth, H * 0.045);
      g.fillStyle = '#fff'; g.fillText(P.title, W / 2, H * 0.04, W * 0.82); g.restore();
    }
    const caption = capAt(time);
    if (caption) drawTopicCaption(g, W, H, caption, tk, v);
  }
  const noise = document.createElement('canvas');
  noise.width = noise.height = 64;
  const ng = noise.getContext('2d'), pixels = ng.createImageData(64, 64);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = Math.random() > 0.5 ? 255 : 0;
    pixels.data[i + 3] = 35;
  }
  ng.putImageData(pixels, 0, 0);
  function drawEffects(g, tk, W, H) {
    const fx = tk.effects || [];
    if (fx.includes('vignette')) {
      const gradient = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.18, W / 2, H / 2, Math.hypot(W, H) / 2);
      gradient.addColorStop(0, 'transparent'); gradient.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = gradient; g.fillRect(0, 0, W, H);
    }
    if (fx.includes('grain') || fx.includes('vhs')) { g.fillStyle = g.createPattern(noise, 'repeat'); g.fillRect(0, 0, W, H); }
    if (fx.includes('vhs')) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    }
    if (fx.includes('bars')) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H * 0.065); g.fillRect(0, H * 0.935, W, H * 0.065); }
  }
  function drawTake(k) {
    const cv = host?.querySelector(`.de-take[data-k="${k}"] canvas`); if (!cv) return;
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, tk = P.takes[k], ps = times(k);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const i = ps.findIndex((x) => t >= x.a && t < x.a + x.d), x = ps[i < 0 ? ps.length - 1 : i];
    if (x) {
      const e = elFor(k, x.mid), lt = Math.max(0, t - x.a), f = Math.min(1, lt / x.d);
      if (e) {
        if (e.vid) { const el = e.el, d = el.duration || 0; if (d) { const want = lt % d; if (Math.abs(el.currentTime - want) > (playing ? 0.35 : 0.04)) el.currentTime = want; } if (playing && el.paused) el.play().catch(() => {}); if (!playing && !el.paused) el.pause(); }
        const fi = i === 0 ? 0.6 : tk.transition === 'cut' ? 0 : 0.18;
        const fo = i === ps.length - 1 ? 1.2 : tk.transition === 'cut' ? 0 : 0.18;
        g.globalAlpha = Math.max(0, Math.min(1, fi ? lt / fi : 1, fo ? (x.d - lt) / fo : 1));
        drawPic(g, e, W, H, x.move, f, tk);
        g.globalAlpha = 1;
      }
    }
    filters[k]?.draw(g, tk.filter, t);
    drawEffects(g, tk, W, H);
    drawText(g, W, H, t, tk);
    const logo = tk.logo != null && elFor(k, tk.logo)?.el;
    if (logo?.naturalWidth) g.drawImage(logo, W * 0.845, H * 0.035, W * 0.12, W * 0.12 * logo.naturalHeight / logo.naturalWidth);
  }
  function drawAll() {
    if (!P || !host) return;
    P.takes.forEach((_, k) => drawTake(k));
    const ph = host.querySelector('.de-ph'); if (ph) ph.style.left = `${t * pps}px`;
    const tm = host.querySelector('.de-time'); if (tm) tm.textContent = `${mmss(t)} / ${mmss(P.total)}`;
    const sk = host.querySelector('.de-seek'); if (sk && document.activeElement !== sk) sk.value = String(t);
  }
  function loop() {
    if (!playing) return;
    t = voice.currentTime;
    if (t >= P.total - 0.02 || voice.ended) { pause(); t = 0; }
    drawAll();
    raf = requestAnimationFrame(loop);
  }
  function syncMusic() {
    const tk = P.takes[focus], m = tk.music >= 0 ? P.music[tk.music] : null;
    if (!m) { music.pause(); return; }
    if (!music.src.endsWith(m.url)) music.src = m.url;
    music.volume = { low: 0.14, high: 0.42 }[P.opts.musicLevel] || 0.26;
    const d = music.duration || 0;
    if (d) music.currentTime = t % d;
    if (playing) music.play().catch(() => {});
  }
  function play() {
    if (!P) return;
    if (t >= P.total - 0.1) t = 0;
    voice.currentTime = t; voice.play().catch(() => {}); playing = true; syncMusic();
    host.querySelector('.de-play path')?.setAttribute('d', PAUSE_ICON);
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function pause() {
    playing = false; voice.pause(); music.pause();
    for (const e of els.values()) if (e.vid) e.el.pause();
    host?.querySelector('.de-play path')?.setAttribute('d', PLAY_ICON);
    drawAll();
  }
  function seek(time) { t = Math.max(0, Math.min(P.total, time)); if (playing) { voice.currentTime = t; syncMusic(); } drawAll(); }

  // ---- saving what you changed (with the project, so it opens again as you left it) ----
  let saveQueue = Promise.resolve();
  const saveErrors = new Map();
  function saveNow() {
    if (!saveT || !P) return;
    clearTimeout(saveT);
    saveT = 0;
    const snapshot = structuredClone({ id: P.id, takes: P.takes, caps: P.scenes.map((x) => x.cap), title: P.title, opts: P.opts });
    saveQueue = saveQueue.then(async () => {
      try { await api('/api/doc/save', snapshot); saveErrors.delete(snapshot.id); }
      catch (error) { saveErrors.set(snapshot.id, error); toast(error.message, true); }
    });
  }
  async function flush() {
    const id = P?.id;
    if (id && saveErrors.has(id) && !saveT) saveSoon();
    saveNow();
    await saveQueue;
    if (saveErrors.has(id)) throw saveErrors.get(id);
  }
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(saveNow, 350);
  }
  const changed = (what = 'all') => { saveSoon(); if (what !== 'insp') renderTimeline(); renderTakes(false); drawAll(); };

  // ---- the page ----
  function render() {
    const v = V(), n = P.takes.length;
    host.innerHTML = `<div class="de">
      <div class="de-top">
        <button class="small ghost" data-de="back" title="Back to the topic">← New video</button>
        <input class="de-title" value="${esc(P.title)}" title="The title (on the title card and the file name)">
        <span class="de-sub">${n} take${n > 1 ? 's' : ''} · ${mmss(P.total)} · ${P.scenes.length} lines</span>
        <span class="de-grow"></span>
        <button class="small ghost" data-de="shuffle" title="New pictures, looks and songs for the other takes (the one you're on stays)">New takes</button>
        <button class="small primary" data-de="all">${n > 1 ? `Export all ${n}` : 'Export'}</button>
      </div>
      <div class="de-takes ${v ? 'v' : 'h'} n${n}"></div>
      <div class="transport de-transport"><button class="play de-play" aria-label="Play or pause" title="Play or pause (Space)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PLAY_ICON}"/></svg></button><span class="time de-time"></span><input class="de-seek" aria-label="Playhead" type="range" min="0" max="${P.total.toFixed(2)}" step="0.01" value="0">
        <label class="de-zoom" title="Timeline zoom">− <input type="range" min="10" max="140" value="${pps}"> +</label></div>
      <div class="de-tl"></div></div>`;
    sidebar.innerHTML = '<section class="panel"><div class="de-insp"></div></section>';
    renderTakes(true); renderTimeline(); renderInsp(); drawAll();
  }
  function renderTakes(full) {
    const box = host.querySelector('.de-takes'); if (!box) return;
    const scale = 640 / Math.max(P.W, P.H), cw = Math.round(P.W * scale), ch = Math.round(P.H * scale);
    if (full || box.children.length !== P.takes.length) {
      box.innerHTML = P.takes.map((_, k) => `<div class="de-take" data-k="${k}"><div class="de-th"><b>Take ${k + 1}</b><span class="de-tinfo"></span></div><canvas width="${cw}" height="${ch}"></canvas><div class="de-tf"><span class="de-tstat"></span><button class="small" data-de="export" data-k="${k}">Export</button></div></div>`).join('');
    }
    box.querySelectorAll('.de-take').forEach((el) => {
      const k = +el.dataset.k, tk = P.takes[k], m = tk.music >= 0 ? P.music[tk.music] : null;
      el.classList.toggle('on', k === focus);
      el.querySelector('.de-tinfo').textContent = `${tk.filter && tk.filter !== 'none' ? FILTERS[tk.filter]?.name || 'None' : LOOK_NAMES[tk.look] || 'None'} · ${STYLE_NAMES[tk.capStyle] || 'Bold'} captions · ${m ? m.mood : 'no music'}`;
    });
  }
  function renderTimeline() {
    const box = host.querySelector('.de-tl'); if (!box) return;
    const ps = times(focus), W = Math.ceil(P.total * pps), tk = P.takes[focus], m = tk.music >= 0 ? P.music[tk.music] : null;
    const step = pps >= 60 ? 1 : pps >= 25 ? 5 : 10;
    const ticks = Array.from({ length: Math.floor(P.total / step) + 1 }, (_, i) => `<i style="left:${i * step * pps}px">${mmss(i * step)}</i>`).join('');
    box.innerHTML = `<div class="de-lanes"><div>Time</div><div>Pictures</div><div>Captions</div><div>Voice</div><div>Music</div></div>
      <div class="de-scroll"><div class="de-inner" style="width:${W}px">
        <div class="de-ruler">${ticks}</div>
        <div class="de-lane pics">${ps.map((x, i) => { const me = P.media[x.mid]; return `<button class="de-pic ${sel?.kind === 'pic' && sel.i === i ? 'on' : ''}" data-pi="${i}" style="left:${x.a * pps}px;width:${Math.max(4, x.d * pps - 2)}px;background-image:url('${esc(me?.thumb || me?.url || '')}')" title="Line ${x.scene + 1}: ${esc(MOVES[x.move]?.[1] || '')}. Click to swap or change it">${me?.kind === 'vid' ? '<em>▶</em>' : ''}</button>`; }).join('')}</div>
        <div class="de-lane caps">${P.scenes.map((s, i) => `<button class="de-cap ${sel?.kind === 'cap' && sel.i === i ? 'on' : ''}" data-ci="${i}" style="left:${s.start * pps}px;width:${Math.max(4, s.dur * pps - 2)}px" title="Click to change this caption">${esc(s.cap || s.text)}</button>`).join('')}</div>
        <div class="de-lane voice">${P.scenes.map((s) => `<span style="left:${s.start * pps}px;width:${Math.max(3, s.dur * pps - 2)}px"></span>`).join('')}</div>
        <div class="de-lane mus">${m ? `<span style="left:0;width:${W}px">♪ ${esc(m.title || m.mood)}</span>` : '<span class="none" style="left:0;width:100%">No music</span>'}</div>
        <div class="de-ph"></div>
      </div></div>`;
    drawAll();
  }
  function renderInsp() {
    const box = sidebar.querySelector('.de-insp'); if (!box) return;
    const tk = P.takes[focus];
    if (sel?.kind === 'pic') {
      const ps = times(focus), x = ps[sel.i]; if (!x) { sel = null; return renderInsp(); }
      const sc = x.scene, here = tk.pieces.filter((y) => y.scene === sc).length;
      const pool = [...new Set([...P.cands[sc], ...(found.get(sc) || [])])];
      box.innerHTML = `<div class="de-ih"><b>Picture ${sel.i + 1}</b><span>line ${sc + 1} · ${x.d.toFixed(1)}s</span><button class="de-x" data-de="unsel" title="Close">×</button></div>
        <p class="de-line">“${esc(P.scenes[sc].text)}”</p>
        <div class="field"><span>Camera</span>${pick('move', MOVES, x.move)}</div>
        <div class="de-swap-h"><b>Swap with</b><span>pictures found for this line${found.get(sc)?.length ? ' and your search' : ''}</span></div>
        <div class="de-grid">${pool.map((mid) => { const me = P.media[mid]; return me ? `<button class="de-cand ${mid === x.mid ? 'on' : ''}" data-mid="${mid}" style="background-image:url('${esc(me.thumb || me.url)}')" title="${esc(me.key || '')}">${me.kind === 'vid' ? '<em>▶</em>' : ''}</button>` : ''; }).join('')}</div>
        <div class="de-search"><input class="de-q" placeholder="Search more: a name, a place, a thing…"><button class="small" data-de="search">Search</button></div>
        <div class="de-acts"><button class="small primary" data-de="findclip">Find clips</button><button class="small ghost" data-de="own" title="A picture or video from your computer">Your file…</button></div>
        <div class="de-acts"><button class="small ghost" data-de="addpic">+ Another picture in this line</button>${here > 1 ? '<button class="small ghost" data-de="delpic">Remove this one</button>' : ''}<button class="small ghost" data-de="alltakes" title="Every take shows this picture at this line">Use in every take</button></div>`;
      return;
    }
    if (sel?.kind === 'cap') {
      const s = P.scenes[sel.i];
      box.innerHTML = `<div class="de-ih"><b>Caption ${sel.i + 1}</b><span>${mmss(s.start)}–${mmss(s.start + s.dur)}</span><button class="de-x" data-de="unsel" title="Close">×</button></div>
        <textarea class="de-capin" rows="4">${esc(s.cap || s.text)}</textarea>
        <p class="de-note">The voice says: “${esc(s.text)}”. Changing the caption doesn't change the voice. It's the same in every take.</p>
        <div class="de-acts"><button class="small ghost" data-de="capreset">Back to what's said</button></div>`;
      return;
    }
    const k = focus;
    box.innerHTML = `<div class="de-ih"><b>Take ${k + 1}</b><span>click a picture or a caption on the timeline to change it</span></div>
      <div class="field"><span>Filter</span>${filterChips(tk.filter || 'none', undefined, tk.look ? LOOK_NAMES[tk.look] || 'None' : 'None')}</div>
      <div class="field"><span>Effects</span><div class="fxchips">${EFFECTS.map(([key, label]) => `<button class="fxc${tk.effects?.includes(key) ? ' on' : ''}" data-k="effect" data-v="${key}" aria-pressed="${!!tk.effects?.includes(key)}">${label}</button>`).join('')}</div></div>
      <div class="field"><span>Transitions</span>${pick('transition', [['fade', 'Dip to black'], ['cut', 'Hard cuts']], tk.transition || 'fade')}</div>
      <div class="field"><span>Captions</span>${pick('capStyle', Object.entries(STYLE_NAMES), tk.capStyle)}</div>
      <div class="field"><span>Font</span>${pick('capFont', Object.entries(FONT_NAMES), tk.capFont || 'default')}</div>
      <div class="field"><span>Position</span>${pick('capPosition', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], tk.capPosition || 'bottom')}</div>
      <div class="field"><span>Text size</span>${pick('capScale', [[0.8, 'Small'], [1, 'Normal'], [1.25, 'Large']], tk.capScale || 1)}</div>
      ${P.opts.captions ? captionSampleHtml() : ''}
      <div class="field"><span>Banner</span>${pick('banner', [[0, 'Off'], [1, 'On']], tk.banner ? 1 : 0)}</div>
      <div class="field"><span>Logo</span><button class="small" data-de="logo">${tk.logo == null ? 'Add image…' : 'Change image…'}</button>${tk.logo != null ? '<button class="small ghost" data-de="nologo">Remove</button>' : ''}</div>
      <div class="field"><span>Quality</span>${pick('quality', [['compact', 'Compact'], ['standard', 'Standard'], ['high', 'High']], tk.quality || 'standard')}</div>
      <div class="field"><span>Music</span>${pick('music', [...P.music.map((m, i) => m && [i, esc(m.title || m.mood)]).filter(Boolean), [-1, 'None']], tk.music)}</div>
      <div class="de-acts"><button class="small" data-de="findsong">Find songs</button><button class="small ghost" data-de="ownsong">Your music…</button></div>
      ${addToEdit ? '<div class="de-acts"><button class="small" data-de="sendedit">Send project to Edit Mode</button><button class="small" data-de="sendclipper">Send project to Clipper Mode</button></div>' : ''}
      <h4>Every take</h4>
      <div class="field"><span>Captions</span>${pick('captions', [[1, 'On'], [0, 'Off']], P.opts.captions ? 1 : 0)}</div>
      <div class="field"><span>Title card</span>${pick('titleCard', [[1, 'On'], [0, 'Off']], P.opts.titleCard ? 1 : 0)}</div>
      <div class="field"><span>Music level</span>${pick('musicLevel', [['low', 'Low'], ['normal', 'Normal'], ['high', 'Loud']], P.opts.musicLevel || 'normal')}</div>`;
    paintCaptionSample(box, { topic: tk, vertical: V() });
  }

  // ---- changing things ----
  // a picture picked for the selected spot (copied to this computer first, if it isn't yet)
  async function useMedia(mid) {
    const me = P.media[mid]; if (!me || sel?.kind !== 'pic') return;
    const k = focus, i = sel.i, piece = P.takes[k].pieces[i];
    piece.mid = mid; changed(); renderInsp();
    if (!me.local) {
      try { const j = await api('/api/doc/fetch', { id: P.id, mid }); P.media[mid] = { ...me, ...j }; for (const key of [...els.keys()]) if (key === String(mid) || key.endsWith(':' + mid)) els.delete(key); changed(sel?.kind === 'pic' ? 'all' : 'all'); if (sel?.kind === 'pic') renderInsp(); }
      catch (e) { toast(e.message, true); }
    }
  }
  function newTakes() {
    // the take you're on stays; the others get other pictures, moves, looks, caption styles and songs
    const used = new Set();
    P.takes.forEach((tk, k) => {
      if (k === focus) return;
      const per = P.scenes.map((_, i) => tk.pieces.filter((x) => x.scene === i).length || 1), off = Math.floor(Math.random() * 7) + 1;
      tk.pieces = [];
      P.scenes.forEach((_, i) => { const c = [...P.cands[i], ...(found.get(i) || [])]; for (let j = 0; j < per[i]; j++) { let mid = c[(off * (k + 1) + j) % c.length]; if (tk.pieces.length && tk.pieces[tk.pieces.length - 1].mid === mid && c.length > 1) mid = c[(off * (k + 1) + j + 1) % c.length]; tk.pieces.push({ scene: i, mid, move: Math.floor(Math.random() * 4) }); } });
      const looks = LOOKS.filter((x) => x !== P.takes[focus].look && !used.has(x)); tk.look = looks[Math.floor(Math.random() * looks.length)] ?? ''; tk.filter = ''; used.add(tk.look);
      tk.capStyle = Object.keys(STYLE_NAMES)[Math.floor(Math.random() * 4)];
      if (P.music.length) tk.music = Math.floor(Math.random() * P.music.length);
    });
    timesCache.clear(); changed(); renderInsp();
    toast(`New pictures, looks and songs for the other take${P.takes.length > 2 ? 's' : ''}`);
  }
  const exports = new Set();
  async function exportTake(k) {
    const project = P, key = `${project.id}:${k}`;
    if (exports.has(key)) return null;
    exports.add(key);
    const card = host.querySelector(`.de-take[data-k="${k}"]`), stat = card?.querySelector('.de-tstat'), btn = card?.querySelector('[data-de="export"]');
    if (btn) btn.disabled = true;
    if (stat) stat.textContent = 'Starting…';
    try {
      const { id } = await api('/api/doc/render', { id: project.id, take: project.takes[k], caps: project.scenes.map((x) => x.cap), title: project.title, captions: project.opts.captions, titleCard: project.opts.titleCard, musicLevel: project.opts.musicLevel });
      for (;;) {
        await new Promise((r) => setTimeout(r, 900));
        const j = await api('/api/doc/status?id=' + id).catch(() => null);
        if (!j) continue;
        const s = P === project ? host?.querySelector(`.de-take[data-k="${k}"] .de-tstat`) : null;
        if (j.status === 'error') throw new Error(j.error);
        if (j.status === 'done') { if (s) s.innerHTML = '<b class="de-ok">✓ Saved</b>'; onExported?.(j, project.title, project.id, k); return j; }
        if (s) s.innerHTML = `<i class="de-bar"><i style="width:${Math.round(j.pct || 1)}%"></i></i>${esc(j.phase || '')}`;
      }
    } catch (e) { if (stat) stat.textContent = ''; toast(e.message, true); return null; }
    finally { exports.delete(key); if (btn) btn.disabled = false; }
  }
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    const click = async (e) => {
      if (!P || !alive) return;
      const tk = P.takes[focus];
      if (e.target.closest('.de-play')) { playing ? pause() : play(); return; }
      const take = e.target.closest('.de-take');
      if (take && !e.target.closest('button')) { if (focus !== +take.dataset.k) { focus = +take.dataset.k; sel = null; renderTakes(false); renderTimeline(); renderInsp(); if (playing) syncMusic(); } return; }
      const pic = e.target.closest('[data-pi]');
      if (pic) { sel = { kind: 'pic', i: +pic.dataset.pi }; const x = times(focus)[sel.i]; seek(x.a + Math.min(0.5, x.d / 2)); renderTimeline(); renderInsp(); return; }
      const cap = e.target.closest('[data-ci]');
      if (cap) { sel = { kind: 'cap', i: +cap.dataset.ci }; seek(P.scenes[sel.i].start + 0.05); renderTimeline(); renderInsp(); sidebar.querySelector('.de-capin')?.focus(); return; }
      if (e.target.closest('.de-ruler')) { const r = host.querySelector('.de-inner').getBoundingClientRect(); seek((e.clientX - r.left) / pps); return; }
      const cand = e.target.closest('[data-mid]');
      if (cand && sel?.kind === 'pic') { useMedia(+cand.dataset.mid); return; }
      const c = e.target.closest('.de-insp button[data-k]');
      if (c) {
        const { k: n, v } = c.dataset;
        if (n === 'move' && sel?.kind === 'pic') tk.pieces[sel.i].move = +v;
        else if (n === 'filter') { tk.filter = v; tk.look = ''; }
        else if (['transition', 'capStyle', 'capFont', 'capPosition', 'quality'].includes(n)) tk[n] = v;
        else if (n === 'effect') { const fx = new Set(tk.effects || []); if (fx.has(v)) fx.delete(v); else fx.add(v); tk.effects = [...fx]; }
        else if (n === 'capScale') tk.capScale = +v;
        else if (n === 'banner') tk.banner = v === '1';
        else if (n === 'music') { tk.music = +v; syncMusic(); }
        else if (n === 'captions' || n === 'titleCard') P.opts[n] = v === '1';
        else if (n === 'musicLevel') { P.opts.musicLevel = v; syncMusic(); }
        changed(); renderInsp(); return;
      }
      const a = e.target.closest('[data-de]')?.dataset.de;
      if (a === 'back') { pause(); onBack?.(); }
      else if (a === 'unsel') { sel = null; renderTimeline(); renderInsp(); }
      else if (a === 'shuffle') newTakes();
      else if (a === 'export') exportTake(+e.target.closest('[data-de]').dataset.k);
      else if (a === 'all') {
        const project = P, button = e.target.closest('[data-de]');
        button.disabled = true;
        try { for (let k = 0; k < project.takes.length && alive && P === project; k++) await exportTake(k); }
        finally { button.disabled = false; }
      }
      else if (a === 'search') search();
      else if (a === 'own') ownFile();
      else if (a === 'ownsong') ownFile(true);
      else if (a === 'logo') ownFile(false, true);
      else if (a === 'nologo') { tk.logo = null; changed(); renderInsp(); }
      else if (a === 'findclip' && sel?.kind === 'pic') findAsset(false);
      else if (a === 'findsong') findAsset(true);
      else if (a === 'sendedit' || a === 'sendclipper') {
        const button = e.target.closest('[data-de]');
        const pid = P.id, selected = focus;
        pause(); button.disabled = true;
        try { await flush(); await addToEdit({ pid, focus: selected }, a === 'sendclipper' ? 'stream' : 'edits'); }
        catch (error) { toast(error.message, true); }
        finally { button.disabled = false; }
      }
      else if (a === 'addpic' && sel?.kind === 'pic') {
        const x = tk.pieces[sel.i], c2 = [...P.cands[x.scene], ...(found.get(x.scene) || [])], usedHere = new Set(tk.pieces.filter((y) => y.scene === x.scene).map((y) => y.mid));
        const mid = c2.find((m) => !usedHere.has(m)) ?? x.mid;
        tk.pieces.splice(sel.i + 1, 0, { scene: x.scene, mid, move: (x.move + 1) % 4 }); sel.i++;
        changed(); renderInsp(); if (!P.media[mid]?.local) useMedia(mid);
      } else if (a === 'delpic' && sel?.kind === 'pic') { tk.pieces.splice(sel.i, 1); sel = null; changed(); renderInsp(); }
      else if (a === 'alltakes' && sel?.kind === 'pic') { const x = times(focus)[sel.i], j = times(focus).filter((y) => y.scene === x.scene).indexOf(x); P.takes.forEach((t2) => { const own = t2.pieces.filter((y) => y.scene === x.scene); (own[j] || own[own.length - 1]).mid = x.mid; }); changed(); toast('Every take shows this picture here now'); }
      else if (a === 'capreset' && sel?.kind === 'cap') { P.scenes[sel.i].cap = P.scenes[sel.i].text; changed(); renderInsp(); }
    };
    const input = (e) => {
      if (!P || !alive) return;
      if (e.target.classList.contains('de-title')) { P.title = e.target.value; saveSoon(); drawAll(); }
      else if (e.target.classList.contains('de-capin') && sel?.kind === 'cap') { P.scenes[sel.i].cap = e.target.value; saveSoon(); drawAll(); const b = host.querySelector(`[data-ci="${sel.i}"]`); if (b) b.textContent = e.target.value; }
      else if (e.target.classList.contains('de-seek')) seek(+e.target.value);
      else if (e.target.closest('.de-zoom')) { const mid = t; pps = +e.target.value; renderTimeline(); const sc = host.querySelector('.de-scroll'); if (sc) sc.scrollLeft = mid * pps - sc.clientWidth / 2; }
    };
    const keydown = (e) => {
      if (!P || !alive) return;
      if (e.key === 'Enter' && e.target.classList.contains('de-q')) search();
      if (e.key === ' ' && !e.target.matches('input, textarea, select')) { e.preventDefault(); playing ? pause() : play(); }
      e.stopPropagation();
    };
    for (const target of [host, sidebar]) {
      target.addEventListener('click', click);
      target.addEventListener('input', input);
      target.addEventListener('keydown', keydown);
    }
  }
  async function search() {
    const q = sidebar.querySelector('.de-q')?.value.trim(); if (!q || sel?.kind !== 'pic') return;
    const sc = times(focus)[sel.i].scene, b = sidebar.querySelector('[data-de="search"]'); if (b) { b.disabled = true; b.textContent = 'Looking…'; }
    try {
      const j = await api('/api/doc/search', { id: P.id, q });
      for (const it of j.items) P.media[it.mid] = it;
      found.set(sc, [...new Set([...j.items.map((x) => x.mid), ...(found.get(sc) || [])])]);
      if (!j.items.length) toast(`Nothing found for “${q}”`);
      renderInsp(); const qi = sidebar.querySelector('.de-q'); if (qi) qi.value = q;
    } catch (e2) { toast(e2.message, true); if (b) { b.disabled = false; b.textContent = 'Search'; } }
  }
  function assetTarget(audio, logo = false) {
    const project = P, tk = P.takes[focus], piece = audio || logo ? null : tk.pieces[sel?.i];
    return {
      id: project.id,
      apply(j) {
        if (!alive || P !== project) return;
        if (audio) {
          P.music[j.mid] = j; tk.music = j.mid;
          if (P.takes[focus] === tk) syncMusic();
        } else {
          P.media[j.mid] = j;
          if (logo) tk.logo = j.mid;
          else {
            if (!tk.pieces.includes(piece)) return;
            found.set(piece.scene, [j.mid, ...(found.get(piece.scene) || [])]);
            piece.mid = j.mid;
          }
        }
        changed(); renderInsp();
      }
    };
  }
  function findAsset(audio) {
    const target = assetTarget(audio);
    pause();
    openFinder?.(audio ? 'music' : undefined, async (item) => {
      toast(`Adding ${item.title || (audio ? 'song' : 'clip')}…`);
      target.apply(await api('/api/doc/import', { id: target.id, item }));
    });
  }
  function ownFile(audio = false, logo = false) {
    const target = assetTarget(audio, logo);
    const i = document.createElement('input'); i.type = 'file'; i.accept = audio ? 'audio/*,.m4a,.flac,.opus' : logo ? 'image/png,image/jpeg,image/webp' : 'image/*,video/*';
    i.onchange = async () => {
      const f = i.files[0]; if (!f) return;
      toast(`Adding ${f.name}…`);
      try {
        let w = 0, h = 0;
        if (/^image\//.test(f.type)) { const bm = await createImageBitmap(f).catch(() => null); if (bm) { w = bm.width; h = bm.height; bm.close?.(); } }
        if (logo && (!w || !h)) throw new Error('Choose a PNG, JPEG or WebP image.');
        const query = new URLSearchParams({ id: target.id, name: f.name, w, h, kind: audio ? 'audio' : 'visual' });
        const r = await fetch('/api/doc/upload?' + query, { method: 'POST', body: f });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not add it');
        target.apply(j);
      } catch (e) { toast(e.message, true); }
    };
    i.click();
  }

  return {
    open(project, mount) {
      saveNow(); pause(); filters.forEach((filter) => filter.reset()); els.clear(); timesCache.clear(); found.clear();
      P = project; P.opts = P.opts || {}; P.opts.captions = P.opts.captions !== false; P.opts.titleCard = P.opts.titleCard !== false;
      P.scenes.forEach((s) => { s.cap = s.cap || s.text; });
      focus = 0; sel = null; t = 0;
      host = mount; alive = true;
      voice.src = P.voice; voice.preload = 'auto';
      render(); wire();
      // pictures still on the internet get their copies on this computer in the background (smoother preview)
    },
    pause: () => { if (P && alive) pause(); },
    flush,
    close() { if (!P) return; saveNow(); pause(); alive = false; host = null; filters.forEach((filter) => filter.reset()); },
    isOpen: (project) => alive && (!project || P === project),
  };
}
