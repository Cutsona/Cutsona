import { decodeAudio, analyzeMusic, analyzeClipAudio, suggestWindow, syntheticMusic, audioCtx, encodeWav } from './audio.js';
import { findMoments, applyCrowd, boostMoments } from './moments.js';
import { frameBounds, contentRect, barTimeline, rectBetween } from './framing.js';
import { planEdit, makeCtx, keyValues, KEY_PROPS } from './edit.js';
import { STYLES, DEFAULT_LINEUP, FILTERS, EXTRAS, ANIMATED_FX, styleParts } from './styles.js';
import { CAPTION_STYLES, CAPTION_FONTS } from './captions.js';
import { analyzeTrack } from './track.js';
import { Player } from './player.js';
import { drawHookCanvas } from './renderer.js';
import { exportEdit } from './exporter.js';
import { initShotBar } from './shotbar.js';
import { initSettings, accentRGBA, accentHex } from './settings.js';
import { initUpdates } from './updates.js';
import { drawWatermark, logoImage, shrinkLogo } from './watermark.js';
import { initFinder } from './finder.js';
import { findHighlights, wholeHighlights, planHighlight, findCam, drawStreamOverlay, tightCut, longCut, keepParts, STREAM_LAYOUTS, BANNER_THEMES } from './stream.js';
import { trimView, partsOff, srcOffset } from './edit.js';
// a clip's cut-and-group parts as a cache key
const partsKey = (c) => (c.parts || []).map((p) => `${p.a}-${p.b}-${p.on ? 1 : 0}`).join(',');

const $ = (s) => document.querySelector(s);

// quality badge (4K / 2K / 1080p / 720p / SD) from a video's size; vertical videos count by their long side too
function resBadge(w, h) {
  if (!w || !h) return '';
  const L = Math.max(w, h), S = Math.min(w, h);
  const r = L >= 3800 || S >= 2100 ? '4K' : L >= 2500 || S >= 1400 ? '2K' : L >= 1900 || S >= 1060 ? '1080p' : L >= 1260 || S >= 700 ? '720p' : 'SD';
  return `<b class="fd-res clip-res q-${r.toLowerCase()}">${r}</b> `;
}

// 16:9 thumbnail of the picture inside rect (bars cropped off)
function thumbFrom(src, [x, y, w, h]) {
  const tc = document.createElement('canvas'); tc.width = 160; tc.height = 90;
  const sw = src.width * w, sh = src.height * h;
  const sc = Math.max(160 / sw, 90 / sh);
  tc.getContext('2d').drawImage(src, src.width * x, src.height * y, sw, sh, (160 - sw * sc) / 2, (90 - sh * sc) / 2, sw * sc, sh * sc);
  return tc.toDataURL('image/jpeg', 0.75);
}
// the picture uncropped (inside any black bars), 240 px wide
function stillFrom(src, [x, y, w, h]) {
  const sw = src.width * w, sh = src.height * h, tc = document.createElement('canvas');
  tc.width = 240; tc.height = Math.max(2, Math.round(240 * sh / sw));
  tc.getContext('2d').drawImage(src, src.width * x, src.height * y, sw, sh, 0, 0, tc.width, tc.height);
  return tc.toDataURL('image/jpeg', 0.7);
}
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|flv|ts|wmv|3gp|mts)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|bmp|gif|avif)$/i;
const CLIP_COLORS = ['#ffc933', '#8b7bff', '#ff5d8f', '#3df5ff', '#ffb02e', '#5dff9a', '#ff7a3d', '#f2f2f2'];

// ---------------- state ----------------
const DEFAULTS = { length: 15, format: '9:16', framing: 'fill', pacing: 0.25, intensity: 1, musicVol: 0.9, clipVol: 1, text: '', textColor: 'white', quality: '1080/30',
  filter: 'none', fx: [], speed: 'on', focus: 'on', captions: 'off', captionStyle: 'yellow_pop', captionFont: 'segoe', pick: 'auto', order: 'scattered',
  fadeIn: 0, fadeOut: 0, musicFadeIn: 0, musicFadeOut: 1,
  // MODE: 'edits' (beat-synced edits) or 'stream' (Twitch / Kick highlights) + the stream clip settings
  mode: 'edits', streamLen: 30, streamLayout: 'auto', streamCaptions: 'on', streamCaptionStyle: 'stream_word', streamTitle: 'on', streamCuts: 'none', reactZoom: 'on',
  // stream banner (platform + name) and the cam / screen template
  streamBanner: 'on', bannerTheme: 'classic', bannerName: '', bannerPlatform: 'auto', stackSwap: 'off', stackGame: 'fill', stackCam: 'face', stackSplit: '0.5',
  // hook text: font, size, where it sits (0..1 from the top left; y null = the mode's usual spot), when it shows
  hookFont: 'arial_black', hookSize: 1, hookX: 0.5, hookY: null, hookStart: 0, hookEnd: 0,
  // the banner moved by hand (its center, 0..1); null = its usual place
  bannerX: null, bannerY: null,
  // watermark: off / text / logo, and how it looks
  wm: 'off', wmText: '', wmFont: 'arial_black', wmColor: '#ffffff', wmSize: 1, wmOpacity: 0.7, wmStyle: 'shadow', wmX: 0.84, wmY: 0.93 };
let saved = {};
try { saved = JSON.parse(localStorage.getItem('cutsona.settings') || '{}'); } catch {}
let savedCustom = [];
try { savedCustom = JSON.parse(localStorage.getItem('cutsona.custom') || '[]'); } catch {}
// Apply the new full-frame default once to existing installations.
try {
  if (localStorage.getItem('cutsona.fillFraming') !== '1') {
    saved.framing = 'fill';
    savedCustom.forEach(c => { if (c?.framing === 'fit') c.framing = 'fill'; });
    localStorage.setItem('cutsona.settings', JSON.stringify(saved));
    localStorage.setItem('cutsona.custom', JSON.stringify(savedCustom));
    localStorage.setItem('cutsona.fillFraming', '1');
  }
} catch {}
let savedView = {};
try { savedView = JSON.parse(localStorage.getItem('cutsona.view') || '{}'); } catch {}
// remember which style each card had (Regen changes them); edit 1 starts as the Simple Beat edit
let savedLineup = null;
try { savedLineup = JSON.parse(localStorage.getItem('cutsona.lineup2') || 'null'); } catch {}
// 4 takes to start; you can add up to 10 (the number you had is remembered)
const LINEUP = (Array.isArray(savedLineup) && savedLineup.length >= 1 && savedLineup.length <= 10 && savedLineup.every((k) => STYLES[k])) ? savedLineup : DEFAULT_LINEUP;
const state = {
  clips: [], planClips: [],
  music: null, musicAnalysis: syntheticMusic(130, 120), musicStart: 0, beatOffset: 0,
  settings: { ...DEFAULTS, ...saved },
  variants: LINEUP.map((styleId, i) => ({ styleId, seed: (Math.random() * 1e9) | 0, plan: null, custom: (savedCustom[i] && typeof savedCustom[i] === 'object') ? savedCustom[i] : {} })),
  focused: 0,
  solo: !!savedView.solo,
  clipVolTouched: false,
  server: { ffmpeg: null },
};
// once: put the new Movie Edit and Caption Edit styles on the first two cards (like the reference edits)
try {
  if (localStorage.getItem('cutsona.movieLineup') !== '1') {
    state.variants[0].styleId = 'movie'; state.variants[1].styleId = 'captionedit';
    for (const v of state.variants.slice(0, 2)) { v.custom.off = []; delete v.custom.fx; delete v.custom.filter; }
    localStorage.setItem('cutsona.movieLineup', '1');
  }
} catch {}
for (const v of state.variants) if (v.custom._autoFor !== v.styleId) applyStyleDefaults(v);
// older caption style names -> current names
for (const o of [state.settings, ...state.variants.map((v) => v.custom)]) {
  if (o.captionStyle === 'cyan') o.captionStyle = 'cyber_cyan';
  if (o.captionStyle === 'white') o.captionStyle = 'pure_white';
}
function saveSettings() { try { localStorage.setItem('cutsona.settings', JSON.stringify(state.settings)); } catch {} refreshEff(); }
function saveCustom() { try { localStorage.setItem('cutsona.custom', JSON.stringify(state.variants.map((v) => v.custom))); } catch {} refreshEff(); }
function saveLineup() { try { localStorage.setItem('cutsona.lineup2', JSON.stringify(state.variants.map((v) => v.styleId))); } catch {} }

// ---------------- per-edit settings: each of the 4 edits can override the main settings ----------------
const OVERRIDABLE = ['format', 'framing', 'filter', 'intensity', 'pacing', 'speed', 'focus', 'captions', 'captionStyle', 'captionFont', 'pick', 'order',
  'fadeIn', 'fadeOut', 'musicFadeIn', 'musicFadeOut', 'textColor'];
function computeEff(i) {
  const s = state.settings, c = state.variants[i].custom || {};
  const e = { ...s };
  for (const k of OVERRIDABLE) if (c[k] !== undefined && c[k] !== null && c[k] !== '') e[k] = c[k];
  if (Array.isArray(c.fx)) e.fx = c.fx;
  if (typeof c.text === 'string' && c.text.trim()) e.text = c.text;
  // a "Best quote" edit shows its words unless captions were switched off for that edit
  if (e.pick === 'quotes' && c.captions == null) e.captions = 'on';
  if (e.hookY == null) e.hookY = s.mode === 'stream' ? 0.07 : 0.2;
  e.keys = Array.isArray(c.keys) && c.keys.length ? c.keys : null; // this take's own card motion
  // stream clips: the stream's own sound, no music / effects, people tracked (to find the cam), stream captions
  if (s.mode === 'stream') {
    const H = state.variants[i].plan?.highlight;
    const so = stackOpts();
    Object.assign(e, { captions: s.streamCaptions, captionStyle: s.streamCaptionStyle, captionFont: 'segoe', clipVol: 1, musicVol: 0,
      fadeIn: 0, fadeOut: 0, fx: [], focus: 'on', framing: 'fill', pick: 'auto', stackOpts: so,
      captionY: H?.layout === 'stack' ? so.divider + 0.035 : 0.27 });
  }
  return e;
}
const isStream = () => state.settings.mode === 'stream';
// the cam / screen template: which side is on top, whole screen or a crop, face or whole webcam, cam share of the height
function stackOpts() {
  const s = state.settings, split = Math.min(0.7, Math.max(0.3, Number(s.stackSplit) || 0.5)), swap = s.stackSwap === 'on';
  return { swap, game: s.stackGame, cam: s.stackCam, split, divider: swap ? 1 - split : split };
}
let effCache = [], ctxCache = [];
function refreshEff() { effCache = state.variants.map((_, i) => computeEff(i)); ctxCache = []; textCache.clear(); }
function eff(i) { return effCache[i] || (effCache[i] = computeEff(i)); }
function isCustom(i) {
  const c = state.variants[i].custom || {};
  if (isStream()) return !!c.layout || c.title != null || !!c.keys?.length;
  return OVERRIDABLE.some((k) => c[k] !== undefined && c[k] !== null && c[k] !== '') || Array.isArray(c.fx) || !!(c.text && c.text.trim()) || !!c.keys?.length;
}
function aspectOf(i) { const [a, b] = String(eff(i).format).split(':').map(Number); return a / b; }
const textCache = new Map();
// the overlay layer of take i: stream banner + title box (stream clips) and your watermark (both modes)
function textFor(i) {
  const s = state.settings, a = aspectOf(i);
  let key = '', make = null;
  if (isStream()) {
    // stream clips: the banner (platform + name) + title box; the hook text is its own layer (hookFor)
    const v = state.variants[i], H = v.plan?.highlight;
    if (H) {
      const title = s.streamTitle === 'on' ? (v.custom.title ?? H.title ?? '') : '', so = stackOpts();
      const pos = s.bannerX != null && s.bannerY != null ? { x: Number(s.bannerX), y: Number(s.bannerY) } : null;
      key = `stream|${H.layout}|${H.platform}|${H.channel}|${title}|${s.streamBanner}|${s.bannerTheme}|${so.divider}|${pos ? pos.x + ',' + pos.y : ''}`;
      make = () => drawStreamOverlay(a, { layout: H.layout, platform: H.platform, channel: H.channel, title, banner: s.streamBanner, theme: s.bannerTheme, divider: so.divider, pos });
    }
  }
  const wm = watermarkOpts();
  if (!make && !wm) return null;
  key += `|wm:${wm ? wm.key : ''}|${a.toFixed(3)}`;
  let c = textCache.get(key);
  if (!c) {
    c = make ? make() : (() => { const x = document.createElement('canvas'); x.height = 1280; x.width = Math.round(1280 * a); return x; })();
    if (wm) {
      const at = drawWatermark(c.getContext('2d'), c.width, c.height, wm.opts, wm.logo);
      c.wmBox = at?.box || null; c.wmCenter = at?.center || null;
    }
    if (textCache.size > 60) textCache.clear();
    textCache.set(key, c);
  }
  return { canvas: c, key };
}
// the watermark as set in the sidebar, or null when it's off / empty
let wmLogo = '';
try { wmLogo = localStorage.getItem('cutsona.wmLogo') || ''; } catch {}
function watermarkOpts() {
  const s = state.settings;
  if (s.wm !== 'text' && s.wm !== 'logo') return null;
  const logo = s.wm === 'logo' ? logoImage(wmLogo, () => { textCache.clear(); player.views.forEach((v) => { if (v) v.dirty = true; }); }) : null;
  if (s.wm === 'logo' && !logo) return null;
  if (s.wm === 'text' && !String(s.wmText || '').trim()) return null;
  const f = CAPTION_FONTS[s.wmFont] || CAPTION_FONTS.arial_black;
  const opts = { kind: s.wm, text: s.wmText, family: `${f[1]}, "Arial Black", sans-serif`, weight: f[2], color: s.wmColor, size: s.wmSize,
    opacity: s.wmOpacity, style: s.wmStyle, x: Number(s.wmX), y: Number(s.wmY) };
  return { opts, logo, key: `${s.wm}|${s.wm === 'logo' ? wmLogo.length + wmLogo.slice(-24) : s.wmText}|${s.wmFont}|${s.wmColor}|${s.wmSize}|${s.wmOpacity}|${s.wmStyle}|${s.wmX}|${s.wmY}` };
}
// the hook text layer for take i: your words in your font, size and spot
const hookCache = new Map();
function hookFor(i) {
  const e = eff(i), t = (e.text || '').trim();
  if (!t) return null;
  const a = aspectOf(i), f = CAPTION_FONTS[e.hookFont] || CAPTION_FONTS.arial_black;
  const key = `hook|${t}|${e.textColor}|${e.hookFont}|${e.hookSize}|${e.hookX}|${e.hookY}|${a.toFixed(3)}`;
  let c = hookCache.get(key);
  if (!c) {
    c = drawHookCanvas(t, a, { family: `${f[1]}, "Arial Black", sans-serif`, weight: f[2], size: Number(e.hookSize) || 1, color: e.textColor, x: Number(e.hookX ?? 0.5), y: Number(e.hookY) });
    if (hookCache.size > 80) hookCache.clear();
    hookCache.set(key, c);
  }
  return { canvas: c, key };
}

// ---------------- helpers ----------------
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = 'toast' + (err ? ' err' : '')), err ? 6000 : 2600);
}
const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60); const s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }
function aspect() { const [a, b] = state.settings.format.split(':').map(Number); return a / b; }

// ---------------- server status ----------------
async function refreshStatus() {
  try {
    const r = await fetch('/api/status'); state.server = await r.json();
  } catch { state.server = { ffmpeg: false, offline: true }; }
  renderStatus();
}
function renderStatus() {
  const chips = [];
  const ready = state.clips.filter((c) => c.status === 'ready').length;
  chips.push(`<span class="chip ${ready ? 'ok' : ''}"><i></i>${ready} clip${ready === 1 ? '' : 's'}</span>`);
  chips.push(`<span class="chip ${state.music ? 'ok' : ''}"><i></i>${state.music ? Math.round(state.musicAnalysis.bpm) + ' BPM' : 'No song (120 BPM grid)'}</span>`);
  if (state.server.ffmpeg === false) chips.push(`<span class="chip bad"><i></i>${state.server.offline ? 'Server offline' : 'ffmpeg missing: export disabled'}</span>`);
  if (!('VideoEncoder' in window)) chips.push(`<span class="chip bad"><i></i>Use Chrome/Edge to export</span>`);
  $('#status').innerHTML = chips.join('');
  // the edit settings stay greyed out (and can't be clicked) until there's a clip or a song to edit
  const locked = !state.clips.length && !state.music;
  $('#editFields').disabled = locked;
  $('#editPanel').classList.toggle('locked', locked);
}
setInterval(() => fetch('/api/ping').catch(() => {}), 5000);
fetch('/api/ping').catch(() => {});
// closing the window lets Cutsona's engine shut down right away (a reload pings again and keeps it running)
addEventListener('pagehide', () => { try { navigator.sendBeacon('/api/bye'); } catch {} });

// ---------------- clips ----------------
let clipQueue = Promise.resolve();
function addFiles(files, target) {
  const vids = [], auds = [], pics = [];
  for (const f of files) {
    if (target !== 'music' && (f.type.startsWith('image') || IMAGE_EXT.test(f.name))) { pics.push(f); continue; }
    if (target === 'music' && (f.type.startsWith('audio') || AUDIO_EXT.test(f.name) || f.type.startsWith('video') || VIDEO_EXT.test(f.name))) { auds.push(f); continue; }
    if (f.type.startsWith('audio') || AUDIO_EXT.test(f.name)) auds.push(f);
    else if (f.type.startsWith('video') || VIDEO_EXT.test(f.name)) vids.push(f);
  }
  if (auds.length) setMusic(auds[0]);
  pics.forEach(addPhoto);
  vids.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const f of vids) {
    const clip = { id: 'c' + Math.random().toString(36).slice(2, 9), name: f.name, file: f, status: 'loading', cropX: 0.5, color: CLIP_COLORS[state.clips.length % CLIP_COLORS.length] };
    state.clips.push(clip);
    queueAnalysis(clip);
  }
  renderClips(); renderStatus(); updateEmpty();
}
// Photos: the server turns each one into an 8s clip with a slow push-in
async function addPhoto(f) {
  const clip = { id: 'c' + Math.random().toString(36).slice(2, 9), name: f.name, status: 'loading', sub: 'making clip from photo…', cropX: 0.5,
    color: CLIP_COLORS[state.clips.length % CLIP_COLORS.length], remote: true, photo: true };
  state.clips.push(clip); renderClips(); renderStatus(); updateEmpty();
  try {
    const r = await fetch(`/api/photo?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'could not use that photo');
    if (!state.clips.includes(clip)) return;
    clip.url = j.url; clip.sub = 'analyzing…'; renderClips(); queueAnalysis(clip);
  } catch (e) { clip.status = 'error'; clip.sub = e.message; renderClips(); toast(`${f.name}: ${e.message}`, true); }
}
// Crowd ratings: YouTube "Most replayed" + the lines / timestamps fans quote in the top comments (downloaded
// YouTube clips) and the memorable quotes on Wikiquote for the movie / show (any clip with a real title).
async function loadCrowd(clip) {
  if (clip.crowdState) return;
  const source = clip.url?.startsWith('/cache/') ? clip.url : '';
  const name = String(clip.name || '').replace(/\.[a-z0-9]{2,4}$/i, '');
  if (!source && (!name || /^(grab_|clip$|vid|img_|video\d|\d+$)/i.test(name))) return;
  clip.crowdState = 'loading'; renderClipsSoon();
  try {
    const r = await fetch(`/api/crowd?source=${encodeURIComponent(source)}&name=${encodeURIComponent(name)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'lookup failed');
    if (!state.clips.includes(clip)) return;
    clip.crowd = d; clip.crowdState = 'done';
    if (d.heatmap?.length || d.comments?.length || d.quotes?.length || d.marks?.length) { applyCrowd(clip); replanSoon(); }
  } catch (e) { clip.crowdState = 'failed'; console.warn('crowd ratings:', e.message); }
  renderClipsSoon();
}
function crowdLabel(c) {
  if (c.crowdState === 'loading') return ', <span class="crowd">checking fan ratings…</span>';
  const d = c.crowd;
  if (!d) return '';
  const bits = [];
  if (d.heatmap?.length) bits.push('most replayed');
  if (d.comments?.length) bits.push(`${d.comments.length} fan comments`);
  if (d.quotes?.length) bits.push(`${d.quotes.length} famous quotes`);
  if (!bits.length) return '';
  return `, <span class="crowd" title="Ranked with: ${esc(d.sources.join(', '))}">${bits.join(', ')}</span>`;
}
let pendingAnalysis = 0;
function queueAnalysis(clip) {
  pendingAnalysis++;
  clipQueue = clipQueue.then(() => analyzeClip(clip)).catch((e) => console.error(e)).finally(() => {
    pendingAnalysis--;
    if (pendingAnalysis === 0) { setAnalyzing(null); replanAll(); }
  });
}

// ---------------- grabbing clips from links (Clip Finder / paste) ----------------
let rcPending = 0;
function renderClipsSoon() { if (!rcPending) rcPending = requestAnimationFrame(() => { rcPending = 0; renderClips(); }); }
async function grab(item, onUpdate) {
  const r = await fetch('/api/grab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not grab that link');
  let host = '';
  try { host = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const clip = { id: 'c' + Math.random().toString(36).slice(2, 9), name: item.title || host || 'clip', status: 'loading', sub: 'queued…', cropX: 0.5,
    color: CLIP_COLORS[state.clips.length % CLIP_COLORS.length], remote: true };
  state.clips.push(clip); renderClips(); renderStatus(); updateEmpty();
  if (onUpdate) onUpdate({ clipId: clip.id });
  for (;;) {
    await sleep(700);
    let s;
    try { s = await (await fetch('/api/grab/status?id=' + j.id)).json(); } catch { continue; }
    if (onUpdate) onUpdate({ ...s, clipId: clip.id });
    if (!state.clips.includes(clip)) return;
    if (s.status === 'done') {
      clip.url = s.url; clip.name = s.name || clip.name; clip.sub = 'analyzing…';
      renderClips(); queueAnalysis(clip); return;
    }
    if (s.status === 'error') {
      clip.status = 'error'; clip.sub = s.error || 'download failed'; renderClips(); renderStatus();
      throw new Error(s.error || 'download failed');
    }
    clip.sub = s.pct > 0 ? `downloading ${Math.round(s.pct)}%` : (s.phase || 'starting').toLowerCase() + '…';
    renderClipsSoon();
  }
}

// A song from the finder (YouTube, Freesound, FMA, ccMixter, Internet Archive): the server makes an MP3,
// then it is loaded exactly like a dropped song file (beats detected, every cut lands on the beat).
async function grabSong(item, onUpdate) {
  const r = await fetch('/api/grab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...item, audio: true }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not get that song');
  $('#musicDrop').querySelector('b').textContent = `Getting ${item.title || 'song'}…`;
  for (;;) {
    await sleep(700);
    let s;
    try { s = await (await fetch('/api/grab/status?id=' + j.id)).json(); } catch { continue; }
    if (onUpdate) onUpdate(s);
    if (s.status === 'error') { $('#musicDrop').querySelector('b').textContent = 'Drop a song'; throw new Error(s.error || 'song download failed'); }
    if (s.status === 'done') {
      const blob = await (await fetch(s.url)).blob();
      await setMusic(new File([blob], `${s.name || 'song'}.mp3`, { type: 'audio/mpeg' }));
      return;
    }
  }
}

function loadVideo(url, ms = 15000) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.crossOrigin = 'anonymous';
    const to = setTimeout(() => rej(new Error('timeout')), ms);
    v.onloadeddata = () => { clearTimeout(to); v.videoWidth ? res(v) : rej(new Error('no video track')); };
    v.onerror = () => { clearTimeout(to); rej(new Error('cannot decode')); };
    v.src = url;
    $('#pool').appendChild(v);
  });
}
function seekV(v, t) {
  return new Promise((res) => { const on = () => { v.removeEventListener('seeked', on); res(); }; v.addEventListener('seeked', on); v.currentTime = t; setTimeout(on, 3000); });
}

async function analyzeClip(clip) {
  if (!state.clips.includes(clip)) return;
  setAnalyzing(`Reading ${clip.name}…`);
  let v;
  try {
    if (clip.file) clip.url = URL.createObjectURL(clip.file);
    try { v = await loadVideo(clip.url, clip.file ? 10000 : 20000); }
    catch {
      if (!clip.file) throw new Error('could not play the downloaded video');
      // browser can't play this format -> convert with ffmpeg
      setAnalyzing(`Converting ${clip.name} (unsupported format)…`);
      clip.sub = 'converting…'; renderClips();
      const h264 = document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"');
      const r = await fetch(`/api/convert?name=${encodeURIComponent(clip.name)}&codec=${h264 ? 'h264' : 'vp9'}`, { method: 'POST', body: clip.file });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'convert failed');
      URL.revokeObjectURL(clip.url);
      clip.url = j.url; clip.converted = true;
      v = await loadVideo(clip.url, 20000);
    }
    clip.duration = v.duration; clip.w = v.videoWidth; clip.h = v.videoHeight;
    clip.sub = `${clip.w}×${clip.h}`;
    clip.previewPromise = preparePreview(clip);

    // audio "hype" curve
    setAnalyzing(`Finding the loudest moments in ${clip.name}…`);
    let audioCurve = null;
    try {
      if (((clip.file && clip.file.size) || 0) < 900e6) {
        const ab = clip.file && !clip.converted ? await clip.file.arrayBuffer() : await (await fetch(clip.url)).arrayBuffer();
        clip.audioBuffer = await decodeAudio(ab);
        audioCurve = analyzeClipAudio(clip.audioBuffer);
        clip.audioCurve = audioCurve; // loudness alone (stream clips: yells -> punch-in, quiet -> dead air)
      }
    } catch { clip.audioBuffer = null; }

    // 4K and other big videos: scan the light preview copy instead of seeking through huge frames
    if (clip.w * clip.h > 2600 * 1500 && clip.previewPromise) {
      setAnalyzing(`Making a light copy of ${clip.name} (${clip.w}×${clip.h})…`);
      await clip.previewPromise;
      if (clip.previewUrl) {
        try { const pv = await loadVideo(clip.previewUrl, 20000); v.removeAttribute('src'); v.load(); v.remove(); v = pv; } catch {}
      }
    }
    // motion curve + thumbnail
    setAnalyzing(`Scanning motion in ${clip.name}…`);
    const n = Math.max(10, Math.min(60, Math.round(clip.duration * 1.5)));
    const cw = 96, ch = 54, borders = [], borderTimes = [];
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d', { willReadFrequently: true });
    // finer sample just for spotting black bars baked into the clip
    const bw = 160, bh = 160;
    const bc = document.createElement('canvas'); bc.width = bw; bc.height = bh;
    const bg = bc.getContext('2d', { willReadFrequently: true });
    const raw = document.createElement('canvas');
    raw.width = 480; raw.height = Math.max(2, Math.round(480 * clip.h / clip.w));
    const motion = new Float32Array(n), quality = new Float32Array(n), scenes = [];
    let prev = null;
    const thumbAt = Math.floor(n * 0.35);
    for (let i = 0; i < n; i++) {
      const at = Math.min(clip.duration - 0.05, ((i + 0.5) / n) * clip.duration);
      await seekV(v, at);
      g.drawImage(v, 0, 0, cw, ch);
      const d = g.getImageData(0, 0, cw, ch).data;
      bg.drawImage(v, 0, 0, bw, bh);
      borders.push(frameBounds(bg.getImageData(0, 0, bw, bh).data, bw, bh)); borderTimes.push(at);
      let brightness = 0, brightness2 = 0;
      for (let k = 0; k < d.length; k += 4) { const l = (d[k] + d[k + 1] + d[k + 2]) / 765; brightness += l; brightness2 += l * l; }
      const mean = brightness / (cw * ch), variance = brightness2 / (cw * ch) - mean * mean;
      quality[i] = mean < 0.035 || mean > 0.975 ? 0 : Math.min(1, Math.sqrt(Math.max(0, variance)) * 10);
      if (prev) { let s = 0; for (let k = 0; k < d.length; k += 4) s += Math.abs(d[k] - prev[k]) + Math.abs(d[k + 1] - prev[k + 1]); motion[i] = s / (cw * ch * 510); }
      if (motion[i] > 0.28) scenes.push(i / n * clip.duration);
      prev = d;
      if (i === thumbAt) {
        raw.getContext('2d').drawImage(v, 0, 0, raw.width, raw.height);
        clip.thumb = thumbFrom(raw, [0, 0, 1, 1]);
        renderClips();
      }
    }
    clip.contentRect = contentRect(borders, bw, bh);
    clip.barTimeline = barTimeline(borders, borderTimes, bw, bh);
    const tr = rectBetween(clip.barTimeline, borderTimes[thumbAt], borderTimes[thumbAt], clip.contentRect);
    if (tr.some((v, k) => Math.abs(v - [0, 0, 1, 1][k]) > 0.004)) { clip.thumb = thumbFrom(raw, tr); renderClips(); }
    clip.still = stillFrom(raw, tr); // the whole picture at its own shape, for framing it by hand
    if (n > 1) motion[0] = motion[1];
    const mmax = Math.max(0.1, Math.min(0.2, Math.max(...motion)));

    const len = Math.max(1, Math.ceil(clip.duration * 10));
    const interest = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / 10;
      const mi = Math.min(n - 1, Math.max(0, (t / clip.duration) * n - 0.5));
      const m0 = Math.floor(mi), m1 = Math.min(n - 1, m0 + 1), a = mi - m0;
      const mv = Math.min(1, (motion[m0] * (1 - a) + motion[m1] * a) / mmax);
      const av = audioCurve ? audioCurve[Math.min(audioCurve.length - 1, i)] : null;
      const q = quality[Math.min(n - 1, Math.floor(t / clip.duration * n))];
      interest[i] = (av == null ? mv : 0.62 * av + 0.38 * mv) * (q < 0.15 ? 0.1 : 1);
    }
    clip.interest = interest;
    // movement alone (10 Hz, 0..1), for "Replace cut": a hard cut between two samples isn't movement, so it's capped
    const mc = new Float32Array(len), capped = motion.map((m) => Math.min(m, mmax * 0.8));
    for (let i = 0; i < len; i++) {
      const mi = Math.min(n - 1, Math.max(0, (i / 10 / clip.duration) * n - 0.5)), m0 = Math.floor(mi), m1 = Math.min(n - 1, m0 + 1), a = mi - m0;
      mc[i] = Math.min(1, (capped[m0] * (1 - a) + capped[m1] * a) / mmax);
    }
    clip.motionCurve = mc;
    // Exclude only measured blank tails; arbitrary outro trimming used to remove real endings.
    let tail = n;
    while (tail > 1 && quality[tail - 1] < 0.08) tail--;
    clip.usableEnd = tail === n ? clip.duration : Math.max(0.25, tail / n * clip.duration);
    clip.scenes = scenes; clip.quality = quality;
    if (clip.audioBuffer) {
      setAnalyzing(`Finding complete speech in ${clip.name}…`);
      await analyzeSpeech(clip);
    }
    setAnalyzing(`Preparing smooth previews for ${clip.name}…`);
    await clip.previewPromise;
    setAnalyzing(`Skipping still pictures in ${clip.name}…`);
    await findClipStills(clip);
    clip.moments = boostMoments(clip, findMoments(interest, clip.usableEnd, { words: clip.words, scenes, quality }));
    clip.status = 'ready';
    loadCrowd(clip); // in the background: what people rewatch / quote / rate online
    queueTrack(clip);
    if (clip.trackPromise && !clip.track) {
      // The first preview must use the framing analysis, not a temporary center crop.
      clip.status = 'loading'; clip.sub = 'finding people…';
      setAnalyzing(`Framing ${clip.name}…`);
      await clip.trackPromise;
      clip.status = 'ready'; clip.sub = `${clip.w}×${clip.h}`;
    }
  } catch (e) {
    console.error(e);
    clip.status = 'error'; clip.sub = 'Could not read this file' + (state.server.ffmpeg === false ? ' (install ffmpeg)' : '');
    toast(`${clip.name}: ${e.message}`, true);
  } finally {
    if (v) { v.removeAttribute('src'); v.load(); v.remove(); }
  }
  renderClips(); renderStatus();
}

// Title cards, posters, "rent on ..." end screens and frozen frames: found by the server (ffmpeg) and
// left out of every edit. A clip that is a picture from start to finish is kept (it was added on purpose).
async function findClipStills(clip) {
  clip.stills = [];
  if (clip.photo || state.server.ffmpeg === false) return;
  const source = clip.previewUrl || (clip.url.startsWith('/cache/') ? clip.url : '');
  if (!source) return;
  try {
    const r = await fetch('/api/stills?source=' + encodeURIComponent(source));
    const j = await r.json();
    const stills = (j.stills || []).map(([a, b]) => [Math.max(0, a - 0.05), Math.min(clip.duration, b + 0.05)]).filter(([a, b]) => b - a >= 0.6);
    const total = stills.reduce((s, [a, b]) => s + b - a, 0);
    if (!stills.length || total > clip.duration * 0.9) return;
    clip.stills = stills;
    // a still that runs to the end (end card) just ends the usable part of the clip
    for (const [a, b] of [...stills].reverse()) if (b >= (clip.usableEnd ?? clip.duration) - 0.6) clip.usableEnd = Math.max(0.25, Math.min(clip.usableEnd ?? clip.duration, a));
    // a still at the very start is skipped by the moment finder through its interest
    for (const [a, b] of stills) for (let i = Math.floor(a * 10); i < Math.min(clip.interest.length, Math.ceil(b * 10)); i++) clip.interest[i] = 0;
  } catch (e) { console.warn('still-picture check failed:', e.message); }
}

async function preparePreview(clip) {
  if (state.server.ffmpeg === false) return;
  try {
    const source = clip.url.startsWith('/cache/') ? clip.url : '';
    if (!source && !clip.file) return;
    const response = await fetch('/api/preview' + (source ? '?source=' + encodeURIComponent(source) : ''),
      { method: 'POST', body: source ? undefined : clip.file });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not prepare preview');
    clip.previewUrl = result.url;
  } catch (error) { console.warn('Using original video for preview:', error.message); }
}

// ---------------- auto-focus tracking (runs in the background, one clip at a time) ----------------
let trackQueue = Promise.resolve();
const focusWanted = () => state.variants.some((_, i) => eff(i).focus === 'on');
let afterTrack = null; // the shot editor refreshes when a clip's people are found
function queueTrack(clip) {
  if ((!focusWanted() && !clip.wantTrack) || clip.track || ['queued', 'running'].includes(clip.trackState) || clip.status !== 'ready') return;
  clip.trackState = 'queued';
  trackQueue = trackQueue.then(async () => {
    if (!state.clips.includes(clip)) return;
    clip.trackState = 'running'; clip.trackPct = 0; renderClipsSoon();
    try {
      const tr = await analyzeTrack(clip, (p) => {
        clip.trackPct = p;
        if (clip.status === 'loading') clip.sub = `framing ${Math.round(p * 100)}%…`;
        renderClipsSoon();
      }, () => !state.clips.includes(clip));
      if (tr) {
        clip.track = tr; clip.trackState = 'done'; if (afterTrack) afterTrack(clip);
        if (isStream()) { clip.cam = findCam(clip); replanSoon(); } // now we know where the streamer's cam is
      }
      else clip.trackState = null;
    } catch (e) { console.error('tracking failed', e); clip.trackState = 'failed'; }
    renderClipsSoon();
  });
  clip.trackPromise = trackQueue;
}
function queueAllTracks() { if (focusWanted()) state.clips.forEach(queueTrack); }
function trackLabel(c) {
  if (!focusWanted() || c.status !== 'ready') return '';
  if (c.trackState === 'running') return `, finding people ${Math.round((c.trackPct || 0) * 100)}%`;
  if (c.trackState === 'queued') return ', finding people next';
  if (c.trackState === 'failed') return ', frame it by hand';
  if (c.track) return `, ${c.track.kind === 'face' ? 'follows faces' : c.track.kind === 'body' ? 'follows bodies' : 'no person found'}`;
  return '';
}

async function analyzeSpeech(clip) {
  if (!clip.audioBuffer || clip.speechState === 'done') return;
  if (clip.speechPromise) return clip.speechPromise;
  clip.speechState = 'running';
  clip.speechPromise = (async () => {
    try {
      // Send mono 16 kHz audio, rather than uploading another full video.
      const input = clip.audioBuffer;
      const offline = new OfflineAudioContext(1, Math.ceil(input.duration * 16000), 16000);
      const source = offline.createBufferSource(); source.buffer = input; source.connect(offline.destination); source.start();
      const audio = await offline.startRendering();
      const response = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: encodeWav(audio) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Speech analysis unavailable');
      clip.words = result.words || []; clip.speechState = 'done'; clip.speechError = '';
      if (clip.status === 'ready') {
        clip.moments = boostMoments(clip, findMoments(clip.interest, clip.usableEnd, { words: clip.words, scenes: clip.scenes, quality: clip.quality }));
        replanSoon();
      }
    } catch (error) {
      clip.speechState = 'failed'; clip.speechError = error.message;
      console.warn('Speech analysis:', error.message);
      toast(`${clip.name}: speech analysis unavailable; using visual moments. ${error.message}`, true);
    } finally { clip.speechPromise = null; renderClipsSoon(); }
  })();
  return clip.speechPromise;
}
function queueAllSpeech() { state.clips.filter(c => c.status === 'ready').forEach(c => { if (c.speechState !== 'done') analyzeSpeech(c); }); }

let clipDragId = null;
function moveClip(id, targetId, after) {
  if (id === targetId) return;
  const c = state.clips.find((x) => x.id === id);
  if (!c) return;
  const rest = state.clips.filter((x) => x !== c);
  let at = rest.findIndex((x) => x.id === targetId);
  if (at < 0) return;
  if (after) at++;
  rest.splice(at, 0, c);
  if (rest.every((x, k) => x === state.clips[k])) { renderClips(); return; }
  state.clips = rest;
  renderClips(); replanAll();
  if (state.variants.some((_, i) => eff(i).order === 'story')) toast('Clip order changed: the "In order" edits follow it');
}
function removeClip(id) {
  const c = state.clips.find((x) => x.id === id);
  if (!c) return;
  state.clips = state.clips.filter((x) => x !== c);
  player.dropClip(id);
  if (c.url && c.url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(c.url), 2000);
  renderClips(); renderStatus(); replanAll(); updateEmpty();
}

// ---- clip trim: pick where each clip starts and how long a part of it the edits may use (like the song window) ----
let trimDrag = null, trimRenderPending = false;
const clipFull = (c) => Math.max(0.5, Math.min(c.duration || 0, c.usableEnd ?? c.duration ?? 0));
const clipTrim = (c) => { const f = clipFull(c); return c.trim ? [Math.max(0, c.trim[0]), Math.min(f, c.trim[1])] : [0, f]; };
const fmtT = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
function parseT(v) {
  const p = String(v).trim().split(':').map(Number);
  if (p.some((x) => !Number.isFinite(x))) return NaN;
  return p.reduce((acc, x) => acc * 60 + x, 0);
}
function setTrim(c, a, b) {
  const f = clipFull(c), len = Math.max(0.5, Math.min(f, b - a));
  a = Math.max(0, Math.min(f - len, a)); b = a + len;
  c.trim = a < 0.05 && b > f - 0.05 ? null : [Math.round(a * 10) / 10, Math.round(b * 10) / 10];
}
function trimRow(c) {
  const [a, b] = clipTrim(c), whole = !c.trim;
  return `<div class="trimrow">
    <label>start <input class="tr-a" aria-label="Start of ${esc(c.name)}" value="${fmtT(a)}" spellcheck="false"></label>
    <label>for <input class="tr-l" aria-label="Length of ${esc(c.name)} in seconds" type="number" min="0.5" max="${clipFull(c).toFixed(1)}" step="0.5" value="${(b - a).toFixed(1)}">s</label>
    <button class="small tr-best" title="Pick the most action-packed part of this length">Best</button>
    <button class="small tr-all ${whole ? 'primary' : ''}" title="Use the whole clip">Whole</button></div>
    ${partsRow(c)}`;
}
// ---- hover a clip's picture in the list: it plays, muted, in a bigger window next to the sidebar ----
const hoverPv = document.createElement('div');
hoverPv.className = 'hover-pv'; hoverPv.hidden = true;
hoverPv.innerHTML = '<video muted playsinline preload="auto"></video><small></small>';
document.body.appendChild(hoverPv);
const hpVideo = hoverPv.querySelector('video');
let hpTimer = 0, hpClip = null, hpLoop = null;
function showClipHover(c, thumb) {
  hpClip = c;
  const r = thumb.getBoundingClientRect(), side = document.querySelector('.side').getBoundingClientRect();
  const w = c.w && c.h < c.w ? 340 : 220; // wide clips get a wider window, tall ones a narrower (taller) one
  hoverPv.style.width = w + 'px';
  hoverPv.style.left = side.right + 10 + 'px';
  const h = c.w ? Math.min(380, w * c.h / c.w) : w * 9 / 16;
  hoverPv.style.top = Math.max(64, Math.min(innerHeight - h - 12, r.top + r.height / 2 - h / 2)) + 'px';
  // play from the clip's best moment (or the start of the part you kept), 5 seconds on a loop
  const [a, b] = clipTrim(c), best = c.moments?.[0]?.t;
  const from = best != null && best >= a && best < b ? Math.max(a, best - 1) : a;
  hpLoop = [from, Math.min(b, from + 5)];
  const url = c.previewUrl || c.url;
  if (hpVideo.dataset.src !== url) { hpVideo.src = url; hpVideo.dataset.src = url; }
  hpVideo.currentTime = from;
  hpVideo.play().catch(() => {});
  hoverPv.querySelector('small').textContent = `Preview from ${fmt(from)}`;
  hoverPv.hidden = false;
}
function hideClipHover() { clearTimeout(hpTimer); hpClip = null; hoverPv.hidden = true; try { hpVideo.pause(); } catch {} }
hpVideo.addEventListener('timeupdate', () => { if (hpLoop && hpVideo.currentTime >= hpLoop[1]) hpVideo.currentTime = hpLoop[0]; });
$('#clipList').addEventListener('mouseover', (e) => {
  const th = e.target.closest('.clip .thumb'); if (!th) return;
  const c = state.clips.find((x) => x.id === th.closest('.clip').dataset.id);
  if (!c || c === hpClip || !(c.previewUrl || c.url) || c.photo) return;
  clearTimeout(hpTimer);
  hpTimer = setTimeout(() => showClipHover(c, th), 250);
});
$('#clipList').addEventListener('mouseout', (e) => {
  const th = e.target.closest('.clip .thumb'); if (!th || th.contains(e.relatedTarget)) return;
  hideClipHover();
});

// ---- frame a clip by hand: drag the box (what the edit shows) over the whole picture, zoom in ----
// cropX / cropY = the box's center as a share of the picture; the box is the edit's shape, made smaller by the zoom
function cropBox(c) {
  const va = c.w / c.h, oa = aspect(), z = Math.max(1, Number(c.cropZoom) || 1);
  const bw = Math.min(1, oa / va) / z, bh = Math.min(1, va / oa) / z;
  const cx = Math.min(1 - bw / 2, Math.max(bw / 2, c.cropX ?? 0.5)), cy = Math.min(1 - bh / 2, Math.max(bh / 2, c.cropY ?? 0.5));
  return { bw, bh, cx, cy };
}
function initCropPad(li, c) {
  const pad = li.querySelector('.crop-pad'); if (!pad) return;
  const frame = pad.querySelector('.cp-frame'), box = pad.querySelector('.cp-box'), zoom = pad.querySelector('.cp-zoom');
  const redraw = () => player.views.forEach((v) => { if (v) v.dirty = true; });
  const place = () => {
    const b = cropBox(c);
    c.cropX = b.cx; c.cropY = b.cy; // keep the stored center inside the picture
    Object.assign(box.style, { left: `${(b.cx - b.bw / 2) * 100}%`, top: `${(b.cy - b.bh / 2) * 100}%`, width: `${b.bw * 100}%`, height: `${b.bh * 100}%` });
    pad.querySelector('.cp-z').textContent = `${(Number(c.cropZoom) || 1).toFixed(2).replace(/0$/, '')}×`;
  };
  let drag = null;
  frame.addEventListener('pointerdown', (e) => {
    const r = frame.getBoundingClientRect(), b = cropBox(c);
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    // grab the box to move it, or click anywhere to put the box there
    const inside = Math.abs(px - b.cx) < b.bw / 2 && Math.abs(py - b.cy) < b.bh / 2;
    drag = { ox: inside ? b.cx - px : 0, oy: inside ? b.cy - py : 0, r };
    if (!inside) { c.cropX = px; c.cropY = py; place(); redraw(); }
    frame.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
  });
  frame.addEventListener('pointermove', (e) => {
    if (!drag) return;
    c.cropX = (e.clientX - drag.r.left) / drag.r.width + drag.ox; c.cropY = (e.clientY - drag.r.top) / drag.r.height + drag.oy;
    place(); redraw();
  });
  const up = () => { drag = null; };
  frame.addEventListener('pointerup', up); frame.addEventListener('pointercancel', up);
  frame.addEventListener('wheel', (e) => { e.preventDefault(); c.cropZoom = Math.max(1, Math.min(3, (Number(c.cropZoom) || 1) * Math.exp(-e.deltaY * 0.0015))); zoom.value = c.cropZoom; place(); redraw(); }, { passive: false });
  zoom.addEventListener('input', () => { c.cropZoom = Number(zoom.value); place(); redraw(); });
  pad.querySelector('.cp-center').onclick = () => { c.cropX = 0.5; c.cropY = 0.5; place(); redraw(); };
  place();
}

// ---- cut a clip into parts and pick which parts go together (the others are skipped) ----
let cutMode = null; // id of the clip whose strip cuts on click
function partsRow(c) {
  const parts = c.parts || [], cutting = cutMode === c.id;
  return `<div class="partsrow">
    <button class="small tr-cut ${cutting ? 'primary' : ''}" title="${cutting ? 'Done cutting' : 'Then click the strip above where you want to cut'}">${cutting ? 'Done' : 'Cut'}</button>
    ${parts.length > 1
      ? parts.map((p, k) => (p.gone ? '' : `<span class="cpart-g"><button class="clip-part ${p.on ? 'on' : ''}" data-cpart="${k}" title="${p.on ? 'Used. Click to skip this part' : 'Skipped. Click to use this part'}">${parts.slice(0, k).filter((x) => !x.gone).length + 1}<small>${fmtT(p.a)}-${fmtT(p.b)}</small></button><button class="cpart-x" data-cpart-del="${k}" title="Delete this part from the video" aria-label="Delete part ${fmtT(p.a)} to ${fmtT(p.b)}">×</button></span>`)).join('')
        + (parts.some((p) => p.gone) ? `<button class="small tr-restore" title="Bring the deleted parts back">Restore ${parts.filter((p) => p.gone).length} deleted</button>` : '')
        + '<button class="small tr-uncut" title="Join the parts back into one clip">Uncut</button>'
      : `<small>${cutting ? 'Click the strip to cut. Each click makes a new part.' : 'Cut the clip into parts, then pick the parts to use'}</small>`}
  </div>`;
}
function addCut(c, t) {
  const f = clipFull(c);
  c.parts ||= [{ a: 0, b: Math.round(f * 10) / 10, on: true }];
  t = Math.round(t * 10) / 10;
  const k = c.parts.findIndex((p) => !p.gone && t > p.a + 0.29 && t < p.b - 0.29);
  if (k < 0) return false;
  const p = c.parts[k];
  c.parts.splice(k, 1, { a: p.a, b: t, on: p.on }, { a: t, b: p.b, on: p.on });
  return true;
}
function toggleCutPart(c, k) {
  const p = c.parts?.[k]; if (!p || p.gone) return;
  if (p.on && c.parts.filter((x) => x.on).length === 1) return toast('Keep at least one part of the clip');
  p.on = !p.on;
}
// delete one part: it's cut out of the video and leaves the list (Restore brings it back)
function deleteCutPart(c, k) {
  const p = c.parts?.[k]; if (!p || p.gone) return false;
  if (c.parts.filter((x) => !x.gone && x !== p).length === 0 || (p.on && c.parts.filter((x) => x.on).length === 1)) { toast('Keep at least one part of the clip'); return false; }
  p.gone = true; p.on = false;
  toast(`Deleted ${fmtT(p.a)} to ${fmtT(p.b)} from ${c.name}`);
  return true;
}
function bestClipPart(c, len) {
  const f = clipFull(c), iv = c.interest || [], step = 0.5;
  let best = 0, bv = -1;
  for (let s = 0; s + len <= f + 0.001; s += step) {
    let v = 0, k = 0;
    for (let t = s; t < s + len; t += 0.2) { v += iv[Math.floor(t * 10)] || 0; k++; }
    for (const [x, y] of c.stills || []) v -= Math.max(0, Math.min(s + len, y) - Math.max(s, x)) * 5;
    v /= Math.max(1, k);
    if (v > bv) { bv = v; best = s; }
  }
  return best;
}
function initTrim(li, c) {
  const cv = li.querySelector('.heat canvas');
  const draw = () => {
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    cv.width = Math.max(10, Math.round(r.width * dpr)); cv.height = Math.max(10, Math.round(r.height * dpr));
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, f = clipFull(c), [a, b] = clipTrim(c);
    const x0 = (a / f) * W, x1 = (b / f) * W, iv = c.interest || [];
    g.clearRect(0, 0, W, H);
    for (let x = 0; x < W; x += 2) {
      const v = Math.min(1, iv[Math.floor(((x / W) * f) * 10)] || 0), inWin = x >= x0 && x <= x1;
      const h = Math.max(2 * dpr, (0.25 + 0.75 * v) * H * 0.8);
      g.fillStyle = inWin ? accentRGBA(0.35 + 0.65 * v) : `rgba(168,165,157,${0.18 + 0.3 * v})`;
      g.fillRect(x, (H - h) / 2, 1.4 * dpr, h);
    }
    for (const [s, e] of c.stills || []) { g.fillStyle = 'rgba(255,93,108,0.35)'; g.fillRect((s / f) * W, H - 2 * dpr, ((e - s) / f) * W, 2 * dpr); }
    g.fillStyle = accentRGBA(0.10); g.fillRect(x0, 0, x1 - x0, H);
    g.strokeStyle = accentHex(); g.lineWidth = 1.5 * dpr; g.strokeRect(x0 + 0.75 * dpr, 0.75 * dpr, Math.max(1, x1 - x0 - 1.5 * dpr), H - 1.5 * dpr);
    g.fillStyle = accentHex(); g.fillRect(x0, 0, 3 * dpr, H); g.fillRect(x1 - 3 * dpr, 0, 3 * dpr, H);
    // cut parts: skipped parts dimmed and striped, deleted parts blacked out with a red edge, a white line at every cut
    for (const p of c.parts || []) {
      if (p.gone) {
        const px0 = (p.a / f) * W, px1 = (p.b / f) * W;
        g.fillStyle = 'rgba(10,10,10,0.92)'; g.fillRect(px0, 0, px1 - px0, H);
        g.fillStyle = '#ff5a3d'; g.fillRect(px0, H - 2 * dpr, px1 - px0, 2 * dpr);
      } else if (!p.on) {
        const px0 = (p.a / f) * W, px1 = (p.b / f) * W;
        g.fillStyle = 'rgba(21,21,21,0.78)'; g.fillRect(px0, 0, px1 - px0, H);
        g.strokeStyle = 'rgba(242,240,234,0.35)'; g.lineWidth = 1 * dpr;
        for (let x = px0 - H; x < px1; x += 6 * dpr) { g.beginPath(); g.moveTo(Math.max(px0, x), Math.min(H, H - (Math.max(px0, x) - x))); g.lineTo(Math.min(px1, x + H), Math.max(0, H - (Math.min(px1, x + H) - x))); g.stroke(); }
      }
      if (p.a > 0.01) { g.fillStyle = '#f2f0ea'; g.fillRect((p.a / f) * W - dpr, 0, 2 * dpr, H); }
    }
  };
  const inA = li.querySelector('.tr-a'), inL = li.querySelector('.tr-l');
  const showVals = () => { const [a, b] = clipTrim(c); inA.value = fmtT(a); inL.value = (b - a).toFixed(1); li.querySelector('.tr-all').classList.toggle('primary', !c.trim); };
  const done = () => { showVals(); draw(); replanAll(); };
  cv.title = cutMode === c.id ? 'Click where you want to cut the clip' : 'Drag the window to pick where this clip starts, drag its edges to change the length';
  cv.addEventListener('pointerdown', (e) => {
    if (cutMode === c.id) {
      // cutting: each click splits the clip there
      const r = cv.getBoundingClientRect();
      if (addCut(c, ((e.clientX - r.left) / r.width) * clipFull(c))) { renderClips(); replanAll(); } else toast('Too close to another cut');
      e.preventDefault(); return;
    }
    const r = cv.getBoundingClientRect(), f = clipFull(c), [a, b] = clipTrim(c);
    const t = ((e.clientX - r.left) / r.width) * f, px = (s) => r.left + (s / f) * r.width;
    const edge = Math.abs(e.clientX - px(a)) <= 7 ? 'a' : Math.abs(e.clientX - px(b)) <= 7 ? 'b' : null;
    if (!edge && (t < a || t > b)) setTrim(c, t - (b - a) / 2, t + (b - a) / 2); // jump the window here
    const [a1, b1] = clipTrim(c);
    trimDrag = { x: e.clientX, edge, a: a1, b: b1, w: r.width, f };
    cv.setPointerCapture(e.pointerId); showVals(); draw(); e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect(), f = clipFull(c);
    if (cutMode === c.id) { cv.style.cursor = 'crosshair'; return; }
    if (!trimDrag) { const [a, b] = clipTrim(c), d = (s) => Math.abs(e.clientX - (r.left + (s / f) * r.width)); cv.style.cursor = d(a) <= 7 || d(b) <= 7 ? 'ew-resize' : 'grab'; return; }
    const dt = ((e.clientX - trimDrag.x) / trimDrag.w) * trimDrag.f, { a, b } = trimDrag;
    if (trimDrag.edge === 'a') setTrim(c, Math.min(b - 0.5, Math.max(0, a + dt)), b);
    else if (trimDrag.edge === 'b') setTrim(c, a, Math.max(a + 0.5, Math.min(f, b + dt)));
    else setTrim(c, a + dt, b + dt);
    showVals(); draw();
  });
  const up = () => { if (!trimDrag) return; trimDrag = null; done(); if (trimRenderPending) { trimRenderPending = false; renderClips(); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  // a new start keeps the length when it fits, otherwise the part runs to the end of the clip
  inA.addEventListener('change', () => { const t = parseT(inA.value), [a, b] = clipTrim(c), f = clipFull(c); if (Number.isFinite(t)) { const s = Math.max(0, Math.min(f - 0.5, t)); setTrim(c, s, Math.min(f, s + (b - a))); } done(); });
  inL.addEventListener('change', () => { const L = Number(inL.value), [a] = clipTrim(c); if (L > 0) setTrim(c, a, a + L); done(); });
  for (const inp of [inA, inL]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  li.querySelector('.tr-all').onclick = () => { c.trim = null; done(); };
  li.querySelector('.tr-cut').onclick = () => { cutMode = cutMode === c.id ? null : c.id; renderClips(); };
  li.querySelectorAll('[data-cpart]').forEach((btn) => (btn.onclick = () => { toggleCutPart(c, Number(btn.dataset.cpart)); renderClips(); replanAll(); }));
  li.querySelectorAll('[data-cpart-del]').forEach((btn) => (btn.onclick = () => { if (deleteCutPart(c, Number(btn.dataset.cpartDel))) { renderClips(); replanAll(); } }));
  const restore = li.querySelector('.tr-restore');
  if (restore) restore.onclick = () => { for (const p of c.parts) if (p.gone) { delete p.gone; p.on = true; } renderClips(); replanAll(); };
  const uncut = li.querySelector('.tr-uncut');
  if (uncut) uncut.onclick = () => { delete c.parts; cutMode = null; renderClips(); replanAll(); };
  li.querySelector('.tr-best').onclick = () => { const [a, b] = clipTrim(c), L = !c.trim ? Math.min(clipFull(c), Math.max(5, Number(state.settings.length) || 15)) : b - a, s = bestClipPart(c, L); setTrim(c, s, s + L); done(); };
  requestAnimationFrame(draw);
}
function renderClips() {
  if (trimDrag) { trimRenderPending = true; return; } // keep the trim bar alive while it's being dragged
  const ul = $('#clipList');
  ul.innerHTML = '';
  for (const c of state.clips) {
    const li = document.createElement('li');
    li.className = 'clip ' + c.status;
    const dur = c.duration ? fmt(c.duration).replace(/\.\d$/, '') : '';
    // the clip's shape differs from the edit's (a 9:16 clip in a 16:9 edit, or the other way round): it gets cropped,
    // so you can choose which part shows
    const canCrop = c.status === 'ready' && c.w && state.variants.some((_, i) => Math.abs(Math.log(aspectOf(i) / (c.w / c.h))) > 0.03 && eff(i).framing === 'fill');
    li.innerHTML = `
      <div class="thumb" style="${c.thumb ? `background-image:url(${c.thumb})` : ''}"><span class="dur">${dur}</span></div>
      <div class="info"><div class="name" title="${esc(c.name)}">${esc(c.name)}</div>
        <div class="sub">${c.status === 'loading' ? esc(c.sub || 'analyzing…') : resBadge(c.w, c.h) + esc(c.sub || '')}${c.audioBuffer ? ', audio' : ''}${trackLabel(c)}${crowdLabel(c)}${c.speechState === 'done' ? (c.words?.length ? ', speech timed' : ', no speech') : c.speechState === 'failed' ? ', speech unavailable' : ''}</div>
        <div class="heat ${c.status === 'ready' ? 'trim' : ''}"><canvas width="200" height="4"></canvas></div></div>
      <button class="x" title="Remove">×</button>
      ${c.status === 'ready' && c.duration ? trimRow(c) : ''}
      ${canCrop ? `<div class="crop"><span>Framing</span><button class="small ${!c.manualCrop ? 'primary' : ''}" data-crop="auto">Auto</button><button class="small ${c.manualCrop ? 'primary' : ''}" data-crop="manual" title="Choose which part of the clip shows">Move &amp; zoom</button></div>
        ${c.manualCrop ? `<div class="crop-pad">
          <div class="cp-frame" style="aspect-ratio:${c.w} / ${c.h};${c.still || c.thumb ? `background-image:url(${c.still || c.thumb})` : ''}" title="Drag the box to the part you want to show"><i class="cp-box"></i></div>
          <div class="cp-ctl"><label>Zoom <b class="cp-z">${(Number(c.cropZoom) || 1).toFixed(2).replace(/0$/, '')}×</b><input class="cp-zoom" type="range" min="1" max="3" step="0.05" value="${Number(c.cropZoom) || 1}" aria-label="Zoom for ${esc(c.name)}"></label>
            <button class="small cp-center">Center</button></div>
          <small class="cp-note">The box is what every take shows of this clip (shape of the ${esc(state.settings.format)} format).</small></div>` : ''}` : ''}`;
    li.querySelector('.x').onclick = () => removeClip(c.id);
    // drag a clip up/down to change the order ("In order" edits play the list top to bottom)
    li.dataset.id = c.id;
    li.draggable = state.clips.length > 1;
    if (state.clips.length > 1) li.title = 'Drag to change the clip order';
    li.addEventListener('dragstart', (e) => {
      if (e.target.closest && e.target.closest('input, button')) { e.preventDefault(); return; }
      clipDragId = c.id; li.classList.add('dragging-clip');
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-cutsona-clip', c.id);
    });
    li.addEventListener('dragend', () => { clipDragId = null; ul.querySelectorAll('.clip').forEach((x) => x.classList.remove('dragging-clip', 'drop-before', 'drop-after')); });
    li.addEventListener('dragover', (e) => {
      if (!clipDragId || clipDragId === c.id) return;
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
      const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      ul.querySelectorAll('.clip').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      li.classList.add(after ? 'drop-after' : 'drop-before');
    });
    li.addEventListener('drop', (e) => {
      if (!clipDragId) return;
      e.preventDefault(); e.stopPropagation();
      const r = li.getBoundingClientRect();
      moveClip(clipDragId, c.id, e.clientY > r.top + r.height / 2);
      clipDragId = null;
    });
    li.querySelectorAll('[data-crop]').forEach(button => { button.onclick = () => {
      c.manualCrop = button.dataset.crop === 'manual';
      player.views.forEach(v => { if (v) v.dirty = true; }); renderClips();
    }; });
    if (c.manualCrop) initCropPad(li, c);
    // don't let a trim / input drag start moving the whole clip
    li.addEventListener('pointerdown', (e) => { li.draggable = state.clips.length > 1 && !(e.target.closest && e.target.closest('input, button, canvas, select, .crop-pad')); });
    if (c.status === 'ready' && c.duration) initTrim(li, c);
    else if (c.interest) {
      const cv = li.querySelector('.heat canvas'), g = cv.getContext('2d');
      for (let x = 0; x < 200; x++) {
        const v = c.interest[Math.floor((x / 200) * c.interest.length)] || 0;
        g.fillStyle = accentRGBA(0.12 + 0.88 * Math.min(1, v) ** 1.5);
        g.fillRect(x, 0, 1, 4);
      }
    }
    ul.appendChild(li);
  }
  $('#clipDrop').classList.toggle('compact', state.clips.length > 0);
}

function setAnalyzing(text) {
  const a = $('#analyzing');
  a.hidden = !text;
  if (text) $('#analyzingText').textContent = text;
}

// ---------------- music ----------------
async function setMusic(file) {
  try {
    toast('Detecting beats…');
    $('#musicDrop').querySelector('b').textContent = 'Analyzing ' + file.name + '…';
    const ab = await file.arrayBuffer();
    const buffer = await decodeAudio(ab);
    await sleep(20);
    const analysis = analyzeMusic(buffer);
    state.music = { name: file.name, buffer, analysis };
    if (!state.clipVolTouched) { state.settings.clipVol = 0.2; syncInputs(); }
    applyBeatOffset();
    const L = Math.min(currentLength(), buffer.duration);
    state.musicStart = suggestWindow(analysis, L);
    $('#musicBox').hidden = false;
    $('#musicDrop').hidden = true;
    $('#btnRemoveMusic').hidden = false;
    $('#musicName').textContent = '♪ ' + file.name.replace(/\.[^.]+$/, '');
    $('#bpm').textContent = `${Math.round(analysis.bpm)} BPM, ${analysis.impacts.length} drops/hits`;
    renderStatus(); drawWave(); replanAll();
    toast(`Locked to ${Math.round(analysis.bpm)} BPM`);
  } catch (e) {
    console.error(e);
    toast('Could not read that song: ' + e.message, true);
    $('#musicDrop').querySelector('b').textContent = 'Drop a song';
  }
}
function removeMusic() {
  state.music = null;
  state.musicAnalysis = syntheticMusic(130, 120);
  state.musicStart = 0;
  if (!state.clipVolTouched) { state.settings.clipVol = 1; syncInputs(); }
  $('#musicBox').hidden = true; $('#musicDrop').hidden = false; $('#btnRemoveMusic').hidden = true;
  $('#musicDrop').querySelector('b').textContent = 'Drop a song';
  renderStatus(); replanAll();
}
function applyBeatOffset() {
  if (!state.music) return;
  const off = state.beatOffset / 1000;
  const a = state.music.analysis;
  state.musicAnalysis = { ...a, beats: a.beats.map((b) => ({ ...b, t: b.t + off })) };
}

// waveform with draggable window
const wave = $('#wave');
function drawWave() {
  if (!state.music) return;
  const a = state.music.analysis;
  const r = wave.getBoundingClientRect();
  // not laid out yet (panel hidden, sidebar collapsed): drawing now would make a tiny canvas that gets
  // stretched into blurry blocks. The size watcher below draws it once it has a real size.
  if (r.width < 20 || r.height < 8) return;
  const dpr = devicePixelRatio || 1;
  const cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
  if (wave.width !== cw || wave.height !== ch) { wave.width = cw; wave.height = ch; }
  const g = wave.getContext('2d'), W = wave.width, H = wave.height;
  g.clearRect(0, 0, W, H);
  const L = currentLength();
  const x0 = (state.musicStart / a.duration) * W, x1 = ((state.musicStart + L) / a.duration) * W;
  g.fillStyle = accentRGBA(0.10); g.fillRect(x0, 0, x1 - x0, H);
  for (let x = 0; x < W; x += 2) {
    const v = a.wave[Math.floor((x / W) * a.wave.length)] || 0;
    const e = a.energy[Math.floor((x / W) * a.energy.length)] || 0;
    const inWin = x >= x0 && x <= x1;
    g.fillStyle = inWin ? accentRGBA(0.55 + 0.45 * e) : `rgba(168,165,157,${0.25 + 0.3 * e})`;
    const h = Math.max(1, v * H * 0.8);
    g.fillRect(x, (H - h) / 2, 1.4 * dpr, h);
  }
  g.strokeStyle = accentHex(); g.lineWidth = 1.5 * dpr;
  g.strokeRect(x0 + 1, 1, x1 - x0 - 2, H - 2);
  if (player && player.playing) {
    const px = ((state.musicStart + player.now()) / a.duration) * W;
    g.fillStyle = '#fff'; g.fillRect(px, 0, 1.5 * dpr, H);
  }
}
new ResizeObserver(() => drawWave()).observe(wave);
let dragWin = null;
wave.addEventListener('dragstart', (e) => e.preventDefault());
wave.addEventListener('pointerdown', (e) => {
  if (!state.music) return;
  e.preventDefault();
  const r = wave.getBoundingClientRect();
  const a = state.music.analysis, L = currentLength();
  const t = ((e.clientX - r.left) / r.width) * a.duration;
  const inside = t >= state.musicStart && t <= state.musicStart + L;
  dragWin = { x: e.clientX, start: inside ? state.musicStart : Math.max(0, Math.min(a.duration - L, t - L / 2)) };
  state.musicStart = dragWin.start;
  wave.setPointerCapture(e.pointerId); drawWave();
});
wave.addEventListener('pointermove', (e) => {
  if (!dragWin) return;
  const r = wave.getBoundingClientRect(), a = state.music.analysis, L = currentLength();
  const dt = ((e.clientX - dragWin.x) / r.width) * a.duration;
  state.musicStart = Math.max(0, Math.min(a.duration - L, dragWin.start + dt));
  drawWave();
});
wave.addEventListener('pointerup', () => {
  if (!dragWin) return;
  dragWin = null;
  const downs = state.music.analysis.beats.filter((b) => b.down);
  let best = state.musicStart, bd = Infinity;
  for (const b of downs) { const d = Math.abs(b.t - state.musicStart); if (d < bd) { bd = d; best = b.t; } }
  state.musicStart = Math.max(0, best);
  drawWave(); replanAll(); player.seek(0);
});
// "Match clip": exactly as long as the usable video (the part you kept, minus frozen / blank stretches)
function usableSeconds(c) {
  const v = trimView(c), a = v.trimIn || 0, b = Math.min(v.duration || 0, v.usableEnd ?? v.duration ?? 0);
  let d = Math.max(0, b - a);
  for (const [s, e] of v.stills || []) d -= Math.max(0, Math.min(e, b) - Math.max(s, a));
  return Math.max(0, d);
}
function matchLength() {
  const t = state.clips.filter((c) => c.status === 'ready').reduce((sum, c) => sum + usableSeconds(c), 0);
  return Math.max(2, Math.min(180, Math.round((t || 15) * 10) / 10));
}
function currentLength() {
  const L = state.settings.length === 'match' ? matchLength() : Number(state.settings.length);
  return state.music ? Math.min(L, state.music.buffer.duration) : L;
}

// ---------------- planning ----------------
// source windows a plan uses, per clip (so the other edits can pick different footage)
function windowsOf(plan, out) {
  if (!plan) return out;
  for (const s of plan.segments) (out[s.clip] ||= []).push([s.srcStart, s.srcStart + Math.max(0.05, s.srcDur)]);
  return out;
}
// ---- stream clips: the takes are the best highlights (🎲 on a card = the next best one) ----
let hiCache = { key: '', list: [] };
function streamHighlights(ready) {
  const s = state.settings;
  const key = [s.streamLen, ...ready.map((c) => `${c.id}:${c.words?.length || 0}:${c.crowdState || ''}:${c.track ? 1 : 0}:${(c.trim || []).join('-')}:${partsKey(c)}`)].join('|');
  if (hiCache.key !== key) {
    for (const c of ready) if (c.track && !c.cam) c.cam = findCam(c);
    // "Match clip": every clip in full (dead video at the ends cut off), else the best highlights up to the max length
    hiCache = { key, list: s.streamLen === 'match' ? wholeHighlights(ready.map(trimView)) : findHighlights(ready.map(trimView), { count: 16, maxLen: Number(s.streamLen) || 30 }) };
  }
  return hiCache.list;
}
function streamPlan(i, ready) {
  const v = state.variants[i], s = state.settings, list = streamHighlights(ready);
  if (!list.length) { v.plan = null; return; }
  const k = i + state.variants.length * (v.hiSkip || 0), h0 = list[k % list.length];
  // fewer highlights than cards: the extra cards are other versions of them (other layout, a short cut)
  const version = Math.floor(k / list.length) % 4, clip = ready[h0.ci];
  const canFlip = !v.custom.layout && s.streamLayout === 'auto' && clip.cam?.steady && !clip.cam.full;
  // with a facecam: whole / other layout / short / short + other layout
  // without one:    whole / short / quick / longer (more of the build-up)
  // (every version is one continuous piece unless "Cut pauses" is on)
  // "Match clip": every take runs the clip's whole length; only the layout can differ
  const V = s.streamLen === 'match' ? ['whole', canFlip ? version % 2 : 0]
    : canFlip ? [['whole', 0], ['whole', 1], ['short', 0], ['short', 1]][version] : [['whole', 0], ['short', 0], ['quick', 0], ['long', 0]][version];
  const tv = trimView(clip);
  const cut = V[0] === 'short' ? tightCut(h0, tv, 0.55, 'shorter') : V[0] === 'quick' ? tightCut(h0, tv, 0.38, 'quickest') : V[0] === 'long' ? longCut(h0, tv, Number(s.streamLen) || 30) || tightCut(h0, tv, 0.75, 'trimmed') : null;
  const hv = cut || h0, cutPauses = s.streamCuts === 'pauses';
  const pieces = keepParts(cutPauses ? hv.pieces : [[hv.a, hv.b]], partsOff(clip));
  const h = { ...hv, pieces: pieces.length ? pieces : [[hv.a, hv.b]], punches: s.reactZoom === 'on' ? hv.punches : [] };
  // the banner name: what you typed, else the channel the clip came from (your own files have none)
  const b = clip.crowd?.brain, typed = String(s.bannerName || '').trim().replace(/^@/, '');
  const plat = s.bannerPlatform && s.bannerPlatform !== 'auto' ? s.bannerPlatform : b?.platform || (typed ? 'twitch' : '');
  const opts = { outAspect: aspectOf(i), channel: typed || b?.name || '', platform: plat };
  v.plan = planHighlight(h, ready, { ...opts, layout: v.custom.layout || s.streamLayout });
  if (V[1] && canFlip) {
    const other = v.plan.highlight.layout === 'stack' ? 'full' : 'stack';
    v.plan = planHighlight({ ...h, why: h.why + (other === 'stack' ? ', cam on top' : ', full frame') }, ready, { ...opts, layout: other });
  }
  v.plan.highlight.rank = list.indexOf(h0) + 1;
  applyCutEdits(v);
  attachCutFraming(v);
}
function replan(i, alsoAvoid = null) {
  const ready = state.clips.filter((c) => c.status === 'ready');
  state.planClips = ready;
  const v = state.variants[i];
  if (!ready.length) { v.plan = null; return; }
  if (isStream()) { streamPlan(i, ready); return; }
  const L = currentLength();
  if (state.music) state.musicStart = Math.max(0, Math.min(state.musicStart, state.music.buffer.duration - L));
  const e = eff(i);
  // every edit shows different moments: avoid what the other edits (and, on a re-roll, this edit's last take) already use
  const avoid = [];
  state.variants.forEach((o, j) => { if (j !== i) windowsOf(o.plan, avoid); });
  if (alsoAvoid) windowsOf(alsoAvoid, avoid);
  v.plan = planEdit({ clips: ready, music: state.musicAnalysis, musicStart: state.music ? state.musicStart : 0, length: L, styleId: v.styleId, seed: v.seed,
    pacing: Number(e.pacing), noSpeed: e.speed === 'off', preserveSpeech: Number(e.clipVol) > 0.05 || e.captions === 'on' || e.pick === 'quotes',
    off: v.custom.off || [], avoid, mode: e.pick || 'auto', order: e.order === 'story' ? 'story' : 'scattered' });
  applyCutEdits(v);
  attachCutFraming(v);
}
// Framing set in the shot editor belongs to one cut of one edit. It is remembered per edit by
// clip + source moment, so the same cut keeps it when the edit is re-planned (effects ticked, etc.).
const cutKey = (seg) => { const c = state.planClips[seg.clip]; return c ? `${c.id}@${seg.srcStart.toFixed(2)}` : ''; };
function attachCutFraming(v) {
  if (!v.plan || !v.cutFrames) return;
  for (const s of v.plan.segments) { const f = v.cutFrames.get(cutKey(s)); if (f) s.framing = f; }
}
function saveCutFraming(seg, entry) {
  const v = state.variants[state.focused];
  v.cutFrames ||= new Map();
  const k = cutKey(seg);
  if (entry) v.cutFrames.set(k, entry); else v.cutFrames.delete(k);
}

// ---- deleting and replacing single cuts (shot editor) ----
// Remembered per edit by the cut's ORIGINAL clip + source moment (like the framing), so they survive a re-plan.
// Delete: the cut is taken out and everything after it slides earlier (the edit gets that much shorter).
// Replace: same place and length in the edit, different footage (the best moment no other cut of this edit uses).
const segUse = (s) => Math.max(s.srcDur || 0, srcOffset(s, s.end - s.start));
// Each cut gets a key the first time a fresh plan is looked at: clip + source moment + which repeat of that
// moment it is (beat edits often reuse the same moment several times, e.g. stutters), so one cut is one key.
function ensureCutKeys(P) {
  if (!P || P.segments.every((s) => s.ek)) return;
  const seen = new Map();
  for (const s of P.segments) {
    const base = cutKey(s), n = seen.get(base) || 0;
    seen.set(base, n + 1);
    s.ek ||= `${base}#${n}`;
  }
}
function applyCutEdits(v) {
  const ed = v.cutEdits, P = v.plan;
  if (!P) return;
  ensureCutKeys(P);
  if (!ed?.size && !P.base) return;
  // always rebuilt from the plan as it was made, so undoing a delete / replace is exact
  P.base ||= { segments: P.segments.slice(), duration: P.duration, beats: P.beats };
  const base = P.base.segments, out = [];
  const allGone = base.every((s) => ed?.get(s.ek)?.del); // never delete every cut
  const inserts = [...(ed || [])].filter(([, e]) => e?.ins);
  let shift = 0;
  for (const s of base) {
    const e = ed?.get(s.ek);
    if (e?.del && !allGone) shift += s.end - s.start;
    else {
      let n = shift ? { ...s, start: s.start - shift, end: s.end - shift } : s;
      if (e?.swap) {
        const ci = state.planClips.findIndex((c) => c.id === e.swap.clipId);
        if (ci >= 0 && (n.clip !== ci || Math.abs(n.srcStart - e.swap.srcStart) > 0.001)) {
          n = { ...n, clip: ci, srcStart: e.swap.srcStart, swapped: true, speech: false, voice: false, framing: undefined, reason: 'Replaced by you' };
        }
      }
      out.push(n);
    }
    // cuts you added ("Add clip") right after this one: everything after them moves later
    for (const [k, x] of inserts) {
      if (x.ins.after !== s.ek) continue;
      const ci = state.planClips.findIndex((c) => c.id === x.ins.clipId);
      if (ci < 0) continue;
      const at = out.length ? out[out.length - 1].end : 0, d = x.ins.dur;
      out.push({ ...s, start: at, end: at + d, clip: ci, srcStart: x.ins.srcStart, srcDur: d, profile: { type: 'const', r: 1 }, speech: false, voice: false,
        framing: undefined, swapped: false, inserted: true, impact: false, ek: k, reason: 'Added by you' });
      shift -= d;
    }
  }
  // decoders: a cut from the same clip right before or after this one gets the other deck
  out.forEach((s, k) => {
    if (!s.swapped && !s.inserted) return;
    const near = [out[k - 1], out[k + 1]].filter((o) => o && o.clip === s.clip).map((o) => o.deck);
    s.deck = [0, 1, 2].find((d) => !near.includes(d)) ?? 0;
  });
  P.segments = out;
  P.duration = Math.max(0.1, P.base.duration - shift);
  P.beats = (P.base.beats || []).filter((b) => b.t <= P.duration + 0.01);
}
// other moments that could fill this cut: same length, not frozen, not used by any other cut of this edit.
// Ranked by how much moves on screen (the clip's motion curve), with the clip's general interest as a tie-breaker.
function replaceOptions(v, seg) {
  const need = Math.max(0.2, segUse(seg)), used = v.plan.segments.filter((s) => s !== seg).map((s) => [s.clip, s.srcStart, s.srcStart + segUse(s)]);
  const opts = [];
  state.planClips.forEach((c, ci) => {
    const tv = trimView(c), a0 = tv.trimIn || 0, b0 = Math.min(c.duration || 0, tv.usableEnd ?? c.duration ?? 0), iv = c.interest || [], mc = c.motionCurve;
    for (let s = a0; s + need <= b0 + 1e-3; s += Math.max(0.25, need / 2)) {
      if (ci === seg.clip && Math.abs(s - seg.srcStart) < need) continue;
      if (used.some(([uc, ua, ub]) => uc === ci && s < ub && s + need > ua)) continue;
      if ((tv.stills || []).some(([x, y]) => s < y && s + need > x)) continue;
      let sc = 0, mv = 0, k = 0;
      for (let t = s; t < s + need; t += 0.1) { const j = Math.floor(t * 10); sc += iv[j] || 0; mv += mc ? mc[j] || 0 : iv[j] || 0; k++; }
      k = Math.max(1, k);
      opts.push({ ci, s: Math.round(s * 100) / 100, motion: mv / k, score: 0.75 * (mv / k) + 0.25 * (sc / k) });
    }
  });
  opts.sort((x, y) => y.score - x.score);
  // spread them out: one option per stretch of a clip
  const picked = [];
  for (const o of opts) if (!picked.some((p) => p.ci === o.ci && Math.abs(p.s - o.s) < Math.max(2, need))) { picked.push(o); if (picked.length >= 30) break; }
  return picked;
}
function deleteCut(seg) {
  const i = state.focused, v = state.variants[i];
  if (!v.plan || v.plan.segments.length <= 1) { toast('An edit needs at least one cut'); return false; }
  ensureCutKeys(v.plan);
  const key = seg.ek, n = v.plan.segments.indexOf(seg) + 1, len = seg.end - seg.start;
  v.cutEdits ||= new Map();
  if (seg.inserted) v.cutEdits.delete(key); // a cut you added: just take it back out
  else v.cutEdits.set(key, { del: true });
  applyCutEdits(v);
  afterCutEdit(i);
  toast(`Cut ${n} deleted: the edit is ${len.toFixed(1)}s shorter (${v.plan.duration.toFixed(1)}s)`);
  return true;
}
// "Add clip": a new cut right after the one at the playhead, a random strong moment from your clips (or the one you pick)
function addCutAt(t, clipId = null) {
  const i = state.focused, v = state.variants[i];
  if (!v.plan?.segments.length) return;
  ensureCutKeys(v.plan);
  v.cutEdits ||= new Map();
  const segs = v.plan.segments;
  let k = segs.findIndex((s) => t >= s.start && t < s.end); if (k < 0) k = segs.length - 1;
  const ref = segs[k], after = ref.inserted ? v.cutEdits.get(ref.ek)?.ins.after : ref.ek;
  if (!after) return;
  const dur = Math.round(Math.max(0.5, Math.min(3, ref.end - ref.start)) * 100) / 100;
  const probe = { ...ref, start: 0, end: dur, srcDur: dur, profile: { type: 'const', r: 1 }, clip: -1, srcStart: -99 };
  let opts = replaceOptions(v, probe);
  if (clipId) opts = opts.filter((o) => state.planClips[o.ci]?.id === clipId);
  if (!opts.length) { toast(clipId ? 'No unused footage of that length left in that clip' : 'No unused footage of that length left'); return; }
  // random among the strongest few, so pressing it again gives something different
  const o = opts[Math.floor(Math.random() * Math.min(6, opts.length))], c = state.planClips[o.ci];
  const key = `ins:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  v.cutEdits.set(key, { ins: { after, clipId: c.id, srcStart: o.s, dur } });
  applyCutEdits(v); attachCutFraming(v); afterCutEdit(i);
  const added = v.plan.segments.find((s) => s.ek === key);
  if (added) { player.pause(); updatePlayIcon(); player.seek(added.start + 0.02); }
  toast(`Added ${dur.toFixed(1)}s of ${c.name} (${fmt(o.s)}) after cut ${k + 1}`);
}
// How much really moves inside [a, b] of a clip: two pairs of frames 0.12s apart, compared pixel by pixel.
// A hard cut between a pair looks like huge movement, so a pair that changes almost completely doesn't count.
const motionVids = new Map(), mcv = document.createElement('canvas');
mcv.width = 64; mcv.height = 36;
const mg = mcv.getContext('2d', { willReadFrequently: true });
async function measureMotion(clip, a, b) {
  const url = clip.previewUrl || clip.url;
  let v = motionVids.get(url);
  if (!v) {
    if (motionVids.size >= 4) { for (const p of motionVids.values()) p.then((old) => { old.removeAttribute('src'); old.load(); }).catch(() => {}); motionVids.clear(); }
    v = loadVideo(url, 15000);
    motionVids.set(url, v);
    v.catch(() => motionVids.delete(url));
  }
  v = await v;
  const frame = async (t) => { await seekV(v, t); mg.drawImage(v, 0, 0, 64, 36); return mg.getImageData(0, 0, 64, 36).data; };
  const dt = Math.min(0.12, Math.max(0.04, (b - a) / 4)), diffs = [];
  for (const t of [a + (b - a) * 0.25, a + (b - a) * 0.65]) {
    const f1 = await frame(t), f2 = await frame(Math.min(b, t + dt));
    let s = 0;
    for (let k = 0; k < f1.length; k += 4) s += Math.abs(f1[k] - f2[k]) + Math.abs(f1[k + 1] - f2[k + 1]) + Math.abs(f1[k + 2] - f2[k + 2]);
    diffs.push(s / (64 * 36 * 765));
  }
  const real = diffs.filter((d) => d < 0.2);
  return real.length ? real.reduce((x, y) => x + y, 0) / real.length : 0;
}
let replacing = false;
async function replaceCut(seg) {
  if (replacing) return false;
  const i = state.focused, v = state.variants[i];
  if (!v.plan) return false;
  ensureCutKeys(v.plan);
  const key = seg.ek, need = segUse(seg);
  v.cutEdits ||= new Map();
  const prev = v.cutEdits.get(key) || {}, tried = new Set(prev.tried || []);
  let opts = replaceOptions(v, seg).filter((o) => !tried.has(`${state.planClips[o.ci].id}@${o.s}`));
  if (!opts.length) { tried.clear(); opts = replaceOptions(v, seg); }
  if (!opts.length) { toast('No other footage of this length to use'); return false; }
  // the motion curve is a rough guide: check the best few for real and take the one that moves the most
  replacing = true;
  toast('Finding a moment with a lot of movement…');
  let o = opts[0];
  try {
    const pool = opts.slice(0, 8);
    for (const x of pool) { try { x.live = await measureMotion(state.planClips[x.ci], x.s, x.s + need); } catch { x.live = null; } }
    const measured = pool.filter((x) => x.live != null).sort((x, y) => y.live - x.live);
    if (measured.length) o = measured[0];
  } finally { replacing = false; }
  if (state.variants[i] !== v || !v.plan || !state.planClips[o.ci]) return false; // the take changed while looking
  const id = state.planClips[o.ci].id;
  tried.add(`${id}@${o.s}`);
  if (seg.inserted && prev.ins) v.cutEdits.set(key, { ins: { ...prev.ins, clipId: id, srcStart: o.s }, tried: [...tried] }); // a cut you added
  else v.cutEdits.set(key, { swap: { clipId: id, srcStart: o.s }, tried: [...tried] });
  applyCutEdits(v);
  afterCutEdit(i);
  toast(`Cut replaced with ${state.planClips[o.ci].name}, ${fmt(o.s)}: the most movement left. Press Replace again for the next one`);
  return true;
}
// put a replaced cut back as the edit planned it
function restoreCut(seg) {
  const i = state.focused, v = state.variants[i], key = seg.swapped ? seg.ek : null;
  if (!key || !v.cutEdits?.has(key)) return false;
  v.cutEdits.delete(key);
  applyCutEdits(v); attachCutFraming(v); afterCutEdit(i);
  toast('The cut\'s own footage is back');
  return true;
}
// bring back every deleted cut of the take you're on
function restoreDeletedCuts() {
  const i = state.focused, v = state.variants[i];
  const dels = [...(v.cutEdits || [])].filter(([, e]) => e.del);
  if (!dels.length) return;
  for (const [k] of dels) v.cutEdits.delete(k);
  applyCutEdits(v); attachCutFraming(v); afterCutEdit(i);
  toast(`${dels.length} deleted cut${dels.length > 1 ? 's' : ''} back in take ${i + 1}`);
}
// deleted cuts of this take's current plan (edits remembered for an older plan don't count)
const deletedCuts = (i) => {
  const v = state.variants[i], P = v?.plan;
  return P?.base && v.cutEdits ? P.base.segments.filter((s) => v.cutEdits.get(s.ek)?.del).length : 0;
};
function afterCutEdit(i) {
  ctxCache = []; updateCards(); player.restartAudio();
  drawTimeline(player.now(), player.duration());
}
function replanAll() {
  // plan in order, so edit 1 gets first pick and the rest go for different footage
  state.variants.forEach((v) => (v.plan = null));
  for (let i = 0; i < state.variants.length; i++) replan(i);
  if (isStream()) refreshEff(); // captions sit above the split line or in the lower third, depending on each card's layout
  updateEmpty(); updateCards(); player.restartAudio();
  $('#btnGenerate').disabled = !state.planClips.length;
  if (!state.planClips.length) {
    // nothing left in Clips: no music or clip sound should keep playing
    player.stop(); player._autostarted = false; updatePlayIcon();
    return;
  }
  if (!player.playing && !player._autostarted) { player._autostarted = true; player.play(); updatePlayIcon(); }
}
const replanSoon = debounce(replanAll, 160);

// ---------------- cards ----------------
const grid = $('#grid');
const cards = [];
const styleOptions = Object.entries(STYLES).filter(([, s]) => !s.hidden).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
const layoutOptions = STREAM_LAYOUTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
// the card's dropdown: a style (edits) or a layout (stream clips)
function syncCardSelect(i) {
  const sel = cards[i]?.querySelector('select');
  if (!sel) return;
  const mode = isStream() ? 'stream' : 'edits';
  if (sel.dataset.mode !== mode) {
    sel.innerHTML = mode === 'stream' ? layoutOptions : styleOptions; sel.dataset.mode = mode; sel.title = mode === 'stream' ? 'Layout' : 'Style';
    cards[i].querySelector('.sl-lbl').textContent = mode === 'stream' ? 'Layout' : 'Style';
  }
  sel.value = mode === 'stream' ? (state.variants[i].custom.layout || 'auto') : state.variants[i].styleId;
}
// One card per take. Takes can be added (up to MAX_TAKES) and removed, so every handler looks up the card's
// current position (idx) instead of remembering a number.
const MAX_TAKES = 10;
function makeCard() {
  const el = document.createElement('div');
  el.className = 'card';
  const idx = () => cards.indexOf(el);
  el.innerHTML = `
    <div class="clapper" aria-hidden="true"></div>
    <div class="card-h">
      <div class="sl-cell sl-take"><small>Take</small><b class="num"></b></div>
      <label class="sl-cell sl-style"><small class="sl-lbl">Style</small><span class="sl-sel"><i class="sw"></i><select title="Style">${styleOptions}</select></span></label>
      <div class="sl-cell sl-len"><small>Length</small><b class="len">-</b></div>
      <button class="icon tunebtn" title="Set up just this take: size, filter, effects, fades, card motion"><svg viewBox="0 0 24 24"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg></button>
      <button class="icon reroll" title="New take of this style (R)"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></button>
      <button class="icon removebtn" title="Remove this take"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="screen"><canvas></canvas><span class="sound">audio from this one</span><span class="custom-tag">custom</span>
      <button class="solobtn" title="Watch just this one big (V): double-click works too"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button></div>
    <div class="parts"></div>
    <div class="parts-pop" hidden></div>
    <div class="card-f"><div class="meta"><span></span></div>
      <button class="regen" title="Regen: a brand-new edit, new style, new effects, new clips and cuts">Regen</button>
      <button class="export">Export</button></div>`;
  grid.insertBefore(el, addTile);
  const sel = el.querySelector('select');
  sel.onchange = () => {
    const i = idx(), v = state.variants[i];
    if (isStream()) {
      if (sel.value === 'auto') delete v.custom.layout; else v.custom.layout = sel.value;
      saveCustom(); replan(i); refreshEff(); updateCards(); if (tuneIndex === i) renderTune();
      return;
    }
    v.styleId = sel.value; v.custom.off = []; applyStyleDefaults(v);
    saveCustom(); saveLineup(); replan(i); updateCards(); if (tuneIndex === i) renderTune();
    if (v.custom.captions === 'on' || v.custom.pick === 'quotes') queueAllSpeech();
  };
  el.querySelector('.reroll').onclick = () => reroll(idx());
  el.querySelector('.regen').onclick = () => regen(idx());
  el.querySelector('.removebtn').onclick = (ev) => { ev.stopPropagation(); removeTake(idx()); };
  // effect tick boxes on the card and in its "all effects" list
  const onChip = (ev) => {
    const i = idx();
    const tog = ev.target.closest('[data-allfx]');
    if (tog) { ev.stopPropagation(); const v = state.variants[i]; v.allOpen = tog.dataset.allfx === 'open'; updateCards(); return; }
    const b = ev.target.closest('[data-kind]'); if (b) { ev.stopPropagation(); toggleCardEffect(i, b.dataset.kind, b.dataset.key); }
  };
  el.querySelector('.parts').onclick = onChip;
  el.querySelector('.parts-pop').onclick = onChip;
  el.querySelector('.tunebtn').onclick = () => { const i = idx(); tuneIndex === i ? closeTune() : openTune(i); };
  el.querySelector('.solobtn').onclick = (ev) => { ev.stopPropagation(); const i = idx(), was = state.solo && state.focused === i; state.focused = i; setSolo(!was); };
  const screen = el.querySelector('.screen');
  screen.onclick = () => { if (!hookDrag?.moved) focusCard(idx()); };
  screen.ondblclick = () => { state.focused = idx(); setSolo(!state.solo); };
  initHookDrag(screen, idx);
  el.querySelector('.export').onclick = () => queueExport(idx());
  cards.push(el);
  return el;
}
// clicking anywhere else closes a card's "all effects" list
document.addEventListener('pointerdown', (ev) => {
  cards.forEach((el, i) => {
    const v = state.variants[i];
    if (v?.allOpen && !el.querySelector('.parts-pop').contains(ev.target) && !ev.target.closest?.('.part.more')) { v.allOpen = false; updateCards(); }
  });
});
// drag the hook text, the watermark or the stream banner around the picture (any take); a plain click still
// picks the take. Every take uses the same spot.
let hookDrag = null;
const LAYERS = {
  wm: { x: 'wmX', y: 'wmY', name: 'Watermark', box: (i) => { const t = textFor(i)?.canvas; return t?.wmBox ? [t.wmBox, t.wmCenter] : null; } },
  hook: { x: 'hookX', y: 'hookY', name: 'Hook text', box: (i) => { const c = hookFor(i)?.canvas; return c?.box ? [c.box, c.center] : null; } },
  banner: { x: 'bannerX', y: 'bannerY', name: 'Banner', box: (i) => { const t = isStream() && textFor(i)?.canvas; return t?.bannerBox ? [t.bannerBox, t.bannerCenter] : null; } },
};
function hookBoxAt(i, ev, screen) {
  const r = screen.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height, pad = 0.015;
  for (const [kind, L] of Object.entries(LAYERS)) {
    const b = L.box(i);
    if (b && x >= b[0][0] - pad && x <= b[0][2] + pad && y >= b[0][1] - pad && y <= b[0][3] + pad) return { kind, x, y, cx: b[1][0], cy: b[1][1] };
  }
  return null;
}
function initHookDrag(screen, idx) {
  screen.addEventListener('pointerdown', (ev) => {
    const i = idx(), hit = hookBoxAt(i, ev, screen);
    if (!hit) return;
    ev.preventDefault();
    hookDrag = { screen, i, kind: hit.kind, x0: hit.x, y0: hit.y, cx: hit.cx, cy: hit.cy, moved: false };
    screen.setPointerCapture(ev.pointerId);
  });
  screen.addEventListener('pointermove', (ev) => {
    if (!hookDrag || hookDrag.screen !== screen) {
      const hit = hookBoxAt(idx(), ev, screen);
      screen.style.cursor = hit ? 'move' : ''; screen.title = hit ? `Drag to move the ${LAYERS[hit.kind].name.toLowerCase()}` : '';
      return;
    }
    const r = screen.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    if (Math.abs(x - hookDrag.x0) + Math.abs(y - hookDrag.y0) > 0.004) hookDrag.moved = true;
    const L = LAYERS[hookDrag.kind];
    state.settings[L.x] = Math.round(Math.min(0.98, Math.max(0.02, hookDrag.cx + x - hookDrag.x0)) * 1000) / 1000;
    state.settings[L.y] = Math.round(Math.min(0.98, Math.max(0.02, hookDrag.cy + y - hookDrag.y0)) * 1000) / 1000;
    refreshEff();
  });
  const end = () => {
    if (!hookDrag || hookDrag.screen !== screen) return;
    const { moved, kind } = hookDrag;
    setTimeout(() => { hookDrag = null; }, 0);
    if (!moved) return;
    saveSettings();
    if (kind === 'hook') renderHookOpts();
    else if (kind === 'wm') renderWmOpts();
    else renderMainLook();
    toast(`${LAYERS[kind].name} moved (every take uses the same spot)`);
  };
  screen.addEventListener('pointerup', end); screen.addEventListener('pointercancel', end);
}
// the "Add take" tile at the end of the takes
const addTile = document.createElement('button');
addTile.className = 'add-take';
addTile.innerHTML = '<span class="plus" aria-hidden="true">+</span><b>Add take</b><small></small>';
addTile.onclick = () => addTake();
grid.appendChild(addTile);
function updateAddTile() {
  const n = state.variants.length;
  addTile.hidden = n >= MAX_TAKES || state.solo;
  addTile.querySelector('small').textContent = `${n} of ${MAX_TAKES}`;
  cards.forEach((el, i) => {
    el.querySelector('.num').textContent = i + 1;
    el.querySelector('.removebtn').hidden = n <= 1;
  });
}
function addTake() {
  if (state.variants.length >= MAX_TAKES) return toast(`Up to ${MAX_TAKES} takes`);
  // a style none of the other takes use yet
  const taken = new Set(state.variants.map((v) => v.styleId));
  const styleId = Object.keys(STYLES).find((k) => !STYLES[k].hidden && !taken.has(k)) || 'beat';
  const v = { styleId, seed: (Math.random() * 1e9) | 0, plan: null, custom: {} };
  applyStyleDefaults(v);
  state.variants.push(v);
  const el = makeCard(), i = cards.length - 1;
  player.attach(i, el.querySelector('canvas'));
  saveCustom(); saveLineup(); refreshEff();
  replan(i); updateAddTile(); updateCards(); requestAnimationFrame(layoutGrid);
  focusCard(i);
  toast(`Take ${i + 1} added: ${isStream() ? 'another highlight' : STYLES[styleId].name}`);
}
function removeTake(i) {
  if (state.variants.length <= 1 || i < 0) return;
  if (tuneIndex != null) closeTune();
  player.detach(i);
  cards[i].remove(); cards.splice(i, 1);
  state.variants.splice(i, 1);
  if (state.focused >= state.variants.length) state.focused = state.variants.length - 1;
  else if (state.focused > i) state.focused--;
  effCache = []; ctxCache = [];
  saveCustom(); saveLineup(); refreshEff();
  updateAddTile(); updateCards(); requestAnimationFrame(layoutGrid); player.restartAudio();
  toast(`Take removed (${state.variants.length} left)`);
}
for (let i = 0; i < state.variants.length; i++) makeCard();
const KEEP_STYLE = new Set(['beat', 'movie', 'captionedit']);
// A style can come with its own settings (Movie Edit: in order + subtitles on the opening line; Caption Edit:
// dialogue in full + sentence captions). They're set on the card when it gets the style, only for settings
// the card hasn't set itself, and undone when the card moves to another style. Main settings still override.
function applyStyleDefaults(v) {
  const c = v.custom;
  for (const [k, val] of Object.entries(c._auto || {})) if (c[k] === val) delete c[k];
  const now = {};
  for (const [k, val] of Object.entries(STYLES[v.styleId]?.defaults || {})) if (c[k] === undefined) { c[k] = val; now[k] = val; }
  c._auto = now; c._autoFor = v.styleId;
}
// New take of the same style: new seed, and steer away from the previous take's footage
function nextHighlight(i) {
  const v = state.variants[i];
  v.hiSkip = (v.hiSkip || 0) + 1; delete v.custom.title;
  replan(i); refreshEff(); updateCards(); player.seek(0);
  const H = v.plan?.highlight;
  toast(H ? `Clip ${i + 1}: highlight #${H.rank}, ${H.why}` : 'No more highlights in these clips');
}
function reroll(i) { if (isStream()) return nextHighlight(i); const prev = state.variants[i].plan; state.variants[i].seed = (Math.random() * 1e9) | 0; replan(i, prev); updateCards(); }
// Regen: a whole new edit — different style (not used by the other cards), new effect mix, new clips + cuts.
// The Simple Beat card stays a simple beat edit, just with new clips and cuts.
function regen(i) {
  if (isStream()) return nextHighlight(i);
  const v = state.variants[i], prev = v.plan, rand = Math.random;
  const pickOne = (arr) => arr[Math.floor(rand() * arr.length)];
  let msg;
  // clean styles (Simple Beat, Movie Edit, Caption Edit) keep their style: just new clips & cuts, no random effects
  if (KEEP_STYLE.has(v.styleId)) {
    delete v.custom.fx; delete v.custom.filter;
    msg = 'new clips & cuts';
  } else {
    const taken = state.variants.map((o) => o.styleId);
    v.styleId = pickOne(Object.keys(STYLES).filter((k) => !KEEP_STYLE.has(k) && !STYLES[k].hidden && !taken.includes(k))) || v.styleId;
    applyStyleDefaults(v);
    const pool = EXTRAS.map((x) => x[0]).filter((k) => !['strobe', 'invertHits', 'kaleido'].includes(k));
    const fx = [];
    for (let n = 1 + Math.floor(rand() * 3); fx.length < n;) { const k = pickOne(pool); if (!fx.includes(k)) fx.push(k); }
    v.custom.fx = fx;
    if (rand() < 0.45) v.custom.filter = pickOne(Object.keys(FILTERS).filter((k) => k !== 'none')); else delete v.custom.filter;
    msg = `${STYLES[v.styleId].name} + ${fx.map((k) => EXTRAS.find((x) => x[0] === k)[1]).join(', ')}${v.custom.filter ? ', ' + FILTERS[v.custom.filter].name : ''}`;
  }
  v.custom.off = []; v.dropped = [];
  v.seed = (Math.random() * 1e9) | 0;
  saveCustom(); saveLineup();
  replan(i, prev); updateCards();
  if (tuneIndex === i) renderTune();
  toast(`Edit ${i + 1} regenerated: ${msg}`);
}
function focusCard(i) {
  state.focused = i; updateCards();
  if (state.solo) requestAnimationFrame(layoutGrid);
  if (tuneIndex != null && tuneIndex !== i) openTune(i);
}
function setSolo(on) {
  state.solo = on;
  try { localStorage.setItem('cutsona.view', JSON.stringify({ solo: on })); } catch {}
  updateCards(); updateViewBar(); requestAnimationFrame(layoutGrid);
}
// Everything that changes how edit i looks, as tick boxes. `from` says which settings own it:
// 'style' (this edit's style parts), 'edit' (this edit's ⚙ overrides) or 'main' (the main settings).
// Things unticked on this card stay listed (unticked) so they can be ticked back on.
const fxLabel = (k) => { const x = EXTRAS.find((e) => e[0] === k); return x ? (ANIMATED_FX.has(k) ? '✦ ' : '') + x[1] : k; };
// every effect of the edit's style; "speed ramps" is the same switch as the Speed ramps setting in the menus
function styleEffects(i) {
  const v = state.variants[i], c = v.custom, e = eff(i), off = new Set(c.off || []), sig = new Set((STYLES[v.styleId].parts || []).map((p) => p[0]));
  return styleParts(v.styleId).map(([key, label]) => key === 'speed'
    ? { kind: 'speed', key, label, on: e.speed !== 'off' && !off.has('speed'), from: c.speed ? 'edit' : 'main', sig: sig.has(key) }
    : { kind: 'part', key, label, on: !off.has(key), from: 'style', sig: sig.has(key) });
}
function cardEffects(i, all = false) {
  const v = state.variants[i], c = v.custom, e = eff(i);
  // on the card: the style's signature effects plus anything switched off; the rest sit behind "all effects"
  const out = styleEffects(i).filter((p) => all || p.sig || !p.on);
  const filterFrom = c.filter != null && c.filter !== '' ? 'edit' : 'main';
  const fxFrom = Array.isArray(c.fx) ? 'edit' : 'main';
  if (e.filter && e.filter !== 'none') out.push({ kind: 'filter', key: e.filter, label: FILTERS[e.filter]?.name || e.filter, on: true, from: filterFrom });
  for (const k of e.fx) out.push({ kind: 'fx', key: k, label: fxLabel(k), on: true, from: fxFrom });
  for (const d of v.dropped || []) {
    if (out.some((o) => o.kind === d.kind && o.key === d.key)) continue;
    if (d.kind === 'filter' && FILTERS[d.key]) out.push({ kind: 'filter', key: d.key, label: FILTERS[d.key].name, on: false, from: filterFrom });
    if (d.kind === 'fx' && EXTRAS.some((x) => x[0] === d.key)) out.push({ kind: 'fx', key: d.key, label: fxLabel(d.key), on: false, from: fxFrom });
  }
  return out;
}
function toggleCardEffect(i, kind, key) {
  const v = state.variants[i], c = v.custom, e = eff(i);
  const remember = (on) => { v.dropped = (v.dropped || []).filter((d) => !(d.kind === kind && d.key === key)); if (!on) v.dropped.push({ kind, key }); };
  let main = false, on;
  if (kind === 'all') {
    // All on / All off for every effect of the style (speed ramps included)
    const turnOn = key === 'on';
    c.off = turnOn ? [] : styleParts(v.styleId).map(([k]) => k).filter((k) => k !== 'speed');
    c.speed = turnOn ? 'on' : 'off';
    saveCustom(); replan(i); updateCards(); renderMainLook(); if (tuneIndex != null) renderTune();
    toast(`Edit ${i + 1}: all ${STYLES[v.styleId].name} effects ${turnOn ? 'on' : 'off'}`);
    return;
  }
  if (kind === 'speed') {
    // the same switch as "Speed ramps & slow-mo" in this edit's ⚙ settings
    on = !(e.speed !== 'off' && !(c.off || []).includes('speed'));
    c.speed = on ? 'on' : 'off';
    c.off = (c.off || []).filter((k) => k !== 'speed');
    saveCustom(); replan(i);
  } else if (kind === 'part') {
    const off = new Set(c.off || []);
    on = off.has(key);
    on ? off.delete(key) : off.add(key);
    c.off = [...off];
    saveCustom(); replan(i);
  } else if (kind === 'fx') {
    main = !Array.isArray(c.fx);
    const tgt = main ? state.settings : c;
    on = !e.fx.includes(key);
    tgt.fx = on ? [...tgt.fx.filter((x) => x !== key), key] : tgt.fx.filter((x) => x !== key);
    remember(on);
    main ? saveSettings() : saveCustom();
  } else if (kind === 'filter') {
    main = !(c.filter != null && c.filter !== '');
    on = e.filter !== key;
    // a filter that replaces another one: keep the old one listed so it can be ticked back
    if (on && e.filter && e.filter !== 'none') v.dropped = [...(v.dropped || []).filter((d) => !(d.kind === 'filter' && d.key === e.filter)), { kind: 'filter', key: e.filter }];
    (main ? state.settings : c).filter = on ? key : 'none';
    remember(on);
    main ? saveSettings() : saveCustom();
  }
  updateCards(); renderMainLook();
  if (tuneIndex != null) renderTune();
  if (main) {
    const label = kind === 'filter' ? FILTERS[key]?.name : fxLabel(key).replace('✦ ', '');
    const others = state.variants.filter((_, j) => j !== i && (kind === 'fx' ? !Array.isArray(state.variants[j].custom.fx) : !state.variants[j].custom.filter)).length;
    toast(`${label} ${on ? 'on' : 'off'} in the main settings${others ? `: also ${on ? 'on' : 'off'} for the ${others} other edit${others > 1 ? 's' : ''} using main` : ''}`);
  }
}
function updateCards() {
  cards.forEach((el, i) => {
    const v = state.variants[i], st = STYLES[v.styleId];
    el.style.setProperty('--c', st.color);
    el.classList.toggle('focused', state.focused === i);
    el.hidden = state.solo && state.focused !== i;
    el.querySelector('select').value = v.styleId;
    const p = v.plan, e = eff(i), cu = isCustom(i);
    el.classList.toggle('custom', cu);
    el.classList.toggle('tuning', tuneIndex === i);
    // every effect on this edit as a tick box: the style's own effects, the filter and the extra effects
    const chip = ({ kind, key, label, on, from }) => {
      const where = kind === 'part' ? `${st.name} style` : kind === 'speed' ? (from === 'main' ? 'Speed ramps setting in the main settings' : 'Speed ramps setting in this edit\'s') : from === 'main' ? 'main settings: every edit using main follows' : 'this edit\'s settings';
      return `<button class="part ${on ? 'on' : ''} ${from === 'main' && kind !== 'part' ? 'main' : ''} k-${kind}" data-kind="${kind}" data-key="${esc(key)}" title="${on ? 'Untick' : 'Tick'} ${esc(label)} (${where})"><i>${on ? '✓' : ''}</i>${esc(label)}</button>`;
    };
    const allFx = styleEffects(i), nOn = allFx.filter((p) => p.on).length;
    el.querySelector('.parts').innerHTML = cardEffects(i).map(chip).join('') +
      `<button class="part more" data-allfx="${v.allOpen ? 'close' : 'open'}" title="Every effect this edit uses: tick any of them on or off">⋯ all effects <b>${nOn}/${allFx.length}</b></button>`;
    // the full list, over the video
    const pop = el.querySelector('.parts-pop');
    pop.hidden = !v.allOpen;
    if (v.allOpen) {
      const extra = cardEffects(i, true).filter((p) => p.kind !== 'part' && p.kind !== 'speed');
      pop.innerHTML = `<div class="pp-h"><b>${esc(st.name)} effects</b><span>${nOn} of ${allFx.length} on</span>
          <button class="small" data-kind="all" data-key="on">All on</button><button class="small" data-kind="all" data-key="off">All off</button>
          <button class="pp-x" data-allfx="close" title="Close">×</button></div>
        <div class="pp-list">${allFx.map(chip).join('')}</div>
        ${extra.length ? `<div class="pp-sub">Filter &amp; extra effects</div><div class="pp-list">${extra.map(chip).join('')}</div>` : ''}`;
    }
    syncCardSelect(i);
    el.querySelector('.len').textContent = p?.duration ? `${p.duration.toFixed(1)}s` : '-';
    const bits = [];
    if (isStream() && p?.highlight) {
      // stream clip: which highlight and why it was picked (its length is on the slate)
      const H = p.highlight;
      el.querySelector('.meta span').textContent = `Highlight ${H.rank}: ${H.why.charAt(0).toLowerCase() + H.why.slice(1)}`;
      el.querySelector('.meta span').title = `${H.title || ''}\n${(state.planClips[H.ci]?.name || '')} ${fmt(H.a)}–${fmt(H.b)}`;
      el.querySelector('.export').disabled = state.server.ffmpeg === false;
      return;
    }
    if (e.pick === 'quotes') bits.push('best quotes'); else if (e.pick === 'scenes') bits.push('best scenes');
    if (e.order === 'story') bits.push('in order');
    if (cu && e.format !== state.settings.format) bits.push(e.format);
    if (p) bits.unshift(`${new Set(p.segments.map(s => s.run)).size} moments`);
    el.querySelector('.meta span').textContent = bits.join(', ');
    el.querySelector('.meta span').title = st.desc;
    el.querySelector('.export').disabled = !p?.segments.length || state.server.ffmpeg === false;
  });
  // more or fewer effect chips can change how tall the cards' chip rows are
  const sig = cards.map((el) => el.querySelector('.parts').childElementCount).join(',');
  if (sig !== chipSig) { chipSig = sig; requestAnimationFrame(() => layoutGrid()); }
  if (shotBar) shotBar.refresh(); // new takes / another edit focused: keep the shot editor on a real shot
  updateViewBar(); updateAddTile();
}
function updateEmpty() {
  const has = state.planClips.length > 0;
  $('#empty').hidden = has; grid.hidden = !has; $('#transport').hidden = !has;
  if (has) requestAnimationFrame(layoutGrid);
}

// lay out the cards: each edit can have its own size (9:16, 1:1, 16:9 …); pick the arrangement that shows them biggest
let chipSig = '', partsH = 22;
function layoutGrid(again = false) {
  if (grid.hidden) return;
  const gr = grid.getBoundingClientRect();
  const n = state.variants.length;
  const vis = state.solo ? [state.focused] : cards.map((_, i) => i);
  const asp = cards.map((_, i) => aspectOf(i));
  // the effect chips wrap onto extra lines on narrow cards; leave room for the tallest row
  // slate (clapper 12 + slate 44) + 3 gaps of 8 + footer 34 + bottom padding 8 (+ the chip row)
  const gap = 14, chromeW = 18, chromeH = 56 + 24 + 34 + 8 + 2 + partsH;
  // the "Add take" tile is a slim column on the right, so it never shrinks the takes much
  const addW = !state.solo && n < MAX_TAKES ? 76 : 0, W = gr.width - (addW ? addW + gap : 0);
  // every way to arrange the takes in rows and columns; keep the one that shows them biggest
  const shapes = state.solo ? [[1, 1]] : Array.from({ length: vis.length }, (_, k) => [k + 1, Math.ceil(vis.length / (k + 1))]);
  let best = null;
  for (const [cols, rows] of shapes) {
    const cw = (W - gap * (cols - 1)) / cols, ch = (gr.height - gap * (rows - 1)) / rows;
    const sizes = [];
    let area = 0;
    for (const i of vis) {
      const a = asp[i];
      const sw = Math.max(60, Math.min(cw - chromeW, (ch - chromeH) * a));
      sizes[i] = [sw, sw / a]; area += (sw * sw) / a;
    }
    if (!best || area > best.area) best = { cols, rows, area, sizes };
  }
  grid.style.gridTemplateColumns = `repeat(${best.cols}, minmax(0, 1fr))${addW ? ` ${addW}px` : ''}`;
  grid.style.gridTemplateRows = `repeat(${best.rows}, minmax(0, 1fr))`;
  addTile.style.gridColumn = `${best.cols + 1}`; addTile.style.gridRow = `1 / span ${best.rows}`;
  updateAddTile();
  cards.forEach((el, i) => {
    el.hidden = !vis.includes(i);
    if (el.hidden) return;
    const [sw, sh] = best.sizes[i];
    const scr = el.querySelector('.screen');
    scr.style.width = sw + 'px'; scr.style.height = sh + 'px'; scr.style.flex = 'none';
    el.style.width = sw + 18 + 'px';
    el.style.minHeight = '';
    player.setViewSize(i, sw, sh);
  });
  // new card widths re-wrap the chips: measure and fit once more if their height changed
  const ph = Math.max(22, ...vis.map((i) => cards[i].querySelector('.parts').offsetHeight));
  if (Math.abs(ph - partsH) > 2 && !again) { partsH = ph; layoutGrid(true); return; }
  partsH = ph;
  // every take as tall as the tallest one (a take with fewer effect chips no longer sits out of line)
  const tallest = Math.max(...vis.map((i) => cards[i].offsetHeight));
  for (const i of vis) cards[i].style.minHeight = tallest + 'px';
}
new ResizeObserver(() => { layoutGrid(); drawWave(); }).observe(document.querySelector('.stage'));
// the shot editor opening/closing changes the space the cards get
let gridH = 0;
new ResizeObserver(() => { const h = grid.clientHeight; if (Math.abs(h - gridH) > 1) { gridH = h; layoutGrid(); } }).observe(grid);

// ---------------- player ----------------
const tl = $('#timeline');
function ctxFor(i) {
  const c = ctxCache[i];
  if (c && c.clips === state.planClips && c.music === state.musicAnalysis) return c;
  return (ctxCache[i] = makeCtx(eff(i), state.musicAnalysis, state.planClips));
}
let shotBar = null; // the shot editor (set up below)
const player = new Player({
  getState: () => ({ ...state, clips: state.planClips }),
  getEff: eff,
  getCtx: ctxFor,
  getText: textFor,
  getHook: hookFor,
  poolEl: $('#pool'), onTick,
});
cards.forEach((el, i) => player.attach(i, el.querySelector('canvas')));
function updateText() { textCache.clear(); }

let lastWaveDraw = 0;
function onTick(t, D) {
  if (grid.hidden) return;
  $('#time').textContent = `${fmt(t)} / ${fmt(D)}`;
  drawTimeline(t, D);
  refreshKeysBlock(t);
  if (shotBar) shotBar.tick();
  if (state.music && player.playing && performance.now() - lastWaveDraw > 100) { lastWaveDraw = performance.now(); drawWave(); }
}
// timeline zoom: the part of the edit the timeline shows ([tlStart, tlStart + D / tlZoom])
let tlZoom = 1, tlStart = 0, tlShownSel = -1;
function tlView(D) {
  tlZoom = Math.max(1, Math.min(Math.max(1, D / 0.6), tlZoom));
  const span = D / tlZoom;
  tlStart = Math.max(0, Math.min(D - span, tlStart));
  return [tlStart, tlStart + span];
}
// zoom by factor f around time `at` (default: the playhead), keeping that moment under the same spot
function zoomTimeline(f, at = null) {
  const D = player.duration(), [v0, v1] = tlView(D), a = at ?? Math.min(v1, Math.max(v0, player.now()));
  const frac = (a - v0) / Math.max(1e-6, v1 - v0);
  tlZoom = f === 0 ? 1 : tlZoom * f;
  const span = D / Math.max(1, Math.min(Math.max(1, D / 0.6), tlZoom));
  tlStart = a - frac * span;
  tlView(D); updateTlZoomUI();
  drawTimeline(player.now(), D);
}
function updateTlZoomUI() {
  const b = $('#tlZoomLvl'); if (b) b.textContent = tlZoom > 1.01 ? `${tlZoom < 10 ? tlZoom.toFixed(1).replace(/\.0$/, '') : Math.round(tlZoom)}×` : 'Fit';
  $('#tlZoomOut').disabled = tlZoom <= 1.01;
}
// timeline rows (fractions of its height): matches the Card / Song / Cuts labels beside it
const TL_LANES = { ruler: [0, 14 / 84], card: [14 / 84, 30 / 84], camera: [30 / 84, 46 / 84], song: [46 / 84, 65 / 84], cuts: [65 / 84, 1] };
let tlHover = false;
const cardKeyAt = (i, t) => (state.variants[i]?.custom.keys || []).findIndex((k) => Math.abs(k.t - t) < 0.05);
// the camera keyframe at edit time t (of the focused take): { si: cut, ki: keyframe } or null
function camKeyAtTime(t) {
  const segs = state.variants[state.focused]?.plan?.segments || [];
  for (let si = 0; si < segs.length; si++) {
    const fr = segs[si].framing; if (fr?.mode !== 'keys') continue;
    const ki = fr.keys.findIndex((k) => Math.abs(segs[si].start + k.o - t) < 0.04);
    if (ki >= 0) return { si, ki };
  }
  return null;
}
function drawTimeline(t, D) {
  const r = tl.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (tl.width !== W || tl.height !== H) { tl.width = W; tl.height = H; }
  const g = tl.getContext('2d');
  g.clearRect(0, 0, W, H);
  const p = state.variants[state.focused].plan;
  if (!p) return;
  let [v0, v1] = tlView(D);
  // zoomed in: keep the playhead in view while playing, and the cut open in the shot editor when it changes
  const sel0 = shotBar ? shotBar.selected() : -1;
  if (tlZoom > 1.01) {
    const span = v1 - v0;
    if (player.playing && (t < v0 || t > v1 - span * 0.04)) tlStart = t - span * 0.08;
    else if (sel0 >= 0 && sel0 !== tlShownSel && p.segments[sel0]) {
      const s = p.segments[sel0];
      if (s.start < v0 || s.end > v1) tlStart = s.start - span * 0.25;
    }
    [v0, v1] = tlView(D);
  }
  tlShownSel = sel0;
  const X = (s) => ((s - v0) / Math.max(1e-6, v1 - v0)) * W;
  // lanes, top to bottom: time ruler, Card (card-motion keyframes), Song (waveform, beats, drops), Cuts
  const top = (l) => Math.round(H * TL_LANES[l][0]), bot = (l) => Math.round(H * TL_LANES[l][1]), mid = (l) => (top(l) + bot(l)) / 2;
  g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(0, top('card'), W, bot('camera') - top('card'));
  g.fillStyle = 'rgba(255,255,255,0.08)'; for (const l of ['card', 'camera', 'song', 'cuts']) g.fillRect(0, top(l), W, dpr);
  // time ruler: a labelled mark every few seconds (closer together when zoomed in), small marks between
  {
    const pps = W / dpr / Math.max(1e-6, v1 - v0);
    const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((x) => x * pps >= 54) || 120;
    const minor = step / (step === 2 || step === 0.2 ? 4 : 5);
    const lab = (x) => { if (step < 1) { const m = Math.floor(x / 60); return `${m}:${(x - m * 60).toFixed(1).padStart(4, '0')}`; } const r = Math.round(x), m = Math.floor(r / 60); return `${m}:${String(r % 60).padStart(2, '0')}`; };
    if (minor * pps >= 6) {
      g.fillStyle = 'rgba(242,240,234,0.2)';
      for (let n = Math.ceil(v0 / minor - 1e-6); n * minor <= v1 + 1e-6; n++) g.fillRect(Math.round(X(n * minor)), bot('ruler') - 3 * dpr, dpr, 3 * dpr);
    }
    g.font = `600 ${9 * dpr}px Archivo, sans-serif`; g.textBaseline = 'top';
    for (let n = Math.ceil(v0 / step - 1e-6); n * step <= v1 + 1e-6; n++) {
      const x = Math.round(X(n * step));
      g.fillStyle = 'rgba(242,240,234,0.45)'; g.fillRect(x, 0, dpr, bot('ruler'));
      g.fillStyle = 'rgba(242,240,234,0.75)'; g.fillText(lab(n * step), x + 3 * dpr, 2 * dpr);
    }
    g.textBaseline = 'alphabetic';
  }
  // Song lane: the waveform, then the beats (taller = downbeat, pink = drop)
  if (state.music) {
    const a = state.music.analysis, hh = (bot('song') - top('song')) * 0.85;
    g.fillStyle = 'rgba(255,255,255,0.09)';
    for (let x = 0; x < W; x += 2 * dpr) {
      const tt = state.musicStart + v0 + (x / W) * (v1 - v0);
      const v = a.wave[Math.floor((tt / a.duration) * a.wave.length)] || 0;
      g.fillRect(x, mid('song') - (v * hh) / 2, 1.2 * dpr, v * hh);
    }
  }
  for (const b of p.beats) {
    const x = X(b.t); if (x < -2 || x > W + 2) continue;
    const lh = bot('song') - top('song') - 2 * dpr, h = b.impact ? lh : b.down ? lh * 0.55 : lh * 0.3;
    g.fillStyle = b.impact ? '#ff5d8f' : b.down ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)';
    g.fillRect(x, bot('song') - h, b.impact ? 2 * dpr : dpr, h);
  }
  // Cuts lane: one block per cut, numbered; a camera mark where you set the framing, ◆ for its camera keyframes
  const sel = shotBar ? shotBar.selected() : -1, cy0 = top('cuts') + 2 * dpr, ch = bot('cuts') - cy0 - dpr;
  p.segments.forEach((sg, k) => {
    const x0 = X(sg.start), x1 = X(sg.end);
    if (x1 < 0 || x0 > W) return; // off screen (zoomed in)
    const c = state.planClips[sg.clip], w = Math.max(2, x1 - x0 - 2);
    g.fillStyle = (c ? c.color : '#888') + (k === sel ? '70' : '38');
    g.fillRect(x0 + 1, cy0, w, ch);
    g.fillStyle = c ? c.color : '#888';
    g.fillRect(x0 + 1, cy0, w, 2 * dpr);
    if (w > 14 * dpr) { g.fillStyle = 'rgba(242,240,234,0.85)'; g.font = `700 ${9 * dpr}px Archivo, sans-serif`; g.fillText(String(k + 1), x0 + 4 * dpr, cy0 + ch * 0.72); }
    if ((sg.profile.type !== 'const' || Math.abs((sg.profile.r || 1) - 1) > 0.03) && w > 30 * dpr) {
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = `${9 * dpr}px Inter Tight, sans-serif`; g.textAlign = 'right';
      g.fillText(sg.profile.type === 'stutter' ? '⟲' : sg.profile.type === 'const' ? `${(+sg.profile.r).toFixed(2).replace(/\.?0+$/, '')}×` : '⤳', x1 - 4 * dpr, cy0 + ch * 0.72);
      g.textAlign = 'left';
    }
    if (k === sel) { g.strokeStyle = '#fff'; g.lineWidth = 1.5 * dpr; g.strokeRect(x0 + 1, cy0, w, ch); }
  });
  // fades: the picture fading in / out darkens the Cuts lane as a ramp; music fades are a blue slope in the Song lane
  const fe = eff(state.focused), fadeRamp = (a, b, fromDark, label, lane) => {
    if (b - a < 0.02) return;
    const x0 = X(a), x1 = X(b);
    if (x1 < 0 || x0 > W) return;
    const music = lane === 'song', yT = top(lane) + 2 * dpr, yB = bot(lane) - 2 * dpr;
    if (!music) {
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, fromDark ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0)'); gr.addColorStop(1, fromDark ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.78)');
      g.fillStyle = gr; g.fillRect(x0, top(lane), x1 - x0, bot(lane) - top(lane));
    }
    g.strokeStyle = music ? 'rgba(120,200,255,0.95)' : 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.moveTo(x0, fromDark ? yB : yT); g.lineTo(x1, fromDark ? yT : yB); g.stroke();
    if (x1 - x0 > 50 * dpr) {
      g.font = `600 ${9 * dpr}px Archivo, sans-serif`; g.fillStyle = music ? 'rgba(160,215,255,1)' : '#fff';
      g.textAlign = fromDark ? 'left' : 'right'; g.fillText(label, fromDark ? x0 + 3 * dpr : x1 - 3 * dpr, music ? yT + 8 * dpr : yB - 2 * dpr);
      g.textAlign = 'left';
    }
  };
  const fIn = Number(fe.fadeIn) || 0, fOut = Number(fe.fadeOut) || 0, mIn = Number(fe.musicFadeIn) || 0, mOut = Number(fe.musicFadeOut) || 0;
  fadeRamp(0, Math.min(D, fIn), true, `Fade in ${fIn}s`, 'cuts');
  fadeRamp(Math.max(0, p.duration - fOut), p.duration, false, `Fade out ${fOut}s`, 'cuts');
  if (state.music) {
    fadeRamp(0, Math.min(D, mIn), true, `Music in ${mIn}s`, 'song');
    fadeRamp(Math.max(0, p.duration - mOut), p.duration, false, `Music out ${mOut}s`, 'song');
  }
  // Card lane: this take's card-motion keyframes (◆ = one keyframe; the line = the card moving between them)
  const ck = state.variants[state.focused].custom.keys || [], onK = cardKeyAt(state.focused, t);
  if (ck.length > 1) { g.fillStyle = accentRGBA(0.55); g.fillRect(X(ck[0].t), mid('card') - dpr, X(ck[ck.length - 1].t) - X(ck[0].t), 2 * dpr); }
  ck.forEach((k, n) => {
    const kx = X(k.t), ky = mid('card'), r = (n === onK ? 6 : 4.6) * dpr;
    if (kx < -r || kx > W + r) return;
    g.fillStyle = n === onK ? '#fff' : accentHex(); g.strokeStyle = '#000'; g.lineWidth = 1.2 * dpr;
    g.beginPath(); g.moveTo(kx, ky - r); g.lineTo(kx + r, ky); g.lineTo(kx, ky + r); g.lineTo(kx - r, ky); g.closePath(); g.fill(); g.stroke();
  });
  const camOn = camKeyAtTime(t), cm = mid('camera');
  p.segments.forEach((sg, k) => {
    const fr = sg.framing; if (!fr) return;
    const x0 = X(sg.start), x1 = X(sg.end); if (x1 < 0 || x0 > W) return;
    if (fr.mode !== 'keys' || !fr.keys?.length) { g.fillStyle = 'rgba(127,209,255,0.35)'; g.fillRect(x0 + 1, cm - 1.5 * dpr, Math.max(2, x1 - x0 - 2), 3 * dpr); return; }
    const ks = fr.keys.map((kf) => X(sg.start + kf.o));
    if (ks.length > 1) { g.fillStyle = 'rgba(127,209,255,0.6)'; g.fillRect(ks[0], cm - dpr, ks[ks.length - 1] - ks[0], 2 * dpr); }
    ks.forEach((kx, n) => {
      const on = camOn && camOn.si === k && camOn.ki === n, r = (on ? 6 : 4.6) * dpr;
      g.fillStyle = on ? '#fff' : '#7fd1ff'; g.strokeStyle = '#000'; g.lineWidth = 1.2 * dpr;
      g.beginPath(); g.moveTo(kx, cm - r); g.lineTo(kx + r, cm); g.lineTo(kx, cm + r); g.lineTo(kx - r, cm); g.closePath(); g.fill(); g.stroke();
    });
  });
  if (!p.segments.some((sg) => sg.framing) && W > 260 * dpr) {
    g.fillStyle = 'rgba(242,240,234,0.32)'; g.font = `500 ${9 * dpr}px Archivo, sans-serif`;
    g.fillText('double-click here to move the camera inside a cut', 6 * dpr, cm + 3 * dpr);
  }
  if (!ck.length && W > 260 * dpr) {
    g.fillStyle = 'rgba(242,240,234,0.32)'; g.font = `500 ${9 * dpr}px Archivo, sans-serif`;
    g.fillText('double-click here to add a card keyframe', 6 * dpr, mid('card') + 3 * dpr);
  }
  // the playhead, with a small head on the ruler
  g.fillStyle = STYLES[p.styleId].color;
  g.fillRect(X(t) - dpr, 0, 2 * dpr, H);
  g.beginPath(); g.moveTo(X(t) - 5 * dpr, 0); g.lineTo(X(t) + 5 * dpr, 0); g.lineTo(X(t), 6 * dpr); g.fill();
  // zoomed in: which part of the whole edit you're looking at (a thin bar along the top)
  if (tlZoom > 1.01) {
    g.fillStyle = 'rgba(242,240,234,0.10)'; g.fillRect(0, 0, W, 3 * dpr);
    g.fillStyle = 'rgba(242,240,234,0.6)'; g.fillRect((v0 / D) * W, 0, Math.max(4 * dpr, ((v1 - v0) / D) * W), 3 * dpr);
  }
  if (!tlHover) $('#tlLabel').textContent = tlNowText(t);
}
// the line under the timeline: where the playhead is, in plain words
function tlNowText(t) {
  const p = state.variants[state.focused].plan; if (!p) return '';
  const k = p.segments.findIndex((s) => t >= s.start && t < s.end), sg = p.segments[k], c = sg && state.planClips[sg.clip];
  const on = cardKeyAt(state.focused, t);
  const parts = [sg ? `Cut ${k + 1} of ${p.segments.length}: ${c ? c.name : 'clip'}, from ${fmt(sg.srcStart)} of the clip${sg.framing ? ', your camera framing' : ''}` : 'End of the edit'];
  if (on >= 0) parts.push(`on card keyframe ${on + 1}`);
  const ca = camKeyAtTime(t); if (ca) parts.push(`on camera keyframe ${ca.ki + 1} of cut ${ca.si + 1}`);
  return parts.join('; ');
}
// timeline: drag to scrub; click a shot to open it in the shot editor; hover to see which shot it is
let scrubbing = false, tlDownX = null;
const tlw = $('.timeline-wrap');
const tlTime = (e) => { const r = tl.getBoundingClientRect(), [v0, v1] = tlView(player.duration()); return v0 + clamp01((e.clientX - r.left) / r.width) * (v1 - v0); };
// Ctrl / ⌘ + wheel (or a trackpad pinch) zooms around the pointer; the wheel scrolls along when zoomed in
tlw.addEventListener('wheel', (e) => {
  const D = player.duration();
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomTimeline(Math.exp(-e.deltaY * 0.004), tlTime(e)); return; }
  if (tlZoom <= 1.01) return;
  e.preventDefault();
  const [v0, v1] = tlView(D), r = tl.getBoundingClientRect(), d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  tlStart = v0 + (d / r.width) * (v1 - v0);
  tlView(D); drawTimeline(player.now(), D);
}, { passive: false });
$('#tlZoomIn').onclick = () => zoomTimeline(1.6);
$('#tlZoomOut').onclick = () => zoomTimeline(1 / 1.6);
$('#tlZoomLvl').onclick = () => zoomTimeline(0);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function scrubTo(e) { player.seek(tlTime(e)); }
// a card-motion keyframe ◆ under the pointer (their row sits just above the cuts)
function tlKeyAt(e) {
  const keys = state.variants[state.focused].custom.keys || [];
  if (!keys.length) return -1;
  const r = tl.getBoundingClientRect(), y = e.clientY - r.top;
  if (y < r.height * TL_LANES.card[0] - 4 || y > r.height * TL_LANES.card[1] + 4) return -1;
  const [v0, v1] = tlView(player.duration()), px = (t) => r.left + ((t - v0) / Math.max(1e-6, v1 - v0)) * r.width;
  let best = -1, bd = 8;
  keys.forEach((k, n) => { const d = Math.abs(px(k.t) - e.clientX); if (d < bd) { bd = d; best = n; } });
  return best;
}
// a camera keyframe ◆ under the pointer, in the Camera row
function camKeyAt(e) {
  const p = state.variants[state.focused].plan; if (!p) return null;
  const r = tl.getBoundingClientRect(), y = e.clientY - r.top;
  if (y < r.height * TL_LANES.camera[0] - 4 || y > r.height * TL_LANES.camera[1] + 4) return null;
  const [v0, v1] = tlView(player.duration()), px = (t) => r.left + ((t - v0) / Math.max(1e-6, v1 - v0)) * r.width;
  let best = null, bd = 8;
  p.segments.forEach((sg, si) => { if (sg.framing?.mode === 'keys') sg.framing.keys.forEach((k, ki) => { const d = Math.abs(px(sg.start + k.o) - e.clientX); if (d < bd) { bd = d; best = { si, ki }; } }); });
  return best;
}
const laneAt = (e) => { const r = tl.getBoundingClientRect(), fy = (e.clientY - r.top) / r.height; return Object.keys(TL_LANES).find((l) => fy >= TL_LANES[l][0] && fy <= TL_LANES[l][1]) || 'cuts'; };
// open a cut in the shot editor with the playhead at t (inside it)
function openCutAt(si, t) {
  player.pause(); updatePlayIcon(); player.seek(t);
  shotBar.select(si, { seek: false });
}
let keyDrag = null, camDrag = null, tlSelTimer = 0;
tlw.addEventListener('pointerdown', (e) => {
  tlw.setPointerCapture(e.pointerId);
  const k = tlKeyAt(e);
  if (k >= 0) { const keys = state.variants[state.focused].custom.keys; keyDrag = { n: k, x: e.clientX, moved: false, t: keys[k].t }; return; }
  const ck = camKeyAt(e);
  if (ck) { camDrag = { ...ck, x: e.clientX, moved: false }; return; }
  scrubbing = true; tlDownX = e.clientX; scrubTo(e);
});
tlw.addEventListener('pointermove', (e) => {
  if (keyDrag) {
    if (Math.abs(e.clientX - keyDrag.x) > 3) keyDrag.moved = true;
    if (keyDrag.moved) {
      const keys = state.variants[state.focused].custom.keys, D = state.variants[state.focused].plan?.duration || 10;
      keys[keyDrag.n].t = Math.round(Math.max(0, Math.min(D, tlTime(e))) * 100) / 100;
      ctxCache = []; refreshEff(); player.seek(keys[keyDrag.n].t); drawTimeline(player.now(), player.duration());
      $('#tlLabel').textContent = `Card keyframe ${keyDrag.n + 1} moved to ${fmt(keys[keyDrag.n].t)}`;
    }
    return;
  }
  if (camDrag) {
    if (Math.abs(e.clientX - camDrag.x) > 3) camDrag.moved = true;
    if (camDrag.moved) {
      // slide the camera keyframe along its cut (it can't leave the cut it belongs to)
      const sg = state.variants[state.focused].plan.segments[camDrag.si], fr = sg.framing, key = fr.keys[camDrag.ki];
      const o = Math.round(Math.max(0, Math.min(sg.end - sg.start - 0.02, tlTime(e) - sg.start)) * 1000) / 1000;
      key.o = o; key.s = sg.srcStart + srcOffset(sg, o);
      fr.keys.sort((a, b) => a.s - b.s); camDrag.ki = fr.keys.indexOf(key);
      saveCutFraming(sg, fr);
      const pv = player.views[state.focused]; if (pv) pv.dirty = true;
      player.seek(sg.start + o); drawTimeline(player.now(), player.duration());
      $('#tlLabel').textContent = `Camera keyframe ${camDrag.ki + 1} of cut ${camDrag.si + 1} moved to ${fmt(sg.start + o)}`;
    }
    return;
  }
  if (scrubbing) { scrubTo(e); return; }
  // hovering: say what's under the pointer and what a click does there
  const k = tlKeyAt(e), ckey = k < 0 ? camKeyAt(e) : null;
  tlw.style.cursor = k >= 0 || ckey ? 'ew-resize' : '';
  const p = state.variants[state.focused].plan;
  if (!p || !p.segments.length) return;
  const r = tl.getBoundingClientRect(), fy = (e.clientY - r.top) / r.height, at = tlTime(e);
  const lane = Object.keys(TL_LANES).find((l) => fy >= TL_LANES[l][0] && fy <= TL_LANES[l][1]) || 'cuts';
  tlHover = true;
  let txt;
  if (k >= 0) txt = `Card keyframe ${k + 1} at ${fmt(p && state.variants[state.focused].custom.keys[k].t)}: drag it to move it, click it to change it in the take's settings`;
  else if (ckey) txt = `Camera keyframe ${ckey.ki + 1} of cut ${ckey.si + 1}: drag it to move it, click it to change where the camera looks`;
  else if (lane === 'card') txt = `${fmt(at)}: double-click to add a card keyframe here (moves the whole picture)`;
  else if (lane === 'camera') { const n = shotBar.shotAt(at); txt = `${fmt(at)}, cut ${n + 1}: double-click to add a camera keyframe here (moves what the camera looks at)`; }
  else if (lane === 'song') { const b = p.beats.find((x) => x.impact && Math.abs(x.t - at) < 0.15); txt = `${fmt(at)}: the song${b ? ', a drop' : ''}. Lines are beats, pink lines are drops`; }
  else if (lane === 'ruler') txt = `${fmt(at)}: click to jump here`;
  else {
    const n = shotBar.shotAt(at), sg = p.segments[n], c = sg && state.planClips[sg.clip];
    txt = c ? `Cut ${n + 1} of ${p.segments.length}: ${c.name}, ${fmt(sg.end - sg.start)} long${sg.framing ? ', your camera framing' : ''}. Click to frame it` : '';
  }
  $('#tlLabel').textContent = txt;
});
tlw.addEventListener('pointerleave', () => { tlHover = false; if (!scrubbing && !keyDrag && !camDrag) drawTimeline(player.now(), player.duration()); });
tlw.addEventListener('pointerup', (e) => {
  if (keyDrag) {
    const i = state.focused, kd = keyDrag; keyDrag = null;
    const keys = [...(state.variants[i].custom.keys || [])], moved = keys[kd.n];
    player.pause(); updatePlayIcon();
    if (kd.moved) { setKeys(i, keys); selKey = state.variants[i].custom.keys.indexOf(state.variants[i].custom.keys.find((k) => k.t === moved.t)); }
    else selKey = kd.n;
    player.seek(moved.t);
    if (tuneIndex !== i) openTune(i); else renderTune();
    drawTimeline(player.now(), player.duration());
    document.querySelector('#tune .keys-block')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (camDrag) {
    // let go of a camera keyframe (moved or just clicked): open its cut in the shot editor, on that keyframe
    const cd = camDrag; camDrag = null;
    const sg = state.variants[state.focused].plan.segments[cd.si], key = sg?.framing?.keys?.[cd.ki];
    if (sg && key) openCutAt(cd.si, sg.start + key.o + 0.001);
    drawTimeline(player.now(), player.duration());
    return;
  }
  scrubbing = false;
  if (tlDownX != null && Math.abs(e.clientX - tlDownX) < 5) {
    player.pause(); updatePlayIcon();
    // wait a moment: a double-click adds a keyframe instead of opening the cut
    const t = tlTime(e);
    clearTimeout(tlSelTimer);
    tlSelTimer = setTimeout(() => shotBar.select(shotBar.shotAt(t), { seek: false }), e.detail >= 2 ? 0 : 280);
    if (e.detail >= 2) clearTimeout(tlSelTimer);
  }
  tlDownX = null;
});
tlw.addEventListener('dblclick', (e) => {
  clearTimeout(tlSelTimer);
  if (tlKeyAt(e) >= 0 || camKeyAt(e) || !state.variants[state.focused].plan) return;
  const lane = laneAt(e), t = tlTime(e);
  if (lane === 'camera') {
    // a camera keyframe at that moment of the cut there: the shot editor opens on it, ready to aim
    const si = shotBar.shotAt(t);
    openCutAt(si, t);
    shotBar.addKey();
  } else if (lane === 'card') addCardKey(state.focused, t);
  drawTimeline(player.now(), player.duration());
});

// "+ Add clip": one clip -> add straight away; more -> a small menu to pick which video (or any)
const addMenu = $('#addMenu');
$('#btnAddCut').onclick = (e) => {
  e.stopPropagation();
  const clips = state.planClips || [];
  if (!clips.length || !state.variants[state.focused].plan) return toast('Add a clip first');
  if (clips.length === 1) { addCutAt(player.now()); return; }
  if (!addMenu.hidden) { addMenu.hidden = true; return; }
  addMenu.innerHTML = `<button data-add-clip="" role="menuitem"><i style="--c:var(--paper)"></i>Any of your clips</button>`
    + clips.map((c) => `<button data-add-clip="${esc(c.id)}" role="menuitem"><i style="--c:${c.color}"></i>${esc(c.name)}</button>`).join('');
  addMenu.hidden = false;
};
addMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-add-clip]'); if (!b) return;
  addMenu.hidden = true;
  addCutAt(player.now(), b.dataset.addClip || null);
});
document.addEventListener('pointerdown', (e) => { if (!addMenu.hidden && !e.target.closest('.tl-add')) addMenu.hidden = true; });
// the timeline gets its own row when the bar is narrow (take settings open): redraw at the new size
new ResizeObserver(() => drawTimeline(player.now(), player.duration())).observe(tlw);

function updatePlayIcon() { $('#playIcon').setAttribute('d', player.playing ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M7 5v14l12-7z'); }
$('#btnPlay').onclick = () => { audioCtx().resume(); player.toggle(); updatePlayIcon(); };
$('#btnLoop').onclick = (e) => { player.loop = !player.loop; e.currentTarget.classList.toggle('on', player.loop); };

// ---------------- export queue ----------------
const jobs = [];
let running = false;
function queueExport(i) {
  const v = state.variants[i];
  if (!v.plan?.segments.length) return;
  if (state.server.ffmpeg === false) return toast('ffmpeg is needed to save MP4s. Run Setup.cmd.', true);
  const [res, fps] = state.settings.quality.split('/').map(Number);
  const base = (state.planClips[0]?.name || 'edit').replace(/\.[^.]+$/, '').slice(0, 30);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const st = isStream() ? STYLES.stream : STYLES[v.styleId];
  const job = {
    id: Math.random().toString(36).slice(2), i, color: st.color, overlay: textFor(i)?.canvas || null, hook: hookFor(i)?.canvas || null,
    name: `${isStream() ? `Clip${v.plan.highlight?.rank || ''}` : st.name}_${base}_${stamp}`,
    plan: v.plan, clips: state.planClips.slice(), music: state.music, musicAnalysis: state.musicAnalysis,
    settings: { ...eff(i), res, fps }, status: 'queued', p: 0, phase: 'Waiting…',
  };
  jobs.unshift(job);
  $('#tray').hidden = false;
  renderJobs(); runJobs();
}
async function runJobs() {
  if (running) return;
  running = true;
  while (true) {
    const job = jobs.slice().reverse().find((j) => j.status === 'queued');
    if (!job) break;
    job.status = 'running';
    if (player.playing) { player.pause(); updatePlayIcon(); }
    try {
      if (job.settings.focus === 'on') {
        job.phase = 'Finishing subject tracking'; renderJobs();
        await Promise.all(job.clips.map(c => c.trackPromise));
      }
      if (job.settings.captions === 'on') {
        job.phase = 'Finishing captions'; renderJobs();
        await Promise.all(job.clips.map(c => c.speechPromise));
        const failed = job.clips.find(c => c.audioBuffer && c.speechState !== 'done');
        if (failed) throw new Error(`Captions unavailable for ${failed.name}. ${failed.speechError || 'Retry captions or select Off.'}`);
      }
      const r = await exportEdit({ ...job, poolEl: $('#pool'), isCancelled: () => job.cancel,
        onProgress: (pr) => { job.p = pr.p; job.phase = pr.phase + (pr.eta != null ? `, ~${Math.ceil(pr.eta)}s left` : ''); renderJobs(); } });
      job.status = 'done'; job.result = r; job.phase = `Saved, ${r.w}×${r.h} ${r.fps}fps, took ${Math.round(r.seconds)}s`;
      toast('Saved ' + r.name);
    } catch (e) {
      console.error(e);
      job.status = e.message === 'cancelled' ? 'cancelled' : 'err';
      job.phase = e.message === 'cancelled' ? 'Cancelled' : 'Failed: ' + e.message;
    }
    renderJobs();
  }
  running = false;
}
function renderJobs() {
  const box = $('#jobs');
  box.innerHTML = '';
  for (const j of jobs) {
    const d = document.createElement('div');
    d.className = 'job ' + j.status;
    d.style.setProperty('--c', j.color);
    d.innerHTML = `<div class="jn">${esc(j.name)}.mp4</div><div class="js"><span>${esc(j.phase)}</span><span>${j.status === 'running' ? Math.round(j.p * 100) + '%' : ''}</span></div>
      <div class="bar"><i style="width:${(j.status === 'done' ? 1 : j.p) * 100}%"></i></div><div class="jb"></div>`;
    const jb = d.querySelector('.jb');
    if (j.status === 'running' || j.status === 'queued') {
      const b = document.createElement('button'); b.className = 'small'; b.textContent = 'Cancel';
      b.onclick = () => { j.cancel = true; if (j.status === 'queued') { j.status = 'cancelled'; j.phase = 'Cancelled'; renderJobs(); } };
      jb.appendChild(b);
    }
    if (j.status === 'done') {
      const b = document.createElement('button'); b.className = 'small'; b.textContent = 'Show in folder';
      b.onclick = () => fetch(`/api/open?name=${encodeURIComponent(j.result.name)}`, { method: 'POST' });
      const pv = document.createElement('button'); pv.className = 'small'; pv.textContent = j.showVideo ? 'Hide video' : 'Watch';
      pv.onclick = () => { j.showVideo = !j.showVideo; renderJobs(); };
      jb.append(b, pv);
      if (j.showVideo) { const v = document.createElement('video'); v.src = j.result.url; v.controls = true; v.autoplay = true; d.appendChild(v); }
    }
    box.appendChild(d);
  }
}
$('#btnTrayClose').onclick = () => ($('#tray').hidden = true);
$('#btnFolder').onclick = () => fetch('/api/open', { method: 'POST' }).then(() => toast('Opened exports folder'));

// ---------------- settings UI ----------------
function syncInputs() {
  document.querySelectorAll('.seg').forEach((seg) => {
    const k = seg.dataset.key;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(state.settings[k]) === b.dataset.v));
  });
  for (const k of ['pacing', 'intensity', 'musicVol', 'clipVol']) $('#' + k).value = state.settings[k];
  $('#pacingVal').textContent = state.settings.pacing < 0.35 ? 'Hype' : state.settings.pacing < 0.65 ? 'Balanced' : 'Story';
  $('#intensityVal').textContent = Math.round(state.settings.intensity * 100) + '%';
  $('#musicVolVal').textContent = Math.round(state.settings.musicVol * 100) + '%';
  $('#clipVolVal').textContent = Math.round(state.settings.clipVol * 100) + '%';
  $('#hookText').value = state.settings.text;
  // a format that isn't one of the buttons is a custom one: show it in the W : H boxes
  const [fw, fh] = String(state.settings.format).split(':');
  $('#fmtW').value = fw; $('#fmtH').value = fh;
  $('#fmtCustom').classList.toggle('on', ![...$('#segFormat').querySelectorAll('button')].some((b) => b.dataset.v === state.settings.format));
}
// custom format: any W : H in whole numbers from 1 to 64 (5:4, 3:2, 9:21...), no thinner than 4 : 1
function useCustomFormat() {
  const w = Math.round(Number($('#fmtW').value)), h = Math.round(Number($('#fmtH').value));
  if (!(w >= 1 && h >= 1 && w <= 64 && h <= 64)) return toast('Type two whole numbers from 1 to 64, like 5 : 4');
  if (w / h > 4 || h / w > 4) return toast('That shape is too thin: keep it within 4 : 1');
  state.settings.format = `${w}:${h}`;
  applyMainToAll('format'); saveSettings(); syncInputs();
  layoutGrid(); updateText(); renderClips(); updateCards(); if (tuneIndex != null) renderTune();
  toast(`Format ${w}:${h} on every take`);
}
$('#btnFmtCustom').onclick = useCustomFormat;
for (const id of ['#fmtW', '#fmtH']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') useCustomFormat(); });
document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = seg.dataset.key;
    state.settings[k] = (k === 'length' || k === 'streamLen') && b.dataset.v !== 'match' ? Number(b.dataset.v) : b.dataset.v;
    applyMainToAll(k); saveSettings(); syncInputs();
    if (k === 'streamLen') { replanAll(); player.seek(0); toast(b.dataset.v === 'match' ? 'Each clip in full, with dead video at the ends cut off' : `Highlights up to ${b.dataset.v}s`); }
    if (k === 'length') { if (state.music) state.musicStart = suggestWindow(state.music.analysis, currentLength()); drawWave(); regenAll('length'); }
    if (k === 'format') { layoutGrid(); updateText(); renderClips(); }
    if (k === 'framing') renderClips();
    if (k === 'textColor') updateText();
    updateCards(); if (tuneIndex != null) renderTune();
  });
});
for (const k of ['pacing', 'intensity', 'musicVol', 'clipVol']) {
  $('#' + k).addEventListener('input', (e) => {
    state.settings[k] = Number(e.target.value);
    if (k === 'clipVol') state.clipVolTouched = true;
    if (k === 'musicVol') player.setMusicVolume(state.settings.musicVol);
    if (!e.target._applied) { e.target._applied = true; applyMainToAll(k); } // once per drag, not every tick
    saveSettings(); syncInputs();
    if (k === 'pacing') replanSoon();
    if (k === 'clipVol') replanSoon();
    updateCards(); if (tuneIndex != null) renderTune();
  });
  $('#' + k).addEventListener('change', (e) => { e.target._applied = false; if (k === 'pacing') regenAll('pacing'); });
}
$('#hookText').addEventListener('input', debounce((e) => { state.settings.text = e.target.value; applyMainToAll('text'); saveSettings(); updateText(); renderHookOpts(); }, 120));
$('#beatOffset').addEventListener('input', (e) => {
  state.beatOffset = Number(e.target.value);
  $('#offsetVal').textContent = `${state.beatOffset > 0 ? '+' : ''}${state.beatOffset} ms`;
  applyBeatOffset(); replanSoon();
});
$('#btnBestPart').onclick = () => { if (!state.music) return; state.musicStart = suggestWindow(state.music.analysis, currentLength()); drawWave(); replanAll(); player.seek(0); };
$('#btnRemoveMusic').onclick = removeMusic;
$('#btnGenerate').onclick = () => {
  if (isStream()) { state.variants.forEach((v) => { v.hiSkip = (v.hiSkip || 0) + 1; delete v.custom.title; }); replanAll(); player.seek(0); toast(`Next ${state.variants.length} highlights`); return; }
  state.variants.forEach((v) => (v.seed = (Math.random() * 1e9) | 0)); replanAll(); player.seek(0); toast(`${state.variants.length} new takes`);
};
// ---------------- MODE: edits or stream clips ----------------
function applyMode(first = false) {
  const st = isStream();
  document.body.classList.toggle('mode-stream', st);
  document.querySelectorAll('#modeSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.settings.mode));
  $('#segLength').dataset.key = st ? 'streamLen' : 'length';
  $('#editTitle').textContent = st ? 'Stream clips' : 'Edit';
  $('#lenLabel').textContent = st ? 'Max clip length' : 'Length';
  syncInputs(); renderMainLook();
  if (first) return;
  if (tuneIndex != null) closeTune();
  hiCache.key = ''; state.variants.forEach((v) => { v.hiSkip = 0; });
  refreshEff(); queueAllTracks(); replanAll(); player.seek(0); renderClips();
  toast(st ? 'Stream clips: the best highlights of your Twitch and Kick clips' : 'Edits: beat-synced takes');
}
document.querySelectorAll('#modeSwitch button').forEach((b) => {
  b.onclick = () => { if (state.settings.mode === b.dataset.mode) return; state.settings.mode = b.dataset.mode; saveSettings(); applyMode(); };
});

// ---------------- look controls: filters, effects, auto-focus, speed, fades ----------------
// Used twice: in the sidebar (main settings, all edits) and in each edit's own "Customize" panel.
const FORMATS = [['9:16', '9:16'], ['4:5', '4:5'], ['1:1', '1:1'], ['16:9', '16:9'], ['3:4', '3:4'], ['4:3', '4:3'], ['2:3', '2:3'], ['21:9', '21:9']];
const FADES = [[0, 'Off'], [0.3, '0.3s'], [0.5, '0.5s'], [1, '1s'], [2, '2s'], [3, '3s']];
const fadeName = (v) => (Number(v) ? `${Number(v)}s` : 'Off');
// text from outside (video titles, file names, channel names) goes into the page only through this
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pick(k, opts, cur, mainVal) {
  const main = mainVal !== undefined ? `<button data-k="${k}" data-v="" class="${cur === undefined ? 'on' : ''}">Main <i>${esc(mainVal)}</i></button>` : '';
  return `<div class="pick">${main}${opts.map(([v, l]) => `<button data-k="${k}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function filterChips(cur, inherit) {
  const main = inherit !== undefined ? `<button class="flt ${cur === undefined ? 'on' : ''}" data-k="filter" data-v=""><i class="sw main"></i>Main: ${esc(FILTERS[inherit]?.name || 'none')}</button>` : '';
  return `<div class="filters">${main}${Object.entries(FILTERS).map(([k, f]) =>
    `<button class="flt ${cur === k ? 'on' : ''}" data-k="filter" data-v="${k}"><i class="sw" style="background:linear-gradient(135deg,${f.sw[0]},${f.sw[1]})"></i>${f.name}</button>`).join('')}</div>`;
}
function fxChips(list, inherited) {
  return `<div class="fxchips ${inherited ? 'inherited' : ''}">${EXTRAS.map(([k, l]) => `<button class="fxc ${list.includes(k) ? 'on' : ''} ${ANIMATED_FX.has(k) ? 'anim' : ''}" data-fx="${k}"${ANIMATED_FX.has(k) ? ' title="Animated: moves on its own"' : ''}>${ANIMATED_FX.has(k) ? '✦ ' : ''}${l}</button>`).join('')}</div>`;
}
function fadeSel(k, cur, mainVal) {
  const opts = (mainVal !== undefined ? [`<option value="" ${cur === undefined ? 'selected' : ''}>Main (${fadeName(mainVal)})</option>`] : [])
    .concat(FADES.map(([v, l]) => `<option value="${v}" ${cur !== undefined && Number(cur) === v ? 'selected' : ''}>${l}</option>`));
  return `<select data-sel="${k}">${opts.join('')}</select>`;
}
// a dropdown of named options (values are strings); with mainVal, the first entry means "same as main"
function strSel(k, opts, cur, mainVal) {
  const main = mainVal !== undefined ? `<option value="" ${cur === undefined ? 'selected' : ''}>Main (${esc(mainVal)})</option>` : '';
  return `<select data-sel="${k}" data-str="1">${main}${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
const CAP_STYLE_OPTS = Object.entries(CAPTION_STYLES).map(([k, v]) => [k, v[0]]);
const CAP_FONT_OPTS = Object.entries(CAPTION_FONTS).map(([k, v]) => [k, v[0]]);
const ORDER_OPTS = [['scattered', 'Scattered'], ['story', 'In order']];
const PICK_OPTS = [['auto', 'Auto'], ['scenes', 'Best scenes'], ['quotes', 'Best quotes']];
const capName = (k) => (CAPTION_STYLES[k] || CAPTION_STYLES.yellow_pop)[0].split(' (')[0];
const fontName = (k) => (CAPTION_FONTS[k] || CAPTION_FONTS.segoe)[0].split(' (')[0];
function fadesBlock(get, mainOf) {
  const L = [['fadeIn', 'Video fade in'], ['fadeOut', 'Video fade out'], ['musicFadeIn', 'Song fade in'], ['musicFadeOut', 'Song fade out']];
  return `<div class="fades">${L.map(([k, l]) => `<label><span>${l}</span>${fadeSel(k, get(k), mainOf ? mainOf(k) : undefined)}</label>`).join('')}</div>`;
}

// ---- hook text: font, size, color, where it sits, when it shows ----
const HOOK_SPOTS = [['top', 'Top', 0.14], ['middle', 'Middle', 0.5], ['bottom', 'Bottom', 0.82]];
function renderHookOpts() {
  const s = state.settings, box = $('#hookOpts');
  if (!(s.text || '').trim()) { box.innerHTML = ''; return; }
  const y = s.hookY ?? (isStream() ? 0.07 : 0.2), spot = Math.abs((s.hookX ?? 0.5) - 0.5) < 0.01 ? HOOK_SPOTS.find((h) => Math.abs(h[2] - y) < 0.02)?.[0] : null;
  const num = (v) => (Number(v) > 0 ? String(Number(v)) : '');
  box.innerHTML = `
    <label class="field"><span>Font</span>${strSel('hookFont', CAP_FONT_OPTS, s.hookFont)}</label>
    <label class="field"><span>Size <em>${Math.round((Number(s.hookSize) || 1) * 100)}%</em></span><input type="range" data-hook="hookSize" min="0.5" max="2" step="0.05" value="${Number(s.hookSize) || 1}"></label>
    <div class="field"><span>Color</span>${pick('textColor', [['white', 'White'], ['yellow', 'Yellow'], ['black', 'Black']], s.textColor)}</div>
    <div class="field"><span>Position <em>${spot ? '' : 'moved by hand'}</em></span>${pick('hookSpot', HOOK_SPOTS.map(([k, l]) => [k, l]), spot || '')}
      <small class="hint-s">Or drag the text on any take to put it anywhere.</small></div>
    <div class="field"><span>Show it <em>${Number(s.hookEnd) > Number(s.hookStart) ? `for ${(Number(s.hookEnd) - Number(s.hookStart)).toFixed(1)}s` : 'until the end'}</em></span>
      <div class="hook-time"><label>from <input type="number" data-hook="hookStart" min="0" step="0.5" value="${num(s.hookStart) || '0'}">s</label>
      <label>to <input type="number" data-hook="hookEnd" min="0" step="0.5" placeholder="end" value="${num(s.hookEnd)}">s</label>
      <button class="small" data-hook-act="whole">Whole video</button></div></div>`;
}
$('#hookOpts').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const s = state.settings;
  if (b.dataset.k === 'hookSpot') { const h = HOOK_SPOTS.find((x) => x[0] === b.dataset.v); s.hookX = 0.5; s.hookY = h[2]; }
  else if (b.dataset.k === 'textColor') { s.textColor = b.dataset.v; applyMainToAll('textColor', true); }
  else if (b.dataset.hookAct === 'whole') { s.hookStart = 0; s.hookEnd = 0; }
  else return;
  saveSettings(); renderHookOpts();
});
$('#hookOpts').addEventListener('input', (e) => {
  const el = e.target.closest('[data-hook]'); if (!el) return;
  const k = el.dataset.hook;
  state.settings[k] = el.value === '' ? 0 : Math.max(0, Number(el.value) || 0);
  if (k === 'hookSize') el.closest('.field').querySelector('em').textContent = Math.round(state.settings.hookSize * 100) + '%';
  saveSettings();
});
$('#hookOpts').addEventListener('change', (e) => {
  if (e.target.matches('select[data-sel]')) { state.settings[e.target.dataset.sel] = e.target.value; saveSettings(); }
  if (e.target.matches('[data-hook="hookStart"], [data-hook="hookEnd"]')) renderHookOpts();
});

// ---- watermark: text (@name) or your logo, on every take and every export ----
const WM_SPOTS = [['tl', 'Top left', 0.16, 0.06], ['tr', 'Top right', 0.84, 0.06], ['c', 'Center', 0.5, 0.5], ['bl', 'Bottom left', 0.16, 0.93], ['br', 'Bottom right', 0.84, 0.93]];
const WM_COLORS = [['#ffffff', 'White'], ['#111111', 'Black'], ['#ffd400', 'Yellow']];
function renderWmOpts() {
  const s = state.settings, box = $('#wmOpts');
  $('#wmPick').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.wm === (s.wm || 'off')));
  $('#wmState').textContent = s.wm === 'text' ? (String(s.wmText || '').trim() ? 'text on every take' : 'type your text') : s.wm === 'logo' ? (wmLogo ? 'logo on every take' : 'choose a picture') : 'off';
  if (s.wm !== 'text' && s.wm !== 'logo') { box.innerHTML = ''; return; }
  const spot = WM_SPOTS.find((p) => Math.abs(p[2] - Number(s.wmX)) < 0.01 && Math.abs(p[3] - Number(s.wmY)) < 0.01)?.[0] || '';
  const pct = (v) => Math.round(Number(v) * 100);
  const custom = !WM_COLORS.some(([h]) => h === s.wmColor);
  box.innerHTML = (s.wm === 'text' ? `
    <label class="field"><span>Text</span><input type="text" data-wmt maxlength="40" spellcheck="false" placeholder="@yourname" value="${esc(s.wmText || '')}"></label>
    <label class="field"><span>Font</span>${strSel('wmFont', CAP_FONT_OPTS, s.wmFont)}</label>
    <div class="field"><span>Color</span><div class="wm-colors">${WM_COLORS.map(([h, n]) => `<button data-wmc="${h}" class="${s.wmColor === h ? 'on' : ''}" style="--sw:${h}" title="${n}" aria-label="${n}"></button>`).join('')}
      <label class="sw-custom ${custom ? 'on' : ''}"><input type="color" data-wmcolor value="${esc(s.wmColor || '#ffffff')}" aria-label="Any color"><span>Custom</span></label></div></div>
    <div class="field"><span>Style</span>${pick('wmStyle', [['shadow', 'Shadow'], ['outline', 'Outline'], ['box', 'Box'], ['plain', 'Plain']], s.wmStyle)}</div>`
  : `<div class="field"><span>Logo <em>PNG with a see-through background looks best</em></span>
      <div class="wm-logo">${wmLogo ? `<img src="${wmLogo}" alt="Your logo">` : '<i>No picture yet</i>'}
        <button class="small" data-wmact="pick">${wmLogo ? 'Change' : 'Choose picture…'}</button>${wmLogo ? '<button class="small" data-wmact="clear">Remove</button>' : ''}</div></div>
    <div class="field"><span>Style</span>${pick('wmStyle', [['plain', 'Plain'], ['shadow', 'Shadow'], ['box', 'Box']], s.wmStyle)}</div>`) + `
    <label class="field"><span>Size <em>${pct(s.wmSize)}%</em></span><input type="range" data-wmr="wmSize" min="0.4" max="2.5" step="0.05" value="${Number(s.wmSize) || 1}"></label>
    <label class="field"><span>See-through <em>${pct(s.wmOpacity)}% visible</em></span><input type="range" data-wmr="wmOpacity" min="0.1" max="1" step="0.05" value="${Number(s.wmOpacity) || 0.7}"></label>
    <div class="field"><span>Position <em>${spot ? '' : 'moved by hand'}</em></span>${pick('wmSpot', WM_SPOTS.map(([k, l]) => [k, l]), spot)}
      <small class="hint-s">Or drag it on any take to put it anywhere.</small></div>`;
}
function wmChanged() { saveSettings(); refreshEff(); player.views.forEach((v) => { if (v) v.dirty = true; }); }
$('#wmPick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-wm]'); if (!b) return;
  state.settings.wm = b.dataset.wm;
  if (b.dataset.wm === 'logo' && !wmLogo) $('#fileLogo').click();
  wmChanged(); renderWmOpts();
});
$('#wmOpts').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const s = state.settings;
  if (b.dataset.wmc) s.wmColor = b.dataset.wmc;
  else if (b.dataset.k === 'wmStyle') s.wmStyle = b.dataset.v;
  else if (b.dataset.k === 'wmSpot') { const p = WM_SPOTS.find((x) => x[0] === b.dataset.v); s.wmX = p[2]; s.wmY = p[3]; }
  else if (b.dataset.wmact === 'pick') { $('#fileLogo').click(); return; }
  else if (b.dataset.wmact === 'clear') { wmLogo = ''; try { localStorage.removeItem('cutsona.wmLogo'); } catch {} }
  else return;
  wmChanged(); renderWmOpts();
});
$('#wmOpts').addEventListener('input', (e) => {
  const s = state.settings, el = e.target;
  if (el.matches('[data-wmt]')) { s.wmText = el.value; wmChanged(); $('#wmState').textContent = el.value.trim() ? 'text on every take' : 'type your text'; }
  else if (el.matches('[data-wmcolor]')) { s.wmColor = el.value; wmChanged(); }
  else if (el.matches('[data-wmr]')) {
    s[el.dataset.wmr] = Number(el.value); wmChanged();
    el.closest('.field').querySelector('em').textContent = el.dataset.wmr === 'wmSize' ? `${Math.round(el.value * 100)}%` : `${Math.round(el.value * 100)}% visible`;
  }
});
$('#wmOpts').addEventListener('change', (e) => {
  if (e.target.matches('select[data-sel]')) { state.settings[e.target.dataset.sel] = e.target.value; wmChanged(); }
  if (e.target.matches('[data-wmcolor]')) renderWmOpts();
});
$('#fileLogo').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) { if (!wmLogo) { state.settings.wm = 'off'; wmChanged(); renderWmOpts(); } return; }
  try {
    wmLogo = await shrinkLogo(f);
    try { localStorage.setItem('cutsona.wmLogo', wmLogo); } catch { toast('That logo is too big to remember after closing Cutsona: it works until then', true); }
    state.settings.wm = 'logo'; if (state.settings.wmStyle === 'outline') state.settings.wmStyle = 'plain';
    wmChanged(); renderWmOpts(); toast('Logo added to every take');
  } catch (err) { toast(err.message, true); }
};

// ---- sidebar (main settings) ----
function renderMainLook() {
  renderWmOpts();
  renderHookOpts();
  const s = state.settings;
  if (s.mode === 'stream') {
    // stream clips: layout, captions, title, dead air, punch-in zoom, a color filter
    const brains = state.clips.map((c) => c.crowd?.brain).filter(Boolean);
    const b = brains[0];
    $('#mainLook').innerHTML = `
      <div class="field"><span>Layout <em>${s.streamLayout === 'auto' ? 'cam on top when there is a facecam' : ''}</em></span>${pick('streamLayout', STREAM_LAYOUTS, s.streamLayout)}</div>
      ${s.streamLayout !== 'full' ? `<div class="sub-block">
        <div class="field"><span>Which half is on top</span>${pick('stackSwap', [['off', 'Cam on top'], ['on', 'Screen on top']], s.stackSwap)}</div>
        <div class="field"><span>Screen <em>${s.stackGame === 'whole' ? 'the whole stream, nothing cropped' : 'cropped to fill its half'}</em></span>${pick('stackGame', [['fill', 'Fill'], ['whole', 'Whole screen']], s.stackGame)}</div>
        <div class="field"><span>Cam</span>${pick('stackCam', [['face', 'Face close-up'], ['whole', 'Whole webcam']], s.stackCam)}</div>
        <div class="field"><span>Cam size</span>${pick('stackSplit', [['0.4', 'Small'], ['0.5', 'Half'], ['0.6', 'Big']], String(s.stackSplit))}</div>
      </div>` : ''}
      <div class="field"><span>Banner <em>${s.streamBanner === 'off' ? 'off' : 'the platform and the streamer\'s name'}</em></span>${pick('streamBanner', [['on', 'On'], ['off', 'Off']], s.streamBanner)}</div>
      ${s.streamBanner !== 'off' ? `<label class="field"><span>Name on the banner <em>${String(s.bannerName || '').trim() ? '' : b?.name ? 'from the clip: ' + esc(b.name) : 'type the streamer\'s name'}</em></span>
        <input class="text-in" data-text="bannerName" maxlength="40" spellcheck="false" placeholder="${esc(b?.name || 'streamer name')}" value="${esc(s.bannerName || '')}"></label>
      <div class="field"><span>Platform</span>${pick('bannerPlatform', [['auto', 'From the clip'], ['twitch', 'Twitch'], ['kick', 'Kick']], s.bannerPlatform || 'auto')}</div>
      <div class="field"><span>Banner look</span><div class="themes">${BANNER_THEMES.map(([k, l, d]) =>
        `<button data-k="bannerTheme" data-v="${k}" class="theme t-${k} ${s.bannerTheme === k ? 'on' : ''}" title="${esc(d)}"><i></i>${l}</button>`).join('')}</div>
        ${s.bannerX != null ? '<div class="set-row"><button class="small" data-banner-reset>Banner back to its usual place</button></div>' : '<small class="hint-s">Drag the banner on any take to move it anywhere.</small>'}</div>` : ''}
      <div class="field"><span>Captions <em>word by word</em></span>${pick('streamCaptions', [['on', 'On'], ['off', 'Off']], s.streamCaptions)}</div>
      ${s.streamCaptions === 'on' ? `<div class="field"><span>Caption style</span>${strSel('streamCaptionStyle', CAP_STYLE_OPTS, s.streamCaptionStyle)}</div>` : ''}
      <div class="field"><span>Title box <em>viewer clip title or the best line</em></span>${pick('streamTitle', [['on', 'On'], ['off', 'Off']], s.streamTitle)}</div>
      <div class="field"><span>Cuts <em>${s.streamCuts === 'pauses' ? 'jump cuts remove pauses' : 'one continuous piece, nothing cut out'}</em></span>${pick('streamCuts', [['none', 'No cuts'], ['pauses', 'Cut pauses']], s.streamCuts)}</div>
      <div class="field"><span>Zoom on big reactions</span>${pick('reactZoom', [['on', 'On'], ['off', 'Off']], s.reactZoom)}</div>
      <div class="field"><span>Filter</span>${filterChips(s.filter)}</div>
      <small class="hint-s brain">${b ? `Clip brain: learned from the ${b.clips.length} most-viewed ${b.platform === 'kick' ? 'Kick' : 'Twitch'} clips of <b>${esc(b.name)}</b>${b.typicalLength ? ` (their best clips run ~${Math.round(b.typicalLength)}s)` : ''}${brains.some((x) => x.matches?.length) ? ' and the moments viewers clipped from this stream' : ''}.`
        : 'Add Twitch / Kick clips or a stream (Find clips → Twitch / Kick, or paste a link). The clip brain learns from the channel\'s most-viewed clips which moments work, then picks the best highlights: what viewers clipped, big laughs and reactions, hooks.'}</small>`;
    return;
  }
  $('#mainLook').innerHTML = `
    <div class="field"><span>Filter</span>${filterChips(s.filter)}</div>
    <div class="field"><span>Extra effects <em>${s.fx.length ? s.fx.length + ' on' : 'tap to stack'}</em></span>${fxChips(s.fx)}</div>
    <div class="field"><span>Auto-focus on faces &amp; bodies <em>${s.focus === 'on' ? 'follows people' : 'shows the whole clip'}</em></span>${pick('focus', [['on', 'On'], ['off', 'Off']], s.focus)}
      ${s.focus === 'on' ? '' : '<small class="hint-s">The camera stays still and every take shows the whole picture. Cuts and effects still land on the beat.</small>'}</div>
    <div class="field"><span>What to use from your clips <em>${s.pick === 'quotes' ? 'inspiring lines' : s.pick === 'scenes' ? 'top moments' : 'smart mix'}</em></span>${pick('pick', PICK_OPTS, s.pick)}
      <small class="hint-s">${s.pick === 'quotes' ? 'Finds the best things said in your clips (inspiring, quotable lines) and plays each one in full, with the music dipped under it.' : s.pick === 'scenes' ? 'Uses the strongest visual moments (action, reactions, big movement) and ignores talking.' : 'Mixes the loudest moments, full sentences and action.'}</small></div>
    <div class="field"><span>Clip order <em>${s.order === 'story' ? 'follows your clips' : 'mixed up'}</em></span>${pick('order', ORDER_OPTS, s.order)}
      <small class="hint-s">${s.order === 'story' ? 'Plays your clips top to bottom (as listed under Clips, drag to reorder) and moves forward through each video, cut to the beat, so the edit tells it in order.' : 'Picks the best moments from anywhere in any clip, in any order.'}</small></div>
    <div class="field"><span>Auto-captions</span>${pick('captions', [['off', 'Off'], ['on', 'On']], s.captions)}</div>
    ${s.captions === 'on' || s.pick === 'quotes' ? `<div class="field"><span>Caption style</span>${strSel('captionStyle', CAP_STYLE_OPTS, s.captionStyle)}</div>
      <div class="field"><span>Caption font</span>${strSel('captionFont', CAP_FONT_OPTS, s.captionFont)}</div>` : ''}
    <div class="field"><span>Speed ramps &amp; slow-mo</span>${pick('speed', [['on', 'On'], ['off', 'Off (normal speed)']], s.speed)}</div>
    <div class="field"><span>Fades</span>${fadesBlock((k) => s[k])}</div>`;
}
function onLookClick(e, mode) {
  const i = tuneIndex;
  const tgt = mode === 'main' ? state.settings : state.variants[i].custom;
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.part && mode === 'edit') { toggleCardEffect(i, b.dataset.part === 'speed' ? 'speed' : 'part', b.dataset.part); return; }
  if (b.dataset.allparts && mode === 'edit') { toggleCardEffect(i, 'all', b.dataset.allparts); return; }
  if (b.dataset.fx) {
    const base = mode === 'main' ? state.settings.fx : (Array.isArray(tgt.fx) ? tgt.fx : eff(i).fx);
    const list = base.includes(b.dataset.fx) ? base.filter((x) => x !== b.dataset.fx) : [...base, b.dataset.fx];
    tgt.fx = list;
    commit(mode, 'fx');
  } else if (b.dataset.k) {
    const k = b.dataset.k, v = b.dataset.v;
    if (mode === 'edit' && v === '') delete tgt[k]; else tgt[k] = v;
    commit(mode, k);
  } else if (b.dataset.act) tuneAction(b.dataset.act);
}
function onLookSelect(e, mode) {
  const el = e.target.closest('select[data-sel]');
  if (!el) return;
  const tgt = mode === 'main' ? state.settings : state.variants[tuneIndex].custom;
  const k = el.dataset.sel;
  if (mode === 'edit' && el.value === '') delete tgt[k]; else tgt[k] = el.dataset.str ? el.value : Number(el.value);
  commit(mode, k);
}
// A setting changed on the main screen goes to all 4 edits: any edit that had its own value for it follows main again.
// Settings that change WHAT the edits show (not just how they look): changing one on the main screen
// remakes all 4 edits as fresh takes built around the new setting.
const REGEN_KEYS = new Set(['pick', 'order', 'pacing', 'speed', 'captions', 'length']);
// stream clip settings: re-cut the 4 highlights with the new setting
const STREAM_KEYS = new Set(['streamLayout', 'streamTitle', 'streamCuts', 'reactZoom', 'streamLen', 'bannerPlatform']);
const REGEN_LABEL = {
  pick: () => ({ auto: 'a smart mix', scenes: 'Best scenes', quotes: 'Best quotes' })[state.settings.pick] || state.settings.pick,
  order: () => (state.settings.order === 'story' ? 'In order' : 'Scattered'), pacing: () => 'the new pacing',
  speed: () => (state.settings.speed === 'on' ? 'speed ramps' : 'normal speed'), captions: () => (state.settings.captions === 'on' ? 'captions' : 'no captions'),
  length: () => (state.settings.length === 'match' ? `the length of your clips (${currentLength()}s)` : `${state.settings.length}s`),
};
function regenAll(k) {
  state.variants.forEach((v) => { v.seed = (Math.random() * 1e9) | 0; });
  replanAll(); player.seek(0);
  toast(`All ${state.variants.length} takes remade with ${REGEN_LABEL[k] ? REGEN_LABEL[k]() : 'the new setting'}`);
}
function applyMainToAll(k, quiet = REGEN_KEYS.has(k)) {
  let n = 0;
  state.variants.forEach((v) => {
    const c = v.custom || {};
    if (c[k] !== undefined && c[k] !== null && !(k === 'text' && !String(c.text).trim())) { delete c[k]; n++; }
    if (k === 'speed' && c.off?.includes('speed')) { c.off = c.off.filter((x) => x !== 'speed'); n++; }
    // the new main filter / effect counts as switched on for every edit
    if ((k === 'filter' || k === 'fx') && v.dropped?.length) {
      const now = k === 'filter' ? [state.settings.filter] : state.settings.fx;
      v.dropped = v.dropped.filter((d) => !(d.kind === k && now.includes(d.key)));
    }
  });
  if (n) { saveCustom(); if (!quiet) toast(`Applied to all ${state.variants.length} takes`); }
  return n;
}
function commit(mode, k) {
  if (mode === 'main') applyMainToAll(k);
  mode === 'main' ? saveSettings() : saveCustom();
  if (STREAM_KEYS.has(k)) { state.variants.forEach((v) => { if (k === 'streamLayout') delete v.custom.layout; }); replanAll(); }
  else if (mode === 'main' && REGEN_KEYS.has(k)) regenAll(k);
  else if (k === 'pacing' || k === 'speed' || k === 'captions' || k === 'pick' || k === 'order') replanSoon();
  if (k === 'pick') queueAllSpeech();
  if (k === 'format' || k === 'textColor' || k === 'text') { updateText(); requestAnimationFrame(layoutGrid); }
  if (k === 'format' || k === 'framing' || k === 'focus') renderClips();
  if (k === 'focus') queueAllTracks();
  if (k === 'captions' && state.variants.some((_, i) => eff(i).captions === 'on')) queueAllSpeech();
  updateCards();
  renderMainLook();
  if (tuneIndex != null) renderTune();
}
$('#mainLook').addEventListener('click', (e) => {
  if (e.target.closest('[data-banner-reset]')) { state.settings.bannerX = null; state.settings.bannerY = null; saveSettings(); refreshEff(); renderMainLook(); return; }
  onLookClick(e, 'main');
});
$('#mainLook').addEventListener('change', (e) => onLookSelect(e, 'main'));
// the banner name: typed text replans every take after a short pause (the field keeps focus)
let nameTimer = 0;
$('#mainLook').addEventListener('input', (e) => {
  const el = e.target.closest('[data-text="bannerName"]'); if (!el) return;
  state.settings.bannerName = el.value; saveSettings();
  clearTimeout(nameTimer); nameTimer = setTimeout(() => { replanAll(); updateCards(); }, 350);
});

// ---- per-edit "Customize" panel ----
let tuneIndex = null;
function openTune(i) {
  tuneIndex = i; state.focused = i;
  $('#tune').hidden = false; document.querySelector('.stage').classList.add('tuning');
  renderTune(); updateCards(); requestAnimationFrame(layoutGrid);
}
function closeTune() {
  tuneIndex = null;
  $('#tune').hidden = true; document.querySelector('.stage').classList.remove('tuning');
  updateCards(); requestAnimationFrame(layoutGrid);
}
function renderTune() {
  const i = tuneIndex;
  if (i == null) return;
  if (isStream()) {
    // a stream clip: its title and its layout
    const v = state.variants[i], H = v.plan?.highlight;
    $('#tune').style.setProperty('--c', '#53fc18');
    $('#tune').innerHTML = `
      <div class="tune-h"><span class="num">${i + 1}</span><div class="tt"><b>Take ${i + 1}${H ? `: highlight ${H.rank}` : ''}</b><small>${H ? esc(H.why) : ''}</small></div>
        <button class="small" data-act="close">Done</button></div>
      <div class="tune-b">
        <div class="field"><span>Title <em>${v.custom.title != null ? '<button class="reset" data-act="reset:title">↺ auto</button>' : 'auto'}</em></span>
          <input type="text" data-stitle maxlength="90" value="${esc(v.custom.title ?? H?.title ?? '')}"></div>
        <div class="field"><span>Layout</span>${pick('layout', STREAM_LAYOUTS, v.custom.layout || 'auto')}</div>
        ${H?.layout === 'stack' ? '<small class="hint-s">Card motion works on full-frame clips (the cam / screen layout stays put).</small>' : keysBlock(i)}
        <div class="tune-actions"><button class="small" data-act="next">Next highlight</button></div>
      </div>`;
    const inp = $('#tune [data-stitle]');
    inp.oninput = debounce(() => { v.custom.title = inp.value; saveCustom(); updateCards(); }, 150);
    $('#tune').onclick = (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'close') return closeTune();
      if (b.dataset.act === 'reset:title') { delete v.custom.title; saveCustom(); renderTune(); return; }
      if (b.dataset.act === 'next') { nextHighlight(i); renderTune(); return; }
      if (b.dataset.k === 'layout') { if (b.dataset.v === 'auto') delete v.custom.layout; else v.custom.layout = b.dataset.v; saveCustom(); replan(i); refreshEff(); updateCards(); renderTune(); }
    };
    return;
  }
  $('#tune').onclick = null;
  const v = state.variants[i], c = v.custom, s = state.settings, e = eff(i), st = STYLES[v.styleId];
  const ownFx = Array.isArray(c.fx);
  const slider = (k, min, max, step, label) => `
    <div class="field"><span>${label} <em>${c[k] !== undefined ? `<b class="tv" data-tv="${k}">${fmtVal(k, e[k])}</b> <button class="reset" data-act="reset:${k}" title="Back to main">↺ main</button>` : `<b class="tv" data-tv="${k}">${fmtVal(k, e[k])}</b> (main)`}</em></span>
      <input type="range" data-range="${k}" min="${min}" max="${max}" step="${step}" value="${e[k]}"></div>`;
  $('#tune').style.setProperty('--c', st.color);
  $('#tune').innerHTML = `
    <div class="tune-h"><span class="num">${i + 1}</span><div class="tt"><b>Take ${i + 1}: ${st.name}</b><small>Changes here only affect this take</small></div>
      <button class="small" data-act="close">Done</button></div>
    <div class="tune-b">
      <div class="field"><span>Size</span>${pick('format', FORMATS, c.format, s.format)}</div>
      <div class="field"><span>Framing</span>${pick('framing', [['fill', 'Fill (crop)'], ['fit', 'Fit + blur']], c.framing, s.framing === 'fit' ? 'Fit' : 'Fill')}</div>
      ${(() => { const fx = styleEffects(i), n = fx.filter((p) => p.on).length; return `<div class="field"><span>${esc(st.name)} style effects <em>${n} of ${fx.length} on
        <button class="reset" data-allparts="on">all on</button> <button class="reset" data-allparts="off">all off</button></em></span><div class="fxchips">${fx.map((p) =>
        `<button class="fxc ${p.on ? 'on' : ''}" data-part="${p.key}" title="${p.kind === 'speed' ? 'Same switch as “Speed ramps & slow-mo” below' : ''}">${esc(p.label)}</button>`).join('')}</div></div>`; })()}
      <div class="field"><span>Filter</span>${filterChips(c.filter, s.filter)}</div>
      <div class="field"><span>Effects <em>${ownFx ? `${e.fx.length} on, <button class="reset" data-act="reset:fx">↺ use main</button>` : `same as main (${s.fx.length})`}</em></span>${fxChips(e.fx, !ownFx)}</div>
      ${slider('intensity', 0, 2, 0.05, 'Effect strength')}
      ${slider('pacing', 0, 1, 0.05, 'Pacing')}
      <div class="field"><span>Speed ramps &amp; slow-mo</span>${pick('speed', [['on', 'On'], ['off', 'Off']], c.speed, s.speed === 'on' ? 'On' : 'Off')}</div>
      <div class="field"><span>Auto-focus on faces &amp; bodies</span>${pick('focus', [['on', 'On'], ['off', 'Off']], c.focus, s.focus === 'on' ? 'On' : 'Off')}</div>
      <div class="field"><span>What to use from the clips</span>${pick('pick', PICK_OPTS, c.pick, PICK_OPTS.find((o) => o[0] === s.pick)?.[1] || 'Auto')}</div>
      <div class="field"><span>Clip order</span>${pick('order', ORDER_OPTS, c.order, ORDER_OPTS.find((o) => o[0] === s.order)?.[1] || 'Scattered')}</div>
      <div class="field"><span>Auto-captions</span>${pick('captions', [['off', 'Off'], ['on', 'On']], c.captions, s.captions === 'on' ? 'On' : 'Off')}</div>
      ${e.captions === 'on' ? `<div class="field"><span>Caption style</span>${strSel('captionStyle', CAP_STYLE_OPTS, c.captionStyle, capName(s.captionStyle))}</div>
        <div class="field"><span>Caption font</span>${strSel('captionFont', CAP_FONT_OPTS, c.captionFont, fontName(s.captionFont))}</div>` : ''}
      <div class="field"><span>Fades</span>${fadesBlock((k) => c[k], (k) => s[k])}</div>
      <div class="field"><span>Hook text <em>empty = main text</em></span><input type="text" data-text maxlength="90" placeholder="${esc(s.text || 'e.g. WAIT FOR IT')}" value="${esc(c.text || '')}"></div>
      <div class="field"><span>Text color</span>${pick('textColor', [['white', 'White'], ['yellow', 'Yellow'], ['black', 'Black']], c.textColor, s.textColor === 'yellow' ? 'Yellow' : s.textColor === 'black' ? 'Black' : 'White')}</div>
      ${keysBlock(i)}
      <div class="tune-actions"><button class="small" data-act="copy">Copy to all takes</button><button class="small" data-act="reset">Reset to main</button></div>
    </div>`;
}
// ---- keyframes: this take's own card motion ----
const KEY_SLIDERS = [['scale', 'Size', 0, 300, '%'], ['x', 'Left / right', -100, 100, '%'], ['y', 'Up / down', -100, 100, '%'],
  ['rot', 'Turn', -180, 180, '°'], ['tiltX', 'Tilt', -80, 80, '°'], ['opacity', 'Show', 0, 100, '%']];
const KEY_EASES = [['smooth', 'Smooth'], ['out', 'Slow down'], ['in', 'Speed up'], ['linear', 'Steady'], ['snap', 'Snap']];
const pctKey = (p) => p === 'scale' || p === 'opacity' || p === 'x' || p === 'y';
const keyUI = (p, v) => Math.round(pctKey(p) ? v * 100 : v);
const keyFromUI = (p, v) => (pctKey(p) ? v / 100 : v);
function keysBlock(i) {
  const keys = state.variants[i].custom.keys || [], t = i === state.focused ? player.now() : 0, on = cardKeyAt(i, t), k = keys[on];
  return `<div class="field keys-block" data-sig="${on}:${on < 0 ? fmt(t) : ''}">
    <p class="kb-note">Card motion moves <b>the whole video</b> of this take, across every cut. It's separate from camera keyframes:
      to move the camera inside just one cut, use <a href="#" data-cam-link>Camera move</a>.</p>
    <div class="kb-h"><span>Card motion <em>keyframes</em></span><small>${keys.length ? `${keys.length} keyframe${keys.length > 1 ? 's' : ''}${on >= 0 ? `, on keyframe ${on + 1}` : ''}` : 'none: the card stays still'}</small></div>
    <div class="kb-row">
      <button class="small" data-key-add ${on >= 0 ? 'disabled' : ''} title="Mark where the card is at the playhead. Then move the playhead and change the card: the card glides between keyframes">◆ Add keyframe at ${fmt(t)}</button>
      ${on >= 0 ? `<button class="small" data-key-del="${on}" title="Delete the keyframe at the playhead">Delete keyframe</button>` : ''}
      ${keys.length ? '<button class="small" data-key-clear title="Remove the whole card motion from this take">Clear all</button>' : ''}
    </div>
    ${k ? `<div class="kb-edit">${KEY_SLIDERS.map(([p, l, a, b, u]) => { const v = keyUI(p, k[p] ?? KEY_PROPS[p] ?? 0); return `<label class="kb-sl"><span>${l} <em>${v}${u}</em></span><input type="range" min="${a}" max="${b}" step="1" value="${v}" data-key-i="${on}" data-key-p="${p}" data-u="${u}"></label>`; }).join('')}
      <label class="kb-sl"><span>Glide into this one</span><select data-key-i="${on}" data-key-p="ease">${KEY_EASES.map(([e, l]) => `<option value="${e}" ${(k.ease || 'smooth') === e ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`
    : `<small class="hint-s">${keys.length ? 'To change a keyframe, put the playhead on its ◆: click it in the Card row of the timeline.' : 'Add a keyframe, move the playhead, add another and change the card there: it glides from one to the next.'} Drag a ◆ on the timeline to move it.</small>`}
  </div>`;
}
// "Camera move" link in the take's settings: open the cut at the playhead in the shot editor and make its
// Camera move section glow, so it's easy to find. ("Card motion" in the shot editor does the reverse.)
function glow(el) {
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.remove('glow'); void el.offsetWidth; el.classList.add('glow');
  clearTimeout(el._glowT); el._glowT = setTimeout(() => el.classList.remove('glow'), 2600);
}
function showCameraMove() {
  const i = tuneIndex ?? state.focused;
  if (i !== state.focused) focusCard(i);
  if (!state.variants[state.focused].plan) return;
  player.pause(); updatePlayIcon();
  shotBar.select(shotBar.shotAt(player.now()), { seek: false });
  requestAnimationFrame(() => glow(document.querySelector('#shotBar .sb-move')));
}
function showCardMotion() {
  if (tuneIndex !== state.focused) openTune(state.focused);
  requestAnimationFrame(() => glow(document.querySelector('#tune .keys-block')));
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-cam-link], [data-card-link]'); if (!a) return;
  e.preventDefault();
  if (a.matches('[data-cam-link]')) showCameraMove(); else showCardMotion();
});
// card-motion keyframes on the timeline: add one at time t (with the card's values there), select one
let selKey = -1;
function addCardKey(i, t) {
  const v = state.variants[i], D = v.plan?.duration || 10, keys = [...(v.custom.keys || [])];
  t = Math.max(0, Math.min(D, t));
  const cur = keyValues(keys.length ? [...keys].sort((a, c) => a.t - c.t) : null, t) || { ...KEY_PROPS };
  const next = [...keys.filter((k) => Math.abs(k.t - t) > 0.05), { ...cur, t, ease: 'smooth' }].sort((a, c) => a.t - c.t);
  selKey = next.findIndex((k) => Math.abs(k.t - Math.round(t * 100) / 100) < 0.006);
  player.pause(); updatePlayIcon(); player.seek(t);
  if (tuneIndex !== i) openTune(i);
  setKeys(i, next);
  document.querySelector('#tune .keys-block')?.scrollIntoView({ block: 'nearest' });
  toast(`Card keyframe at ${fmt(t)}: change it with the sliders under Card motion`);
}
function setKeys(i, keys) {
  const v = state.variants[i];
  if (keys?.length) v.custom.keys = keys.map((k) => ({ ...k, t: Math.max(0, Math.round(k.t * 100) / 100) })).sort((a, b) => a.t - b.t); else delete v.custom.keys;
  saveCustom(); updateCards(); renderTune();
}
$('#tune').addEventListener('click', (e) => {
  const i = tuneIndex; if (i == null) return;
  const b = e.target.closest('button'); if (!b) return;
  const D = state.variants[i].plan?.duration || 10;
  if (b.dataset.keyAdd != null) { if (i !== state.focused) return; addCardKey(i, player.now()); drawTimeline(player.now(), player.duration()); }
  else if (b.dataset.keyDel != null) { const keys = [...(state.variants[i].custom.keys || [])]; keys.splice(Number(b.dataset.keyDel), 1); setKeys(i, keys); }
  else if (b.dataset.keyClear != null) { selKey = -1; setKeys(i, []); }
});
$('#tune').addEventListener('change', (e) => {
  const el = e.target.closest('[data-key-i]'), i = tuneIndex; if (!el || i == null) return;
  const keys = (state.variants[i].custom.keys || []).map((k) => ({ ...k })), k = keys[Number(el.dataset.keyI)], p = el.dataset.keyP;
  if (!k) return;
  if (p === 'ease') k.ease = el.value;
  else {
    // a slider: already applied live; just keep it (no redraw of the panel, so the slider keeps focus)
    state.variants[i].custom.keys[Number(el.dataset.keyI)][p] = keyFromUI(p, Number(el.value) || 0);
    saveCustom(); updateCards(); return;
  }
  setKeys(i, keys);
});
// dragging a keyframe slider: the card moves live, saved when you let go (the change above)
$('#tune').addEventListener('input', (e) => {
  const el = e.target.closest('input[type=range][data-key-i]'), i = tuneIndex; if (!el || i == null) return;
  const k = state.variants[i].custom.keys?.[Number(el.dataset.keyI)]; if (!k) return;
  k[el.dataset.keyP] = keyFromUI(el.dataset.keyP, Number(el.value) || 0);
  const em = el.closest('.kb-sl')?.querySelector('em'); if (em) em.textContent = el.value + (el.dataset.u || '');
  ctxCache = []; refreshEff(); player.seek(player.now());
});
// the playhead moved onto / off a keyframe: show that keyframe's settings (or the Add button with the new time)
function refreshKeysBlock(t) {
  const i = tuneIndex; if (i == null || i !== state.focused) return;
  const el = document.querySelector('#tune .keys-block'); if (!el) return;
  const on = cardKeyAt(i, t);
  // only redraw the block when the playhead lands on / leaves a keyframe; otherwise just update the time on the Add button
  // (redrawing it every frame while playing would swallow clicks on its buttons and link)
  if (el.dataset.sig.split(':')[0] !== String(on)) { el.outerHTML = keysBlock(i); return; }
  const add = el.querySelector('[data-key-add]'), label = `◆ Add keyframe at ${fmt(t)}`;
  if (add && add.textContent !== label) add.textContent = label;
}
function fmtVal(k, v) {
  v = Number(v);
  if (k === 'intensity') return Math.round(v * 100) + '%';
  if (k === 'pacing') return v < 0.35 ? 'Hype' : v < 0.65 ? 'Balanced' : 'Story';
  return String(v);
}
function tuneAction(act) {
  const i = tuneIndex;
  if (act === 'close') return closeTune();
  if (act === 'reset') { state.variants[i].custom = {}; commit('edit', 'format'); replanSoon(); toast(`Edit ${i + 1} back to main settings`); return; }
  if (act === 'copy') {
    const c = JSON.parse(JSON.stringify(state.variants[i].custom));
    state.variants.forEach((v, j) => { if (j !== i) v.custom = JSON.parse(JSON.stringify(c)); });
    commit('edit', 'format'); queueAllTracks(); replanSoon(); toast('Copied to all takes'); return;
  }
  if (act.startsWith('reset:')) { const k = act.slice(6); delete state.variants[i].custom[k]; commit('edit', k); if (k === 'pacing') replanSoon(); }
}
$('#tune').addEventListener('click', (e) => { if (!isStream()) onLookClick(e, 'edit'); });
$('#tune').addEventListener('change', (e) => {
  if (isStream()) return;
  if (e.target.matches('input[data-range]')) { commit('edit', e.target.dataset.range); return; }
  onLookSelect(e, 'edit');
});
$('#tune').addEventListener('input', (e) => {
  if (isStream()) return;
  const r = e.target.closest('input[data-range]');
  if (r) {
    const k = r.dataset.range;
    state.variants[tuneIndex].custom[k] = Number(r.value);
    saveCustom();
    const tv = $(`#tune [data-tv="${k}"]`); if (tv) tv.textContent = fmtVal(k, r.value);
    if (k === 'pacing') replanSoon();
    return;
  }
  if (e.target.matches('input[data-text]')) {
    state.variants[tuneIndex].custom.text = e.target.value;
    saveCustom(); updateCards();
  }
});

// ---- view: all 4 at once, or just one big ----
function updateViewBar() {
  const vb = $('#viewBar');
  if (!vb) return;
  vb.innerHTML = `<div class="pick view"><button data-view="all" class="${state.solo ? '' : 'on'}" title="Play every take at the same time">▦ All ${state.variants.length}</button>
    <button data-view="one" class="${state.solo ? 'on' : ''}" title="Watch one edit big (V)">▢ One</button></div>` +
    (state.solo ? `<div class="solo-nav">${state.variants.map((v, i) => `<button data-i="${i}" class="${i === state.focused ? 'on' : ''}" style="--c:${STYLES[v.styleId].color}" title="${STYLES[v.styleId].name}">${i + 1}</button>`).join('')}</div>` : '');
}
$('#viewBar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.view) setSolo(b.dataset.view === 'one');
  else if (b.dataset.i) focusCard(Number(b.dataset.i));
});

// ---------------- files / drag & drop ----------------
$('#btnAddClips').onclick = () => $('#fileClips').click();
$('#clipDrop').onclick = () => $('#fileClips').click();
$('#btnAddFolder').onclick = () => $('#fileFolder').click();
$('#btnAddMusic').onclick = () => $('#fileMusic').click();
$('#musicDrop').onclick = () => $('#fileMusic').click();
$('#fileClips').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
$('#fileFolder').onchange = (e) => { addFiles([...e.target.files].filter((f) => VIDEO_EXT.test(f.name) || IMAGE_EXT.test(f.name))); e.target.value = ''; };
$('#fileMusic').onchange = (e) => { if (e.target.files[0]) addFiles([e.target.files[0]], 'music'); e.target.value = ''; };
let dragDepth = 0;
// the "Drop clips or a song" cover only for real files dragged in from outside, never for drags inside the app
// (moving the song window, reordering clips, selecting text...)
const draggingFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { e.preventDefault(); if (clipDragId || !draggingFiles(e)) return; dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', (e) => { if (!draggingFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragend', () => { dragDepth = 0; document.body.classList.remove('dragging'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  if (clipDragId) { clipDragId = null; return; } // a clip being reordered, not a file
  const onMusic = e.target.closest && e.target.closest('#musicDrop, #musicBox');
  addFiles([...e.dataTransfer.files], onMusic ? 'music' : null);
});

// ---------------- clip finder + paste a link anywhere ----------------
const finder = initFinder({ grab, grabSong, toast, hasClip: (id) => state.clips.some((c) => c.id === id) });
$('#btnFind').onclick = () => finder.open();
$('#btnFindSong').onclick = () => finder.open('music');
$('#btnFindEmpty').onclick = () => finder.open();
$('#btnOwnEmpty').onclick = () => $('#fileClips').click();
window.addEventListener('paste', (e) => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  const files = [...(e.clipboardData.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); return; }
  const urls = (e.clipboardData.getData('text') || '').split(/\s+/).filter((s) => /^https?:\/\//i.test(s));
  if (!urls.length) return;
  e.preventDefault();
  urls.forEach((u) => finder.addLink(u));
  toast(`Grabbing ${urls.length} link${urls.length === 1 ? '' : 's'}…`);
});

// ---------------- keyboard ----------------
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input[type=text], input[type=number], select, textarea') || finder.isOpen()) return;
  // arrow keys on a slider move the slider, not the playhead
  if (e.target.matches('input[type=range]') && /^Arrow|^Page|^Home$|^End$/.test(e.key)) return;
  if (e.code === 'Space') { e.preventDefault(); audioCtx().resume(); player.toggle(); updatePlayIcon(); }
  else if (/^Digit[0-9]$/.test(e.code)) { const n = Number(e.code.slice(5)) || 10; if (n <= state.variants.length) focusCard(n - 1); }
  else if (e.key === 'r' || e.key === 'R') reroll(state.focused);
  else if (e.key === 'g' || e.key === 'G') $('#btnGenerate').click();
  else if (e.key === 'e' || e.key === 'E') queueExport(state.focused);
  else if (e.key === 'f' || e.key === 'F') finder.open();
  else if (e.key === 'v' || e.key === 'V') setSolo(!state.solo);
  else if (e.key === 'c' || e.key === 'C') (tuneIndex === state.focused ? closeTune() : openTune(state.focused));
  else if (e.key === 'Escape' && shotBar.isOpen()) shotBar.close();
  else if ((e.key === 'Delete' || e.key === 'Backspace') && shotBar.isOpen() && !e.target.matches('input')) { e.preventDefault(); shotBar.deleteSelected(); }
  else if ((e.key === 'k' || e.key === 'K') && shotBar.isOpen()) shotBar.addKey();
  // timeline zoom
  else if (e.key === '=' || e.key === '+') zoomTimeline(1.6);
  else if (e.key === '-' || e.key === '_') zoomTimeline(1 / 1.6);
  else if (e.key === 'Escape' && tuneIndex != null) closeTune();
  // shots: [ ] or Shift+arrows jump shot by shot (and open the shot editor)
  else if (e.key === '[' || (e.shiftKey && e.code === 'ArrowLeft')) { e.preventDefault(); shotBar.step(-1); updatePlayIcon(); }
  else if (e.key === ']' || (e.shiftKey && e.code === 'ArrowRight')) { e.preventDefault(); shotBar.step(1); updatePlayIcon(); }
  else if (e.code === 'ArrowLeft') player.seek(player.now() - (shotBar.isOpen() ? 0.1 : 1));
  else if (e.code === 'ArrowRight') player.seek(player.now() + (shotBar.isOpen() ? 0.1 : 1));
  else if (e.key === 'Home') player.seek(0);
});

// ---------------- shot editor: what the camera captures, shot by shot ----------------
function wantTrack(clip, withBoxes) {
  // tracks made before the shot editor existed don't know where everyone is: find people again
  if (withBoxes && clip.track && !clip.track.boxes) { clip.track = null; clip.trackState = null; clip.trackPromise = null; }
  clip.wantTrack = true; queueTrack(clip); renderClipsSoon();
}
shotBar = initShotBar({
  el: $('#shotBar'), player, toast, wantTrack, saveCut: saveCutFraming,
  cutOps: { del: deleteCut, replace: replaceCut, restore: restoreCut, restoreDeleted: restoreDeletedCuts, deleted: () => deletedCuts(state.focused) },
  getView: () => { const i = state.focused, v = state.variants[i]; return { index: i, plan: v.plan, clips: state.planClips, ctx: ctxFor(i), color: STYLES[v.styleId].color }; },
  // a framing change shows in the take right away, even while paused
  onChange: () => { const v = player.views[state.focused]; if (v) v.dirty = true; drawTimeline(player.now(), player.duration()); },
  onToggle: () => { updatePlayIcon(); requestAnimationFrame(layoutGrid); drawTimeline(player.now(), player.duration()); },
});
afterTrack = () => shotBar.refresh();

// ---------------- settings: export folder, theme, accent color ----------------
const settingsUI = initSettings({ toast, esc });
$('#btnSettings').onclick = () => settingsUI.open();
initUpdates({ toast, esc });
document.addEventListener('cutsona:look', () => { drawWave(); renderClips(); drawTimeline(player.now(), player.duration()); });

refreshEff(); renderMainLook(); syncInputs(); applyMode(true); updateCards(); renderStatus(); refreshStatus().then(updateCards);
window.__cutsona = { state, player };
