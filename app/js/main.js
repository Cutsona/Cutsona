import { decodeAudio, analyzeMusic, analyzeClipAudio, suggestWindow, syntheticMusic, audioCtx, encodeWav } from './audio.js';
import { findMoments, applyCrowd, boostMoments, speechPhrases } from './moments.js';
import { frameBounds, contentRect, barTimeline, rectBetween } from './framing.js';
import { planEdit, makeCtx, keyValues, KEY_PROPS, cutFades } from './edit.js';
import { STYLES, DEFAULT_LINEUP, FILTERS, EXTRAS, ANIMATED_FX, VIDEO_FORMATS, styleParts, allParts } from './styles.js';
import { CAPTION_STYLES, CAPTION_FONTS, captionSampleHtml, paintCaptionSample } from './captions.js';
import { analyzeTrack, PEOPLE_V } from './track.js';
import { Player } from './player.js';
import { drawHookCanvas } from './renderer.js';
import { exportEdit } from './exporter.js';
import { initShotBar } from './shotbar.js';
import { initSettings, accentRGBA, accentHex } from './settings.js';
import { initUpdates } from './updates.js';
import { drawWatermark, logoImage, shrinkLogo } from './watermark.js';
import { initFinder } from './finder.js';
import { initOnboarding, needTool, openReport } from './onboard.js';
import { initTopicVideo } from './topicvideo.js';
import { initLongVideo } from './longvideo.js';
import { quickToEditor, remapSavedPlan } from './quicktransfer.js';
import { soundEvents, reactionAt, loadLexicon } from './sounds.js';
import { faceReactions, faceAt } from './faces.js';
import { findHighlights, wholeHighlights, planHighlight, findCam, drawStreamOverlay, tightCut, longCut, keepParts, STREAM_LAYOUTS, BANNER_THEMES } from './stream.js';
import { trimView, partsOff, srcOffset } from './edit.js';
import { rightsOf, summarize, sourceFromUrl, readId3, LEVELS } from './rights.js';
import { SAFE_ZONES, fitsSafeZones, coveredShare, safeZoneHtml } from './safezones.js';
import { createHistory, initProjects } from './projects.js';
import { createOverlays } from './overlays.js';
import { initDropdowns } from './dropdowns.js';
import { createHotkeys, renderHotkeySettings } from './hotkeys.js';
import { createTranscript } from './transcript.js';
import { createClipAudio, hasAudioFx, clipLevel, runBounds, clipSpan } from './clipaudio.js';
import { createSongEditor } from './songedit.js';
import { initPanes } from './panes.js';
import { snapTo, guides } from './snap.js';
import { analyzeViral, takeVirality, scoreColor } from './viral.js';
import { initKeys } from './keys.js';
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
function framingThumbFrom(src, [x, y, w, h]) {
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
  filter: 'none', fx: [], speed: 'on', focus: 'on', captions: 'off', captionStyle: 'yellow_pop', captionFont: 'segoe', pick: 'viral', order: 'scattered',
  fadeIn: 0, fadeOut: 0, musicFadeIn: 0, musicFadeOut: 1,
  // MODE: 'edits' (beat-synced edits) or 'stream' (Twitch / Kick highlights) + the stream clip settings
  mode: 'edits', streamLen: 30, streamLayout: 'auto', streamCaptions: 'on', streamCaptionStyle: 'stream_word', streamTitle: 'on', streamCuts: 'none', reactZoom: 'on',
  // stream banner (platform + name) and the cam / screen template
  streamBanner: 'on', bannerTheme: 'classic', bannerName: '', bannerPlatform: 'auto', stackSwap: 'off', stackGame: 'fill', stackCam: 'face', stackSplit: '0.5', streamEdge: 'black', streamFit: 'fill',
  // hook text: font, size, where it sits (0..1 from the top left; y null = the mode's usual spot), when it shows
  hookFont: 'arial_black', hookSize: 1, hookX: 0.5, hookY: null, hookStart: 0, hookEnd: 0,
  // the banner moved by hand (its center, 0..1); null = its usual place
  bannerX: null, bannerY: null,
  // Spotlight: { clip: clip id, pid: person id } (the edit follows just that person), or null
  spotlight: null,
  // skip title cards, black screens and text slates found in the clips
  skipCards: 'on',
  // the stream title box and the captions moved by hand (null = their usual place)
  titleX: null, titleY: null, capX: null, capY: null,
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
// A computer without much power plays many takes at once badly: there Cutsona opens fewer takes (two; one when
// there's no graphics chip it can use). More can still be added with + Add take.
// Settings → Performance can force it either way ('auto' | 'one' | 'full').
function lowEndPc() {
  const cores = navigator.hardwareConcurrency || 8, mem = navigator.deviceMemory || 8;
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const x = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = String((x && gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) || gl?.getParameter(gl.RENDERER) || '');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {}
  const soft = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic/i.test(gpu) || !gpu;
  const weakGpu = /intel\(r\) (hd|uhd) graphics|intel.*(hd|uhd) graphics [0-9]{3}\b|mali-[gt]?[0-9]{2}\b|adreno/i.test(gpu) && !/iris|arc/i.test(gpu);
  // (browsers report at most 8 GB, and 4 GB on many ordinary laptops: memory alone only counts when it's really little)
  const why = soft ? 'no graphics chip Cutsona can use' : cores <= 2 ? `${cores} processor cores` : mem <= 2 ? `${mem} GB of memory` : weakGpu && cores <= 4 ? 'a basic graphics chip and 4 cores' : '';
  return { low: !!why, soft, why, cores, mem, gpu };
}
const PERF = (() => { try { return localStorage.getItem('cutsona.perf') || 'auto'; } catch { return 'auto'; } })();
const PC = lowEndPc();
const ONE_TAKE = PERF === 'one' || (PERF === 'auto' && PC.low);
// 4 takes to start; you can add up to 10 (the number you had is remembered); a low-end computer starts with two (one without graphics)
const LINEUP0 = (Array.isArray(savedLineup) && savedLineup.length >= 1 && savedLineup.length <= 10 && savedLineup.every((k) => STYLES[k])) ? savedLineup : DEFAULT_LINEUP;
const LINEUP = ONE_TAKE ? LINEUP0.slice(0, PERF === 'one' || PC.soft ? 1 : 2) : LINEUP0;
const state = {
  clips: [], planClips: [],
  music: null, musicAnalysis: syntheticMusic(130, 120), musicStart: 0, beatOffset: 0,
  settings: { ...DEFAULTS, ...saved },
  variants: LINEUP.map((styleId, i) => ({ styleId, seed: (Math.random() * 1e9) | 0, plan: null, custom: (savedCustom[i] && typeof savedCustom[i] === 'object') ? savedCustom[i] : {} })),
  focused: 0,
  solo: !!savedView.solo,
  safeZone: SAFE_ZONES[savedView.safe] ? savedView.safe : 'off',
  clipVolTouched: false,
  server: { ffmpeg: null },
  takeScale: Math.min(1, Math.max(0.3, Number(localStorage.getItem('cutsona.takeScale')) || 1)),
};
// What's selected on the timeline (like CapCut: only the selected item gets edited):
// { kind: 'card', n } the take's card motion (n = a keyframe), { kind: 'cut', si } a cut, { kind: 'cam', si, ki } the
// camera keyframes of a cut, or null. Dragging / zooming the picture changes the selected item only.
let tlSel = null;
// once: put the new Movie Edit and Caption Edit styles on the first two cards (like the reference edits)
try {
  if (localStorage.getItem('cutsona.movieLineup') !== '1' && Array.isArray(savedLineup) && state.variants.length > 1) {
    // (an older lineup only: a new install already starts with Beat Sync, Movie Edit, Caption Edit, Velocity)
    state.variants[0].styleId = 'movie'; state.variants[1].styleId = 'captionedit';
    for (const v of state.variants.slice(0, 2)) { v.custom.off = []; delete v.custom.fx; delete v.custom.filter; }
  }
  localStorage.setItem('cutsona.movieLineup', '1');
} catch {}
// once: take 1 becomes the plain Beat Sync edit (just cuts on the beat); what was there moves to the Simple Beat card
try {
  if (localStorage.getItem('cutsona.pureLineup') !== '1') {
    const V = state.variants, was = V[0].styleId;
    if (was !== 'pure') {
      let j = V.findIndex((v, k) => k > 0 && v.styleId === 'beat');
      // no Simple Beat card: the take-1 style goes on the last card that isn't a Movie / Caption Edit
      if (j < 0 && was !== V[1]?.styleId) for (let k = V.length - 1; k > 0; k--) if (!['movie', 'captionedit', 'pure', was].includes(V[k].styleId)) { j = k; break; }
      if (j > 0) { V[j].styleId = was; V[j].custom = V[0].custom; }
      V[0].styleId = 'pure'; V[0].custom = {};
    }
    localStorage.setItem('cutsona.pureLineup', '1');
  }
} catch {}
for (const v of state.variants) if (v.custom._autoFor !== v.styleId) applyStyleDefaults(v);
// older caption style names -> current names
for (const o of [state.settings, ...state.variants.map((v) => v.custom)]) {
  if (o.captionStyle === 'cyan') o.captionStyle = 'cyber_cyan';
  if (o.captionStyle === 'white') o.captionStyle = 'pure_white';
}
// a project being opened (its saved cuts are kept while its clips load); removed clips and songs, kept for Undo
let projectLoading = false;
const graveyard = new Map();
function bury(x) {
  if (!x?.id) return;
  graveyard.delete(x.id); graveyard.set(x.id, x);
  while (graveyard.size > 40) {
    const [k, old] = graveyard.entries().next().value;
    graveyard.delete(k);
    if (old.url?.startsWith('blob:') && !state.clips.includes(old)) URL.revokeObjectURL(old.url);
  }
}
function saveSettings() { try { localStorage.setItem('cutsona.settings', JSON.stringify(state.settings)); } catch {} refreshEff(); }
function saveCustom() { try { localStorage.setItem('cutsona.custom', JSON.stringify(state.variants.map((v) => v.custom))); } catch {} refreshEff(); }
// (opened with fewer takes on a slow computer: the rest of your usual lineup is kept for when it's back to normal)
function saveLineup() { try { const now = state.variants.map((v) => v.styleId); localStorage.setItem('cutsona.lineup2', JSON.stringify(ONE_TAKE && now.length <= LINEUP.length ? [...now, ...LINEUP0.slice(now.length)] : now)); } catch {} }

// ---------------- per-edit settings: each of the 4 edits can override the main settings ----------------
const OVERRIDABLE = ['format', 'framing', 'filter', 'intensity', 'pacing', 'speed', 'focus', 'captions', 'captionStyle', 'captionFont', 'pick', 'order',
  'fadeIn', 'fadeOut', 'musicFadeIn', 'musicFadeOut', 'textColor'];
function computeEff(i) {
  const s = state.settings, c = state.variants[i].custom || {};
  const e = { ...s };
  for (const k of OVERRIDABLE) if (c[k] !== undefined && c[k] !== null && c[k] !== '') e[k] = c[k];
  if (Array.isArray(c.fx)) e.fx = c.fx;
  if (typeof c.text === 'string' && c.text.trim()) e.text = c.text;
  // the plain Beat Sync take: only cuts on the beat. The main filter and extra effects don't reach it
  // (you can still give this one take its own filter / effects)
  if (s.mode !== 'stream' && STYLES[state.variants[i].styleId]?.pure) {
    if (c.filter == null || c.filter === '') e.filter = 'none';
    if (!Array.isArray(c.fx)) e.fx = [];
    if (c.speed == null) e.speed = 'off';
  }
  // a "Best quote" edit shows its words unless captions were switched off for that edit
  if (e.pick === 'quotes' && c.captions == null) e.captions = 'on';
  if (e.hookY == null) e.hookY = s.mode === 'stream' ? 0.07 : 0.2;
  e.keys = Array.isArray(c.keys) && c.keys.length ? c.keys : null; // this take's own card motion
  e.pan = c.pan && Object.keys(c.pan).length ? c.pan : null; // where you dragged the picture on this take
  e.panKeys = c.panKeys && Object.values(c.panKeys).some((k) => k?.length) ? c.panKeys : null; // camera keyframes of a stream take's parts
  // Spotlight decides these (their settings are greyed out while it's on)
  if (s.mode !== 'stream' && s.spotlight) { e.framing = 'fill'; e.focus = 'on'; }
  // stream clips: the stream's own sound, no music / effects, people tracked (to find the cam), stream captions
  if (s.mode === 'stream' && !state.variants[i].sourcePlan?.plan?.quick) {
    const H = state.variants[i].plan?.highlight;
    const so = stackOpts();
    Object.assign(e, { captions: s.streamCaptions, captionStyle: s.streamCaptionStyle, captionFont: 'segoe', clipVol: 1, musicVol: 0,
      fadeIn: 0, fadeOut: 0, fx: [], focus: 'on', framing: 'fill', pick: 'auto', stackOpts: so,
      captionY: H?.layout === 'stack' ? so.divider + 0.035 : 0.27 });
    // this take's own look (Clipper Mode makes every take different): its captions and filter
    const R = state.variants[i].custom.layout ? null : streamRecipe(i);
    if (R) {
      if (CAPTION_STYLES[R.cap]) e.captionStyle = R.cap;
      if (!c.filter && FILTERS[R.filter]) e.filter = R.filter; // (each take its own color, unless you gave this take one)
      // its own cam size and a closer screen crop, so every take really looks different (unless you moved them)
      if (R.split && !c.pan?.cam) { const so2 = { ...so, split: R.split, divider: so.swap ? 1 - R.split : R.split }; e.stackOpts = so2; e.captionY = H?.layout === 'stack' ? so2.divider + 0.035 : 0.27; }
      if (R.gz && !c.pan?.game && !c.panKeys?.game) e.pan = { ...(e.pan || {}), game: [0, 0, R.gz] };
      if (R.capDy) e.captionY = Math.min(0.9, Math.max(0.05, (e.captionY ?? 0.27) + R.capDy));
    }
  }
  // captions dragged on a take (capY = middle of the words from the top, capX = from the left): every take
  if (s.capY != null) e.captionY = Math.min(0.95, Math.max(0.02, 1 - Number(s.capY) - 0.035));
  e.captionX = s.capX != null ? Number(s.capX) : null;
  return e;
}
const isStream = () => state.settings.mode === 'stream';
// the cam / screen template: which side is on top, whole screen or a crop, face or whole webcam, cam share of the height
function stackOpts() {
  const s = state.settings, split = Math.min(0.7, Math.max(0.3, Number(s.stackSplit) || 0.5)), swap = s.stackSwap === 'on';
  return { swap, game: s.stackGame, cam: s.stackCam, split, divider: swap ? 1 - split : split, edge: s.streamEdge === 'blur' ? 'blur' : 'black', fullFit: s.streamFit };
}
let effCache = [], ctxCache = [];
function refreshEff() { effCache = state.variants.map((_, i) => computeEff(i)); ctxCache = []; textCache.clear(); }
function eff(i) { return effCache[i] || (effCache[i] = computeEff(i)); }
function isCustom(i) {
  const c = state.variants[i].custom || {};
  if (isStream()) return !!c.layout || c.title != null || !!c.keys?.length || !!c.pan || !!c.panKeys;
  return OVERRIDABLE.some((k) => c[k] !== undefined && c[k] !== null && c[k] !== '') || Array.isArray(c.fx) || !!(c.text && c.text.trim()) || !!c.keys?.length || !!c.pan;
}
function aspectOf(i) { const [a, b] = String(eff(i).format).split(':').map(Number); return a / b; }
const textCache = new Map();
// your own logo picture on the stream banner (in place of the platform's name)
let logoImg = null, logoSrc = '';
function bannerLogo() {
  const src = state.settings.bannerLogo || '';
  if (!src) return null;
  if (src !== logoSrc) { logoSrc = src; logoImg = new Image(); logoImg.onload = () => { textCache.clear(); refreshEff(); player.views.forEach((v) => { if (v) v.dirty = true; }); }; logoImg.src = src; }
  return logoImg;
}
async function pickBannerLogo() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const url = URL.createObjectURL(f), im = new Image(); im.src = url; await im.decode();
      // kept small: 160 px tall, transparent background stays
      const h = Math.min(160, im.naturalHeight || 160), w = Math.max(1, Math.round(h * (im.naturalWidth || 1) / (im.naturalHeight || 1)));
      const cv = document.createElement('canvas'); cv.width = Math.min(800, w); cv.height = h; cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      state.settings.bannerLogo = cv.toDataURL('image/png'); saveSettings(); textCache.clear(); refreshEff(); renderMainLook();
      toast('Your logo is on the banner');
    } catch { toast('Could not read that picture', true); }
  };
  inp.click();
}
// the overlay layer of take i: stream banner + title box (stream clips) and your watermark (both modes)
function textFor(i) {
  const s = state.settings, a = aspectOf(i);
  let key = '', make = null;
  const quick = state.variants[i].plan?.quick;
  if (quick?.banner || quick?.logo) {
    const logo = logoImage(quick.logo, () => { textCache.clear(); });
    key = `quick|${quick.banner}|${quick.logo}|${!!logo}`;
    make = () => {
      const canvas = document.createElement('canvas'); canvas.height = 1280; canvas.width = Math.round(1280 * a);
      const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
      if (quick.banner) {
        g.font = `700 ${H * 0.028}px Arial`; g.textAlign = 'center'; g.textBaseline = 'top';
        const w = Math.min(W * 0.8, g.measureText(quick.banner).width) + H * 0.028;
        g.fillStyle = '#171717c0'; g.fillRect((W - w) / 2, H * 0.032, w, H * 0.045);
        g.fillStyle = '#fff'; g.fillText(quick.banner, W / 2, H * 0.04, W * 0.8);
      }
      if (logo) g.drawImage(logo, W * 0.845, H * 0.035, W * 0.12, W * 0.12 * logo.naturalHeight / logo.naturalWidth);
      return canvas;
    };
  } else if (isStream()) {
    // stream clips: the banner (platform + name) + title box; the hook text is its own layer (hookFor)
    const v = state.variants[i], H = v.plan?.highlight;
    if (H) {
      const title = s.streamTitle === 'on' ? (v.custom.title ?? H.title ?? '') : '', so = eff(i).stackOpts || stackOpts();
      const pos = s.bannerX != null && s.bannerY != null ? { x: Number(s.bannerX), y: Number(s.bannerY) } : null;
      const titlePos = s.titleX != null && s.titleY != null ? { x: Number(s.titleX), y: Number(s.titleY) } : null;
      const theme = streamRecipe(i)?.theme || s.bannerTheme;
      const logo = bannerLogo();
      key = `stream|${H.layout}|${H.platform}|${H.channel}|${title}|${s.streamBanner}|${theme}|${so.divider}|${pos ? pos.x + ',' + pos.y : ''}|${titlePos ? titlePos.x + ',' + titlePos.y : ''}|${logo?.complete ? (s.bannerLogo || '').length : 0}`;
      make = () => drawStreamOverlay(a, { layout: H.layout, platform: H.platform, channel: H.channel, title, banner: s.streamBanner, theme, divider: so.divider, pos, titlePos, logo });
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
  // something needs a tool that isn't installed: offer the one-click install right there (once a minute at most)
  if (err && /speech tools|ffmpeg|yt-dlp/i.test(msg) && Date.now() - (toast.reqAt || 0) > 60000) { toast.reqAt = Date.now(); needTool(/speech/i.test(msg) ? 'speech' : /yt-dlp/i.test(msg) ? 'ytdlp' : 'ffmpeg').catch(() => {}); }
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
// ---------------- copyright check ----------------
// where a clip or song came from (the finder card, a pasted link, or your own file), for the copyright check
function originOf(item = {}) {
  return { kind: item.kind || (item.audio ? 'song' : 'clip'), source: item.source || sourceFromUrl(item.url || ''), url: item.url || '', page: item.page || '',
    channel: item.channel || '', title: item.title || '', license: item.license || '', moment: !!item.moment };
}
// YouTube / Dailymotion links: ask what the site says (a Creative Commons license, a released song inside)
const rightsAsked = new Set();
async function lookupRights(origin) {
  const u = origin?.url || '';
  if (!/youtube\.com|youtu\.be|dailymotion\.com/.test(u) || origin.meta || rightsAsked.has(u)) return;
  rightsAsked.add(u);
  try {
    const r = await fetch('/api/rights?url=' + encodeURIComponent(u));
    if (!r.ok) return;
    origin.meta = await r.json();
    renderClipsSoon(); renderStatus(); renderMusicName(); if (!$('#rightsDlg').hidden) renderRights();
  } catch {}
}
const rightsFor = (o) => rightsOf({ ...(o || { local: true }) });
const rightsBadge = (r) => `<span class="rt rt-${r.level}" title="${esc(r.label + ': ' + r.why)}">${esc(r.short)}</span>`;
function rightsSummary() {
  const items = state.clips.filter((c) => c.status !== 'error').map((c) => ({ name: c.name, kind: 'Clip', r: rightsFor(c.origin) }));
  if (state.music) items.push({ name: state.music.name.replace(/\.[^.]+$/, ''), kind: 'Song', r: rightsFor(state.music.origin) });
  return { items, sum: summarize(items.map((x) => x.r)) };
}
function renderMusicName() {
  if (!state.music) return;
  $('#musicName').innerHTML = `${esc('♪ ' + state.music.name.replace(/\.[^.]+$/, ''))} ${rightsBadge(rightsFor(state.music.origin))}`;
}
function renderRights() {
  const { items, sum } = rightsSummary();
  const order = items.slice().sort((a, b) => b.r.rank - a.r.rank);
  $('#rightsList').innerHTML = order.length ? order.map((x) => `<li class="rt-row">${rightsBadge(x.r)}<div><b>${esc(x.name)}</b> <small>${x.kind}</small><p>${esc(x.r.why)}</p>${x.r.credit ? `<p class="rt-credit">Credit: ${esc(x.r.credit)}</p>` : ''}</div></li>`).join('')
    : '<li class="rt-row"><p>Add clips or a song and each one gets checked here.</p></li>';
  const w = sum.worst;
  $('#rightsVerdict').textContent = !w ? '' : sum.risky ? `${sum.risky} of ${items.length} may get your post muted, claimed or taken down.` : w.level === 'free' ? 'Everything here is free to use.' : 'Nothing here is likely to be claimed. Some of it needs a credit.';
  $('#btnCopyCredits').hidden = !sum.credits.length;
}
function openRights() { renderRights(); $('#rightsDlg').hidden = false; $('#btnRightsClose').focus(); }
$('#status').addEventListener('click', (e) => { if (e.target.closest('#btnRights')) openRights(); });
$('#btnRightsClose').onclick = () => { $('#rightsDlg').hidden = true; };
$('#rightsDlg').addEventListener('click', (e) => { if (e.target.id === 'rightsDlg') $('#rightsDlg').hidden = true; });
$('#rightsDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#rightsDlg').hidden = true; });
$('#btnCopyCredits').onclick = async () => {
  const { sum } = rightsSummary();
  try { await navigator.clipboard.writeText(sum.credits.join('\n')); toast('Credits copied: paste them in your post\'s description'); } catch { toast('Couldn\'t copy: select the credits and copy them yourself', true); }
};
// the copyright check no longer shows at the top (1.2), so exports don't warn about it either
function warnRights() {}

setInterval(() => fetch('/api/ping').catch(() => {}), 5000);
fetch('/api/ping').catch(() => {});
// closing the window lets Cutsona's engine shut down right away (a reload pings again and keeps it running)
addEventListener('pagehide', () => { try { navigator.sendBeacon('/api/bye'); } catch {} });

// ---------------- clips ----------------
let clipQueue = Promise.resolve();
// a subtitle file (.srt / .vtt) dropped or picked: its lines become the words of the clip with the same name
// (or the clip you're on), so captions and transcripts work without the speech tools
async function addSubtitles(f) {
  try {
    const txt = (await f.text()).replace(/\r/g, '');
    const ts = (x) => { const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(x); return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+('0.' + m[4])) : NaN; };
    const words = [];
    for (const block of txt.split(/\n\s*\n/)) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const k = lines.findIndex((l) => l.includes('-->')); if (k < 0) continue;
      const [a, b] = lines[k].split('-->').map(ts); if (!(b > a)) continue;
      const text = lines.slice(k + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').trim();
      const ws = text.split(/\s+/).filter(Boolean), total = ws.reduce((n, w) => n + w.length + 1, 0);
      let t = a;
      for (const w of ws) { const d = (b - a) * (w.length + 1) / total; words.push({ text: w, start: t, end: t + d * 0.92 }); t += d; }
    }
    if (!words.length) throw new Error('no timed lines in it');
    const base = f.name.replace(/\.[^.]+$/, '').toLowerCase();
    const clip = state.clips.find((c) => c.name.replace(/\.[^.]+$/, '').toLowerCase() === base) || state.planClips[state.variants[state.focused]?.plan?.segments[0]?.clip] || state.clips.find((c) => !c.photo);
    if (!clip) throw new Error('add the video first');
    clip.words = words; clip.speechState = 'done'; clip.speechError = '';
    if (clip.status === 'ready') { clip.moments = boostMoments(clip, findMoments(clip.interest, clip.usableEnd, { words: clip.words, scenes: clip.scenes, quality: clip.quality })); replanSoon(); }
    renderClips(); toast(`Captions from ${f.name} are on ${clip.name}`);
  } catch (e) { toast(`Couldn't read ${f.name}: ${e.message}`, true); }
}
function addFiles(files, target, { preview = true } = {}) {
  const vids = [], auds = [], pics = [];
  for (const f of files) {
    if (/\.(srt|vtt)$/i.test(f.name)) { addSubtitles(f); continue; }
    if (target !== 'music' && (f.type.startsWith('image') || IMAGE_EXT.test(f.name))) { pics.push(f); continue; }
    if (target === 'music' && (f.type.startsWith('audio') || AUDIO_EXT.test(f.name) || f.type.startsWith('video') || VIDEO_EXT.test(f.name))) { auds.push(f); continue; }
    if (f.type.startsWith('audio') || AUDIO_EXT.test(f.name)) auds.push(f);
    else if (f.type.startsWith('video') || VIDEO_EXT.test(f.name)) vids.push(f);
  }
  if (auds.length) setMusic(auds[0]);
  pics.forEach(addPhoto);
  vids.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  // your own videos open in a preview first (a tab each): Cutsona watches them for their most viral parts, and you
  // can trim each one right there (Smart trim, or drag the part's edges) before it's added. Lots at once: added directly.
  if (preview && vids.length && vids.length <= 12 && state.settings.previewOwn !== 'off' && finder.previewFiles(vids)) { renderClips(); renderStatus(); updateEmpty(); return; }
  for (const f of vids) addVideoFile(f);
  renderClips(); renderStatus(); updateEmpty();
}
// one video file into the clip list; part = { start, end } picked in its preview (becomes the clip's start / length),
// scan = the viral scan the preview already did (so it isn't watched twice)
function addVideoFile(f, part = null, scan = null) {
  const clip = { id: 'c' + Math.random().toString(36).slice(2, 9), name: f.name, file: f, status: 'loading', cropX: 0.5, color: CLIP_COLORS[state.clips.length % CLIP_COLORS.length], origin: { local: true, title: f.name } };
  if (part && part.end - part.start >= 0.5) clip.trim = [Math.round(part.start * 10) / 10, Math.round(part.end * 10) / 10];
  if (scan) clip.viralGiven = scan;
  state.clips.push(clip);
  queueAnalysis(clip);
  renderClips(); renderStatus(); updateEmpty();
  return clip;
}
// Photos: the server turns each one into an 8s clip with a slow push-in
async function addPhoto(f) {
  const clip = { id: 'c' + Math.random().toString(36).slice(2, 9), name: f.name, status: 'loading', sub: 'making clip from photo…', cropX: 0.5,
    color: CLIP_COLORS[state.clips.length % CLIP_COLORS.length], remote: true, photo: true, origin: { local: true, title: f.name } };
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
// ---- viral scan: the server watches the whole clip (picture, sound, words), viral.js finds what would go viral ----
async function scanViral(clip, given = null) {
  if (clip.viralState === 'running' || clip.viral || clip.photo || state.server.ffmpeg === false) return;
  clip.viralState = 'running'; clip.viralPct = 0; renderClipsSoon();
  try {
    let j = given;
    if (!j) {
      const src = clip.previewUrl?.startsWith('/cache/') ? clip.previewUrl : clip.url?.startsWith('/cache/') ? clip.url : '';
      const path = !src && clip.file && window.cutsonaDesktop?.pathOf ? window.cutsonaDesktop.pathOf(clip.file) : '';
      let r;
      if (src) r = await fetch('/api/viral?cache=' + encodeURIComponent(src));
      else if (path) r = await fetch('/api/viral?path=' + encodeURIComponent(path));
      else if (clip.file) r = await fetch(`/api/viral?name=${encodeURIComponent(clip.file.name)}&size=${clip.file.size}&mtime=${clip.file.lastModified || 0}`, { method: 'POST', body: clip.file });
      else throw new Error('nothing to scan');
      j = await r.json();
      while (j.running) {
        await new Promise((res) => setTimeout(res, 900));
        if (!state.clips.includes(clip)) return;
        clip.viralPct = j.pct || 0; renderClipsSoon();
        j = await (await fetch('/api/viral?key=' + j.key)).json();
      }
      if (j.error) throw new Error(j.error);
    }
    if (!state.clips.includes(clip)) return;
    applyViral(clip, j);
  } catch (e) { console.warn('viral scan:', e.message); clip.viralState = 'failed'; }
  finally { if (clip.viralState === 'running') clip.viralState = clip.viral ? 'done' : 'failed'; renderClipsSoon(); }
}
function applyViral(clip, scan) {
  clip.viralScan = scan;
  // words it heard (when this clip wasn't transcribed yet): they make captions, quotes and the viral lines
  if (scan.words?.length && !clip.words?.length) { clip.words = scan.words; clip.speechState = 'done'; }
  clip.viral = analyzeViral({ ...scan, words: clip.words?.length ? clip.words : scan.words || [] });
  clip.viralState = 'done';
  // what the edits pick from: the viral seconds count as more interesting
  const cur = clip.viral.curve, iv = clip.interest;
  if (iv?.length && cur?.length) for (let i = 0; i < iv.length; i++) { const v = cur[Math.min(cur.length - 1, Math.floor(i / 10 / clip.viral.step))] || 0; if (iv[i] > 0) iv[i] = Math.min(1, iv[i] * 0.6 + v * 0.55); }
  replanSoon(); updateCards();
}
// "Most viral": the clip's viral peaks (reactions, punchlines, hooks) come first when the edits pick moments
function viralize(c) {
  const hot = c.viral?.hot;
  if (!hot?.length) return c;
  const [a, b] = clipTrim(c);
  const mine = hot.filter((h) => h.start >= a - 0.5 && h.end <= b + 0.5).map((h) => ({ ...h, score: 0.55 + h.score * 0.8 }));
  return mine.length ? { ...c, moments: [...mine, ...(c.moments || [])] } : c;
}
// the clip's viral score (its best part), or that it's still being watched
function viralLabel(c) {
  if (c.viralState === 'running') return `<span class="vchip scan" data-vinfo title="Watching the whole clip for its most viral parts${c.viralPct ? ` (${c.viralPct}%)` : ''}"><i class="spin"></i>${c.viralPct ? `${c.viralPct}%` : ''}</span>`;
  if (!c.viral) return '';
  const m = c.viral.moments[0];
  return `<span class="vchip ${scoreColor(c.viral.score)}" data-vinfo title="Viral score ${c.viral.score}/100: how likely this clip's best part is to do well on TikTok, Reels and Shorts${m ? `\nBest part ${fmt(m.start)}–${fmt(m.end)} (${m.score}): ${esc(m.why.join(', '))}` : ''}\nOn its wave: the hotter the line under it, the likelier that part goes viral. Click for what the score means">${FLAME}${c.viral.score}</span>`;
}
const heatColor = (v) => (v > 0.7 ? `rgba(255,77,77,${0.55 + v * 0.45})` : v > 0.5 ? `rgba(255,150,60,${0.45 + v * 0.45})` : `rgba(255,214,90,${0.3 + v * 0.4})`);
// what the fire and the number mean (click any viral score)
function viralInfo(e) {
  popMenu(e, 'The fire and the number', [
    { head: 'Viral score, 0 to 100' },
    { label: 'How likely it is to do well on TikTok, Reels and Shorts', sub: 'Cutsona watches the whole video: the first seconds (the hook), laughs and big reactions, lines people quote, drama, action, dead air, and what viewers replay most', info: true },
    '-', { head: 'Colors' },
    { label: '75 and up: red', sub: 'Very likely to go viral', info: true },
    { label: '55 to 74: orange', sub: 'Good: worth posting', info: true },
    { label: '35 to 54: yellow', sub: 'So-so: needs a stronger hook or moment', info: true },
    { label: 'Under 35: grey', sub: 'Quiet: unlikely to stop people scrolling', info: true },
    '-', { head: 'Where you see it' },
    { label: 'On a take', sub: 'How viral that take is as it is. Click it for why, and what would raise it', info: true },
    { label: 'On a clip', sub: 'Its best part. The line on its wave: hotter = likelier to go viral', info: true },
    { label: 'In a transcript and the preview', sub: 'Lit-up words are the ones that travel; the list shows the best parts to cut', info: true },
  ]);
}
const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3.5 5 6 5 11a5 5 0 0 1-10 0c0-2.2 1-3.8 2.3-5 .2 1.6 1 2.7 2.2 3.2C11 8 12.3 5.2 12 2z"/></svg>';
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
    color: CLIP_COLORS[state.clips.length % CLIP_COLORS.length], remote: true, origin: originOf(item),
    srcOffset: item.start != null && item.start !== '' ? (typeof item.start === 'number' ? item.start : parseT(item.start)) || 0 : 0 };
  state.clips.push(clip); renderClips(); renderStatus(); updateEmpty();
  if (onUpdate) onUpdate({ clipId: clip.id });
  lookupRights(clip.origin);
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
  const nm = String(item.title || 'song').slice(0, 40);
  songProgress(`Getting ${nm}…`);
  for (;;) {
    await sleep(700);
    let s;
    try { s = await (await fetch('/api/grab/status?id=' + j.id)).json(); } catch { continue; }
    if (onUpdate) onUpdate(s);
    if (s.status === 'error') { songProgress(null); musicUi(); throw new Error(s.error || 'song download failed'); }
    if (s.status !== 'done') songProgress(s.pct > 0 ? `Downloading ${nm} · ${Math.round(s.pct)}%` : `${String(s.phase || 'Getting').replace(/^./, (c) => c.toUpperCase())} ${nm}…`, s.pct);
    if (s.status === 'done') {
      songProgress(`Loading ${nm}…`);
      const blob = await (await fetch(s.url)).blob();
      const origin = originOf({ ...item, kind: 'song' });
      await setMusic(new File([blob], `${s.name || 'song'}.mp3`, { type: 'audio/mpeg' }), origin, s.url);
      lookupRights(origin);
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
    clip.framingThumb = framingThumbFrom(raw, tr); // use the full frame in manual framing
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
    // speech: in the background, and only when an edit needs the words (captions, quotes, Movie Edit's dialogue);
    // any clip can be transcribed by itself from its right-click menu
    if (clip.audioBuffer && wantsSpeech()) analyzeSpeech(clip);
    if (clip.audioBuffer) listenSounds(clip);
    findShots(clip);
    setAnalyzing(`Preparing smooth previews for ${clip.name}…`);
    await clip.previewPromise;
    setAnalyzing(`Skipping still pictures in ${clip.name}…`);
    await findClipStills(clip);
    findClipCards(clip); // title cards / black screens: in the background
    clip.moments = boostMoments(clip, findMoments(interest, clip.usableEnd, { words: clip.words, scenes, quality }));
    clip.status = 'ready';
    loadCrowd(clip); // in the background: what people rewatch / quote / rate online
    scanViral(clip, clip.viralGiven || null); delete clip.viralGiven; // in the background: watch the whole clip for its most viral parts
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
  // a new project saves itself once its clips are in
  try { if (clip.status === 'ready' && !projects.current().id) projects.changed(); } catch {}
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

// title cards, black screens and text slates in a clip (found by the server): skipped by the edits
async function findClipCards(clip) {
  const source = clip.previewUrl || (clip.url?.startsWith('/cache/') ? clip.url : '');
  if (!source || clip.photo || state.server.ffmpeg === false) return;
  try {
    const j = await (await fetch('/api/titlecards?source=' + encodeURIComponent(source))).json();
    clip.cards = (j.cards || []).map(([a, b, k]) => [a, Math.min(clip.duration || b, b), k]).filter(([a, b]) => b - a > 0.2);
    // (a clip that's nearly all "card" is probably a lyric video or slideshow: leave it alone)
    if (clip.cards.reduce((s, [a, b]) => s + b - a, 0) > (clip.duration || 1) * 0.6) clip.cards = [];
    renderClipsSoon();
    if (clip.cards.length && skipCardsOn()) { replanSoon(); if (!isStream()) renderMainLook(); }
  } catch (e) { console.warn('title card check failed:', e.message); }
}
const skipCardsOn = () => state.settings.skipCards !== 'off';
function withCards(list) {
  if (!skipCardsOn()) return list;
  return list.map((c) => {
    if (!c.cards?.length) return c;
    // only inside the part of the clip you picked; and if that would leave too little, keep them (an edit beats no edit)
    const [a, b] = clipTrim(c), inside = c.cards.map(([x, y]) => [Math.max(a, x), Math.min(b, y)]).filter(([x, y]) => y - x > 0.05);
    const lost = inside.reduce((s, [x, y]) => s + y - x, 0);
    if (!inside.length || lost > (b - a) * 0.45 || (b - a) - lost < 3) return c;
    return { ...c, stills: [...(c.stills || []), ...inside].sort((x, y) => x[0] - y[0]) };
  });
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
        if (tr?.people?.length) readFaces(clip);
        if (isStream()) { clip.cam = findCam(clip); findCamBox(clip); replanSoon(); } // now we know where the streamer's cam is
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
  if (c.trackState === 'running') return (c.trackPct || 0) >= 0.99 ? ', telling the people apart' : `, finding faces ${Math.round((c.trackPct || 0) * 100)}%`;
  if (c.trackState === 'queued') return ', finding faces next';
  if (c.trackState === 'failed') return ', frame it by hand';
  if (c.track) return c.track.people?.length ? `, ${c.track.people.length} face${c.track.people.length > 1 ? 's' : ''} found` : c.track.kind === 'motion' ? ', no face found' : ', follows faces';
  return '';
}

// what the sound says (YAMNet, open source, on this PC): laughter, cheering, screaming, gasps, big hits. One clip at a
// time in the background; the reactions make those moments count more for highlights, edits and viral parts
let soundQueue = Promise.resolve();
function listenSounds(clip) {
  if (clip.sounds || clip.soundState || !clip.audioBuffer || (clip.duration || 0) < 3 || clip.photo) return;
  clip.soundState = 'queued';
  soundQueue = soundQueue.then(async () => {
    if (!state.clips.includes(clip)) return;
    clip.soundState = 'running';
    try {
      const s = await soundEvents(clip.audioBuffer);
      if (!state.clips.includes(clip)) return;
      clip.sounds = s; clip.soundState = 'done';
      // the moments people react to: how many (3 s apart at least)
      let n = 0, last = -9;
      for (let t = 0; t < (clip.duration || 0); t += 0.5) if (reactionAt(s, t) > 0.55 && t - last > 3) { n++; last = t; }
      clip.reactions = n;
      const iv = clip.interest;
      if (iv) for (let i = 0; i < iv.length; i++) { const r = reactionAt(s, i / 10); if (r > 0.2) iv[i] = Math.min(1, iv[i] + 0.35 * r); }
      if (clip.status === 'ready') { clip.moments = boostMoments(clip, findMoments(clip.interest, clip.usableEnd, { words: clip.words, scenes: clip.scenes, quality: clip.quality })); replanSoon(); }
      renderClips();
    } catch (e) { clip.soundState = 'failed'; console.warn('sound detector', e); }
  });
}
// ---- caption languages: what the clip speaks (detected, 99 languages) and what the captions show (translated on
// this PC with Argos Translate when it's another language) ----
const LANGS = [['en', 'English'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['nl', 'Dutch'],
  ['ru', 'Russian'], ['uk', 'Ukrainian'], ['pl', 'Polish'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['he', 'Hebrew'], ['fa', 'Persian'], ['hi', 'Hindi'], ['ur', 'Urdu'],
  ['bn', 'Bengali'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['id', 'Indonesian'], ['ms', 'Malay'], ['vi', 'Vietnamese'], ['th', 'Thai'],
  ['tl', 'Filipino'], ['sv', 'Swedish'], ['da', 'Danish'], ['fi', 'Finnish'], ['nb', 'Norwegian'], ['cs', 'Czech'], ['el', 'Greek'], ['hu', 'Hungarian'], ['ro', 'Romanian']];
const langName = (c) => (LANGS.find((l) => l[0] === c) || [, c ? String(c).toUpperCase() : ''])[1];
const NO_SPACES = /^(zh|ja|th)$/, RTL = /^(ar|he|fa|ur)$/;
async function translateCaptions(clip, quiet = false) {
  const to = state.settings.captionLang || 'same';
  const words = clip.words || [];
  if (to === 'same' || !words.length || !clip.lang || to === clip.lang) {
    if (clip.capWords) { delete clip.capWords; delete clip.capLang; player.views.forEach((v) => { if (v) v.dirty = true; }); }
    return;
  }
  if (clip.capLang === to && clip.capWords) return;
  const phrases = speechPhrases(words, clip.usableEnd ?? clip.duration).filter((p) => p.text?.trim());
  if (!phrases.length) return;
  const myTurn = (clip.capJob = (clip.capJob || 0) + 1);
  if (!quiet) toast(`Translating ${clip.name}'s captions to ${langName(to)}… (the first time downloads that language, about 100 MB)`);
  try {
    const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: phrases.map((p) => p.text), from: clip.lang, to }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'translation failed');
    if (clip.capJob !== myTurn || (state.settings.captionLang || 'same') !== to) return;
    // each translated line takes the time of the line it came from, its words spread by length
    const out = [];
    phrases.forEach((p, i) => {
      const t = String(j.texts[i] || '').trim(); if (!t) return;
      let toks;
      if (RTL.test(to)) toks = [t]; // right-to-left: the whole line as one piece, so its words stay in order
      else if (NO_SPACES.test(to)) { toks = []; const chars = [...t.replace(/\s+/g, '')]; for (let k = 0; k < chars.length; k += 6) toks.push(chars.slice(k, k + 6).join('')); }
      else toks = t.split(/\s+/).filter(Boolean);
      const a = p.start + 0.12, b = Math.max(a + 0.3, p.end - 0.2), total = toks.reduce((n, w) => n + w.length + 1, 0);
      let at = a;
      for (const w of toks) { const d = (b - a) * (w.length + 1) / total; out.push({ text: w, start: at, end: at + d * 0.95 }); at += d; }
    });
    clip.capWords = out; clip.capLang = to;
    player.views.forEach((v) => { if (v) v.dirty = true; });
    renderClipsSoon();
    if (!quiet) toast(`${clip.name}: captions in ${langName(to)}`);
  } catch (e) { toast(`Couldn't translate the captions: ${e.message}`, true); }
}
// a language setting changed: hear the clips again in the language you set, or translate their captions
function languageChanged(k) {
  for (const c of state.clips) {
    if (k === 'speechLang' && c.speechState === 'done') { c.speechState = null; c.words = []; delete c.capWords; delete c.capLang; if (c.audioBuffer) analyzeSpeech(c); }
    else if (k === 'captionLang' && c.speechState === 'done') translateCaptions(c);
  }
  renderClipsSoon();
}
// silent reactions (MediaPipe Face Landmarker): a face that suddenly reacts counts as a moment (after the sounds)
function readFaces(clip) {
  if (clip.faceReact || clip.faceState || clip.photo || (clip.duration || 0) < 3) return;
  clip.faceState = 'queued';
  soundQueue = soundQueue.then(async () => {
    if (!state.clips.includes(clip)) return;
    clip.faceState = 'running';
    try {
      const f = await faceReactions(clip);
      if (!state.clips.includes(clip) || !f) { clip.faceState = 'done'; return; }
      clip.faceReact = f; clip.faceState = 'done';
      const iv = clip.interest;
      if (iv) for (let i = 0; i < iv.length; i++) { const r = faceAt(f, i / 10); if (r > 0.35) iv[i] = Math.min(1, iv[i] + 0.25 * r); }
      if (clip.status === 'ready') { clip.moments = boostMoments(clip, findMoments(clip.interest, clip.usableEnd, { words: clip.words, scenes: clip.scenes, quality: clip.quality })); replanSoon(); }
    } catch (e) { clip.faceState = 'failed'; console.warn('face reader', e); }
  });
}
// exact shot changes (PySceneDetect, open source, in the speech tools' Python): movie and TV clips cut right
// between shots instead of a frame into the next one
async function findShots(clip) {
  const src = [clip.url, clip.previewUrl].find((u) => typeof u === 'string' && u.startsWith('/cache/'));
  if (!src || clip.photo || clip.shotsState || (clip.duration || 0) < 8 || clip.duration > 900) return;
  clip.shotsState = 'running';
  try {
    const sp = await (await fetch('/api/speech')).json().catch(() => ({}));
    if (!sp.ready) { clip.shotsState = null; return; }
    const r = await fetch('/api/scenes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: src }) });
    const j = await r.json();
    if (!r.ok || !Array.isArray(j.cuts) || !state.clips.includes(clip)) { clip.shotsState = 'failed'; return; }
    clip.shotsState = 'done';
    clip.scenes = j.cuts.filter((t) => t > 0.2 && t < (clip.duration || 0) - 0.2);
    if (clip.status === 'ready') { clip.moments = boostMoments(clip, findMoments(clip.interest, clip.usableEnd, { words: clip.words, scenes: clip.scenes, quality: clip.quality })); replanSoon(); }
  } catch (e) { clip.shotsState = 'failed'; console.warn('shots', e); }
}
let speechHintShown = false;
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
      const response = await fetch('/api/transcribe?lang=' + encodeURIComponent(state.settings.speechLang || 'auto'), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: encodeWav(audio) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Speech analysis unavailable');
      clip.words = result.words || []; clip.speechState = 'done'; clip.speechError = '';
      // the language it speaks (detected or yours), and where speech starts and stops (Silero VAD) for clean cuts
      clip.lang = result.language || null; clip.speechRuns = result.speech || null;
      translateCaptions(clip);
      if (clip.viralScan && clip.words.length) applyViral(clip, clip.viralScan); // judge its viral parts again, now with its words
      if (clip.status === 'ready') {
        clip.moments = boostMoments(clip, findMoments(clip.interest, clip.usableEnd, { words: clip.words, scenes: clip.scenes, quality: clip.quality }));
        replanSoon();
      }
    } catch (error) {
      clip.speechState = 'failed';
      console.warn('Speech analysis:', error.message);
      // the speech tools aren't set up on this PC (yet): say how, once, instead of a Python error per clip
      if (/No module named|could not start|ENOENT|not recognized|runtime stopped|cannot find/i.test(error.message)) {
        clip.speechError = 'Captions need the speech tools: set them up once in Settings → Captions and speech.';
        if (!speechHintShown) { speechHintShown = true; toast('Captions and cutting between sentences need the speech tools. Set them up once in Settings → Captions and speech.'); }
      } else {
        clip.speechError = error.message;
        toast(`${clip.name}: speech analysis unavailable; using visual moments. ${error.message}`, true);
      }
    } finally { clip.speechPromise = null; renderClipsSoon(); }
  })();
  return clip.speechPromise;
}
function wantsSpeech() {
  if (isStream()) return state.settings.streamCaptions === 'on';
  return state.variants.some((v, i) => eff(i).captions === 'on' || eff(i).pick === 'quotes' || STYLES[v.styleId]?.voiceCaptions);
}
// right-click a clip: transcribe just this one, see its words, or delete it
const clipMenu = document.createElement('div');
clipMenu.className = 'clip-menu'; clipMenu.hidden = true; clipMenu.setAttribute('role', 'menu');
document.body.appendChild(clipMenu);
let clipMenuFor = null;
document.getElementById('clipList').addEventListener('contextmenu', (e) => {
  const li = e.target.closest('.clip'); if (!li) return;
  const c = state.clips.find((x) => x.id === li.dataset.id); if (!c) return;
  e.preventDefault();
  clipMenuFor = c;
  const st = c.speechState, busy = st === 'running';
  clipMenu.innerHTML = `<b title="${esc(c.name)}">${esc(c.name)}</b>
    <button data-cm="speech" ${busy || !c.audioBuffer ? 'disabled' : ''}>${!c.audioBuffer ? 'No sound to transcribe' : busy ? 'Transcribing…' : st === 'done' ? 'Transcribe again' : 'Transcribe this clip'}<small>${st === 'done' ? `${c.words?.length || 0} words found` : 'Only this clip, nothing else'}</small></button>
    <button data-cm="words" ${c.status !== 'ready' ? 'disabled' : ''}>Show transcript</button>
    <button data-cm="audio" ${c.status !== 'ready' ? 'disabled' : ''}>Clip audio…</button>
    <hr><button data-cm="delete" class="danger">Delete clip<small>Undo brings it back</small></button>`;
  clipMenu.hidden = false;
  const w = clipMenu.offsetWidth, h = clipMenu.offsetHeight;
  clipMenu.style.left = `${Math.min(innerWidth - w - 8, e.clientX)}px`;
  clipMenu.style.top = `${Math.min(innerHeight - h - 8, e.clientY)}px`;
});
clipMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cm]'); if (!b || b.disabled) return;
  const c = clipMenuFor; clipMenu.hidden = true; if (!c) return;
  const k = b.dataset.cm;
  if (k === 'delete') removeClip(c.id);
  else if (k === 'words') transcript.open(c);
  else if (k === 'audio') { const li = document.querySelector(`#clipList .clip[data-id="${c.id}"]`); clipAudio.open(c, li?.querySelector('.tr-audio') || li); }
  else if (k === 'speech') transcribeClip(c);
});
document.addEventListener('pointerdown', (e) => { if (!clipMenu.hidden && !clipMenu.contains(e.target)) clipMenu.hidden = true; }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') clipMenu.hidden = true; });
// a menu that opens under the pointer (right-click), like the desktop's: items = [{ label, sub, run, disabled, danger }] or '-'
function popMenu(e, title, items) {
  e.preventDefault();
  clipMenu.innerHTML = (title ? `<b title="${esc(title)}">${esc(title)}</b>` : '') + items.map((it, n) => it === '-' ? '<hr>' : it.head ? `<i class="pm-head">${esc(it.head)}</i>`
    : `<button data-pm="${n}" class="${it.danger ? 'danger' : ''}${it.info ? ' info' : ''}" ${it.disabled || it.info ? 'disabled' : ''}>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('');
  clipMenu._items = items; clipMenuFor = null;
  clipMenu.hidden = false;
  const w = clipMenu.offsetWidth, h = clipMenu.offsetHeight;
  clipMenu.style.left = `${Math.max(4, Math.min(innerWidth - w - 8, e.clientX))}px`;
  clipMenu.style.top = `${Math.max(4, Math.min(innerHeight - h - 8, e.clientY))}px`;
}
clipMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pm]'); if (!b || b.disabled) return;
  const it = clipMenu._items?.[Number(b.dataset.pm)]; clipMenu.hidden = true;
  it?.run?.();
});
function transcribeClip(c) {
  if (c.speechState === 'done') { c.speechState = null; c.words = []; }
  toast(`Transcribing ${c.name}…`);
  analyzeSpeech(c).then(() => { if (c.speechState === 'done') toast(`${c.name}: ${c.words?.length || 0} words found`); });
  renderClipsSoon();
}
function queueAllSpeech() { state.clips.filter(c => c.status === 'ready').forEach(c => { if (!c.speechState) analyzeSpeech(c); }); } // (a failed one: right-click → Transcribe)

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
  bury(c); // kept for a while, so Undo can bring it back
  // everything Cutsona learned from this clip goes with it: its people (Spotlight, the shot editor's faces),
  // the cuts you framed, swapped or changed in it, and effects you took off its cuts
  if (state.settings.spotlight?.clip === id) { state.settings.spotlight = null; saveSettings(); }
  const mine = (k) => String(k).startsWith(id + '@');
  for (const v of state.variants) {
    if (v.cutFrames) for (const k of [...v.cutFrames.keys()]) if (mine(k)) v.cutFrames.delete(k);
    if (v.cutEdits) for (const [k, e] of [...v.cutEdits]) if (mine(k) || e?.swap?.clipId === id || e?.ins?.clipId === id) v.cutEdits.delete(k);
    if (v.custom?.cutFx) for (const k of Object.keys(v.custom.cutFx)) if (mine(k)) delete v.custom.cutFx[k];
    if (v.savedPlan) delete v.savedPlan;
  }
  saveCustom();
  if (shotBar?.selected?.() >= 0) shotBar.close?.();
  renderClips(); renderStatus(); replanAll(); updateEmpty(); renderMainLook();
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
// a photo: how long it stays on screen in the edit. Auto = a few beats of the song (snappier on fast songs)
function photoAutoHold() {
  const bpm = state.musicAnalysis?.bpm || 120, period = 60 / bpm;
  return Math.max(0.8, Math.min(2.5, period * (period < 0.45 ? 4 : 2)));
}
function holdRow(c) {
  const auto = !c.hold, v = auto ? photoAutoHold() : c.hold, beats = Math.round(v / (60 / (state.musicAnalysis?.bpm || 120)) * 2) / 2;
  return `<div class="holdrow">
    <span>On screen</span>
    <button class="small ho-auto ${auto ? 'primary' : ''}" title="Hold it for a few beats of the song">Auto</button>
    ${[1, 2, 3].map((x) => `<button class="small ho-pick ${!auto && Math.abs(c.hold - x) < 0.01 ? 'primary' : ''}" data-hold="${x}">${x}s</button>`).join('')}
    <label><input class="ho-in" type="number" min="0.3" max="8" step="0.1" value="${v.toFixed(1)}" aria-label="Seconds ${esc(c.name)} stays on screen">s</label>
    <small>${auto ? `${beats} beat${beats === 1 ? '' : 's'}` : 'yours'}</small>
  </div>`;
}
function trimRow(c) {
  const [a, b] = clipTrim(c), whole = !c.trim;
  return `<div class="trimrow">
    <label>start <input class="tr-a" aria-label="Start of ${esc(c.name)}" value="${fmtT(a)}" spellcheck="false"></label>
    <label>for <input class="tr-l" aria-label="Length of ${esc(c.name)} in seconds" type="number" min="0.5" max="${clipFull(c).toFixed(1)}" step="0.5" value="${(b - a).toFixed(1)}">s</label>
    <button class="small tr-best" title="Pick the most action-packed part of this length">Best</button>
    <button class="small tr-all ${whole ? 'primary' : ''}" title="Use the whole clip">Whole</button>
    <button class="small tr-words" title="See every word said in this clip, search it, and start or end the clip on a word">Transcript</button>
    <button class="small tr-audio ${hasAudioFx(c) ? 'set' : ''}" aria-label="Clip settings" title="Edit this clip in its preview: which part plays (viral moments, Smart trim, transcript) and its sound (volume, mute, bass, treble, fades). Double-click its wave works too"><svg class="gear" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button></div>
    ${partsRow(c)}
    <div class="usedrow" data-used="${c.id}">${usedRowHtml(c)}</div>`;
}
// Scattered edits: the parts of a clip the edit you're on uses, as chips (click one: the playhead goes to it)
// and as marks under the clip's strip
function usedParts(c) {
  const i = state.focused, v = state.variants[i], p = v?.plan;
  if (!p || eff(i).order === 'story' || isStream()) return [];
  const k = state.planClips.indexOf(c); if (k < 0) return [];
  const out = [];
  p.segments.forEach((sg, n) => {
    if (sg.clip !== k) return;
    const a = sg.srcStart, b = sg.srcStart + (sg.srcDur || sg.end - sg.start), last = out.at(-1);
    // beat cuts inside one continuous moment are one part
    if (last && last.cut === n - 1 && Math.abs(last.b - a) < 0.08) { last.b = b; last.cut = n; return; }
    out.push({ a, b, at: sg.start, first: n, cut: n });
  });
  return out;
}
// one short line (the parts themselves are the marks on the clip's wave): how many, and ‹ › to step through them
function usedRowHtml(c) {
  const n = usedParts(c).length;
  return n ? `<span class="up-n">Edit ${state.focused + 1} uses <b>${n}</b> part${n > 1 ? 's' : ''}</span><button class="up-step" data-upstep="-1" title="The part before (on the clip)" aria-label="Previous part">‹</button><button class="up-step" data-upstep="1" title="The next part (on the clip)" aria-label="Next part">›</button>` : '';
}
function refreshUsedParts() {
  document.querySelectorAll('#clipList .clip').forEach((li) => {
    const c = state.clips.find((x) => x.id === li.dataset.id), row = li.querySelector('.usedrow');
    if (!c || !row) return;
    const html = usedRowHtml(c);
    if (row.innerHTML !== html) row.innerHTML = html; // only when it changed: no flicker
    li._drawTrim?.();
  });
}
// step through the parts of a clip the edit uses: the playhead goes to the cut, the shot editor opens on it
const upAt = new Map();
function stepUsed(c, d) {
  const parts = usedParts(c).sort((x, y) => x.a - y.a); if (!parts.length) return;
  const k = ((upAt.get(c.id) ?? (d > 0 ? -1 : 0)) + d + parts.length) % parts.length; upAt.set(c.id, k);
  const pt = parts[k];
  player.pause(); player.seek(pt.at + 0.02); shotBar?.select(pt.first, { seek: false });
  toast(`Part ${k + 1} of ${parts.length}: ${fmtT(pt.a)}–${fmtT(pt.b)} of the clip, cut ${pt.first + 1} of the edit`);
}
document.getElementById('clipList')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-upstep]'); if (!b) return;
  const c = state.clips.find((x) => x.id === b.closest('.clip')?.dataset.id); if (c) stepUsed(c, Number(b.dataset.upstep));
});
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
  // Ctrl + scroll zooms; a plain scroll keeps scrolling the sidebar (it used to zoom by accident)
  frame.addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); c.cropZoom = Math.max(1, Math.min(3, (Number(c.cropZoom) || 1) * Math.exp(-e.deltaY * 0.0015))); zoom.value = c.cropZoom; place(); redraw(); }, { passive: false });
  zoom.addEventListener('input', () => { c.cropZoom = Number(zoom.value); place(); redraw(); });
  pad.querySelector('.cp-center').onclick = () => { c.cropX = 0.5; c.cropY = 0.5; place(); redraw(); };
  place();
}

// ---- cut a clip into parts and pick which parts go together (the others are skipped) ----
let cutMode = null; // id of the clip whose strip cuts on click
function partsRow(c) {
  const parts = c.parts || [], cutting = cutMode === c.id;
  return `<div class="partsrow">
    <button class="small tr-cut ${cutting ? 'primary' : ''}" title="${cutting ? 'Done cutting' : 'Cut the clip into parts (click the strip above where to cut), then pick the parts to use'}">${cutting ? 'Done' : 'Cut'}</button>
    ${parts.length > 1
      ? parts.map((p, k) => (p.gone ? '' : `<span class="cpart-g"><button class="clip-part ${p.on ? 'on' : ''}" data-cpart="${k}" title="${p.on ? 'Used. Click to skip this part' : 'Skipped. Click to use this part'}">${parts.slice(0, k).filter((x) => !x.gone).length + 1}<small>${fmtT(p.a)}-${fmtT(p.b)}</small></button><button class="cpart-x" data-cpart-del="${k}" title="Delete this part from the video" aria-label="Delete part ${fmtT(p.a)} to ${fmtT(p.b)}">×</button></span>`)).join('')
        + (parts.some((p) => p.gone) ? `<button class="small tr-restore" title="Bring the deleted parts back">Restore ${parts.filter((p) => p.gone).length} deleted</button>` : '')
        + '<button class="small tr-uncut" title="Join the parts back into one clip">Uncut</button>'
      : cutting ? '<small>Click the strip to cut</small>' : ''}
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
    // how viral each second is: a thin heat line along the top (orange / red = the likeliest to go viral)
    const vc = c.viral?.curve;
    if (vc?.length) for (let x = 0; x < W; x += dpr) {
      const v = vc[Math.min(vc.length - 1, Math.floor(((x / W) * f) / c.viral.step))] || 0;
      if (v < 0.32) continue;
      g.fillStyle = heatColor(v); g.fillRect(x, 0, dpr, 2.5 * dpr);
    }
    // title cards / black screens the edits skip: dark hatched
    if (skipCardsOn() && withCards([c])[0] !== c) for (const [s0, e0] of c.cards || []) {
      const px0 = (s0 / f) * W, px1 = (e0 / f) * W;
      g.fillStyle = 'rgba(10,10,10,0.7)'; g.fillRect(px0, 0, px1 - px0, H);
      g.strokeStyle = 'rgba(242,240,234,0.28)'; g.lineWidth = 1 * dpr;
      for (let x = px0 - H; x < px1; x += 5 * dpr) { g.beginPath(); g.moveTo(Math.max(px0, x), Math.min(H, H - (Math.max(px0, x) - x))); g.lineTo(Math.min(px1, x + H), Math.max(0, H - (Math.min(px1, x + H) - x))); g.stroke(); }
    }
    // the parts the edit you're on uses (Scattered): marks along the bottom
    const onC = getComputedStyle(document.documentElement).getPropertyValue('--on').trim() || '#34d17a';
    for (const pt of usedParts(c)) { g.fillStyle = onC; g.fillRect((pt.a / f) * W, H - 3 * dpr, Math.max(2 * dpr, ((pt.b - pt.a) / f) * W), 3 * dpr); }
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
  li.querySelector('.tr-words').onclick = () => transcript.open(c);
  li.querySelector('.tr-audio').onclick = (e) => openClipPreview(c, e.currentTarget);
  li.querySelector('.tr-cut').onclick = () => { cutMode = cutMode === c.id ? null : c.id; renderClips(); };
  li.querySelectorAll('[data-cpart]').forEach((btn) => (btn.onclick = () => { toggleCutPart(c, Number(btn.dataset.cpart)); renderClips(); replanAll(); }));
  li.querySelectorAll('[data-cpart-del]').forEach((btn) => (btn.onclick = () => { if (deleteCutPart(c, Number(btn.dataset.cpartDel))) { renderClips(); replanAll(); } }));
  const restore = li.querySelector('.tr-restore');
  if (restore) restore.onclick = () => { for (const p of c.parts) if (p.gone) { delete p.gone; p.on = true; } renderClips(); replanAll(); };
  const uncut = li.querySelector('.tr-uncut');
  if (uncut) uncut.onclick = () => { delete c.parts; cutMode = null; renderClips(); replanAll(); };
  li.querySelector('.tr-best').onclick = () => { const [a, b] = clipTrim(c), L = !c.trim ? Math.min(clipFull(c), Math.max(5, Number(state.settings.length) || 15)) : b - a, s = bestClipPart(c, L); setTrim(c, s, s + L); done(); };
  li._drawTrim = draw;
  // double-click the clip's wave: its sound settings (like the song's Edit)
  cv.addEventListener('dblclick', (e) => { e.preventDefault(); openClipPreview(c, cv); });
  requestAnimationFrame(draw);
}
function renderClips() {
  if (trimDrag) { trimRenderPending = true; return; } // keep the trim bar alive while it's being dragged
  const ul = $('#clipList');
  // a card that would come out exactly the same is kept as it is (no flicker, its pictures and wave stay put)
  const old = new Map([...ul.children].map((x) => [x._cid, x]));
  ul.innerHTML = '';
  requestAnimationFrame(refreshUsedParts);
  requestAnimationFrame(applyLocks);
  for (const c of state.clips) {
    const li = document.createElement('li');
    li.className = 'clip ' + c.status;
    const dur = c.duration ? fmt(c.duration).replace(/\.\d$/, '') : '';
    // the clip's shape differs from the edit's (a 9:16 clip in a 16:9 edit, or the other way round): it gets cropped,
    // so you can choose which part shows
    const canCrop = c.status === 'ready' && c.w && state.variants.some((_, i) => Math.abs(Math.log(aspectOf(i) / (c.w / c.h))) > 0.03 && eff(i).framing === 'fill');
    li.innerHTML = `
      <div class="thumb" style="${c.thumb ? `background-image:url(${c.thumb})` : ''}"><span class="dur">${dur}</span></div>
      <div class="info"><div class="name" title="${esc(c.name)}">${c.status !== 'error' ? rightsBadge(rightsFor(c.origin)) : ''}<span class="nm">${esc(c.name)}</span>${viralLabel(c)}</div>
        <div class="sub">${c.status === 'loading' ? esc(c.sub || 'analyzing…') : resBadge(c.w, c.h) + esc(c.sub || '')}${c.audioBuffer ? ', audio' : ''}${c.reactions ? `, <span title="Laughter, cheering, screaming or big hits Cutsona heard: those moments count more">${c.reactions} reaction${c.reactions > 1 ? 's' : ''} heard</span>` : c.soundState === 'running' ? ', listening…' : ''}${trackLabel(c)}${crowdLabel(c)}${c.speechState === 'running' ? ', transcribing…' : c.speechState === 'done' ? (c.words?.length ? `, ${c.lang && c.lang !== 'en' ? langName(c.lang) + ' ' : ''}speech timed${c.capLang ? ` (captions in ${langName(c.capLang)})` : ''}` : ', no speech') : c.speechState === 'failed' ? (c.ytWords?.length ? ', captions' : ', speech unavailable') : ''}${hasAudioFx(c) ? `, <b class="ca-badge" title="Change it with the Audio button">${c.audioFx?.mute ? 'muted' : `audio ${Math.round(clipLevel(c) * 100)}%`}</b>` : ''}</div>
        ${c.track?.people?.length ? `<div class="clip-faces">${c.track.people.map((p) => `<img src="${p.thumb}" data-cface="${p.id}" alt="${esc(p.name)}" title="${esc(p.name)}: in ${Math.round(p.share * 100)}% of the clip. Click to put the playhead on them">`).join('')}</div>` : ''}
        ${c.photo ? '' : `<div class="heat ${c.status === 'ready' ? 'trim' : ''}"><canvas width="200" height="4"></canvas></div>`}</div>
      <button class="x" title="Remove">×</button>
      ${c.status === 'ready' && c.duration ? (c.photo ? holdRow(c) : trimRow(c)) : ''}
      ${canCrop ? `<div class="crop"><span>Framing</span><button class="small ${!c.manualCrop ? 'primary' : ''}" data-crop="auto">Auto</button><button class="small ${c.manualCrop ? 'primary' : ''}" data-crop="manual" title="Choose which part of the clip shows">Move &amp; zoom</button></div>
        ${c.manualCrop ? `<div class="crop-pad">
          <div class="cp-frame" style="aspect-ratio:${c.w} / ${c.h};${c.framingThumb || c.thumb ? `background-image:url(${c.framingThumb || c.thumb})` : ''}" title="Drag the box to the part you want to show. Ctrl + scroll zooms"><i class="cp-box"></i></div>
          <div class="cp-ctl"><label>Zoom <b class="cp-z">${(Number(c.cropZoom) || 1).toFixed(2).replace(/0$/, '')}×</b><input class="cp-zoom" type="range" min="1" max="3" step="0.05" value="${Number(c.cropZoom) || 1}" aria-label="Zoom for ${esc(c.name)}"></label>
            <button class="small cp-center">Center</button></div>
          </div>` : ''}` : ''}`;
    const sig = li.className + '|' + state.clips.length + '|' + (cutMode === c.id) + '|' + (c.interest?.length || 0) + '|' + li.innerHTML, prev = old.get(c.id);
    if (prev && prev._sig === sig && prev._clip === c) { ul.appendChild(prev); prev._drawTrim?.(); continue; }
    li._cid = c.id; li._sig = sig; li._clip = c;
    li.querySelector('.x').onclick = () => removeClip(c.id);
    if (c.photo) {
      const setHold = (h) => { if (h == null) delete c.hold; else c.hold = Math.max(0.3, Math.min(8, Math.round(h * 10) / 10)); renderClips(); replanSoon(); };
      li.querySelector('.ho-auto')?.addEventListener('click', () => setHold(null));
      li.querySelectorAll('.ho-pick').forEach((b) => b.addEventListener('click', () => setHold(+b.dataset.hold)));
      li.querySelector('.ho-in')?.addEventListener('change', (e) => { const n = parseFloat(e.target.value); if (n > 0) setHold(n); });
    }
    li.querySelector('[data-vinfo]')?.addEventListener('click', (ev) => { ev.stopPropagation(); viralInfo(ev); });
    // a face of this clip: the playhead goes to the cut where that person is (and the shot editor follows them)
    li.querySelector('.clip-faces')?.addEventListener('wheel', (ev) => { const r = ev.currentTarget; if (r.scrollWidth > r.clientWidth && Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { r.scrollLeft += ev.deltaY; ev.preventDefault(); } }, { passive: false });
    li.querySelector('.clip-faces')?.addEventListener('click', (ev) => {
      const im = ev.target.closest('[data-cface]'); if (!im) return;
      ev.stopPropagation();
      const k = state.planClips.indexOf(c);
      if (k < 0 || !state.variants[state.focused]?.plan) { toast('Make the edits first, then click a face to find them in the cuts'); return; }
      shotBar.showPerson(k, im.dataset.cface);
    });
    // drag a clip up/down to change the order ("In order" edits play the list top to bottom)
    li.dataset.id = c.id;
    li.draggable = state.clips.length > 1;
    if (state.clips.length > 1) li.title = 'Drag to change the clip order';
    li.addEventListener('dragstart', (e) => {
      if (e.target.closest && e.target.closest('input, button')) { e.preventDefault(); return; }
      clipDragId = c.id; li.classList.add('dragging-clip');
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-cutsona-clip', c.id);
      // the thing under your pointer: a grey ghost of the clip (its picture and name)
      const gh = document.createElement('div'); gh.className = 'clip-ghost';
      gh.innerHTML = `${c.thumb ? `<img src="${c.thumb}" alt="">` : ''}<b>${esc(c.name)}</b>`;
      document.body.appendChild(gh); e.dataTransfer.setDragImage(gh, 20, 20); setTimeout(() => gh.remove(), 0);
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
    if (c.status === 'ready' && c.duration && !c.photo) initTrim(li, c);
    else if (c.interest && !c.photo) {
      const cv = li.querySelector('.heat canvas'), g = cv.getContext('2d');
      for (let x = 0; x < 200; x++) {
        const v = c.interest[Math.floor((x / 200) * c.interest.length)] || 0;
        g.fillStyle = accentRGBA(0.12 + 0.88 * Math.min(1, v) ** 1.5);
        g.fillRect(x, 0, 1, 4);
      }
    }
    ul.appendChild(li);
    li._drawTrim?.(); // now that it's on the page (drawn right away: a rebuilt card never shows an empty wave)
  }
  $('#clipDrop').classList.toggle('compact', state.clips.length > 0);
}

function setAnalyzing(text) {
  const a = $('#analyzing');
  a.hidden = !text;
  if (text) $('#analyzingText').textContent = text;
}

// ---------------- music ----------------
// the song box while a song is on its way: a bar (download %) or a moving stripe (converting, finding beats)
function songProgress(text, pct = null) {
  const d = $('#musicDrop'); if (!d) return;
  let bar = d.querySelector('.m-prog');
  if (!bar) { bar = document.createElement('span'); bar.className = 'm-prog'; bar.innerHTML = '<i></i>'; d.appendChild(bar); }
  d.classList.toggle('busy', text != null);
  d.querySelector('b').textContent = text ?? 'Drop a song';
  bar.classList.toggle('indet', text != null && !(pct > 0));
  bar.firstChild.style.width = pct > 0 ? `${Math.min(100, pct)}%` : '';
  if (text != null) { $('#musicBox').hidden = true; d.hidden = false; }
}
async function setMusic(file, origin = null, url = null) {
  try {
    songProgress('Finding the beats…');
    await sleep(30);
    const ab = await file.arrayBuffer();
    const tags = origin ? null : readId3(ab);
    const buffer = await decodeAudio(ab);
    await sleep(20);
    const analysis = analyzeMusic(buffer);
    state.music = { name: file.name, buffer, analysis, file, url, origin: origin || { kind: 'song', local: true, title: file.name, tags } };
    state.music.id = 'm' + Math.random().toString(36).slice(2, 9);
    if (!projectLoading && !state.clipVolTouched) { state.settings.clipVol = 0.2; syncInputs(); }
    applyBeatOffset();
    const L = Math.min(currentLength(), buffer.duration);
    state.musicStart = suggestWindow(analysis, L);
    songProgress(null);
    musicUi();
    renderStatus(); drawWave(); replanAll();
    toast(`Locked to ${Math.round(analysis.bpm)} BPM`);
  } catch (e) {
    console.error(e);
    toast('Could not read that song: ' + e.message, true);
    songProgress(null); musicUi();
  }
}
function musicUi() {
  const m = state.music;
  $('#musicBox').hidden = !m; $('#musicDrop').hidden = !!m; $('#btnRemoveMusic').hidden = !m; $('#btnEditMusic').hidden = !m;
  if (!m) { $('#musicDrop').querySelector('b').textContent = 'Drop a song'; return; }
  renderMusicName();
  $('#bpm').textContent = `${Math.round(m.analysis.bpm)} BPM, ${m.analysis.impacts.length} drops/hits`;
  $('#beatOffset').value = state.beatOffset;
  $('#offsetVal').textContent = `${state.beatOffset > 0 ? '+' : ''}${state.beatOffset} ms`;
}
function removeMusic() {
  if (state.music) bury(state.music);
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
  const v = trimView(withCards([c])[0]), a = v.trimIn || 0, b = Math.min(v.duration || 0, v.usableEnd ?? v.duration ?? 0);
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
  const key = [s.streamLen, ...ready.map((c) => `${c.id}:${c.words?.length || 0}:${c.crowdState || ''}:${c.track ? 1 : 0}:${(c.trim || []).join('-')}:${partsKey(c)}:${c.sounds ? 's' : ''}${c.faceReact ? 'f' : ''}`)].join('|');
  if (hiCache.key !== key) {
    for (const c of ready) if (c.track && !c.cam) { c.cam = findCam(c); findCamBox(c); }
    // "Match clip": every clip in full (dead video at the ends cut off), else the best highlights up to the max length
    hiCache = { key, list: s.streamLen === 'match' ? wholeHighlights(ready.map(trimView)) : findHighlights(ready.map(trimView), { count: 16, maxLen: Number(s.streamLen) || 30 }) };
  }
  return hiCache.list;
}
// the webcam's own box in the stream picture (its edges), so "Webcam + full screen" crops exactly to it
async function findCamBox(clip) {
  const cam = clip.cam;
  if (!cam || cam.full || cam.boxState) return;
  const src = clip.previewUrl?.startsWith('/cache/') ? clip.previewUrl : clip.url?.startsWith('/cache/') ? clip.url : '';
  if (!src) return;
  cam.boxState = 'looking';
  try {
    const j = await (await fetch(`/api/camrect?source=${encodeURIComponent(src)}&x=${cam.x}&y=${cam.y}&w=${cam.w}&h=${cam.h}`)).json();
    if (clip.cam !== cam) return;
    cam.box = j.box || null; cam.boxState = 'done';
    // a webcam box found around the streamer: a real facecam (even when the person box ran out of the corner)
    if (cam.box) { cam.steady = true; cam.corner = true; }
    if (cam.box) replanSoon();
  } catch { cam.boxState = 'failed'; }
}
// Clipper Mode: every take a different edit of the highlight, so you can pick the one that works: its layout
// (cam + screen / cam only / full frame, when the clip has a facecam), its captions, its banner and its filter.
// How it moves is always yours: Zoom on big reactions and Cuts hold on every take.
// Take 1 is exactly your settings; Settings → "Every take" can make them all the same.
// (split: the cam's share of the height; gz: a closer crop of the screen; capDy: captions a bit higher / lower)
const STREAM_RECIPES = [
  null,
  { layout: 'cam', cap: 'glow_word', theme: 'nametag', filter: 'vivid', split: 0.44, label: 'glow captions, name tag, vivid' },
  { layout: 'full', cap: 'hormozi_gold', theme: 'live', filter: 'hdr', gz: 1.12, label: 'gold captions, LIVE banner, HDR' },
  { layout: 'stack', cap: 'yellow_pop', theme: 'brand', filter: 'teal', split: 0.4, gz: 1.15, capDy: -0.04, label: 'small cam, yellow captions, teal' },
  { layout: 'cam', cap: 'edit_caps', theme: 'center', filter: 'none', split: 0.56, capDy: 0.05, label: 'big cam, bold captions' },
  { layout: 'full', cap: 'stream_word', theme: 'minimal', filter: 'cold', label: 'one word at a time, cold' },
  { layout: 'stack', cap: 'neon_green', theme: 'live', filter: 'vivid', split: 0.6, gz: 1.1, label: 'big cam, neon captions, vivid' },
  { layout: 'cam', cap: 'crimson_fire', theme: 'classic', filter: 'hdr', split: 0.36, capDy: -0.03, label: 'small cam, red captions, HDR' },
];
const streamRecipe = (i) => (isStream() && state.settings.streamVary !== 'same' ? STREAM_RECIPES[i % STREAM_RECIPES.length] : null);
function streamPlan(i, ready) {
  const v = state.variants[i], s = state.settings, list = streamHighlights(ready);
  if (!list.length) { v.plan = null; return; }
  // hiPick: one highlight by number (Export all goes through them one by one), else card i of the current page
  const k = v.hiPick != null ? v.hiPick : i + state.variants.length * (v.hiSkip || 0), h0 = list[k % list.length];
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
  const R = v.custom.layout ? null : streamRecipe(i);
  const hv = cut || h0, cutPauses = s.streamCuts === 'pauses';
  const pieces = keepParts(cutPauses ? hv.pieces : [[hv.a, hv.b]], partsOff(clip));
  const zoom = s.reactZoom === 'on'; // (your setting on every take: a take never zooms when you turned it off)
  const h = { ...hv, pieces: pieces.length ? pieces : [[hv.a, hv.b]], punches: zoom ? hv.punches : [] };
  // the banner name: what you typed, else the channel the clip came from (your own files have none)
  const b = clip.crowd?.brain, typed = String(s.bannerName || '').trim().replace(/^@/, '');
  const plat = s.bannerPlatform && s.bannerPlatform !== 'auto' ? s.bannerPlatform : b?.platform || (typed ? 'twitch' : '');
  const opts = { outAspect: aspectOf(i), channel: typed || b?.name || '', platform: plat };
  // a take's own layout only when the clip really has a streamer's facecam (a game's characters are not a facecam)
  const realCam = !!(clip.cam?.steady && !clip.cam.full);
  const rl = R && s.streamLayout === 'auto' ? (realCam ? R.layout : 'full') : null;
  v.plan = planHighlight(h, ready, { ...opts, layout: v.custom.layout || rl || s.streamLayout });
  v.plan.highlight.recipe = R ? `${{ cam: 'webcam + screen', stack: 'cam + screen', full: 'full frame' }[v.plan.highlight.layout] || ''}, ${R.label}` : '';
  if (V[1] && canFlip && !R) {
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
  if (!alsoAvoid && v.sourcePlan) {
    const fixed = remapSavedPlan(v.sourcePlan, ready);
    if (fixed) {
      v.plan = restorePlan(fixed); applyCutEdits(v); attachCutFraming(v); return;
    }
    v.plan = null;
    return;
  }
  // a project you opened: keep its saved cuts until you change something that would cut it differently
  const sp = v.savedPlan;
  if (sp) {
    if (!alsoAvoid && sp.sig === planSig(i, ready)) {
      const kept = remapSavedPlan(sp, ready);
      if (kept) { v.plan = restorePlan(kept); attachCutFraming(v); return; }
    }
    if (!projectLoading) delete v.savedPlan;
  }
  if (isStream()) { streamPlan(i, ready); return; }
  const L = currentLength();
  if (state.music) state.musicStart = Math.max(0, Math.min(state.musicStart, state.music.buffer.duration - L));
  const e = eff(i);
  // every edit shows different moments: avoid what the other edits (and, on a re-roll, this edit's last take) already use
  const avoid = [];
  state.variants.forEach((o, j) => { if (j !== i) windowsOf(o.plan, avoid); });
  if (alsoAvoid) windowsOf(alsoAvoid, avoid);
  const viralOn = e.pick === 'viral';
  v.plan = planEdit({ clips: spotClips(withCards(viralOn ? ready.map(viralize) : ready)), music: state.musicAnalysis, musicStart: state.music ? state.musicStart : 0, length: L, styleId: v.styleId, seed: v.seed,
    pacing: Number(e.pacing), noSpeed: e.speed === 'off', preserveSpeech: Number(e.clipVol) > 0.05 || e.captions === 'on' || e.pick === 'quotes',
    off: v.custom.off || [], avoid, mode: viralOn ? 'auto' : e.pick || 'auto', order: e.order === 'story' ? 'story' : 'scattered' });
  // never an empty take: if skipping title cards left nothing, plan without skipping them
  if ((!v.plan?.segments.length || v.plan.duration < 1) && skipCardsOn()) {
    v.plan = planEdit({ clips: spotClips(ready), music: state.musicAnalysis, musicStart: state.music ? state.musicStart : 0, length: Math.max(L, 3), styleId: v.styleId, seed: v.seed,
      pacing: Number(e.pacing), noSpeed: e.speed === 'off', preserveSpeech: true, off: v.custom.off || [], avoid, mode: e.pick === 'viral' ? 'auto' : e.pick || 'auto', order: e.order === 'story' ? 'story' : 'scattered' });
  }
  // Spotlight on someone who's barely in the clips: an edit without it rather than an empty one
  if (state.settings.spotlight && (!v.plan?.segments.length || v.plan.duration < 1)) {
    v.plan = planEdit({ clips: ready, music: state.musicAnalysis, musicStart: state.music ? state.musicStart : 0, length: L, styleId: v.styleId, seed: v.seed,
      pacing: Number(e.pacing), noSpeed: e.speed === 'off', preserveSpeech: true, off: v.custom.off || [], avoid, mode: e.pick || 'auto', order: 'scattered' });
    if (!replan.warned) { replan.warned = true; setTimeout(() => { replan.warned = false; }, 4000); toast('Spotlight: that person is on screen too little to fill the edit, so it uses the whole clip'); }
  }
  // last resort: still nothing (a very short or odd part of a clip): the plainest edit that can be made
  if (!v.plan?.segments.length || v.plan.duration < 1) {
    v.plan = planEdit({ clips: ready, music: state.musicAnalysis, musicStart: state.music ? state.musicStart : 0, length: Math.max(L, 5), styleId: v.styleId, seed: v.seed,
      pacing: Number(e.pacing), noSpeed: false, preserveSpeech: false, off: v.custom.off || [], avoid: null, mode: 'auto', order: 'scattered' });
  }
  applyCutEdits(v);
  attachCutFraming(v);
  applySpotlight(v);
}
// ---- Spotlight: one person, the whole edit ----
// Pick a person found in a clip: every take uses only the parts of that clip with them on screen, and the camera
// follows them in every cut (a cut you framed by hand keeps your framing).
function spotPerson() {
  const sp = state.settings.spotlight; if (!sp) return null;
  const c = state.clips.find((x) => x.id === sp.clip), p = c?.track?.people?.find((x) => x.id === sp.pid);
  return c && p ? { c, p } : null;
}
// the times the person is on screen, as [start, end] stretches of the clip
function spotRanges(c, p) {
  const step = (c.duration || 1) / Math.max(1, Math.min(600, Math.ceil((c.duration || 1) * 4)));
  const out = [];
  for (const s of p.seen) {
    const a = Math.max(0, s.t - Math.max(0.3, step)), b = Math.min(c.duration, s.t + Math.max(0.3, step));
    const last = out.at(-1);
    if (last && a <= last[1] + step * 1.5) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out.filter(([a, b]) => b - a >= 0.4);
}
function spotClips(ready) {
  const S = spotPerson(); if (!S) return ready;
  const keep = spotRanges(S.c, S.p);
  if (!keep.length) return ready;
  return ready.map((c) => {
    if (c !== S.c) return { ...c, usableEnd: 0.01, moments: [] }; // other clips: not used
    // everything without the person counts as unusable (like a still picture), so it's skipped
    const gaps = []; let at = 0;
    for (const [a, b] of keep) { if (a - at > 0.05) gaps.push([at, a]); at = b; }
    if (c.duration - at > 0.05) gaps.push([at, c.duration]);
    // (the clip's own start / length don't apply: Spotlight uses the whole clip, wherever the person is)
    return { ...c, trim: null, parts: undefined, stills: [...(c.stills || []), ...gaps].sort((x, y) => x[0] - y[0]),
      moments: (c.moments || []).filter((m) => keep.some(([a, b]) => m.t >= a && m.t <= b)) };
  });
}
function applySpotlight(v) {
  const S = spotPerson(); if (!S || !v.plan) return;
  const k = state.planClips.indexOf(S.c); if (k < 0) return;
  for (const sg of v.plan.segments) {
    if (sg.clip !== k || (sg.framing && !sg.framing.spot)) continue;
    const mid = sg.srcStart + (sg.srcDur || sg.end - sg.start) / 2;
    const s = S.p.seen.reduce((a, x) => (Math.abs(x.t - mid) < Math.abs(a.t - mid) ? x : a), S.p.seen[0]);
    sg.framing = { mode: 'person', z: 1, seed: { t: s.t, x: s.x, y: s.y + s.h * 0.9, h: s.h * 3, face: S.p.id }, spot: true };
  }
}
function spotlightHtml() {
  const ready = state.clips.filter((c) => c.status === 'ready'), sp = state.settings.spotlight, S = spotPerson();
  const people = state.clips.filter((c) => c.status !== 'error').flatMap((c) => (c.track?.people || []).map((p) => ({ c, p })));
  const busy = ready.some((c) => c.trackState === 'running' || c.trackState === 'queued');
  const needScan = ready.some((c) => !c.track?.people || (c.track.peopleV || 1) < 2);
  return `<div class="field spot"><span>Spotlight <em>${S ? `follows ${esc(S.p.name)}` : 'off: everyone'}</em></span>
    <div class="spot-row"><button data-spot="off" class="spot-off ${!S ? 'on' : ''}">Off</button>${people.map(({ c, p }) => `<button data-spot="${c.id}|${p.id}" class="spot-face ${sp?.clip === c.id && sp?.pid === p.id ? 'on' : ''}" title="${esc(p.name)} (${esc(c.name)}): in ${Math.round(p.share * 100)}% of the clip"><img src="${p.thumb}" alt=""><span>${esc(p.name.replace('Person ', 'P'))}</span></button>`).join('')}
      ${busy ? '<span class="spot-note"><i class="spin"></i>Finding the people…</span>' : needScan && ready.length ? '<button data-spot="scan" class="small">Find the people</button>' : ''}</div>
    <small class="hint-s">${S ? 'Every take uses only the parts with this person in them, and the camera stays on them the whole time. A cut you framed yourself keeps your framing.' : 'Pick one person: every take follows only them, using only the parts they are in.'}</small></div>`;
}
// ---- settings that decide another setting: that one is greyed out (with why), until the first is turned off ----
let lockedNow = new Set();
function locksNow() {
  const s = state.settings, L = [];
  if (isStream()) return L;
  const S = spotPerson();
  if (S) {
    L.push(['order', 'Spotlight is on: the edit goes wherever the person is']);
    L.push(['pick', 'Spotlight is on: it uses the parts with the person in them']);
    L.push(['focus', 'Spotlight is on: the camera follows the person']);
    L.push(['framing', 'Spotlight is on: the picture is cropped to follow the person']);
    L.push(['trim', 'Spotlight is on: it uses the whole clip, wherever the person is']);
  } else if (s.framing === 'fit') L.push(['focus', 'Framing is Fit + blur: the whole picture shows, so there is nothing to follow']);
  if (s.pick === 'quotes') L.push(['captions', 'What to use is Best quotes: the lines always show their words']);
  if (s.mode !== 'stream' && s.pick === 'quotes' && s.speed !== 'off') L.push(['speed', 'Best quotes plays every line at normal speed']);
  return L;
}
function applyLocks() {
  const L = locksNow(), now = new Set(L.map((x) => x[0]));
  // greyed fields: the main settings (rendered and static ones) and the clip trims
  document.querySelectorAll('.lock-note').forEach((n) => n.remove());
  document.querySelectorAll('.locked').forEach((el) => { el.classList.remove('locked'); el.removeAttribute('data-lock'); });
  for (const [k, why] of L) {
    const fields = k === 'trim' ? [...document.querySelectorAll('#clipList .trimrow')]
      : k === 'framing' ? [document.querySelector('#segFraming')?.parentElement].filter(Boolean)
      : [...document.querySelectorAll(`#mainLook .field:has([data-k="${k}"])`)];
    for (const f of fields) {
      f.classList.add('locked'); f.title = why;
      const n = document.createElement('small'); n.className = 'lock-note'; n.textContent = why;
      f.insertAdjacentElement(k === 'trim' ? 'afterend' : 'beforeend', n);
    }
  }
  // say so when something just got taken over
  const fresh = L.filter(([k]) => !lockedNow.has(k));
  if (fresh.length && lockedNow.size + fresh.length > 0 && applyLocks.ready) {
    const names = { order: 'Clip order', pick: 'What to use', focus: 'Auto-focus', framing: 'Framing', trim: 'the clip start / length', captions: 'Auto-captions', speed: 'Speed ramps' };
    toast(`${fresh.map(([k]) => names[k] || k).join(', ')} ${fresh.length > 1 ? 'are' : 'is'} greyed out: ${fresh[0][1].split(':')[0]}. Turn that off to change ${fresh.length > 1 ? 'them' : 'it'}`);
  }
  lockedNow = now; applyLocks.ready = true;
}
function setSpotlight(v) {
  if (v === 'scan') {
    for (const c of state.clips.filter((x) => x.status === 'ready')) if (!c.track?.people || (c.track.peopleV || 1) < 2) { c.track = null; c.trackState = null; c.trackPromise = null; wantTrack(c, 'people'); }
    toast('Finding the people in your clips…'); renderMainLook(); return;
  }
  if (v === 'off') state.settings.spotlight = null;
  else { const [clip, pid] = v.split('|'); state.settings.spotlight = { clip, pid }; }
  // spotlight framing goes away with it
  if (v === 'off') state.variants.forEach((x) => x.plan?.segments.forEach((sg) => { if (sg.framing?.spot) delete sg.framing; }));
  saveSettings(); replanAll(); renderMainLook();
  const S = spotPerson();
  toast(S ? `Spotlight on ${S.p.name}: every take follows them` : 'Spotlight off');
}
// Framing set in the shot editor belongs to one cut of one edit. It is remembered per edit by
// clip + source moment, so the same cut keeps it when the edit is re-planned (effects ticked, etc.).
const cutKey = (seg) => { const c = state.planClips[seg.clip]; return c ? `${c.id}@${seg.srcStart.toFixed(2)}` : ''; };
function attachCutFraming(v) {
  if (!v.plan) return;
  if (v.cutFrames) for (const s of v.plan.segments) { const f = v.cutFrames.get(cutKey(s)); if (f) s.framing = f; }
  // effects you removed from single cuts (right-click the FX row): no transition, normal speed, not mirrored
  const cf = v.custom?.cutFx; if (!cf) return;
  v.plan.segments.forEach((s, k) => {
    const x = cf[cutKey(s)]; if (!x) return;
    if (x.noTrans) { s.transIn = null; const pv = v.plan.segments[k - 1]; if (pv) pv.transOut = null; }
    if (x.normal && s.profile && !(s.profile.type === 'const' && (s.profile.r || 1) === 1)) { s.profile = { type: 'const', r: 1 }; s.srcDur = s.end - s.start; }
    if (x.noFlip) s.mirror = 0;
    if (x.fade) s.fade = { ...x.fade };
  });
}
// right-click the FX row: take an effect away (from this cut, or from the whole take)
function fxMenu(e) {
  const i = state.focused, v = state.variants[i], p = v?.plan; if (!p?.segments.length) return;
  const k = shotBar.shotAt(tlTime(e)), sg = p.segments[k]; if (!sg) return;
  const e2 = eff(i), key = cutKey(sg), pr = sg.profile || {};
  const setCut = (prop) => () => { v.custom.cutFx = { ...(v.custom.cutFx || {}), [key]: { ...(v.custom.cutFx?.[key] || {}), [prop]: true } }; saveCustom(); replan(i); updateCards(); drawTimeline(player.now(), player.duration()); toast(`Cut ${k + 1}: removed`); };
  const items = [{ head: `This cut (${k + 1})` }];
  if (sg.transIn) items.push({ label: `Remove the ${sg.transIn.type} transition`, sub: `Into cut ${k + 1}: a plain cut instead`, run: setCut('noTrans') });
  if (pr.type === 'ramp' || pr.type === 'stutter' || (pr.type === 'const' && Math.abs((pr.r || 1) - 1) > 0.03)) items.push({ label: 'Normal speed for this cut', sub: pr.type === 'stutter' ? 'No stutter' : pr.type === 'ramp' ? 'No speed ramp' : `Not ${(+pr.r).toFixed(2)}×`, run: setCut('normal') });
  if (sg.mirror) items.push({ label: 'Not mirrored', sub: `Cut ${k + 1} shows the picture the right way round`, run: setCut('noFlip') });
  // fades of this one cut (from / to black), on top of its clip's
  { const cur = sg.fade || null, setFade = (f) => () => { const o = { ...(v.custom.cutFx?.[key] || {}) }; if (f) o.fade = f; else delete o.fade; const cf = { ...(v.custom.cutFx || {}) }; if (Object.keys(o).length) cf[key] = o; else delete cf[key]; v.custom.cutFx = cf; saveCustom(); replan(i); updateCards(); drawTimeline(player.now(), player.duration()); toast(f ? `Cut ${k + 1}: fade ${f.in ? `in ${f.in}s` : ''}${f.in && f.out ? ', ' : ''}${f.out ? `out ${f.out}s` : ''}${!f.in && !f.out ? 'off' : ''}` : `Cut ${k + 1}: its clip's fades`); };
    const d = sg.end - sg.start, q = Math.min(0.4, Math.round(d * 0.25 * 10) / 10) || 0.1;
    items.push({ label: 'Fade in', sub: `${q}s from black`, run: setFade({ in: q, out: cur?.out || 0 }) },
      { label: 'Fade out', sub: `${q}s to black`, run: setFade({ in: cur?.in || 0, out: q }) },
      { label: 'Fade in and out', sub: `${q}s each`, run: setFade({ in: q, out: q }) },
      { label: 'Fade length…', sub: 'Your own seconds', run: () => numPop(e.clientX, e.clientY, `Cut ${k + 1} fades`, [['In', cur?.in ?? q], ['Out', cur?.out ?? q]], d * 0.8, ([fi, fo]) => setFade({ in: fi, out: fo })()) });
    if (cur) items.push({ label: 'No fade on this cut', run: setFade({ in: 0, out: 0 }) }, { label: 'Use its clip\'s fades', run: setFade(null) }); }
  if (v.custom.cutFx?.[key]) items.push({ label: 'Bring back this cut\'s effects', run: () => { const cf = { ...v.custom.cutFx }; delete cf[key]; v.custom.cutFx = cf; saveCustom(); replan(i); updateCards(); drawTimeline(player.now(), player.duration()); } });

  items.push('-', { head: `Whole take ${i + 1}` });
  const n0 = items.length;
  if (e2.filter && e2.filter !== 'none') items.push({ label: `Remove the ${FILTERS[e2.filter]?.name || e2.filter} filter`, run: () => toggleCardEffect(i, 'filter', e2.filter) });
  for (const x of e2.fx || []) { const ex = EXTRAS.find((q) => q[0] === x); if (ex) items.push({ label: `Remove ${ex[1].replace('✦ ', '')}`, run: () => toggleCardEffect(i, 'fx', x) }); }
  for (const [pk, pl] of styleParts(v.styleId)) if (!(v.custom.off || []).includes(pk) && pk !== 'speed') items.push({ label: `Remove ${pl}`, run: () => toggleCardEffect(i, 'part', pk) });
  for (const p of styleEffects(i)) if (!p.native && p.on) items.push({ label: `Remove ${p.label}`, run: () => toggleCardEffect(i, 'part', p.key) });
  if (e2.speed !== 'off') items.push({ label: 'Remove speed ramps & slow-mo', run: () => toggleCardEffect(i, 'speed', 'speed') });
  if (items.length === n0) items.push({ label: 'No filter or effects on this take', disabled: true });
  popMenu(e, 'Remove an effect', items);
}
// a small box of number fields by the pointer (Electron has no prompt())
function numPop(x, y, title, fields, max, onOk) {
  document.querySelector('.num-pop')?.remove();
  const b = document.createElement('div'); b.className = 'num-pop'; b.setAttribute('role', 'dialog');
  b.innerHTML = `<b>${esc(title)}</b>${fields.map(([l, v], n) => `<label>${esc(l)}<input type="number" min="0" max="${max.toFixed(1)}" step="0.1" value="${(+v || 0).toFixed(1)}" data-n="${n}">s</label>`).join('')}<button class="small primary">OK</button>`;
  document.body.appendChild(b);
  b.style.left = `${Math.min(innerWidth - b.offsetWidth - 8, x)}px`; b.style.top = `${Math.max(8, Math.min(innerHeight - b.offsetHeight - 8, y - b.offsetHeight - 6))}px`;
  const ok = () => { const vals = [...b.querySelectorAll('input')].map((i) => Math.round(Math.max(0, Math.min(max, +i.value || 0)) * 10) / 10); b.remove(); off(); onOk(vals); };
  const away = (ev) => { if (!b.contains(ev.target)) { b.remove(); off(); } };
  const off = () => document.removeEventListener('pointerdown', away, true);
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  b.querySelector('button').onclick = ok;
  b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ok(); if (ev.key === 'Escape') { b.remove(); off(); } ev.stopPropagation(); });
  b.querySelector('input')?.select();
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
  if (!ed?.size && !P.base && !v.cutOrder?.length) return;
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
  // cuts you dragged to another place: put them in your order, then lay them end to end again (each keeps its length,
  // so cuts still change on beats), and the drop effects go to whichever cut now starts on a drop
  if (v.cutOrder?.length) {
    const rank = new Map(v.cutOrder.map((k, n) => [k, n]));
    const keyed = out.map((s, n) => ({ s, r: rank.has(s.ek) ? rank.get(s.ek) : null, n }));
    // cuts not in your order (added later) stay right after the cut they came after
    let lastR = -1;
    for (const k of keyed) { if (k.r == null) k.r = lastR + 0.5; else lastR = k.r; }
    keyed.sort((a, b) => a.r - b.r || a.n - b.n);
    const drops = (P.base?.beats || P.beats || []).filter((b) => b.impact).map((b) => b.t);
    let at = 0;
    for (let n = 0; n < keyed.length; n++) {
      const sg = keyed[n].s, d = sg.end - sg.start, nw = { ...sg, start: at, end: at + d, moved: sg.moved || keyed[n].n !== n };
      nw.impact = drops.some((t) => Math.abs(t - at) < 0.06);
      keyed[n].s = nw; at += d;
    }
    out.length = 0; for (const k of keyed) out.push(k.s);
  }
  P.segments = out;
  P.duration = Math.max(0.1, P.base.duration - shift);
  P.beats = (P.base.beats || []).filter((b) => b.t <= P.duration + 0.01);
}
// other moments that could fill this cut: same length, not frozen, not used by any other cut of this edit.
// Ranked by how much moves on screen (the clip's motion curve), with the clip's general interest as a tie-breaker.
// level 0: footage no other cut uses, inside each clip's picked part; 1: other cuts' footage is fine too;
// 2: anywhere in the clips (outside the part you picked as well), so Replace always has somewhere to go
function replaceOptions(v, seg, level = 0) {
  const need = Math.max(0.2, segUse(seg)), used = v.plan.segments.filter((s) => s !== seg).map((s) => [s.clip, s.srcStart, s.srcStart + segUse(s)]);
  const opts = [];
  state.planClips.forEach((c, ci) => {
    const tv = trimView(level >= 2 ? { ...c, trim: null, parts: undefined } : c), a0 = tv.trimIn || 0, b0 = Math.min(c.duration || 0, tv.usableEnd ?? c.duration ?? 0), iv = c.interest || [], mc = c.motionCurve;
    for (let s = a0; s + need <= b0 + 1e-3; s += Math.max(0.25, need / 2)) {
      if (ci === seg.clip && Math.abs(s - seg.srcStart) < need) continue;
      if (level < 1 && used.some(([uc, ua, ub]) => uc === ci && s < ub && s + need > ua)) continue;
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
  applyCutEdits(v); attachCutFraming(v); applySpotlight(v); afterCutEdit(i);
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
  // the strictest choice that still has options: new footage, then footage other cuts use, then outside the picked part
  let opts = [], level = 0;
  for (; level <= 2 && !opts.length; level++) {
    opts = replaceOptions(v, seg, level).filter((o) => !tried.has(`${state.planClips[o.ci].id}@${o.s}`));
    if (!opts.length && level === 2) { tried.clear(); opts = replaceOptions(v, seg, 2); }
  }
  level--;
  if (!opts.length) { toast('This clip is too short for anything else at this length: try a longer clip or a shorter cut'); return false; }
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
  toast(`Cut replaced with ${state.planClips[o.ci].name}, ${fmt(o.s)}${level === 1 ? ' (a moment another cut also shows: the rest is used)' : level === 2 ? ' (from outside the part of the clip you picked: everything inside it is used)' : ': the most movement left'}. Press Replace again for the next one`);
  return true;
}
// put a replaced cut back as the edit planned it
function restoreCut(seg) {
  const i = state.focused, v = state.variants[i], key = seg.swapped ? seg.ek : null;
  if (!key || !v.cutEdits?.has(key)) return false;
  v.cutEdits.delete(key);
  applyCutEdits(v); attachCutFraming(v); applySpotlight(v); afterCutEdit(i);
  toast('The cut\'s own footage is back');
  return true;
}
// bring back every deleted cut of the take you're on
function restoreDeletedCuts() {
  const i = state.focused, v = state.variants[i];
  const dels = [...(v.cutEdits || [])].filter(([, e]) => e.del);
  if (!dels.length) return;
  for (const [k] of dels) v.cutEdits.delete(k);
  applyCutEdits(v); attachCutFraming(v); applySpotlight(v); afterCutEdit(i);
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
  if (projectLoading) return;
  // plan in order, so edit 1 gets first pick and the rest go for different footage
  state.variants.forEach((v) => (v.plan = null));
  for (let i = 0; i < state.variants.length; i++) replan(i);
  if (isStream()) refreshEff(); // captions sit above the split line or in the lower third, depending on each card's layout
  updateEmpty(); updateCards(); player.restartAudio();
  // captions / quotes / dialogue need the words: transcribe the clips that aren't yet (in the background)
  if (wantsSpeech()) setTimeout(queueAllSpeech, 0);
  $('#btnGenerate').disabled = !state.planClips.length;
  if (!state.planClips.length) {
    // nothing left in Clips: no music or clip sound should keep playing
    player.stop(); player._autostarted = false; updatePlayIcon();
    return;
  }
  if (!player.playing && !player._autostarted && state.settings.mode !== 'quick') { player._autostarted = true; player.play(); updatePlayIcon(); }
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
    <div class="screen"><canvas></canvas><div class="safe" aria-hidden="true" hidden></div><span class="sound">audio from this one</span><span class="custom-tag">custom</span><button class="vbadge" hidden></button>
      <button class="solobtn" title="Watch just this one big (V): double-click works too"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button></div>
    <div class="parts"></div>
    <div class="parts-pop" hidden></div>
    <div class="card-f"><div class="meta"><span></span></div>
      <button class="regen" title="Regen: a brand-new edit, new style, new effects, new clips and cuts"><span class="bt">Regen</span><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></button>
      <button class="export" title="Export this take"><span class="bt">Export</span><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button></div>`;
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
  // the Length on the slate: click it to change how long the edits run (every take, like Edit → Length)
  const lenCell = el.querySelector('.sl-len');
  lenCell.title = 'Click to change how long the edits run'; lenCell.style.cursor = 'pointer';
  lenCell.addEventListener('click', (e) => {
    e.stopPropagation();
    const cur = state.settings.length, pickLen = (v) => () => document.querySelector(`#segLength [data-v="${v}"]`)?.click();
    popMenu(e, 'Edit length (every take)', [['match', 'Match clip', 'As long as the part of your clips you picked'], ...[7, 10, 15, 20, 30, 45, 60].map((x) => [String(x), `${x} seconds`, ''])]
      .map(([v, label, sub]) => ({ label: (String(cur) === v ? '● ' : '') + label, sub, run: pickLen(v) })));
  });
  el.querySelector('.regen').onclick = () => regen(idx());
  const vb = el.querySelector('.vbadge');
  vb.addEventListener('pointerdown', (ev) => ev.stopPropagation()); // (not a drag on the picture)
  vb.onclick = (ev) => { ev.stopPropagation(); viralMenu(ev, idx()); };
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
  initTakeDrag(el, idx);
  el.querySelector('.export').onclick = () => queueExport(idx());
  cards.push(el);
  return el;
}
// drag a take by its slate number to move it anywhere in the grid (up, down, left, right)
function initTakeDrag(el, idx) {
  const handle = el.querySelector('.sl-take');
  handle.classList.add('grip');
  handle.title = 'Drag to move this take to another spot';
  handle.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || state.solo || state.variants.length < 2) return;
    ev.preventDefault();
    const from = idx(), sx = ev.clientX, sy = ev.clientY;
    let target = null, moved = false, ghost = null;
    handle.setPointerCapture(ev.pointerId);
    const move = (e) => {
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
      if (!moved) {
        moved = true; el.classList.add('take-dragging'); grid.classList.add('takes-moving');
        // a grey, dashed ghost stays where the take was, so it's clear what is moving and where it came from
        const r = el.getBoundingClientRect();
        ghost = document.createElement('div'); ghost.className = 'take-ghost';
        Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        ghost.innerHTML = `<span>Take ${from + 1}</span>`;
        document.body.appendChild(ghost);
      }
      el.style.transform = `translate(${e.clientX - sx}px, ${e.clientY - sy}px) rotate(1.5deg)`;
      const hit = cards.find((c) => c !== el && !c.hidden && (() => { const r = c.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; })());
      if (hit !== target) { target?.classList.remove('take-drop'); target = hit || null; target?.classList.add('take-drop'); }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
      el.classList.remove('take-dragging'); grid.classList.remove('takes-moving'); el.style.transform = ''; ghost?.remove();
      target?.classList.remove('take-drop');
      if (moved && target) moveTake(from, cards.indexOf(target));
      else if (!moved) focusCard(from);
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  });
}
function moveTake(from, to) {
  if (from === to || from < 0 || to < 0) return;
  if (tuneIndex != null) closeTune();
  const [v] = state.variants.splice(from, 1);
  state.variants.splice(to, 0, v);
  const f = state.focused;
  state.focused = f === from ? to : from < f && to >= f ? f - 1 : from > f && to <= f ? f + 1 : f;
  effCache = []; ctxCache = [];
  saveCustom(); saveLineup(); refreshEff();
  player.views.forEach((w) => { if (w) w.dirty = true; });
  updateAddTile(); updateCards(); requestAnimationFrame(layoutGrid); player.restartAudio();
  toast(`Take moved to spot ${to + 1}`);
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
  title: { x: 'titleX', y: 'titleY', name: 'Title box', box: (i) => { const t = isStream() && textFor(i)?.canvas; return t?.titleBox ? [t.titleBox, t.titleCenter] : null; } },
  // captions: a band across the picture where the words show (drag it up or down)
  captions: { x: 'capX', y: 'capY', name: 'Captions', box: (i) => {
    const e = eff(i), on = isStream() ? state.settings.streamCaptions === 'on' : e.captions === 'on' || e.pick === 'quotes';
    if (!on || !player.views[i]?.renderer?.captionVisible) return null; // only while words show on this take
    const cy = 1 - (e.captionY ?? 0.163) - 0.035, cx = e.captionX ?? 0.5;
    return [[Math.max(0, cx - 0.42), cy - 0.06, Math.min(1, cx + 0.42), cy + 0.04], [cx, cy]];
  } },
};
function hookBoxAt(i, ev, screen) {
  const r = screen.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height, pad = 0.015;
  for (const [kind, L] of Object.entries(LAYERS)) {
    const b = L.box(i);
    if (b && x >= b[0][0] - pad && x <= b[0][2] + pad && y >= b[0][1] - pad && y <= b[0][3] + pad) return { kind, x, y, cx: b[1][0], cy: b[1][1] };
  }
  return null;
}
// which part of a take's picture is under the pointer: the cam or the screen half of a stream clip, or the whole picture
function panPartAt(i, y) {
  const H = state.variants[i]?.plan?.highlight;
  if (isStream() && H?.layout === 'cam') {
    // webcam + screen: the webcam panel is as tall as its box's shape needs (same sum as the renderer)
    const so = eff(i).stackOpts || stackOpts(), clip = state.planClips[state.variants[i].plan.segments[0]?.clip] || {}, bx = H.cam?.box;
    const va = (clip.w || 16) / (clip.h || 9), camPix = bx ? (bx[2] * va) / Math.max(1e-4, bx[3]) : 1.2;
    const split = Math.min(0.58, Math.max(0.26, aspectOf(i) / camPix)), top = so.swap ? 1 - split : split, upper = y < top;
    return { part: upper === !so.swap ? 'cam' : 'game', share: upper ? top : 1 - top, top: upper ? 0 : top };
  }
  if (!isStream() || H?.layout !== 'stack') return { part: 'full', share: 1, top: 0 };
  const so = eff(i).stackOpts || stackOpts(), top = so.swap ? 1 - so.split : so.split; // height of the top panel
  const upper = y < top;
  const part = upper === !so.swap ? 'cam' : 'game';
  return { part, share: upper ? top : 1 - top, top: upper ? 0 : top };
}
const PAN_NAME = { cam: 'cam', game: 'screen', full: 'picture' };
// (scroll on a take to zoom in on the spot under the pointer, drag to move, right-click to put it back)
// the hook text, title box, banner, watermark or captions: × on its corner takes it off (every take)
const LAYER_OFF = {
  title: ['Title box', () => { state.settings.streamTitle = 'off'; }],
  banner: ['Banner', () => { state.settings.streamBanner = 'off'; }],
  hook: ['Hook text', () => { state.settings.text = ''; state.variants.forEach((v) => { delete v.custom.text; }); const h = $('#hookText'); if (h) h.value = ''; }],
  wm: ['Watermark', () => { state.settings.wm = 'off'; }],
  captions: ['Captions', () => { if (isStream()) state.settings.streamCaptions = 'off'; else { state.settings.captions = 'off'; state.variants.forEach((v) => { delete v.custom.captions; }); } }],
};
function layerOff(kind) {
  const L = LAYER_OFF[kind]; if (!L) return;
  L[1](); saveSettings(); saveCustom(); refreshEff(); renderMainLook(); syncInputs(); updateCards(); updateText?.(); renderHookOpts(); renderWmOpts();
  toast(`${L[0]} removed from every take. Turn it back on in the settings (or Ctrl+Z)`);
}
function initHookDrag(screen, idx) {
  const lx = document.createElement('button');
  lx.className = 'layer-x'; lx.hidden = true; lx.textContent = '×'; lx.setAttribute('aria-label', 'Remove');
  screen.appendChild(lx);
  lx.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
  lx.addEventListener('click', (ev) => { ev.stopPropagation(); lx.hidden = true; layerOff(lx.dataset.kind); });
  screen.addEventListener('pointerleave', () => { lx.hidden = true; });
  screen.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.target.closest('.ov-item, .solobtn, .layer-x')) return;
    const i = idx(), hit = hookBoxAt(i, ev, screen);
    const r = screen.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    ev.preventDefault();
    if (hit) hookDrag = { screen, i, kind: hit.kind, x0: hit.x, y0: hit.y, cx: hit.cx, cy: hit.cy, moved: false };
    else {
      // drag the video itself. What it changes is what's selected on the timeline (like CapCut):
      // - Card motion selected: a card keyframe at the playhead (the card glides there from the keyframe before)
      // - a cut / its camera keyframes selected (shot editor open): where the camera looks in that cut
      // - nothing selected: moves what this take shows, the same all the way through (each half of a stream clip on its own)
      const P = panPartAt(i, y), c = state.variants[i].custom, cur = c.pan?.[P.part] || [0, 0];
      const sel = i === state.focused ? tlSel : null;
      if (sel?.kind === 'card') hookDrag = { screen, i, kind: 'key', x0: x, y0: y, k: prepCardKey(i), moved: false };
      // a stream clip: the Camera row selected = a camera keyframe of the part you drag (cam or screen) at the playhead
      else if (isStream() && sel?.kind === 'cam') { const pk = prepPanKey(i, P.part); hookDrag = { screen, i, kind: 'pankey', part: P.part, share: P.share, x0: x, y0: y, pk, moved: false }; }
      else if (P.part === 'full' && (sel?.kind === 'cut' || sel?.kind === 'cam') && shotBar.isOpen() && shotBar.dragAim('start')) hookDrag = { screen, i, kind: 'aim', x0: x, y0: y, moved: false };
      else hookDrag = { screen, i, kind: 'pan', part: P.part, share: P.share, x0: x, y0: y, p0: cur.slice(), moved: false };
    }
    screen.setPointerCapture(ev.pointerId);
  });
  screen.addEventListener('pointermove', (ev) => {
    if (!hookDrag || hookDrag.screen !== screen) {
      const hit = hookBoxAt(idx(), ev, screen);
      const r = screen.getBoundingClientRect(), P = panPartAt(idx(), (ev.clientY - r.top) / r.height);
      screen.style.cursor = hit ? 'move' : 'grab';
      if (hit && LAYER_OFF[hit.kind]) {
        const b = LAYERS[hit.kind].box(idx())?.[0];
        if (b) { lx.hidden = false; lx.dataset.kind = hit.kind; lx.title = `Remove the ${LAYER_OFF[hit.kind][0].toLowerCase()} (every take)`; lx.style.left = `${Math.min(0.94, b[2]) * 100}%`; lx.style.top = `${Math.max(0.02, b[1]) * 100}%`; }
      } else if (!ev.target.closest('.layer-x')) lx.hidden = true;
      const sl = idx() === state.focused ? tlSel : null;
      screen.title = hit ? `Drag to move the ${LAYERS[hit.kind].name.toLowerCase()}` : P.part === 'full' && sl?.kind === 'card' ? 'Card motion (selected on the timeline): drag or scroll to set the card at the playhead. It makes a keyframe there and glides from the one before'
        : P.part === 'full' && sl && shotBar.isOpen() ? `Cut ${(sl.si ?? 0) + 1} (selected on the timeline): drag to aim the camera in this cut${sl.kind === 'cam' ? ', as a keyframe at the playhead' : ''}`
        : `Drag to move the ${PAN_NAME[P.part]} in this take (all the way through), scroll to zoom in on a spot. Right-click puts it back. To animate it, click the Card row on the timeline first`;
      return;
    }
    if (!(ev.buttons & 1)) { end(); return; } // the button was let go where we couldn't hear it: stop dragging
    const r = screen.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    if (Math.abs(x - hookDrag.x0) + Math.abs(y - hookDrag.y0) > 0.004) hookDrag.moved = true;
    if (hookDrag.kind === 'key') {
      // the card follows the pointer (x across the take's width, y up), live
      const k = hookDrag.k, key = state.variants[hookDrag.i].custom.keys?.[k.idx]; if (!key) return;
      const oa = aspectOf(hookDrag.i), lim = (v) => Math.max(-2, Math.min(2, Math.round(v * 1000) / 1000));
      key.x = lim(k.x0 + (x - hookDrag.x0) * oa); key.y = lim(k.y0 - (y - hookDrag.y0));
      screen.style.cursor = 'grabbing';
      ctxCache = []; refreshEff(); player.seek(player.now());
      return;
    }
    if (hookDrag.kind === 'aim') { shotBar.dragAim('move', x - hookDrag.x0, y - hookDrag.y0); screen.style.cursor = 'grabbing'; return; }
    if (hookDrag.kind === 'pankey') {
      const k = hookDrag.pk.key, lim = (v) => Math.max(-1.5, Math.min(1.5, Math.round(v * 1000) / 1000));
      k.x = lim(hookDrag.pk.x0 + (x - hookDrag.x0)); k.y = lim(hookDrag.pk.y0 + (y - hookDrag.y0) / hookDrag.share);
      screen.style.cursor = 'grabbing'; refreshEff(); player.views[hookDrag.i] && (player.views[hookDrag.i].dirty = true);
      return;
    }
    if (hookDrag.kind === 'pan') {
      const c = state.variants[hookDrag.i].custom, lim = (v) => Math.max(-1.5, Math.min(1.5, Math.round(v * 1000) / 1000));
      c.pan = { ...(c.pan || {}), [hookDrag.part]: [lim(hookDrag.p0[0] + (x - hookDrag.x0)), lim(hookDrag.p0[1] + (y - hookDrag.y0) / hookDrag.share), hookDrag.p0[2] || 1] };
      screen.style.cursor = 'grabbing';
      refreshEff(); player.views[hookDrag.i] && (player.views[hookDrag.i].dirty = true);
      return;
    }
    const L = LAYERS[hookDrag.kind];
    // lock onto the middle and the thirds of the picture (a guide line shows it); Alt moves freely
    const sx = snapTo(Math.min(0.98, Math.max(0.02, hookDrag.cx + x - hookDrag.x0)), ev), sy = snapTo(Math.min(0.98, Math.max(0.02, hookDrag.cy + y - hookDrag.y0)), ev);
    state.settings[L.x] = Math.round(sx.v * 1000) / 1000;
    state.settings[L.y] = Math.round(sy.v * 1000) / 1000;
    guides(screen, sx.line, sy.line);
    refreshEff();
  });
  const end = () => {
    if (!hookDrag || hookDrag.screen !== screen || hookDrag.done) return;
    hookDrag.done = true; guides(screen, null, null);
    const { moved, kind, part, i } = hookDrag;
    setTimeout(() => { hookDrag = null; }, 0);
    screen.style.cursor = '';
    if (kind === 'key') {
      const k = hookDrag.k, v = state.variants[i];
      if (!moved) { if (k.made) { const keys = [...(v.custom.keys || [])]; keys.splice(k.idx, 1); if (k.madeStart) keys.shift(); setKeys(i, keys); } return; }
      if (tlSel?.kind === 'card') tlSel.n = state.variants[i].custom.keys?.findIndex((q) => Math.abs(q.t - k.t) < 0.006) ?? null;
      saveCustom(); updateCards(); renderTune(); drawTimeline(player.now(), player.duration());
      toast(k.made ? `Card keyframe at ${fmt(k.t)}: the card glides here from ${k.madeStart ? 'where it starts' : 'the keyframe before'}. Move the playhead and drag again for the next move`
        : `Card keyframe at ${fmt(k.t)} moved`);
      return;
    }
    if (kind === 'pankey') {
      const pk = hookDrag.pk;
      if (!moved && pk.made) { const ks = state.variants[i].custom.panKeys[part]; ks.splice(ks.indexOf(pk.key), 1); cleanPanKeys(i); refreshEff(); return; }
      saveCustom(); updateCards(); drawTimeline(player.now(), player.duration());
      if (moved) toast(`Camera keyframe of the ${PAN_NAME[part]} at ${fmt(pk.key.t)}${pk.madeStart ? ': it glides here from the start' : ''}. Move the playhead and drag again for the next one`);
      return;
    }
    if (kind === 'aim') { shotBar.dragAim('end'); if (moved) toast(tlSel?.kind === 'cam' ? `Camera keyframe at ${fmt(player.now())} in cut ${(tlSel.si ?? 0) + 1}` : `Camera aimed in cut ${(tlSel?.si ?? 0) + 1} (only this cut)`); return; }
    if (!moved) return;
    if (kind === 'pan') { saveCustom(); updateCards(); toast(`Moved the ${PAN_NAME[part]} in take ${i + 1} (the whole take). To animate it, click the Card row on the timeline first. Right-click the picture to put it back`); return; }
    saveSettings();
    if (kind === 'hook') renderHookOpts();
    else if (kind === 'wm') renderWmOpts();
    else renderMainLook();
    toast(`${LAYERS[kind].name} moved (every take uses the same spot)`);
    requestAnimationFrame(renderSafeZones);
  };
  for (const e of ['pointerup', 'pointercancel', 'lostpointercapture']) screen.addEventListener(e, end);
  // scroll on the picture: zoom in / out on the spot under the pointer (Ctrl + scroll still resizes the takes)
  let wheelSave = 0;
  screen.addEventListener('wheel', (ev) => {
    if (ev.ctrlKey || ev.metaKey) return;
    ev.preventDefault();
    const i = idx(), r = screen.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    const P = panPartAt(i, y), c = state.variants[i].custom, cur = c.pan?.[P.part] || [0, 0, 1];
    // Card motion selected on the timeline: the scroll sizes the card at the playhead (a keyframe)
    if (i === state.focused && isStream() && tlSel?.kind === 'cam') {
      const pk = prepPanKey(i, P.part), k = pk.key;
      k.z = Math.max(1, Math.min(5, Math.round((k.z ?? 1) * Math.exp(-Math.max(-60, Math.min(60, ev.deltaY)) * 0.004) * 1000) / 1000));
      refreshEff(); player.views[i] && (player.views[i].dirty = true);
      clearTimeout(wheelSave); wheelSave = setTimeout(() => { saveCustom(); updateCards(); drawTimeline(player.now(), player.duration()); }, 350);
      return;
    }
    if (i === state.focused && tlSel?.kind === 'card') {
      const k = prepCardKey(i), key = c.keys?.[k.idx]; if (!key) return;
      key.scale = Math.max(0.1, Math.min(3, Math.round((key.scale ?? 1) * Math.exp(-Math.max(-60, Math.min(60, ev.deltaY)) * 0.004) * 1000) / 1000));
      if (tlSel.n !== k.idx) tlSel.n = k.idx;
      ctxCache = []; refreshEff(); player.seek(player.now());
      clearTimeout(wheelSave); wheelSave = setTimeout(() => { saveCustom(); updateCards(); renderTune(); drawTimeline(player.now(), player.duration()); }, 350);
      return;
    }
    // a cut selected (shot editor open): the scroll zooms the camera in that cut
    if (P.part === 'full' && i === state.focused && (tlSel?.kind === 'cut' || tlSel?.kind === 'cam') && shotBar.isOpen()) { shotBar.zoomBy(ev.deltaY); return; }
    const z1 = Math.max(1, cur[2] || 1), z2 = Math.min(5, Math.max(1, z1 * Math.exp(-Math.max(-60, Math.min(60, ev.deltaY)) * 0.004)));
    if (Math.abs(z2 - z1) < 1e-4) return;
    const ax = x, ay = P.share ? (y - P.top) / P.share : y, k = z2 / z1;
    const lim = (v) => Math.max(-3, Math.min(3, Math.round(v * 1000) / 1000));
    let nx = lim(cur[0] * k + (ax - 0.5) * (1 - k)), ny = lim(cur[1] * k + (ay - 0.5) * (1 - k));
    if (z2 <= 1.0001) { nx = 0; ny = 0; } // all the way out: back to how Cutsona framed it
    c.pan = { ...(c.pan || {}), [P.part]: [nx, ny, Math.round(z2 * 1000) / 1000] };
    if (z2 <= 1.0001 && !(cur[0] || cur[1])) { delete c.pan[P.part]; if (!Object.keys(c.pan).length) delete c.pan; }
    refreshEff(); player.views[i] && (player.views[i].dirty = true);
    clearTimeout(wheelSave); wheelSave = setTimeout(() => { saveCustom(); updateCards(); }, 350);
  }, { passive: false });
  // right-click: put the part you moved back where Cutsona framed it
  screen.addEventListener('contextmenu', (ev) => {
    if (ev.target.closest('.ov-item')) return;
    const i = idx(), r = screen.getBoundingClientRect(), P = panPartAt(i, (ev.clientY - r.top) / r.height), c = state.variants[i].custom;
    // right-click a moved title box / captions / banner: back to its usual place
    const hit = hookBoxAt(i, ev, screen), L = hit && LAYERS[hit.kind];
    if (L && ['title', 'captions', 'banner'].includes(hit.kind) && state.settings[L.y] != null) {
      ev.preventDefault();
      state.settings[L.x] = null; state.settings[L.y] = null; saveSettings(); refreshEff();
      toast(`${L.name} is back in its usual place`); requestAnimationFrame(renderSafeZones);
      return;
    }
    if (!c.pan?.[P.part] && !c.panKeys?.[P.part]?.length) { takeMenu(ev, i); return; }
    ev.preventDefault();
    if (c.pan) { delete c.pan[P.part]; if (!Object.keys(c.pan).length) delete c.pan; }
    if (c.panKeys?.[P.part]) { delete c.panKeys[P.part]; cleanPanKeys(i); }
    refreshEff(); saveCustom(); updateCards(); player.views[i] && (player.views[i].dirty = true); drawTimeline(player.now(), player.duration());
    toast(`The ${PAN_NAME[P.part]} is back where Cutsona framed it`);
  });
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
const KEEP_STYLE = new Set(['pure', 'beat', 'movie', 'captionedit']);
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
  const v = state.variants[i]; if (!v) return;
  if (v.sourcePlan) return toast('This take uses your Quick project’s cut order.');
  v.hiSkip = (v.hiSkip || 0) + 1; delete v.custom.title;
  replan(i); refreshEff(); updateCards(); player.seek(0);
  const H = v.plan?.highlight;
  toast(H ? `Clip ${i + 1}: highlight #${H.rank}, ${H.why}` : 'No more highlights in these clips');
}
// New take (the ↻ on a take): a new edit of the same style from scratch: new cuts and moments (different from the
// last take where the clips allow), and your cut changes, framings, moves and zooms for this take are cleared
function reroll(i) {
  if (isStream()) return nextHighlight(i);
  const v = state.variants[i], prev = v.plan;
  v.seed = (Math.random() * 1e9) | 0;
  v.cutEdits = new Map(); v.cutFrames = new Map(); v.cutOrder = null; delete v.savedPlan; delete v.sourcePlan;
  if (v.custom) { delete v.custom.pan; delete v.custom.keys; saveCustom(); }
  replan(i, prev);
  const same = prev && v.plan && prev.segments.length === v.plan.segments.length && prev.segments.every((s, k) => Math.abs(s.srcStart - v.plan.segments[k].srcStart) < 0.05);
  if (same) { v.seed = (Math.random() * 1e9) | 0; replan(i, null); }
  updateCards(); if (shotBar?.isOpen()) shotBar.refresh(); drawTimeline(player.now(), player.duration());
  player.views[i] && (player.views[i].dirty = true);
  const el = cards[i]; if (el) { el.classList.remove('rerolled'); void el.offsetWidth; el.classList.add('rerolled'); }
  toast(same ? `Take ${i + 1}: a new edit (this part of the clip is short, so some moments repeat)` : `Take ${i + 1}: a brand-new ${STYLES[v.styleId]?.name || ''} edit`);
}
// Regen: a whole new edit — different style (not used by the other cards), new effect mix, new clips + cuts.
// The Simple Beat card stays a simple beat edit, just with new clips and cuts.
// a random style (one the other takes don't use) + 1-3 extra effects + sometimes a filter
function randomLook(i) {
  const v = state.variants[i], rand = Math.random, pickOne = (arr) => arr[Math.floor(rand() * arr.length)];
  const taken = state.variants.map((o) => o.styleId);
  v.styleId = pickOne(Object.keys(STYLES).filter((k) => !KEEP_STYLE.has(k) && !STYLES[k].hidden && !taken.includes(k))) || v.styleId;
  v.custom.off = [];
  applyStyleDefaults(v);
  const pool = EXTRAS.map((x) => x[0]).filter((k) => !['strobe', 'invertHits', 'kaleido'].includes(k));
  const fx = [];
  for (let n = 1 + Math.floor(rand() * 3); fx.length < n;) { const k = pickOne(pool); if (!fx.includes(k)) fx.push(k); }
  v.custom.fx = fx;
  if (rand() < 0.45) v.custom.filter = pickOne(Object.keys(FILTERS).filter((k) => k !== 'none')); else delete v.custom.filter;
  return `${STYLES[v.styleId].name} + ${fx.map((k) => EXTRAS.find((x) => x[0] === k)[1]).join(', ')}${v.custom.filter ? ', ' + FILTERS[v.custom.filter].name : ''}`;
}
function regen(i) {
  if (isStream()) return nextHighlight(i);
  const v = state.variants[i], prev = v.plan;
  let msg;
  // clean styles (Beat Sync, Simple Beat, Movie Edit, Caption Edit) keep their style: just new clips & cuts, no random effects
  if (KEEP_STYLE.has(v.styleId)) {
    delete v.custom.fx; delete v.custom.filter; v.custom.off = [];
    msg = 'new clips & cuts';
  } else {
    msg = randomLook(i);
  }
  v.dropped = [];
  v.seed = (Math.random() * 1e9) | 0;
  saveCustom(); saveLineup();
  replan(i, prev); updateCards();
  if (tuneIndex === i) renderTune();
  toast(`Edit ${i + 1} regenerated: ${msg}`);
}
function focusCard(i) {
  const wasQuick = !!state.variants[state.focused]?.plan?.quick;
  state.focused = i; updateCards();
  if (wasQuick || state.variants[i]?.plan?.quick) player.restartAudio();
  if (state.solo) requestAnimationFrame(layoutGrid);
  if (tuneIndex != null && tuneIndex !== i) openTune(i);
}
function setSolo(on) {
  state.solo = on;
  try { localStorage.setItem('cutsona.view', JSON.stringify({ solo: on, safe: state.safeZone })); } catch {}
  updateCards(); updateViewBar(); requestAnimationFrame(layoutGrid);
}
// Everything that changes how edit i looks, as tick boxes. `from` says which settings own it:
// 'style' (this edit's style parts), 'edit' (this edit's ⚙ overrides) or 'main' (the main settings).
// Things unticked on this card stay listed (unticked) so they can be ticked back on.
const fxLabel = (k) => { const x = EXTRAS.find((e) => e[0] === k); return x ? (ANIMATED_FX.has(k) ? '✦ ' : '') + x[1] : k; };
// every effect of the edit's style; "speed ramps" is the same switch as the Speed ramps setting in the menus
function styleEffects(i) {
  const v = state.variants[i], c = v.custom, e = eff(i), off = new Set(c.off || []), sig = new Set((STYLES[v.styleId].parts || []).map((p) => p[0]));
  // every effect there is: the style's own ones first (on unless ticked off), then all the others (off unless added)
  return allParts(v.styleId).map(({ key, label, native }) => native
    ? (key === 'speed'
      ? { kind: 'speed', key, label, on: e.speed !== 'off' && !off.has('speed'), from: c.speed ? 'edit' : 'main', sig: sig.has(key), native }
      : { kind: 'part', key, label, on: !off.has(key), from: 'style', sig: sig.has(key), native })
    : { kind: 'part', key, label, on: off.has('+' + key) && (key !== 'speed' || e.speed !== 'off'), from: 'added', sig: false, native });
}
function cardEffects(i, all = false) {
  const v = state.variants[i], c = v.custom, e = eff(i);
  // on the card: the style's signature effects plus anything switched off; the rest sit behind "all effects"
  const out = styleEffects(i).filter((p) => all || p.sig || (p.native ? !p.on : p.on));
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
    const turnOn = key === 'on', added = (c.off || []).filter((k) => k[0] === '+');
    c.off = turnOn ? added : styleParts(v.styleId).map(([k]) => k).filter((k) => k !== 'speed');
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
    if (styleParts(v.styleId).some(([k]) => k === key)) { on = off.has(key); on ? off.delete(key) : off.add(key); }
    else { on = !off.has('+' + key); on ? off.add('+' + key) : off.delete('+' + key); if (on && key === 'speed' && e.speed === 'off') c.speed = 'on'; } // an effect this style doesn't have: add it
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
function updateExportAll() {
  const btn = $('#btnExportAll');
  if (!btn) return;
  const ready = isStream() ? state.clips.filter((c) => c.status === 'ready') : [];
  const n = isStream() && state.variants.some((v) => v.sourcePlan) ? state.variants.filter((v) => v.plan).length : ready.length ? streamHighlights(ready).length : 0;
  btn.disabled = !n;
  btn.textContent = n ? `Export all ${n}` : 'Export all';
}
$('#btnExportAll').onclick = exportAllHighlights;
function updateCards() {
  updateExportAll();
  renderQuickTracks();
  requestAnimationFrame(refreshUsedParts);
  cards.forEach((el, i) => {
    const v = state.variants[i], st = STYLES[v.styleId];
    el.style.setProperty('--c', st.color);
    el.classList.toggle('focused', state.focused === i);
    el.hidden = state.solo && state.focused !== i;
    el.querySelector('select').value = v.styleId;
    const p = v.plan, e = eff(i), cu = isCustom(i);
    el.classList.toggle('custom', cu);
    { const tb = el.querySelector('.tunebtn'); if (tb) tb.title = cu ? 'This take has its own settings: click to see or change them' : 'Set up just this take: size, filter, effects, fades, card motion'; }
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
      el.querySelector('.meta span').textContent = H.recipe ? `${H.recipe.charAt(0).toUpperCase() + H.recipe.slice(1)}` : `Highlight ${H.rank}: ${H.why.charAt(0).toLowerCase() + H.why.slice(1)}`;
      el.querySelector('.meta span').title = `Highlight ${H.rank}: ${H.why}${H.recipe ? `\nThis take: ${H.recipe}` : ''}\n${H.title || ''}\n${(state.planClips[H.ci]?.name || '')} ${fmt(H.a)}–${fmt(H.b)}`;
      el.querySelector('.export').disabled = state.server.ffmpeg === false;
      return;
    }
    if (e.pick === 'quotes') bits.push('best quotes'); else if (e.pick === 'scenes') bits.push('best scenes'); else if (e.pick === 'viral') bits.push('most viral');
    if (e.order === 'story') bits.push('in order');
    if (cu && e.format !== state.settings.format) bits.push(e.format);
    if (p) bits.unshift(`${new Set(p.segments.map(s => s.run)).size} moments`);
    el.querySelector('.meta span').textContent = bits.join(', ');
    el.querySelector('.meta span').title = st.desc;
    el.querySelector('.export').disabled = !p?.segments.length || state.server.ffmpeg === false;
    renderViralBadge(el, i);
  });
  // more or fewer effect chips can change how tall the cards' chip rows are
  const sig = cards.map((el) => el.querySelector('.parts').childElementCount).join(',');
  if (sig !== chipSig) { chipSig = sig; requestAnimationFrame(() => layoutGrid()); }
  if (shotBar) shotBar.refresh(); // new takes / another edit focused: keep the shot editor on a real shot
  updateViewBar(); updateAddTile();
  if (typeof overlays !== 'undefined') overlays.render();
}
// a take's viral score on its picture (top left): click it for why, and what would raise it
let viralToldOnce = false;
function renderViralBadge(el, i) {
  const b = el.querySelector('.vbadge'); if (!b) return;
  const v = state.variants[i], p = v.plan;
  const r = !isStream() && p?.segments?.length ? takeVirality(p, state.planClips, eff(i), { music: !!state.music }) : null;
  v.viralNow = r;
  b.hidden = !r;
  if (!r) return;
  const scanning = state.planClips.some((c) => c.viralState === 'running');
  b.className = `vbadge ${scoreColor(r.score)}${scanning ? ' scanning' : ''}`;
  b.innerHTML = `${FLAME}<b>${r.score}</b>`;
  if (!viralToldOnce && !scanning) {
    viralToldOnce = true;
    try { if (!localStorage.getItem('cutsona.viralTold')) { localStorage.setItem('cutsona.viralTold', '1'); setTimeout(() => toast('The fire and number on each take is its viral score (0-100): how likely it is to do well on TikTok, Reels and Shorts. Red is best. Click it for why'), 900); } } catch {}
  }
  b.title = `Viral score ${r.score}/100${scanning ? ' (still watching your clips: it gets more exact)' : ''}${r.why.length ? '\n' + r.why.join('\n') : ''}${r.tips.length ? '\nWould raise it: ' + r.tips.map((t) => t.text).join('; ') : ''}\nClick for more`;
}
// click the badge: why it scores what it does, and one-click fixes
function viralMenu(e, i) {
  const r = state.variants[i].viralNow; if (!r) return;
  const fix = {
    captions: () => { state.settings.captions = 'on'; saveSettings(); queueAllSpeech(); renderMainLook(); replanAll(); },
    pick: () => { state.settings.pick = 'viral'; saveSettings(); renderMainLook(); replanAll(); },
    format: () => { state.settings.format = '9:16'; saveSettings(); renderMainLook(); syncInputs(); replanAll(); },
    length: () => { const b = document.querySelector('#segLength [data-v="30"]'); if (b) b.click(); },
    regen: () => cards[i]?.querySelector('.reroll')?.click(),
    pace: () => cards[i]?.querySelector('.reroll')?.click(),
    music: () => $('#fileMusic').click(),
  };
  popMenu(e, `Take ${i + 1}: viral score ${r.score}/100`, [
    ...(r.why.length ? [{ head: 'Why' }, ...r.why.map((w) => ({ label: w, info: true }))] : []),
    ...(r.tips.length ? ['-', { head: 'Would raise it' }, ...r.tips.map((t) => ({ label: t.text, sub: `about +${t.gain}`, run: fix[t.fix] }))] : []),
    '-', { label: 'What the fire and the number mean', sub: 'Colors, and how it’s scored', run: () => setTimeout(() => viralInfo(e), 0) },
  ]);
}
function updateEmpty() {
  const has = state.planClips.length > 0;
  $('#empty').hidden = has; grid.hidden = !has; $('#transport').hidden = !has;
  if (has) requestAnimationFrame(layoutGrid);
}

// lay out the cards: each edit can have its own size (9:16, 1:1, 16:9 …); pick the arrangement that shows them biggest
let chipSig = '', partsH = 22, fitExtra = 0;
function layoutGrid(again = false, fit = 0) {
  if (grid.hidden) return;
  if (!again && !fit) { fitExtra = 0; grid.classList.remove('tight'); }
  const gr = grid.getBoundingClientRect();
  const n = state.variants.length;
  const vis = state.solo ? [state.focused] : cards.map((_, i) => i);
  const asp = cards.map((_, i) => aspectOf(i));
  // the effect chips wrap onto extra lines on narrow cards; leave room for the tallest row
  // slate (clapper 12 + slate 44) + 3 gaps of 8 + footer 34 + bottom padding 8 (+ the chip row)
  const gap = 14, chromeW = 18, chromeH = 56 + 24 + 34 + 8 + 2 + partsH + fitExtra;
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
      // the arrangement is chosen at full size; the take size slider only scales the result (picking it at a
      // small size made every arrangement tie and the takes fell into one thin column)
      // (raw can go below zero when there's very little room: then the arrangement with the most room wins, not a tie)
      const raw = Math.min(cw - chromeW, (ch - chromeH) * a), full = Math.max(60, raw), sw = Math.max(60, full * (state.solo ? 1 : state.takeScale || 1));
      sizes[i] = [sw, sw / a]; area += (raw >= 0 ? raw * raw : -raw * raw) / a;
    }
    if (!best || area > best.area) best = { cols, rows, area, sizes, cw };
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
    // a short, narrow picture (a tall format with many takes) still gets a slate and buttons wide enough to read:
    // the card takes the room its column has (up to 214px) and the picture sits in the middle of it
    el.style.width = Math.max(sw + 18, Math.min(214, best.cw)) + 'px';
    el.style.minHeight = '';
    player.setViewSize(i, sw, sh);
  });
  // new card widths re-wrap the chips: measure and fit once more if their height changed
  const ph = Math.max(22, ...vis.map((i) => cards[i].querySelector('.parts').offsetHeight));
  if (Math.abs(ph - partsH) > 2 && !again) { partsH = ph; layoutGrid(true); return; }
  partsH = ph;
  // a take taller than its row (its chips wrapped onto more lines than expected) would sit on top of the row below:
  // make the pictures smaller by the difference and lay out again (a few times at most)
  const rowH = (gr.height - gap * (best.rows - 1)) / best.rows;
  const tallest0 = Math.max(...vis.map((i) => Math.max(cards[i].offsetHeight, cards[i].scrollHeight)));
  if (tallest0 > rowH + 1 && fit < 5) {
    // first: fold the effect chips into their "all effects" button (one short line), then shrink the pictures
    if (!grid.classList.contains('tight')) { grid.classList.add('tight'); partsH = 22; layoutGrid(true, fit + 1); return; }
    fitExtra += tallest0 - rowH + 2; layoutGrid(true, fit + 1); return;
  }
  // every take as tall as the tallest one (a take with fewer effect chips no longer sits out of line)
  const tallest = Math.min(rowH, Math.max(...vis.map((i) => cards[i].offsetHeight)));
  for (const i of vis) cards[i].style.minHeight = tallest + 'px';
  renderSafeZones();
}
// ---- safe zones: where TikTok / Reels / Shorts cover the video with their own buttons and captions ----
function renderSafeZones() {
  if (typeof syncSafePick === 'function') syncSafePick();
  const pf = state.safeZone, P = SAFE_ZONES[pf];
  cards.forEach((el, i) => {
    const box = el.querySelector('.safe');
    if (!box) return;
    const on = !!P && i < state.variants.length && fitsSafeZones(aspectOf(i));
    box.hidden = !on;
    if (!on) { box.innerHTML = ''; return; }
    box.innerHTML = safeZoneHtml(pf);
  });
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
let quickAudioFiles = new Map();
const quickAudioOf = (take) => take.plan?.quick ? {
  voice: quickAudioFiles.get(take.plan.quick.voice), song: quickAudioFiles.get(take.plan.quick.song),
  voiceGain: take.custom.quickVoiceGain ?? 1, songGain: take.custom.quickSongGain ?? take.plan.quick.gain,
} : null;
function renderQuickTracks() {
  const panel = $('#quickTracks'), v = state.variants[state.focused], q = v?.plan?.quick;
  panel.hidden = !q;
  if (!q) { panel.replaceChildren(); return; }
  const key = JSON.stringify([q.voice, q.song, q.captions, v.custom.quickVoiceGain, v.custom.quickSongGain, v.custom.captions, state.focused]);
  if (panel.dataset.trackKey === key && panel.children.length) return;
  const previous = Number(panel.querySelector('select')?.value) || 0;
  panel.dataset.trackKey = key;
  const captionIdx = Math.min(previous, q.captions.length - 1);
  panel.innerHTML = `<div class="panel-h"><h3>Quick project tracks</h3></div>
    <label class="qt-control">Narration <input type="range" data-track="quickVoiceGain" min="0" max="1.5" step="0.01" value="${v.custom.quickVoiceGain ?? 1}"></label>
    ${q.song ? `<label class="qt-control">Soundtrack <small>${esc(q.songName)}</small><input type="range" data-track="quickSongGain" min="0" max="1" step="0.01" value="${v.custom.quickSongGain ?? q.gain}"></label>` : ''}
    ${q.captions.length ? `<label class="qt-control"><input type="checkbox" data-track="caps" ${eff(state.focused).captions === 'on' ? 'checked' : ''}> Captions</label>
      <label class="qt-control">Caption cue <select aria-label="Caption cue">${q.captions.map((c, i) => `<option value="${i}" ${i === captionIdx ? 'selected' : ''}>${fmt(c.start)} · ${esc(c.text.slice(0, 52))}</option>`).join('')}</select></label>
      <textarea class="qt-caption" rows="2" aria-label="Caption text">${esc(q.captions[captionIdx]?.text || '')}</textarea>` : ''}`;
  panel.onchange = (event) => {
    const field = event.target, track = field.dataset.track, select = panel.querySelector('select');
    if (track === 'caps') { v.custom.captions = field.checked ? 'on' : 'off'; refreshEff(); }
    else if (track) { v.custom[track] = Number(field.value); player.restartAudio(); }
    else if (field === select) {
      panel.querySelector('textarea').value = q.captions[Number(select.value)].text;
      player.seek(q.captions[Number(select.value)].start);
      return;
    } else if (field.matches('textarea')) {
      v.sourcePlan.plan.quick.captions[Number(select.value)].text = field.value.trim();
      replanAll();
    }
    saveCustom(); history.touch();
  };
}
const player = new Player({
  getState: () => ({ ...state, clips: state.planClips }),
  getEff: eff,
  getCtx: ctxFor,
  getText: textFor,
  getHook: hookFor,
  getQuickAudio: quickAudioOf,
  poolEl: $('#pool'), onTick,
});
cards.forEach((el, i) => player.attach(i, el.querySelector('canvas')));
// photos / videos over the takes (drag, resize, × to remove from one take)
const overlays = createOverlays({ state, cards: () => cards, save: saveCustom, toast, now: () => player.now(), playing: () => player.playing });
function updateText() { textCache.clear(); }

let lastWaveDraw = 0;
function onTick(t, D) {
  if (grid.hidden) return;
  $('#time').textContent = `${fmt(t)} / ${fmt(D)}`;
  drawTimeline(t, D);
  refreshKeysBlock(t);
  if (shotBar) shotBar.tick();
  overlays.sync();
  if (state.music && player.playing && performance.now() - lastWaveDraw > 100) { lastWaveDraw = performance.now(); drawWave(); }
}
// timeline zoom: the part of the edit the timeline shows ([tlStart, tlStart + D / tlZoom])
// right-click a take (its slate or picture): the take's own menu
function takeMenu(e, i) {
  const el = cards[i]; if (!el || !state.variants[i]) return;
  const click = (sel) => () => el.querySelector(sel)?.click();
  popMenu(e, `Take ${i + 1}`, [
    { label: 'Watch it big', sub: 'Just this take (V)', run: click('.solobtn') },
    { label: 'Set up this take…', sub: 'Size, filter, effects, fades', run: click('.tunebtn') },
    { label: 'New take of this style', run: click('.reroll') },
    { label: 'Regen', sub: 'A brand-new edit', run: click('.regen') },
    { label: 'Export', run: click('.export') },
    '-',
    { label: 'Remove take', danger: true, disabled: state.variants.length <= 1, run: click('.removebtn') },
  ]);
}
document.querySelector('.grid')?.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.card'); if (!card || e.target.closest('.screen')) return; // the picture has its own (above)
  const i = cards.indexOf(card); if (i >= 0) takeMenu(e, i);
});
// right-click a cut on the timeline: what you can do with that cut
function cutMenu(e) {
  const v = state.variants[state.focused], p = v?.plan; if (!p?.segments.length) return;
  const k = shotBar.shotAt(tlTime(e)), sg = p.segments[k]; if (!sg) return;
  const c = state.planClips[sg.clip];
  popMenu(e, `Cut ${k + 1} of ${p.segments.length}${c ? ': ' + c.name : ''}`, [
    { label: 'Edit this cut', sub: 'Framing, faces, camera move', run: () => shotBar.select(k) },
    { label: 'Replace cut', sub: 'Other footage, same spot and length', run: async () => { if (await replaceCut(sg)) { shotBar.refresh(); drawTimeline(player.now(), player.duration()); } } },
    { label: 'Reset its framing', disabled: !sg.framing, run: () => { delete sg.framing; saveCutFraming(sg, null); shotBar.refresh(); player.views[state.focused] && (player.views[state.focused].dirty = true); drawTimeline(player.now(), player.duration()); } },
    '-',
    { label: c?.speechState === 'done' ? 'Transcribe its clip again' : 'Transcribe its clip', sub: 'Only this clip', disabled: !c?.audioBuffer || c?.speechState === 'running', run: () => transcribeClip(c) },
    { label: 'Clip audio…', disabled: !c, run: () => clipAudio.open(c, tl) },
    '-',
    { label: 'Delete cut', danger: true, disabled: p.segments.length <= 1, run: () => { if (deleteCut(sg)) { shotBar.refresh(); drawTimeline(player.now(), player.duration()); } } },
  ]);
}
// the "On" color as #rrggbb (cuts you changed are drawn in it)
function onColor() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--on').trim() || '#34d17a';
  return /^#[0-9a-f]{6}$/i.test(v) ? v : '#34d17a';
}
let tlZoom = 1, tlStart = 0, tlShownSel = -1;
// moved along by hand (scroll bar, sideways scroll, zoom): the view stays put for a while, even while playing
let tlManual = 0;
const tlHeld = () => performance.now() - tlManual < 4000;
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
// lanes (fractions of the timeline's height): ruler, Card, Camera, FX (every effect, filter and transition), Song, Cuts
const TL_LANES = { ruler: [0, 13 / 120], card: [13 / 120, 28 / 120], camera: [28 / 120, 43 / 120], fx: [43 / 120, 60 / 120], song: [60 / 120, 80 / 120], cuts: [80 / 120, 1] };
// ---- timeline filmstrip: small frames of each cut, grabbed in the background (never blocks the edit) ----
const filmCache = new Map(), filmQueue = [], filmVids = new Map(); let filmBusy = false, filmRedraw = 0;
function filmFrame(clip, sec) {
  if (!clip) return null;
  // a photo: its picture (it plays as a short video clip, so its thumbnail is the picture to show)
  const src = clip.photo && clip.thumb ? clip.thumb : (clip.previewUrl || clip.url);
  if (!src) return null;
  const still = clip.photo && src === clip.thumb;
  const key = still ? 'still:' + clip.id : src + '@' + Math.round(sec * 2) / 2;
  const c = filmCache.get(key);
  if (c) return typeof c === 'object' ? c : null;
  if (filmCache.size > 600) filmCache.delete(filmCache.keys().next().value);
  filmCache.set(key, 'busy'); filmQueue.push({ clip, src, still, sec: Math.round(sec * 2) / 2, key }); pumpFilm();
  return null;
}
const filmOnce = (el, ev, ms) => new Promise((ok, no) => { const tm = setTimeout(() => no(new Error('slow')), ms); el.addEventListener(ev, () => { clearTimeout(tm); ok(); }, { once: true }); el.addEventListener('error', () => { clearTimeout(tm); no(new Error('bad')); }, { once: true }); });
async function pumpFilm() {
  if (filmBusy) return; filmBusy = true;
  while (filmQueue.length) {
    // the frames on screen first (the newest asks)
    const { src, still, sec, key } = filmQueue.pop();
    try {
      let el, w, h;
      if (still) { el = new Image(); el.decoding = 'async'; el.src = src; await el.decode(); w = el.naturalWidth; h = el.naturalHeight; }
      else {
        el = filmVids.get(src);
        if (!el) {
          if (filmVids.size >= 3) { const [k0, v0] = filmVids.entries().next().value; v0.removeAttribute('src'); v0.load(); filmVids.delete(k0); }
          el = document.createElement('video'); el.muted = true; el.preload = 'auto'; el.playsInline = true; el.src = src; filmVids.set(src, el);
          await filmOnce(el, 'loadeddata', 10000);
        }
        el.currentTime = Math.max(0, Math.min(sec, (el.duration || sec + 1) - 0.05)); await filmOnce(el, 'seeked', 6000);
        w = el.videoWidth; h = el.videoHeight;
      }
      const cv = document.createElement('canvas'); cv.height = 56; cv.width = Math.max(8, Math.round(56 * (w || 16) / (h || 9)));
      cv.getContext('2d').drawImage(el, 0, 0, cv.width, cv.height); filmCache.set(key, cv);
    } catch { filmCache.set(key, 'fail'); }
    cancelAnimationFrame(filmRedraw); filmRedraw = requestAnimationFrame(() => { if (!player.playing) drawTimeline(player.now(), player.duration()); });
  }
  filmBusy = false;
}
// a rounded box path on the timeline
function tlRound(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); else g.rect(x, y, w, h); }
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
const SEL_LANE = { card: 'card', cut: 'cuts', cam: 'camera' };
const SEL_NAME = { card: 'Card motion', cut: 'Cut', cam: 'Camera keyframes' };
function selectTl(sel, { quiet = false } = {}) {
  const was = tlSel?.kind;
  tlSel = sel;
  document.querySelectorAll('.tl-lanes span').forEach((sp) => sp.classList.toggle('sel', !!sel && sp.textContent.trim().toLowerCase() === SEL_LANE[sel.kind]));
  tlw?.classList.toggle('has-sel', !!sel);
  if (sel?.kind === 'card') {
    // card motion: the shot editor (for cuts) closes; the take's settings show its keyframes when they're open
    // (they don't pop open by themselves, so the timeline doesn't jump under your mouse)
    if (shotBar?.isOpen()) shotBar.close();
    if (tuneIndex === state.focused) requestAnimationFrame(() => document.querySelector('#tune .keys-block')?.scrollIntoView({ block: 'nearest' }));
    if (!quiet && was !== 'card') toast('Card motion selected: move the playhead, then drag or scroll on the picture. Each change is a keyframe there, and the card glides between them. Esc unselects');
  } else if (sel && !quiet && was !== sel.kind) {
    toast(sel.kind === 'cam' && isStream() ? 'Camera selected: move the playhead, then drag or scroll the cam or the screen. Each change is a keyframe and it glides between them. Esc unselects'
      : sel.kind === 'cam' ? `Camera keyframes of cut ${sel.si + 1} selected: move the playhead and drag the picture (or the box): each change is a camera keyframe. Esc unselects`
      : `Cut ${sel.si + 1} selected: drag the picture (or the box) to aim the camera in this cut. Esc unselects`);
  }
  drawTimeline(player.now(), player.duration());
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
  if (tlZoom > 1.01 && !tlHeld()) {
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
  // each row is its own soft track
  for (const l of ['card', 'camera', 'fx', 'song', 'cuts']) { g.fillStyle = l === 'cuts' ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.04)'; tlRound(g, 0, top(l) + dpr, W, bot(l) - top(l) - 2 * dpr, 3 * dpr); g.fill(); }
  // the selected item: its row lit (a whole row for card motion, the cut's stretch for a cut / its camera)
  if (tlSel && p) {
    const ln = SEL_LANE[tlSel.kind], sg = tlSel.si != null ? p.segments[tlSel.si] : null;
    const xa = sg ? X(sg.start) : 0, xb = sg ? X(sg.end) : W;
    g.fillStyle = accentRGBA(0.14); tlRound(g, xa, top(ln) + dpr, xb - xa, bot(ln) - top(ln) - 2 * dpr, 3 * dpr); g.fill();
    g.strokeStyle = accentRGBA(0.9); g.lineWidth = 1.5 * dpr; tlRound(g, xa + 0.75 * dpr, top(ln) + 1.75 * dpr, xb - xa - 1.5 * dpr, bot(ln) - top(ln) - 3.5 * dpr, 3 * dpr); g.stroke();
  }
  // time ruler: a labelled mark every few seconds (closer together when zoomed in), small marks between
  {
    const pps = W / dpr / Math.max(1e-6, v1 - v0);
    const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((x) => x * pps >= 54) || 120;
    const minor = step / (step === 2 || step === 0.2 ? 4 : 5);
    // plain seconds ("2s", "10s", "1m 30s"): easier to read at a glance than 0:02 / 1:30
    const lab = (x) => {
      x = Math.round(x * 10) / 10;
      const sec = (v) => (step < 1 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v)));
      if (x < 60) return `${sec(x)}s`;
      const m = Math.floor(x / 60), r = x - m * 60;
      return r < 0.05 ? `${m}m` : `${m}m ${sec(r)}s`;
    };
    if (minor * pps >= 6) {
      g.fillStyle = 'rgba(242,240,234,0.18)';
      for (let n = Math.ceil(v0 / minor - 1e-6); n * minor <= v1 + 1e-6; n++) g.fillRect(Math.round(X(n * minor)), bot('ruler') - 3 * dpr, dpr, 2 * dpr);
    }
    g.font = `600 ${9 * dpr}px Archivo, sans-serif`; g.textBaseline = 'top';
    for (let n = Math.ceil(v0 / step - 1e-6); n * step <= v1 + 1e-6; n++) {
      const x = Math.round(X(n * step));
      g.fillStyle = 'rgba(242,240,234,0.35)'; g.fillRect(x, bot('ruler') - 5 * dpr, dpr, 4 * dpr);
      g.fillStyle = 'rgba(242,240,234,0.62)'; g.fillText(lab(n * step), x + 3 * dpr, 1.5 * dpr);
    }
    g.textBaseline = 'alphabetic';
  }
  // Song lane: the waveform, then the beats (taller = downbeat, pink = drop)
  if (state.music) {
    const a = state.music.analysis, hh = (bot('song') - top('song')) * 0.85;
    g.fillStyle = accentRGBA(0.26);
    for (let x = 0; x < W; x += 2 * dpr) {
      const tt = state.musicStart + v0 + (x / W) * (v1 - v0);
      const v = a.wave[Math.floor((tt / a.duration) * a.wave.length)] || 0;
      g.fillRect(x, mid('song') - (v * hh) / 2, 1.2 * dpr, v * hh);
    }
  }
  for (const b of p.beats) {
    const x = X(b.t); if (x < -2 || x > W + 2) continue;
    const lh = bot('song') - top('song') - 2 * dpr, h = b.impact ? lh : b.down ? lh * 0.55 : lh * 0.3;
    g.fillStyle = b.impact ? '#ff5d8f' : b.down ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)';
    g.fillRect(x, bot('song') - h, b.impact ? 2 * dpr : dpr, h);
  }
  // Cuts lane: one block per cut, numbered; a camera mark where you set the framing, ◆ for its camera keyframes
  const sel = shotBar ? shotBar.selected() : -1, cy0 = top('cuts') + 2 * dpr, ch = bot('cuts') - cy0 - dpr;
  p.segments.forEach((sg, k) => {
    const x0 = X(sg.start), x1 = X(sg.end);
    if (x1 < 0 || x0 > W) return; // off screen (zoomed in)
    const c = state.planClips[sg.clip], w = Math.max(2, x1 - x0 - 2 * dpr), bx = x0 + dpr, rad = 4 * dpr;
    // a cut you changed (framed, camera moved, replaced, added or moved) shows in the "On" color
    const touched = !!((sg.framing && !sg.framing.spot) || sg.swapped || sg.inserted || sg.moved);
    const col = touched ? onColor() : (c ? c.color : '#888');
    g.save(); tlRound(g, bx, cy0, w, ch, rad); g.clip();
    g.fillStyle = '#141416'; g.fillRect(bx, cy0, w, ch);
    // the footage: one frame every tile, from where this cut reads its clip
    if (c && w > 6 * dpr) {
      const probe = filmFrame(c, sg.srcStart || 0), tw = Math.max(12 * dpr, ch * (probe ? probe.width / probe.height : c.w && c.h ? c.w / c.h : 16 / 9));
      const rate = (sg.srcDur || (sg.end - sg.start)) / Math.max(1e-3, sg.end - sg.start);
      for (let tx = Math.max(bx, Math.floor(-bx / tw) * tw + bx); tx < Math.min(bx + w, W); tx += tw) {
        const at = (sg.srcStart || 0) + ((tx + tw / 2 - x0) / Math.max(1, x1 - x0)) * (sg.end - sg.start) * rate;
        const fr = c.photo ? probe : filmFrame(c, at);
        if (fr) g.drawImage(fr, tx, cy0, tw, ch); else { g.fillStyle = col + '30'; g.fillRect(tx, cy0, tw - dpr, ch); }
      }
      if (k !== sel) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(bx, cy0, w, ch); }
    } else { g.fillStyle = col + '40'; g.fillRect(bx, cy0, w, ch); }
    if (touched) { g.fillStyle = col + '30'; g.fillRect(bx, cy0, w, ch); }
    // its fades: a dark ramp in / out
    { const [fi, fo] = cutFades(p, k, state.planClips);
      for (const [a0, a1, inn] of [[sg.start, sg.start + fi, true], [sg.end - fo, sg.end, false]]) {
        if (a1 - a0 < 0.02) continue; const xa = X(a0), xb = X(a1), gr = g.createLinearGradient(xa, 0, xb, 0);
        gr.addColorStop(0, inn ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0)'); gr.addColorStop(1, inn ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.6)');
        g.fillStyle = gr; g.fillRect(xa, cy0, xb - xa, ch);
        g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = dpr; g.beginPath(); g.moveTo(xa, inn ? cy0 + ch : cy0); g.lineTo(xb, inn ? cy0 : cy0 + ch); g.stroke();
      } }
    g.fillStyle = col; g.fillRect(bx, cy0, w, (touched ? 3 : 2) * dpr);
    g.restore();
    g.strokeStyle = k === sel ? '#fff' : 'rgba(255,255,255,0.14)'; g.lineWidth = (k === sel ? 2 : 1) * dpr; tlRound(g, bx + 0.5 * dpr, cy0 + 0.5 * dpr, w - dpr, ch - dpr, rad); g.stroke();
    if (w > 18 * dpr) {
      g.font = `700 ${9 * dpr}px Archivo, sans-serif`; const nt = String(k + 1), nw = g.measureText(nt).width + 7 * dpr;
      g.fillStyle = 'rgba(0,0,0,0.62)'; tlRound(g, bx + 3 * dpr, cy0 + ch - 15 * dpr, nw, 12 * dpr, 3 * dpr); g.fill();
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(nt, bx + 6.5 * dpr, cy0 + ch - 9 * dpr); g.textBaseline = 'alphabetic';
    }
    if ((sg.profile.type !== 'const' || Math.abs((sg.profile.r || 1) - 1) > 0.03) && w > 30 * dpr) {
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = `${9 * dpr}px Inter Tight, sans-serif`; g.textAlign = 'right';
      g.fillText(sg.profile.type === 'stutter' ? '⟲' : sg.profile.type === 'const' ? `${(+sg.profile.r).toFixed(2).replace(/\.?0+$/, '')}×` : '⤳', x1 - 4 * dpr, cy0 + ch * 0.72);
      g.textAlign = 'left';
    }
    if (k === sel) { g.strokeStyle = '#fff'; g.lineWidth = 1.5 * dpr; g.strokeRect(x0 + 1, cy0, w, ch); }
  });
  // FX row: per cut, readable pills: the transition into it, its speed, a mirror flip, a hit on a drop.
  // (The take's filter and effects, which run the whole edit, are named under the timeline.)
  {
    // (pills stay pill-sized on a tall timeline: at most 18 px high, in the middle of the row)
    const lane = bot('fx') - top('fx') - 4 * dpr, yh = Math.min(lane, 18 * dpr), y0 = top('fx') + 2 * dpr + (lane - yh) / 2, fs = Math.max(8.5, Math.min(10.5, yh / dpr * 0.6)) * dpr;
    g.font = `700 ${fs}px Inter Tight, sans-serif`; g.textBaseline = 'middle';
    const pill = (x, w, text, bg, fg = '#0d0d0d') => {
      if (w < 6 * dpr) return 0;
      g.fillStyle = bg; const r = Math.min(4 * dpr, yh / 2);
      g.beginPath(); g.roundRect ? g.roundRect(x, y0 + 1 * dpr, w, yh - 2 * dpr, r) : g.rect(x, y0 + 1 * dpr, w, yh - 2 * dpr); g.fill();
      let t = text;
      while (t.length > 1 && g.measureText(t).width + 6 * dpr > w) t = t.slice(0, -1);
      if (g.measureText(t).width + 4 * dpr <= w) { g.fillStyle = fg; g.fillText(t, x + Math.max(2 * dpr, (w - g.measureText(t).width) / 2), y0 + yh / 2); }
      return w;
    };
    for (const sg of p.segments) {
      const x0 = X(sg.start), x1 = X(sg.end); if (x1 < 0 || x0 > W) continue;
      let x = x0 + 1;
      const room = () => x1 - 1 - x;
      const tags = [];
      if (sg.transIn) tags.push([sg.transIn.type, '#ffffff']);
      const pr = sg.profile || {};
      if (pr.type === 'stutter') tags.push(['stutter', '#ff6ad5']);
      else if (pr.type === 'ramp') tags.push(['ramp', '#ffc94d']);
      else if (pr.type === 'const' && Math.abs((pr.r || 1) - 1) > 0.03) tags.push([(pr.r < 1 ? 'slow ' : 'fast ') + `${(+pr.r).toFixed(1)}×`, pr.r < 1 ? '#7cc8ff' : '#ffc94d']);
      if (sg.mirror) tags.push(['flip', '#c8b9ff']);
      if (sg.impact) tags.push(['hit', '#ff6ad5']);
      for (const [t, bg] of tags) {
        const tw = g.measureText(t).width + 6 * dpr, w = Math.min(room(), tw);
        if (w < 5 * dpr) break;
        x += pill(x, w, t, bg) + 2 * dpr;
      }
    }
  }
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
    const picked = tlSel?.kind === 'card' && tlSel.n === n;
    const kx = X(k.t), ky = mid('card'), r = (n === onK || picked ? 6 : 4.6) * dpr;
    if (kx < -r || kx > W + r) return;
    g.fillStyle = n === onK || picked ? '#fff' : accentHex(); g.strokeStyle = picked ? accentHex() : '#000'; g.lineWidth = (picked ? 2.2 : 1.2) * dpr;
    g.beginPath(); g.moveTo(kx, ky - r); g.lineTo(kx + r, ky); g.lineTo(kx, ky + r); g.lineTo(kx - r, ky); g.closePath(); g.fill(); g.stroke();
  });
  const camOn = camKeyAtTime(t), cm = mid('camera');
  // a stream take: the camera keyframes of its parts (cam = blue, screen = green, whole picture = white)
  if (isStream()) {
    const pk = state.variants[state.focused].custom.panKeys || {}, COL = { cam: '#7fd1ff', game: '#7dff9a', full: '#ffffff' };
    Object.entries(pk).forEach(([part, ks], pi) => {
      if (!ks?.length) return;
      const yy = cm + (pi - 0.5) * 3 * dpr;
      if (ks.length > 1) { g.fillStyle = COL[part] + '88'; g.fillRect(X(ks[0].t), yy - dpr, X(ks[ks.length - 1].t) - X(ks[0].t), 2 * dpr); }
      for (const k of ks) {
        const kx = X(k.t), r = (Math.abs(k.t - t) < 0.05 ? 6 : 4.6) * dpr;
        g.fillStyle = COL[part]; g.strokeStyle = '#000'; g.lineWidth = 1.2 * dpr;
        g.beginPath(); g.moveTo(kx, yy - r); g.lineTo(kx + r, yy); g.lineTo(kx, yy + r); g.lineTo(kx - r, yy); g.closePath(); g.fill(); g.stroke();
      }
    });
  }
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
  if (tlSel?.kind === 'cam' && !p.segments.some((sg) => sg.framing) && !(isStream() && state.variants[state.focused].custom.panKeys) && W > 260 * dpr) {
    g.fillStyle = 'rgba(242,240,234,0.32)'; g.font = `500 ${9 * dpr}px Archivo, sans-serif`;
    g.fillText(isStream() ? 'drag the cam or screen to add a keyframe' : 'drag the picture to aim the camera', 6 * dpr, cm + 3 * dpr);
  }
  if (!ck.length && tlSel?.kind === 'card' && W > 260 * dpr) {
    g.fillStyle = 'rgba(242,240,234,0.32)'; g.font = `500 ${9 * dpr}px Archivo, sans-serif`;
    g.fillText('drag or scroll the picture to add a keyframe', 6 * dpr, mid('card') + 3 * dpr);
  }
  // the playhead, with a small head on the ruler
  {
    const px = X(t);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(px - 1.5 * dpr, 0, 3 * dpr, H);
    g.fillStyle = '#fff'; g.fillRect(px - 0.75 * dpr, 0, 1.5 * dpr, H);
    g.fillStyle = accentHex(); tlRound(g, px - 5 * dpr, 0, 10 * dpr, bot('ruler') - 1 * dpr, 3 * dpr); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = dpr; g.stroke();
  }
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
  // the effects that run through the whole take (right-click the FX row to remove any of them)
  { const v2 = state.variants[state.focused], e2 = eff(state.focused), all = [];
    if (e2.filter && e2.filter !== 'none') all.push(FILTERS[e2.filter]?.name);
    for (const x of e2.fx || []) { const ex = EXTRAS.find((q) => q[0] === x); if (ex) all.push(ex[1].replace('✦ ', '')); }
    for (const [pk, pl] of styleParts(v2.styleId)) if (!(v2.custom.off || []).includes(pk)) all.push(pl);
    for (const p of styleEffects(state.focused)) if (!p.native && p.on) all.push(p.label);
    if (all.filter(Boolean).length) parts.push(`whole take: ${all.filter(Boolean).join(', ')}`); }
  if (on >= 0) parts.push(`on card keyframe ${on + 1}`);
  const ca = camKeyAtTime(t); if (ca) parts.push(`on camera keyframe ${ca.ki + 1} of cut ${ca.si + 1}`);
  // what the picture does when you drag it now
  const sel = tlSel ? (tlSel.kind === 'card' ? 'Card selected: drag or scroll the picture'
    : isStream() && tlSel.kind === 'cam' ? 'Camera selected: drag or scroll the cam or screen'
    : `${tlSel.kind === 'cam' ? 'Camera of cut' : 'Cut'} ${(tlSel.si ?? 0) + 1} selected: drag the picture to aim it`) : '';
  return (sel ? sel + ' (Esc) · ' : '') + parts.join(' · ');
}
// timeline: drag to scrub; click a shot to open it in the shot editor; hover to see which shot it is
let scrubbing = false, tlDownX = null;
const tlw = $('.timeline-wrap');
tlw.addEventListener('contextmenu', (e) => { if (e.target.closest('.tl-scroll, .pane-split')) return; const ln = laneAt(e); if (ln === 'fx') fxMenu(e); else if (ln === 'card') cardMenu(e); else cutMenu(e); });
// right-click the Card row: the keyframe under the pointer (how it moves into the next one, delete), or add one
function cardMenu(e) {
  e.preventDefault();
  const i = state.focused, keys = state.variants[i].custom.keys || [], n = tlKeyAt(e), t = tlTime(e);
  if (n < 0) {
    popMenu(e, 'Card motion', [
      { label: `Add a card keyframe at ${fmt(t)}`, run: () => addCardKey(i, t) },
      { label: 'Select card motion', sub: 'then drag / scroll the picture to keyframe it', run: () => selectTl({ kind: 'card', n: null }) },
      { label: 'Remove all card keyframes', danger: true, disabled: !keys.length, run: () => { setKeys(i, []); selectTl(null, { quiet: true }); toast('Card motion removed from this take'); } },
    ]);
    return;
  }
  const k = keys[n], setEase = (ease) => () => { const ks = keys.map((q) => ({ ...q })); ks[n].ease = ease; setKeys(i, ks); toast(`Keyframe ${n + 1}: ${ease === 'snap' ? 'jumps' : 'moves'} ${KEY_EASES.find((x) => x[0] === ease)?.[1].toLowerCase()} into the next one`); };
  popMenu(e, `Card keyframe ${n + 1} at ${fmt(k.t)}`, [
    ...KEY_EASES.map(([v, l]) => ({ label: `${k.ease === v ? '✓ ' : ''}${l}`, run: setEase(v) })),
    '-',
    { label: 'Delete this keyframe', danger: true, run: () => { const ks = [...keys]; ks.splice(n, 1); setKeys(i, ks); selectTl(ks.length ? { kind: 'card', n: null } : null, { quiet: true }); } },
  ]);
}
const tlTime = (e) => { const r = tl.getBoundingClientRect(), [v0, v1] = tlView(player.duration()); return v0 + clamp01((e.clientX - r.left) / r.width) * (v1 - v0); };
// Ctrl / ⌘ + wheel (or a trackpad pinch) zooms around the pointer; the wheel scrolls along when zoomed in
// the mouse wheel zooms the timeline in and out around the pointer (no need for the Fit button);
// Shift + wheel, or a sideways swipe, moves along it when zoomed in
tlw.addEventListener('wheel', (e) => {
  const D = player.duration();
  e.preventDefault();
  const side = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
  if (!side) { tlManual = performance.now(); zoomTimeline(Math.exp(-Math.max(-80, Math.min(80, e.deltaY)) * 0.004), tlTime(e)); return; }
  if (tlZoom <= 1.01) return;
  const [v0, v1] = tlView(D), r = tl.getBoundingClientRect(), d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  tlStart = v0 + (d / r.width) * (v1 - v0); tlManual = performance.now();
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
  if (e.target.closest('.pane-split, .tl-scroll')) return; // the height grip and the scroll bar do their own thing
  tlw.setPointerCapture(e.pointerId);
  const k = tlKeyAt(e);
  if (k >= 0) { const keys = state.variants[state.focused].custom.keys; keyDrag = { n: k, x: e.clientX, moved: false, t: keys[k].t }; return; }
  const ck = camKeyAt(e);
  if (ck) { camDrag = { ...ck, x: e.clientX, moved: false }; return; }
  // a cut: press on it and move the mouse to pick it up (a grey ghost of it follows the pointer, a yellow line shows
  // where it will land); let go to drop it there. A click without moving still opens it. The other rows scrub.
  tlDownX = e.clientX; tlManual = 0;
  if (laneAt(e) === 'cuts' && state.variants[state.focused].plan?.segments.length > 1) {
    cutDrag = { si: shotBar.shotAt(tlTime(e)), x: e.clientX, moved: false, t0: performance.now() };
    tlw.style.cursor = 'grab';
    return;
  }
  scrubbing = true; scrubTo(e);
});
let cutDrag = null; // { si, x, moved, t }
// the ghost of a cut being dragged: its picture, number and length, following the pointer above the timeline,
// and a green drop line with the spot it will go to
const cutGhost = document.createElement('div'); cutGhost.className = 'cut-ghost'; cutGhost.hidden = true;
const cutDropTag = document.createElement('div'); cutDropTag.className = 'cut-drop'; cutDropTag.hidden = true;
document.body.append(cutGhost, cutDropTag);
function showCutGhost(si) {
  const P = state.variants[state.focused].plan, sg = P?.segments[si], c = sg && state.planClips[sg.clip];
  cutGhost.innerHTML = `${c?.thumb ? `<img src="${c.thumb}" alt="">` : '<i></i>'}<span><b>Cut ${si + 1}</b><small>${esc(c?.name || 'clip')} · ${(sg ? sg.end - sg.start : 0).toFixed(1)}s</small></span>`;
  cutGhost.hidden = false; document.body.classList.add('cut-dragging');
}
function moveCutGhost(e, sp) {
  const r = tl.getBoundingClientRect();
  cutGhost.style.left = `${e.clientX}px`; cutGhost.style.top = `${r.top - 6}px`;
  if (!sp) { cutDropTag.hidden = true; return; }
  const [v0, v1] = tlView(player.duration()), x = r.left + ((sp.at - v0) / Math.max(1e-6, v1 - v0)) * r.width;
  cutDropTag.hidden = false; cutDropTag.classList.toggle('same', !!sp.same);
  cutDropTag.style.left = `${Math.max(r.left, Math.min(r.right, x))}px`; cutDropTag.style.top = `${r.bottom + 2}px`;
  cutDropTag.textContent = sp.same ? 'stays here' : `spot ${sp.to + 1}`;
}
function hideCutGhost() { cutGhost.hidden = true; cutDropTag.hidden = true; document.body.classList.remove('cut-dragging'); }
// Esc while dragging a cut: put it back
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !cutDrag?.moved) return;
  e.preventDefault(); e.stopPropagation();
  cutDrag.cancel = true; cutDrag.t = null; hideCutGhost(); drawTimeline(player.now(), player.duration());
  $('#tlLabel').textContent = 'Move cancelled: let go';
}, true);
// where a cut dragged to edit time t lands: the gap between two cuts nearest to t ({ at: that time, to: its new spot })
function dropSpot(from, t) {
  const P = state.variants[state.focused].plan; if (!P) return null;
  const segs = P.segments, n = segs.findIndex((s) => t >= s.start && t < s.end);
  let gap = n < 0 ? segs.length : n; // the gap before cut `gap`
  if (n >= 0 && t > (segs[n].start + segs[n].end) / 2) gap = n + 1;
  const at = gap >= segs.length ? P.duration : segs[gap].start;
  let to = gap; if (to > from) to--;
  return { at, to, same: gap === from || gap === from + 1 };
}
function moveCut(from, t) {
  const v = state.variants[state.focused], P = v.plan; if (!P) return;
  const segs = P.segments, sp = dropSpot(from, t);
  if (!sp || sp.same) { toast(`Cut ${from + 1} stays where it was`); return false; }
  const to = sp.to;
  const order = segs.map((s) => s.ek);
  const [k] = order.splice(from, 1); order.splice(to, 0, k);
  v.cutOrder = order;
  replan(state.focused); updateCards(); drawTimeline(player.now(), player.duration());
  player.seek(v.plan.segments[to]?.start ?? 0);
  shotBar.select(to, { seek: false });
  toast(`Cut ${from + 1} moved to spot ${to + 1}: the cuts still change on the beat`);
  return true;
}
tlw.addEventListener('pointermove', (e) => {
  if (keyDrag) {
    if (Math.abs(e.clientX - keyDrag.x) > 3) keyDrag.moved = true;
    if (keyDrag.moved) {
      const keys = state.variants[state.focused].custom.keys, D = state.variants[state.focused].plan?.duration || 10;
      // it snaps to a beat or a cut's start close by (hold Alt to place it freely)
      let tk = Math.max(0, Math.min(D, tlTime(e))), snapped = '';
      if (!e.altKey) {
        const P = state.variants[state.focused].plan, [v0, v1] = tlView(player.duration()), near = 7 * (v1 - v0) / Math.max(1, tl.getBoundingClientRect().width);
        let best = near;
        for (const b of P?.beats || []) if (Math.abs(b.t - tk) < best) { best = Math.abs(b.t - tk); snapped = b.impact ? 'a drop' : 'a beat'; tk = b.t; }
        for (const sg of P?.segments || []) if (Math.abs(sg.start - tk) < best) { best = Math.abs(sg.start - tk); snapped = 'a cut'; tk = sg.start; }
      }
      keys[keyDrag.n].t = Math.round(tk * 100) / 100;
      ctxCache = []; refreshEff(); player.seek(keys[keyDrag.n].t); drawTimeline(player.now(), player.duration());
      $('#tlLabel').textContent = `Card keyframe ${keyDrag.n + 1} moved to ${fmt(keys[keyDrag.n].t)}${snapped ? `, on ${snapped} (Alt: no snapping)` : ''}`;
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
  if (cutDrag) {
    if (cutDrag.cancel) return;
    if (!cutDrag.moved && Math.abs(e.clientX - cutDrag.x) > 4) { cutDrag.moved = true; scrubbing = false; showCutGhost(cutDrag.si); }
    if (cutDrag.moved) {
      cutDrag.t = tlTime(e); tlw.style.cursor = 'grabbing';
      drawTimeline(player.now(), player.duration());
      const sp = dropSpot(cutDrag.si, cutDrag.t);
      moveCutGhost(e, sp);
      $('#tlLabel').textContent = sp?.same ? `Cut ${cutDrag.si + 1}: let go here to leave it where it is (Esc cancels)` : `Moving cut ${cutDrag.si + 1}: let go to drop it at spot ${(sp?.to ?? 0) + 1} (Esc cancels)`;
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
  else if (lane === 'fx') {
    const n = shotBar.shotAt(at), sg = state.variants[state.focused].plan?.segments[n];
    const bits = [];
    if (sg?.transIn) bits.push(`${sg.transIn.type} transition in`);
    const pr = sg?.profile || {};
    if (pr.type === 'stutter') bits.push('stutter'); else if (pr.type === 'ramp') bits.push('speed ramp'); else if (pr.type === 'const' && Math.abs((pr.r || 1) - 1) > 0.03) bits.push(`${(+pr.r).toFixed(2)}× speed`);
    if (sg?.impact) bits.push('hit on a drop'); if (sg?.mirror) bits.push('mirrored');
    txt = `${fmt(at)}, cut ${n + 1}: ${bits.length ? bits.join(', ') : 'no transition or speed change'} · right-click to remove an effect`;
  }
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
    selectTl({ kind: 'card', n: selKey });
    return;
  }
  if (camDrag) {
    // let go of a camera keyframe (moved or just clicked): open its cut in the shot editor, on that keyframe
    const cd = camDrag; camDrag = null;
    const sg = state.variants[state.focused].plan.segments[cd.si], key = sg?.framing?.keys?.[cd.ki];
    if (sg && key) openCutAt(cd.si, sg.start + key.o + 0.001);
    selectTl({ kind: 'cam', si: cd.si, ki: cd.ki });
    return;
  }
  if (cutDrag) {
    const cd = cutDrag; cutDrag = null; tlw.style.cursor = ''; hideCutGhost();
    if (cd.moved) { scrubbing = false; tlDownX = null; if (cd.t != null && !cd.cancel) moveCut(cd.si, cd.t); drawTimeline(player.now(), player.duration()); return; }
  }
  scrubbing = false;
  if (tlDownX != null && Math.abs(e.clientX - tlDownX) < 5) {
    player.pause(); updatePlayIcon();
    // the playhead lands exactly where you clicked, then (after a moment: a double-click adds a keyframe instead)
    // the cut under it opens in the shot editor
    // what you click is what gets selected (like CapCut): the Card row = card motion, a cut = that cut (it opens
    // in the shot editor), the Camera row = that cut's camera keyframes. The ruler, FX and Song rows only move the
    // playhead and keep what's selected.
    const t = tlTime(e), lane = laneAt(e);
    player.seek(t);
    clearTimeout(tlSelTimer);
    if (lane === 'card') { selectTl({ kind: 'card', n: cardKeyAt(state.focused, t) >= 0 ? cardKeyAt(state.focused, t) : null }); }
    else if (lane === 'camera' && isStream()) selectTl({ kind: 'cam', si: shotBar.shotAt(t) });
    else if (lane === 'cuts' || lane === 'camera') {
      tlSelTimer = setTimeout(() => {
        const si = shotBar.shotAt(t);
        shotBar.select(si, { seek: false }); if (Math.abs(player.now() - t) > 0.03) player.seek(t);
        selectTl(lane === 'camera' ? { kind: 'cam', si } : { kind: 'cut', si });
      }, e.detail >= 2 ? 0 : 280);
      if (e.detail >= 2) clearTimeout(tlSelTimer);
    } else drawTimeline(player.now(), player.duration());
  } else if (tlDownX != null && shotBar.isOpen()) {
    // dragged the playhead: the shot editor follows to the cut it ended on (and so does the selection)
    const si = shotBar.shotAt(player.now());
    shotBar.select(si, { seek: false });
    if (tlSel && tlSel.si != null && tlSel.si !== si) selectTl({ kind: tlSel.kind, si }, { quiet: true });
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
    selectTl({ kind: 'cam', si }, { quiet: true });
  } else if (lane === 'card') { addCardKey(state.focused, t); selectTl({ kind: 'card', n: selKey }, { quiet: true }); }
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
// Stream clips → Export all: every highlight found, one after another (each with its own title and layout)
function exportAllHighlights() {
  if (!isStream()) return;
  if (state.variants.some((v) => v.sourcePlan)) { state.variants.forEach((_, i) => queueExport(i)); return; }
  if (state.server.ffmpeg === false) return toast('ffmpeg is needed to save MP4s.', true);
  const ready = state.clips.filter((c) => c.status === 'ready');
  const list = ready.length ? streamHighlights(ready) : [];
  if (!list.length) return toast('No highlights found yet: add a stream clip first', true);
  const v = state.variants[0], keep = { hiPick: v.hiPick, title: v.custom.title };
  let n = 0;
  for (let k = 0; k < list.length; k++) {
    v.hiPick = k; delete v.custom.title;
    replan(0); refreshEff();
    if (queueExport(0, { batch: k + 1 })) n++;
  }
  if (keep.hiPick == null) delete v.hiPick; else v.hiPick = keep.hiPick;
  if (keep.title != null) v.custom.title = keep.title;
  replan(0); refreshEff(); updateCards();
  toast(`Exporting all ${n} clips: they save one after another. You can keep working.`);
}
function queueExport(i, opt = {}) {
  const v = state.variants[i];
  if (!v.plan?.segments.length) return false;
  if (state.server.ffmpeg === false) { toast('ffmpeg is needed to save MP4s.', true); return false; }
  const [quality, fps] = state.settings.quality.split('/').map(Number);
  const res = v.plan.quick?.quality === 'compact' ? Math.min(quality, 720) : quality;
  const base = (state.planClips[0]?.name || 'edit').replace(/\.[^.]+$/, '').slice(0, 30);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const st = isStream() ? STYLES.stream : STYLES[v.styleId];
  const job = {
    id: Math.random().toString(36).slice(2), i, color: st.color, overlay: textFor(i)?.canvas || null, hook: hookFor(i)?.canvas || null, items: overlays.forExport(i),
    name: `${isStream() ? `Clip${v.plan.highlight?.rank || ''}` : st.name}_${base}_${stamp}`,
    plan: v.plan, clips: state.planClips.slice(), music: state.music, musicAnalysis: state.musicAnalysis, quickAudio: quickAudioOf(v),
    settings: { ...eff(i), res, fps }, status: 'queued', p: 0, phase: 'Waiting…',
  };
  jobs.unshift(job);
  $('#tray').hidden = false;
  renderJobs(); runJobs();
  warnRights(i);
  return true;
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
      if (job.settings.captions === 'on' && !job.plan.quick) {
        job.phase = 'Finishing captions'; renderJobs();
        await Promise.all(job.clips.map(c => c.speechPromise));
        const failed = job.clips.find(c => c.audioBuffer && c.speechState !== 'done');
        if (failed) throw new Error(`No captions for ${failed.name}. ${failed.speechError || 'Try again,'} Or turn Captions off for this take.`);
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
  requestAnimationFrame(() => { if (typeof applyLocks === 'function') applyLocks(); });
  document.querySelectorAll('.seg').forEach((seg) => {
    const k = seg.dataset.key;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(state.settings[k]) === b.dataset.v));
  });
  { const L = state.settings[$('#segLength').dataset.key]; $('#segLength').dataset.ddEmpty = L === 'match' ? 'Match clip' : `${L}s`; }
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
  // take 1: the plain Beat Sync edit with new cuts; the other takes: a random style + effect mix each
  state.variants.forEach((v, i) => {
    v.seed = (Math.random() * 1e9) | 0;
    if (i === 0) { if (v.styleId !== 'pure') { v.styleId = 'pure'; v.custom.off = []; applyStyleDefaults(v); } delete v.custom.fx; delete v.custom.filter; }
    else if (!KEEP_STYLE.has(v.styleId)) randomLook(i);
  });
  saveCustom(); saveLineup(); replanAll(); player.seek(0); toast(`${state.variants.length} new takes: take 1 is a plain beat sync, the rest are mixed up`);
};
// ---------------- MODE: edits or stream clips ----------------
let quickApi = null; // Quick Mode's Topic to video page (set up further down)
function applyMode(first = false) {
  const st = isStream(), quick = state.settings.mode === 'quick';
  document.body.classList.toggle('mode-stream', st);
  document.body.classList.toggle('mode-quick', quick);
  if (quick) {
    // its own page: the editor waits underneath, as it was
    document.querySelectorAll('#modeSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'quick'));
    if (first) return;
    if (player.playing) { player.pause?.(); updatePlayIcon(); }
    quickApi?.open();
    toast('Quick Mode: a topic or a long video in, a finished video out');
    return;
  }
  state.editorMode = state.settings.mode;
  quickApi?.pause();
  document.querySelectorAll('#modeSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.settings.mode));
  $('#segLength').dataset.key = st ? 'streamLen' : 'length';
  $('#editTitle').textContent = st ? 'Clipper' : 'Edit';
  $('#lenLabel').textContent = st ? 'Max clip length' : 'Length';
  syncInputs(); renderMainLook();
  if (first) return;
  if (tuneIndex != null) closeTune();
  hiCache.key = ''; state.variants.forEach((v) => { v.hiSkip = 0; });
  refreshEff(); queueAllTracks(); replanAll(); player.seek(0); renderClips();
  toast(st ? 'Clipper Mode: the best highlights of your Twitch and Kick clips' : 'Edit Mode: make edits of anything');
}
document.querySelectorAll('#modeSwitch button').forEach((b) => {
  b.onclick = () => { if (state.settings.mode === b.dataset.mode) return; state.settings.mode = b.dataset.mode; saveSettings(); applyMode(); };
});

// ---------------- look controls: filters, effects, auto-focus, speed, fades ----------------
// Used twice: in the sidebar (main settings, all edits) and in each edit's own "Customize" panel.
const FORMATS = VIDEO_FORMATS.map((format) => [format, format]);
const FADES = [[0, 'Off'], [0.3, '0.3s'], [0.5, '0.5s'], [1, '1s'], [2, '2s'], [3, '3s']];
const fadeName = (v) => (Number(v) ? `${Number(v)}s` : 'Off');
// text from outside (video titles, file names, channel names) goes into the page only through this
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pick(k, opts, cur, mainVal) {
  const main = mainVal !== undefined ? `<button data-k="${k}" data-v="" class="${cur === undefined ? 'on' : ''}">Main <i>${esc(mainVal)}</i></button>` : '';
  return `<div class="pick">${main}${opts.map(([v, l]) => `<button data-k="${k}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function filterChips(cur, inherit, noneLabel = FILTERS.none.name) {
  const main = inherit !== undefined ? `<button class="flt ${cur === undefined ? 'on' : ''}" data-k="filter" data-v=""><i class="sw main"></i>Main: ${esc(FILTERS[inherit]?.name || 'none')}</button>` : '';
  return `<div class="filters">${main}${Object.entries(FILTERS).map(([k, f]) =>
    `<button class="flt ${cur === k ? 'on' : ''}" data-k="filter" data-v="${k}"><i class="sw" style="background:linear-gradient(135deg,${f.sw[0]},${f.sw[1]})"></i>${k === 'none' ? noneLabel : f.name}</button>`).join('')}</div>`;
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
const PICK_OPTS = [['viral', 'Most viral'], ['auto', 'Auto'], ['scenes', 'Best scenes'], ['quotes', 'Best quotes']];
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
// Clean look: the explanations under a setting's name become its hover tip (the setting stays one short line).
// Kept: anything with a button or a number in it (reset buttons, counts like "3 on").
function quietUi(root) {
  if (!root) return;
  root.querySelectorAll('.field > span > em').forEach((em) => {
    if (em.querySelector('button, b, input') || /\d/.test(em.textContent) || !em.textContent.trim()) return;
    const sp = em.parentElement; sp.title = (sp.title ? sp.title + ' · ' : '') + em.textContent.trim(); em.remove();
  });
  root.querySelectorAll('.field > small.hint-s:not(.keep)').forEach((h) => {
    const f = h.closest('.field'), sp = f?.querySelector(':scope > span');
    if (sp && h.textContent.trim()) sp.title = (sp.title ? sp.title + ' · ' : '') + h.textContent.trim();
    if (!h.querySelector('button')) h.remove();
  });
}
function renderMainLook() {
  renderWmOpts();
  renderHookOpts();
  const s = state.settings;
  if (s.mode === 'stream') {
    // stream clips: layout, captions, title, dead air, punch-in zoom, a color filter
    const brains = state.clips.map((c) => c.crowd?.brain).filter(Boolean);
    const b = brains[0];
    $('#mainLook').innerHTML = `
      <div class="field"><span>Every take <em>${s.streamVary === 'same' ? 'your settings on all of them' : 'a different look each: layout, captions, banner, filter (zoom and cuts stay as you set them)'}</em></span>${pick('streamVary', [['vary', 'Different'], ['same', 'All the same']], s.streamVary === 'same' ? 'same' : 'vary')}</div>
      <div class="field"><span>Layout <em>${s.streamLayout === 'auto' ? (s.streamVary === 'same' ? 'the webcam cropped out to its own box on top, when there is one' : 'take 1 picks; the others try webcam + screen, cam + screen and full frame') : s.streamLayout === 'cam' ? 'the webcam cropped out to its own box, the screen in the rest' : s.streamLayout === 'stack' ? 'close on the streamer’s face, the screen in the rest' : ''}</em></span>${pick('streamLayout', STREAM_LAYOUTS, s.streamLayout)}</div>
      ${s.streamLayout !== 'full' ? `<div class="sub-block">
        <div class="field"><span>Which half is on top</span>${pick('stackSwap', [['off', 'Cam on top'], ['on', 'Screen on top']], s.stackSwap)}</div>
        <div class="field"><span>Screen <em>${s.stackGame === 'whole' ? 'the whole stream, nothing cropped' : 'cropped to fill its half'}</em></span>${pick('stackGame', [['fill', 'Fill'], ['whole', 'Whole screen']], s.stackGame)}</div>
        ${s.stackGame === 'whole' ? `<div class="field"><span>Around the screen</span>${pick('streamEdge', [['black', 'Black bars'], ['blur', 'Blurred copy']], s.streamEdge || 'black')}</div>` : ''}
        <div class="field"><span>Cam <em>${s.stackCam === 'multi' ? (state.clips.some((c) => c.cam?.group) ? 'everyone on cam' : 'one face found so far') : ''}</em></span>${pick('stackCam', [['face', 'Face close-up'], ['multi', 'Everyone (2+ faces)'], ['whole', 'Whole webcam']], s.stackCam)}</div>
        <div class="field"><span>Cam size</span>${pick('stackSplit', [['0.4', 'Small'], ['0.5', 'Half'], ['0.6', 'Big']], String(s.stackSplit))}</div>
      </div>` : ''}
      ${s.streamLayout !== 'stack' ? `<div class="field"><span>${s.streamLayout === 'auto' ? 'Full frame picture' : 'Picture'} <em>${s.streamFit === 'whole' ? 'the whole video' : 'cropped, follows the streamer'}</em></span>${pick('streamFit', [['fill', 'Fill (crop)'], ['whole', 'Whole video']], s.streamFit || 'fill')}</div>
        ${s.streamFit === 'whole' && s.stackGame !== 'whole' ? `<div class="field"><span>Around the video</span>${pick('streamEdge', [['black', 'Black bars'], ['blur', 'Blurred copy']], s.streamEdge || 'black')}</div>` : ''}` : ''}
      <div class="field"><span>Banner <em>${s.streamBanner === 'off' ? 'off' : 'the platform and the streamer\'s name'}</em></span>${pick('streamBanner', [['on', 'On'], ['off', 'Off']], s.streamBanner)}</div>
      ${s.streamBanner !== 'off' ? `<label class="field"><span>Name on the banner <em>${String(s.bannerName || '').trim() ? '' : b?.name ? 'from the clip: ' + esc(b.name) : 'type the streamer\'s name'}</em></span>
        <input class="text-in" data-text="bannerName" maxlength="40" spellcheck="false" placeholder="${esc(b?.name || 'streamer name')}" value="${esc(s.bannerName || '')}"></label>
      <div class="field"><span>Platform</span>${pick('bannerPlatform', [['auto', 'From the clip'], ['twitch', 'Twitch'], ['kick', 'Kick']], s.bannerPlatform || 'auto')}</div>
      <div class="field"><span>Logo</span><div class="set-row logo-row">${s.bannerLogo ? `<img class="logo-prev" src="${s.bannerLogo}" alt="">` : '<em class="logo-none">Platform name</em>'}<button class="small" data-banner-logo>${s.bannerLogo ? 'Change' : 'Use my logo…'}</button>${s.bannerLogo ? '<button class="small" data-banner-logo-x>Remove</button>' : ''}</div></div>
      <div class="field"><span>Banner look</span><div class="themes">${BANNER_THEMES.map(([k, l, d]) =>
        `<button data-k="bannerTheme" data-v="${k}" class="theme t-${k} ${s.bannerTheme === k ? 'on' : ''}" title="${esc(d)}"><i></i>${l}</button>`).join('')}</div>
        ${s.bannerX != null ? '<div class="set-row"><button class="small" data-banner-reset>Banner back to its usual place</button></div>' : '<small class="hint-s">Drag the banner on any take to move it anywhere.</small>'}</div>` : ''}
      <div class="field"><span>Captions <em>word by word</em></span>${pick('streamCaptions', [['on', 'On'], ['off', 'Off']], s.streamCaptions)}</div>
      ${s.streamCaptions === 'on' ? `<div class="field"><span>Caption style</span>${strSel('streamCaptionStyle', CAP_STYLE_OPTS, s.streamCaptionStyle)}</div>${captionSampleHtml()}
      <div class="field"><span>Spoken language</span>${strSel('speechLang', [['auto', 'Detect it'], ...LANGS], s.speechLang || 'auto')}</div>
      <div class="field"><span>Captions in</span>${strSel('captionLang', [['same', 'The language spoken'], ...LANGS], s.captionLang || 'same')}</div>` : ''}
      <div class="field"><span>Title box <em>viewer clip title or the best line</em></span>${pick('streamTitle', [['on', 'On'], ['off', 'Off']], s.streamTitle)}</div>
      <div class="field"><span>Cuts <em>${s.streamCuts === 'pauses' ? 'jump cuts remove pauses' : 'one continuous piece, nothing cut out'}</em></span>${pick('streamCuts', [['none', 'No cuts'], ['pauses', 'Cut pauses']], s.streamCuts)}</div>
      <div class="field"><span>Zoom on big reactions</span>${pick('reactZoom', [['on', 'On'], ['off', 'Off']], s.reactZoom)}</div>
      <div class="field"><span>Filter</span>${filterChips(s.filter)}</div>
      <small class="hint-s brain keep">${b ? `Clip brain: learned from the ${b.clips.length} most-viewed ${b.platform === 'kick' ? 'Kick' : 'Twitch'} clips of <b>${esc(b.name)}</b>${b.typicalLength ? ` (their best clips run ~${Math.round(b.typicalLength)}s)` : ''}${brains.some((x) => x.matches?.length) ? ' and the moments viewers clipped from this stream' : ''}.`
        : 'Add Twitch / Kick clips (Find clips → Twitch / Kick, or paste a link): Cutsona learns from the channel’s top clips and picks the best moments.'}</small>`;
    quietUi($('#mainLook'));
    paintCaptionSample($('#mainLook'), { style: s.streamCaptionStyle, font: 'segoe' });
    return;
  }
  $('#mainLook').innerHTML = `
    <div class="field"><span>Filter</span>${filterChips(s.filter)}</div>
    <div class="field"><span>Extra effects <em>${s.fx.length ? s.fx.length + ' on' : 'tap to stack'}</em></span>${fxChips(s.fx)}</div>
    <div class="field"><span>Auto-focus on faces <em>${s.focus === 'on' ? 'follows faces' : 'shows the whole clip'}</em></span>${pick('focus', [['on', 'On'], ['off', 'Off']], s.focus)}
      ${s.focus === 'on' ? '' : '<small class="hint-s">The camera stays still and every take shows the whole picture. Cuts and effects still land on the beat.</small>'}</div>
    ${spotlightHtml()}
    ${(() => { const n = state.clips.reduce((k, c) => k + (c.cards?.length || 0), 0); return `<div class="field"><span>Skip title cards <em>${n ? `${n} found: name cards, black screens, text slates` : 'name cards, black screens, text slates'}</em></span>${pick('skipCards', [['on', 'Skip them'], ['off', 'Keep them']], s.skipCards || 'on')}</div>`; })()}
    <div class="field"><span>What to use from your clips <em>${s.pick === 'viral' ? 'hooks, reactions, best lines' : s.pick === 'quotes' ? 'inspiring lines' : s.pick === 'scenes' ? 'top moments' : 'smart mix'}</em></span>${pick('pick', PICK_OPTS, s.pick)}
      <small class="hint-s">${s.pick === 'quotes' ? 'Finds the best things said in your clips (inspiring, quotable lines) and plays each one in full, with the music dipped under it.' : s.pick === 'scenes' ? 'Uses the strongest visual moments (action, reactions, big movement) and ignores talking.' : 'Mixes the loudest moments, full sentences and action.'}</small></div>
    <div class="field"><span>Clip order <em>${s.order === 'story' ? 'follows your clips' : 'mixed up'}</em></span>${pick('order', ORDER_OPTS, s.order)}
      <small class="hint-s">${s.order === 'story' ? 'Plays your clips top to bottom (as listed under Clips, drag to reorder) and moves forward through each video, cut to the beat, so the edit tells it in order.' : 'Picks the best moments from anywhere in any clip, in any order.'}</small></div>
    <div class="field"><span>Auto-captions</span>${pick('captions', [['off', 'Off'], ['on', 'On']], s.captions)}</div>
    ${s.captions === 'on' || s.pick === 'quotes' ? `<div class="field"><span>Caption style</span>${strSel('captionStyle', CAP_STYLE_OPTS, s.captionStyle)}</div>
      <div class="field"><span>Caption font</span>${strSel('captionFont', CAP_FONT_OPTS, s.captionFont)}</div>${captionSampleHtml()}
      <div class="field"><span>Spoken language</span>${strSel('speechLang', [['auto', 'Detect it'], ...LANGS], s.speechLang || 'auto')}</div>
      <div class="field"><span>Captions in</span>${strSel('captionLang', [['same', 'The language spoken'], ...LANGS], s.captionLang || 'same')}</div>` : ''}
    <div class="field"><span>Speed ramps &amp; slow-mo</span>${pick('speed', [['on', 'On'], ['off', 'Off (normal speed)']], s.speed)}</div>`;
  quietUi($('#mainLook'));
  paintCaptionSample($('#mainLook'), { style: s.captionStyle, font: s.captionFont });
  requestAnimationFrame(applyLocks);
    // (fades: the song's in Music → Edit, a clip's in its sound settings, the picture's per take in the take's settings)
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
  const k = el.dataset.sel;
  if (k === 'speechLang' || k === 'captionLang') { state.settings[k] = el.value; saveSettings(); languageChanged(k); return; }
  const tgt = mode === 'main' ? state.settings : state.variants[tuneIndex].custom;
  if (mode === 'edit' && el.value === '') delete tgt[k]; else tgt[k] = el.dataset.str ? el.value : Number(el.value);
  commit(mode, k);
}
// A setting changed on the main screen goes to all 4 edits: any edit that had its own value for it follows main again.
// Settings that change WHAT the edits show (not just how they look): changing one on the main screen
// remakes all 4 edits as fresh takes built around the new setting.
const REGEN_KEYS = new Set(['pick', 'order', 'pacing', 'speed', 'captions', 'length']);
// stream clip settings: re-cut the 4 highlights with the new setting
const STREAM_KEYS = new Set(['streamLayout', 'streamTitle', 'streamCuts', 'reactZoom', 'streamLen', 'bannerPlatform', 'streamVary']);
const REGEN_LABEL = {
  pick: () => ({ viral: 'Most viral', auto: 'a smart mix', scenes: 'Best scenes', quotes: 'Best quotes' })[state.settings.pick] || state.settings.pick,
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
  else if (k === 'pacing' || k === 'speed' || k === 'captions' || k === 'pick' || k === 'order' || k === 'skipCards') replanSoon();
  if (k === 'skipCards') renderClips();
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
  const sp = e.target.closest('[data-spot]');
  if (sp) { setSpotlight(sp.dataset.spot); return; }
  if (e.target.closest('[data-banner-logo]')) { pickBannerLogo(); return; }
  if (e.target.closest('[data-banner-logo-x]')) { delete state.settings.bannerLogo; saveSettings(); textCache.clear(); refreshEff(); renderMainLook(); return; }
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
  $('#tune').onclick = null; // (a Clipper Mode take's own handler: never left behind for an Edit Mode take)
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
      ${(() => { const fx = styleEffects(i), n = fx.filter((p) => p.on).length, own = fx.filter((p) => p.native).length; return `<div class="field"><span>Style effects <em>${n} of ${fx.length} on (${own} come with ${esc(st.name)})
        <button class="reset" data-allparts="on">all on</button> <button class="reset" data-allparts="off">all off</button></em></span><div class="fxchips">${fx.map((p) =>
        `<button class="fxc ${p.on ? 'on' : ''}" data-part="${p.key}" title="${p.kind === 'speed' ? 'Speed ramps & slow-mo in this take' : p.native ? '' : `Not part of ${esc(st.name)}: tick to add it to this take`}">${esc(p.label)}</button>`).join('')}</div></div>`; })()}
      <div class="field"><span>Filter</span>${filterChips(c.filter, s.filter)}</div>
      <div class="field"><span>Effects <em>${ownFx ? `${e.fx.length} on, <button class="reset" data-act="reset:fx">↺ use main</button>` : `same as main (${s.fx.length})`}</em></span>${fxChips(e.fx, !ownFx)}</div>
      ${slider('intensity', 0, 2, 0.05, 'Effect strength')}
      ${slider('pacing', 0, 1, 0.05, 'Pacing')}
      <div class="field"><span>Auto-focus on faces &amp; bodies</span>${pick('focus', [['on', 'On'], ['off', 'Off']], c.focus, s.focus === 'on' ? 'On' : 'Off')}</div>
      <div class="field"><span>What to use from the clips</span>${pick('pick', PICK_OPTS, c.pick, PICK_OPTS.find((o) => o[0] === s.pick)?.[1] || 'Auto')}</div>
      <div class="field"><span>Clip order</span>${pick('order', ORDER_OPTS, c.order, ORDER_OPTS.find((o) => o[0] === s.order)?.[1] || 'Scattered')}</div>
      <div class="field"><span>Auto-captions</span>${pick('captions', [['off', 'Off'], ['on', 'On']], c.captions, s.captions === 'on' ? 'On' : 'Off')}</div>
      ${e.captions === 'on' ? `<div class="field"><span>Caption style</span>${strSel('captionStyle', CAP_STYLE_OPTS, c.captionStyle, capName(s.captionStyle))}</div>
        <div class="field"><span>Caption font</span>${strSel('captionFont', CAP_FONT_OPTS, c.captionFont, fontName(s.captionFont))}</div>${captionSampleHtml()}` : ''}
      <div class="field"><span>Fades</span>${fadesBlock((k) => c[k], (k) => s[k])}</div>
      <div class="field"><span>Hook text <em>empty = main text</em></span><input type="text" data-text maxlength="90" placeholder="${esc(s.text || 'e.g. WAIT FOR IT')}" value="${esc(c.text || '')}"></div>
      <div class="field"><span>Text color</span>${pick('textColor', [['white', 'White'], ['yellow', 'Yellow'], ['black', 'Black']], c.textColor, s.textColor === 'yellow' ? 'Yellow' : s.textColor === 'black' ? 'Black' : 'White')}</div>
      ${keysBlock(i)}
      <div class="tune-actions"><button class="small" data-act="copy">Copy to all takes</button><button class="small" data-act="reset">Reset to main</button></div>
    </div>`;
}
{ const renderTune0 = renderTune; renderTune = function () {
  renderTune0(); quietUi($('#tune'));
  if (tuneIndex != null) { const e = eff(tuneIndex); paintCaptionSample($('#tune'), { style: e.captionStyle, font: e.captionFont }); }
}; }
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
  selectTl({ kind: 'card', n: null });
  requestAnimationFrame(() => glow(document.querySelector('#tune .keys-block')));
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-cam-link], [data-card-link]'); if (!a) return;
  e.preventDefault();
  if (a.matches('[data-cam-link]')) showCameraMove(); else showCardMotion();
});
// card-motion keyframes on the timeline: add one at time t (with the card's values there), select one
let selKey = -1;
function jumpCardKey(dir) {
  const i = state.focused, keys = state.variants[i].custom.keys || [], t = player.now();
  const k = dir < 0 ? [...keys].reverse().find((q) => q.t < t - 0.02) : keys.find((q) => q.t > t + 0.02);
  if (!k) { toast(dir < 0 ? 'No card keyframe before the playhead' : 'No card keyframe after the playhead'); return; }
  player.pause(); updatePlayIcon(); player.seek(k.t);
  selectTl({ kind: 'card', n: keys.indexOf(k) }, { quiet: true }); renderTune();
}
function addCardKey(i, t) {
  const v = state.variants[i], D = v.plan?.duration || 10, keys = [...(v.custom.keys || [])];
  t = Math.max(0, Math.min(D, t));
  const cur = keyValues(keys.length ? [...keys].sort((a, c) => a.t - c.t) : null, t) || { ...KEY_PROPS };
  const next = [...keys.filter((k) => Math.abs(k.t - t) > 0.05), { ...cur, t, ease: 'smooth' }].sort((a, c) => a.t - c.t);
  selKey = next.findIndex((k) => Math.abs(k.t - Math.round(t * 100) / 100) < 0.006);
  player.pause(); updatePlayIcon(); player.seek(t);
  if (tuneIndex !== i) openTune(i);
  setKeys(i, next);
  if (i === state.focused) selectTl({ kind: 'card', n: selKey }, { quiet: true });
  document.querySelector('#tune .keys-block')?.scrollIntoView({ block: 'nearest' });
  toast(`Card keyframe at ${fmt(t)}: drag or scroll the picture, or use the sliders under Card motion. Move the playhead and change it again for the next keyframe`);
}
// a drag on the picture in card motion mode: the keyframe at the playhead (made if there isn't one, with the card
// as it is there; the very first one also gets a keyframe at the start, so the move is a glide from there)
function prepCardKey(i) {
  const v = state.variants[i], D = v.plan?.duration || 10, t = Math.max(0, Math.min(D, Math.round(player.now() * 100) / 100));
  player.pause(); updatePlayIcon();
  let keys = [...(v.custom.keys || [])].sort((a, b) => a.t - b.t), made = false, madeStart = false;
  let idx = keys.findIndex((k) => Math.abs(k.t - t) < 0.15);
  if (idx < 0) {
    const cur = keyValues(keys.length ? keys : null, t) || { ...KEY_PROPS };
    if (!keys.length && t > 0.2) { keys.push({ ...KEY_PROPS, t: 0, ease: 'smooth' }); madeStart = true; }
    keys = [...keys, { ...cur, t, ease: 'smooth' }].sort((a, b) => a.t - b.t);
    idx = keys.findIndex((k) => Math.abs(k.t - t) < 0.006); made = true;
    v.custom.keys = keys;
  } else v.custom.keys = keys;
  selKey = idx;
  const k = v.custom.keys[idx];
  return { idx, t: k.t, x0: k.x || 0, y0: k.y || 0, made, madeStart };
}
// a stream take's camera keyframe for one part (cam / game / full) at the playhead: the one there, or a new one
// with the part where it is now (the very first one also gets a keyframe at the start, so it glides from there)
function prepPanKey(i, part) {
  const v = state.variants[i], c = v.custom, D = v.plan?.duration || 10, t = Math.max(0, Math.min(D, Math.round(player.now() * 100) / 100));
  player.pause(); updatePlayIcon();
  c.panKeys ||= {}; const ks = (c.panKeys[part] ||= []);
  let key = ks.find((k) => Math.abs(k.t - t) < 0.15), made = false, madeStart = false;
  if (!key) {
    const now = (() => { const e = { pan: c.pan, panKeys: c.panKeys }; const kk = e.panKeys[part]; if (!kk.length) return c.pan?.[part] || [0, 0, 1];
      const f = kk.length && t <= kk[0].t ? kk[0] : kk.length && t >= kk[kk.length - 1].t ? kk[kk.length - 1] : null;
      if (f) return [f.x, f.y, f.z ?? 1];
      let j = 0; while (j < kk.length - 2 && kk[j + 1].t <= t) j++; const a = kk[j], b = kk[j + 1], u = (t - a.t) / Math.max(1e-4, b.t - a.t);
      return [a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, (a.z ?? 1) + ((b.z ?? 1) - (a.z ?? 1)) * u]; })();
    if (!ks.length && t > 0.2) { const p0 = c.pan?.[part] || [0, 0, 1]; ks.push({ t: 0, x: p0[0], y: p0[1], z: p0[2] ?? 1 }); madeStart = true; }
    key = { t, x: now[0], y: now[1], z: now[2] ?? 1 }; ks.push(key); ks.sort((a, b) => a.t - b.t); made = true;
  }
  return { key, x0: key.x, y0: key.y, made, madeStart };
}
function cleanPanKeys(i) {
  const c = state.variants[i].custom; if (!c.panKeys) return;
  for (const k of Object.keys(c.panKeys)) if (!c.panKeys[k]?.length) delete c.panKeys[k];
  if (!Object.keys(c.panKeys).length) delete c.panKeys;
  saveCustom(); updateCards();
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
  const sz = ''; // safe zones moved to Settings → Look (1.2)
  // compact: the size slider, All / One as icons, and in One view a ‹ 3/10 › stepper instead of a button per take
  const size = state.solo ? '' : `<label class="take-size" title="Take window size: ${Math.round(state.takeScale * 100)}% (Ctrl + scroll over the takes works too)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>
    <input type="range" id="takeSize" min="0.3" max="1" step="0.01" value="${state.takeScale}" aria-label="Take window size"><b>${Math.round(state.takeScale * 100)}%</b></label>`;
  const n = state.variants.length, f = state.focused;
  vb.innerHTML = sz + size + `<div class="pick view icons"><button data-view="all" class="${state.solo ? '' : 'on'}" title="All ${n} takes at once" aria-label="All takes"><svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg></button>
    <button data-view="one" class="${state.solo ? 'on' : ''}" title="One take big (V)" aria-label="One take"><svg viewBox="0 0 24 24"><rect x="5" y="3.5" width="14" height="17" rx="2"/></svg></button></div>` +
    (state.solo ? `<div class="solo-step" style="--c:${STYLES[state.variants[f].styleId].color}"><button data-i="${(f - 1 + n) % n}" title="The take before" aria-label="Previous take">‹</button><b title="${STYLES[state.variants[f].styleId].name}">${f + 1}<small>/${n}</small></b><button data-i="${(f + 1) % n}" title="The next take" aria-label="Next take">›</button></div>` : '');
}
function setTakeScale(v) {
  state.takeScale = Math.min(1, Math.max(0.3, v));
  try { localStorage.setItem('cutsona.takeScale', String(state.takeScale)); } catch {}
  const r = $('#takeSize'); if (r && Number(r.value) !== state.takeScale) r.value = state.takeScale;
  const b = $('#viewBar .take-size b'); if (b) b.textContent = Math.round(state.takeScale * 100) + '%';
  layoutGrid();
}
$('#viewBar').addEventListener('input', (e) => { if (e.target.id === 'takeSize') setTakeScale(Number(e.target.value)); });
grid.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey) || state.solo) return;
  e.preventDefault(); setTakeScale(state.takeScale * Math.exp(-e.deltaY * 0.0012));
}, { passive: false });
// Safe zones (the eye next to Settings): which app's screen shows over the previews
function syncSafePick() {
  const on = SAFE_ZONES[state.safeZone];
  $('#btnSafe').classList.toggle('on', !!on);
  $('#safeName').textContent = on ? on.name : '';
  $('#safeMenu').innerHTML = `<b>Safe zones</b><small>See an app's buttons and captions over every tall take. Previews only.</small>`
    + [['off', 'Off'], ...Object.entries(SAFE_ZONES).map(([k, z]) => [k, z.name])].map(([k, n]) => `<button role="menuitemradio" aria-checked="${(state.safeZone || 'off') === k}" data-safe="${k}" class="${(state.safeZone || 'off') === k ? 'on' : ''}">${n}</button>`).join('');
}
function setSafe(k) {
  state.safeZone = k;
  try { localStorage.setItem('cutsona.view', JSON.stringify({ solo: state.solo, safe: state.safeZone })); } catch {}
  syncSafePick(); renderSafeZones();
  toast(k === 'off' ? 'Safe zones off' : `${SAFE_ZONES[k].name} screen over every tall take`);
}
$('#btnSafe').addEventListener('click', (e) => { e.stopPropagation(); $('#safeMenu').hidden = !$('#safeMenu').hidden; });
$('#safeMenu').addEventListener('click', (e) => { const b = e.target.closest('[data-safe]'); if (!b) return; $('#safeMenu').hidden = true; setSafe(b.dataset.safe); });
document.addEventListener('pointerdown', (e) => { if (!$('#safeMenu').hidden && !e.target.closest('.sz-pick')) $('#safeMenu').hidden = true; });
syncSafePick();
$('#viewBar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.view) setSolo(b.dataset.view === 'one');
  else if (b.dataset.i) { focusCard(Number(b.dataset.i)); updateViewBar(); }
});

// ---------------- files / drag & drop ----------------
$('#btnAddOverlay').onclick = () => $('#fileOverlay').click();
$('#fileOverlay').onchange = (e) => { overlays.addFiles([...e.target.files]); e.target.value = ''; };
$('#btnAddClips').onclick = () => $('#fileClips').click();
$('#clipDrop').onclick = () => $('#fileClips').click();
$('#btnAddFolder').onclick = () => $('#fileFolder').click();
$('#btnAddMusic').onclick = () => $('#fileMusic').click();
$('#musicDrop').onclick = () => $('#fileMusic').click();
$('#fileClips').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
$('#fileFolder').onchange = (e) => { addFiles([...e.target.files].filter((f) => VIDEO_EXT.test(f.name) || IMAGE_EXT.test(f.name)), null, { preview: false }); e.target.value = ''; };
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
// "+ Own clip → Find clips / GIF": the next clip you add there goes into the edit at the playhead once it's ready
let ownPending = null;
const takeOwn = () => { const o = ownPending && Date.now() < ownPending.until ? ownPending : null; ownPending = null; return o; };
async function insertWhenReady(id, at) {
  for (let k = 0; k < 1200; k++) {
    await sleep(400);
    const c = state.clips.find((x) => x.id === id);
    if (!c || c.status === 'error') return;
    if (c.status === 'ready' && state.planClips.some((pc) => pc.id === id) && state.variants[state.focused]?.plan) { addCutAt(at, id); return; }
  }
}
const finder = initFinder({
  grab: (item, onUpdate) => { const own = takeOwn(); let done = false; return grab(item, (u) => { if (own && !done && u?.clipId) { done = true; insertWhenReady(u.clipId, own.at); } onUpdate?.(u); }); },
  grabSong, toast, hasClip: (id) => state.clips.some((c) => c.id === id),
  addFile: (f, part, scan) => { const own = takeOwn(), c = addVideoFile(f, part, scan); if (own && c) insertWhenReady(c.id, own.at); return c; },
  explainViral: (e) => viralInfo(e),
  isStream: () => isStream(), hasMusic: () => !!state.music,
  // a random edit: fresh random styles on every take once the clips are in
  onRandom: () => { if (!isStream() && !$('#btnGenerate').disabled) $('#btnGenerate').click(); } });
$('#btnFind').onclick = () => finder.open();
$('#btnFindSong').onclick = () => finder.open('music');
$('#btnFindEmpty').onclick = () => finder.open();
$('#btnOwnEmpty').onclick = () => $('#fileClips').click();
// empty screen: "Make a new one with Add": the link lights up the Add slot (and the real + Add take tile once there are takes)
function glowAdd(el) { if (!el) return; el.classList.remove('glowing'); void el.offsetWidth; el.classList.add('glowing'); setTimeout(() => el.classList.remove('glowing'), 1700); }
$('#linkAddTake').onclick = (e) => { e.preventDefault(); glowAdd(grid.hidden ? $('#blankAdd') : addTile); };
$('#blankAdd').onclick = () => { glowAdd($('#blankAdd')); toast('Add your clips first: then + Add makes another take (up to 10)'); $('#fileClips').click(); };
if (ONE_TAKE && LINEUP.length === 1) {
  $('#emptyTitle').textContent = 'One take from your clips';
  $('.blank-takes').classList.add('one');
}
// a low-end computer, the first time: say why there's one take, and where to change it
try {
  if (ONE_TAKE && PERF === 'auto' && !localStorage.getItem('cutsona.perfToldV1')) {
    localStorage.setItem('cutsona.perfToldV1', '1');
    setTimeout(() => toast(`This computer has ${PC.why}, so Cutsona opens ${LINEUP.length === 1 ? 'one take' : 'two takes'} to stay smooth. + Add take makes more; Settings → Performance changes it`), 1500);
  }
} catch {}
// Cutsona makes viral videos: "What to use" starts at Most viral (once, for people who had it on Auto)
try { if (!localStorage.getItem('cutsona.viralV1')) { localStorage.setItem('cutsona.viralV1', '1'); if (state.settings.pick === 'auto') { state.settings.pick = 'viral'; saveSettings(); renderMainLook(); } } } catch {}
// Settings → API keys
initKeys({ toast, esc });
// Settings → Performance
{
  const sel = $('#setPerf'), note = $('#perfNote');
  // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x2504) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "NVIDIA GeForce RTX 3060"
  const gpuName = (g) => { const m = /^ANGLE \((.*)\)$/.exec(g), parts = (m ? m[1] : g).split(', '); return (parts[1] || parts[0]).replace(/\s*\(0x[0-9a-f]+\)/i, '').replace(/\s+(Direct3D|OpenGL|vs_|ps_).*$/, '').trim().slice(0, 60); };
  if (sel) {
    sel.value = PERF;
    const say = () => { note.textContent = `This computer: ${PC.cores} cores${navigator.deviceMemory ? `, ${PC.mem}${PC.mem >= 8 ? '+' : ''} GB memory` : ''}${PC.gpu ? `, ${gpuName(PC.gpu)}` : ''}. ${PC.low ? `Counts as low-power (${PC.why}).` : 'Plenty for four takes.'}`; };
    say();
    sel.onchange = () => { try { localStorage.setItem('cutsona.perf', sel.value); } catch {} toast('Takes at start: changes the next time Cutsona opens'); };
  }
}
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

// a video playing in a preview (Find clips, your own video, a clip's preview, the transcript): the takes pause
window.addEventListener('cutsona:preview-play', () => { if (player.playing) { player.pause(); updatePlayIcon(); } });
// ---------------- keyboard: every shortcut can be changed in Settings → Hotkeys ----------------
const hotkeys = createHotkeys();
window.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input[type=text], input[type=number], select, textarea') || finder.isOpen()) return;
  if (state.settings.mode === 'quick') {
    if (!$('#qvLong').hidden && hotkeys.action(e) === 'finder') { e.preventDefault(); longVideo.openClipFinder(); }
    return;
  }
  // arrow keys on a slider move the slider, not the playhead
  if (e.target.matches?.('input[type=range]') && /^Arrow|^Page|^Home$|^End$/.test(e.key)) return;
  if (e.key === 'Escape') { if (tlSel) selectTl(null); else if (shotBar.isOpen()) shotBar.close(); else if (tuneIndex != null) closeTune(); return; }
  // 1-9, 0: pick that take
  if (/^Digit[0-9]$/.test(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { const n = Number(e.code.slice(5)) || 10; if (n <= state.variants.length) focusCard(n - 1); return; }
  const a = hotkeys.action(e);
  if (!a || ['undo', 'redo', 'save', 'open'].includes(a)) return; // those are handled below (they also work while typing)
  const step = shotBar.isOpen() ? 0.1 : 1;
  const run = {
    play: () => { audioCtx().resume(); player.toggle(); updatePlayIcon(); },
    back: () => player.seek(player.now() - step),
    fwd: () => player.seek(player.now() + step),
    start: () => player.seek(0),
    // [ and ]: the previous / next shot, or with card motion selected its previous / next keyframe
    prevShot: () => { if (tlSel?.kind === 'card') return jumpCardKey(-1); shotBar.step(-1); updatePlayIcon(); },
    nextShot: () => { if (tlSel?.kind === 'card') return jumpCardKey(1); shotBar.step(1); updatePlayIcon(); },
    reroll: () => reroll(state.focused),
    generate: () => $('#btnGenerate').click(),
    export: () => queueExport(state.focused),
    solo: () => setSolo(!state.solo),
    tune: () => (tuneIndex === state.focused ? closeTune() : openTune(state.focused)),
    finder: () => finder.open(),
    overlay: () => $('#fileOverlay').click(),
    transcript: () => { const c = state.clips.find((x) => x.status === 'ready'); if (c) transcript.open(c); else toast('Add a clip first'); },
    zoomIn: () => zoomTimeline(1.6),
    zoomOut: () => zoomTimeline(1 / 1.6),
    addKey: () => { if (shotBar.isOpen()) shotBar.addKey(); else return false; },
    deleteCut: () => {
      // the selected keyframe, else the selected cut
      if (tlSel?.kind === 'card' && tlSel.n != null) { const i = state.focused, keys = [...(state.variants[i].custom.keys || [])]; if (!keys[tlSel.n]) return false; keys.splice(tlSel.n, 1); setKeys(i, keys); selectTl(keys.length ? { kind: 'card', n: null } : null, { quiet: true }); toast('Card keyframe deleted'); return; }
      if (tlSel?.kind === 'cam' && isStream()) {
        const c = state.variants[state.focused].custom, t = player.now(); let n = 0;
        for (const ks of Object.values(c.panKeys || {})) for (let j = ks.length - 1; j >= 0; j--) if (Math.abs(ks[j].t - t) < 0.15) { ks.splice(j, 1); n++; }
        cleanPanKeys(state.focused); refreshEff(); drawTimeline(player.now(), player.duration());
        toast(n ? `Camera keyframe${n > 1 ? 's' : ''} at ${fmt(t)} deleted` : 'No camera keyframe at the playhead'); return;
      }
      if (tlSel?.kind === 'cam' && shotBar.isOpen()) { if (shotBar.deleteKeyHere()) { selectTl({ kind: 'cam', si: tlSel.si }, { quiet: true }); toast('Camera keyframe deleted'); return; } }
      if (shotBar.isOpen()) shotBar.deleteSelected(); else return false;
    },
  }[a];
  if (!run) return;
  if (run() === false) return;
  e.preventDefault();
});

// ---------------- shot editor: what the camera captures, shot by shot ----------------
function wantTrack(clip, withBoxes) {
  // tracks made before the shot editor existed don't know where everyone is: find people again
  if (withBoxes && clip.track && (!clip.track.boxes || (withBoxes === 'people' && (!clip.track.people || (clip.track.peopleV || 1) < PEOPLE_V)))) { clip.track = null; clip.trackState = null; clip.trackPromise = null; }
  clip.wantTrack = true; queueTrack(clip); renderClipsSoon();
}
shotBar = initShotBar({
  el: $('#shotBar'), player, toast, wantTrack, saveCut: saveCutFraming,
  wantKeys: () => tlSel?.kind === 'cam', // camera keyframes selected on the timeline: every aim is a keyframe
  cutOps: { del: deleteCut, replace: replaceCut, restore: restoreCut, restoreDeleted: restoreDeletedCuts, deleted: () => deletedCuts(state.focused) },
  getView: () => { const i = state.focused, v = state.variants[i]; return { index: i, plan: v.plan, clips: state.planClips, ctx: ctxFor(i), color: STYLES[v.styleId].color }; },
  // a framing change shows in the take right away, even while paused
  onChange: () => { const v = player.views[state.focused]; if (v) v.dirty = true; drawTimeline(player.now(), player.duration()); },
  onToggle: (open) => { if (!open && tlSel && tlSel.kind !== 'card') selectTl(null, { quiet: true }); updatePlayIcon(); requestAnimationFrame(layoutGrid); drawTimeline(player.now(), player.duration()); },
});
afterTrack = () => { shotBar.refresh(); if (!isStream()) renderMainLook(); if (state.settings.spotlight) replanAll(); };

// ---------------- settings: export folder, theme, accent color ----------------
const settingsUI = initSettings({ toast, esc });
$('#btnSettings').onclick = () => settingsUI.open();
initUpdates({ toast, esc });
document.addEventListener('cutsona:look', () => { drawWave(); renderClips(); drawTimeline(player.now(), player.duration()); });

refreshEff(); renderMainLook(); syncInputs(); applyMode(true); updateCards(); renderStatus(); refreshStatus().then(updateCards);
window.__cutsona = { state, player };

// ---------------- projects and undo ----------------
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const round3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;
// everything you can change, as plain data: what Undo steps through and what a project saves
function docState() {
  return {
    settings: state.settings,
    takes: state.variants.map((v) => ({ styleId: v.styleId, seed: v.seed, custom: v.custom, hiSkip: v.hiSkip || 0, hiPick: v.hiPick ?? null,
      cutEdits: v.cutEdits ? [...v.cutEdits] : [], cutFrames: v.cutFrames ? [...v.cutFrames] : [], cutOrder: v.cutOrder ? [...v.cutOrder] : null, sourcePlan: v.sourcePlan || null })),
    clips: state.clips.filter((c) => c.status !== 'error').map((c) => ({ id: c.id, trim: c.trim || null, parts: c.parts || null, manualCrop: !!c.manualCrop,
      cropX: round3(c.cropX ?? 0.5), cropY: round3(c.cropY ?? 0.5), cropZoom: round3(c.cropZoom ?? 1), audioFx: c.audioFx || null, srcOffset: c.srcOffset || 0, hold: c.hold || null, vfade: c.vfade || null })),
    music: state.music ? state.music.id : null, musicStart: round3(state.musicStart), beatOffset: state.beatOffset,
  };
}
// what a take's cuts depend on: if none of it changed, a saved take can show its saved cuts
function planSig(i, ready) {
  const v = state.variants[i];
  return JSON.stringify([state.settings, v.styleId, v.seed, v.custom, v.hiSkip || 0, v.hiPick ?? null, v.cutEdits ? [...v.cutEdits] : [], state.variants.length,
    ready.map((c) => [c.id, c.trim || null, c.parts || null]), state.music ? state.music.name : null, round3(state.musicStart), state.beatOffset]);
}
const planJson = (plan) => JSON.parse(JSON.stringify(plan, (k, val) => (k === 'style' ? undefined : val)));
function restorePlan(p) { const plan = clone(p); plan.style = STYLES[plan.styleId] || STYLES.stream; return plan; }
// make the takes the right number (adding / removing cards like + Add take and ×)
function setTakeCount(n) {
  n = Math.max(1, Math.min(MAX_TAKES, n));
  if (tuneIndex != null && (n !== state.variants.length)) closeTune();
  while (state.variants.length < n) {
    state.variants.push({ styleId: 'beat', seed: 1, plan: null, custom: {} });
    const el = makeCard(); player.attach(cards.length - 1, el.querySelector('canvas'));
  }
  while (state.variants.length > n) {
    const i = state.variants.length - 1;
    player.detach(i); cards[i].remove(); cards.splice(i, 1); state.variants.pop();
  }
  if (state.focused >= n) state.focused = n - 1;
  effCache = []; ctxCache = [];
}
function setTakes(takes) {
  setTakeCount(takes.length);
  takes.forEach((t, i) => {
    const v = state.variants[i];
    v.styleId = STYLES[t.styleId] ? t.styleId : 'beat'; v.seed = t.seed; v.custom = clone(t.custom) || {}; v.hiSkip = t.hiSkip || 0;
    if (t.hiPick == null) delete v.hiPick; else v.hiPick = t.hiPick;
    v.cutEdits = new Map(t.cutEdits || []); v.cutFrames = new Map(t.cutFrames || []); v.cutOrder = t.cutOrder ? [...t.cutOrder] : null;
    v.savedPlan = t.savedPlan || null; if (!v.savedPlan) delete v.savedPlan;
    v.sourcePlan = t.sourcePlan || null;
    v.plan = null;
  });
}
// after settings / takes / clips changed all at once (Undo, opening a project): redraw every part of the app
function refreshAll() {
  saveSettings(); saveCustom(); saveLineup(); refreshEff(); hiCache.key = '';
  applyMode(true); renderHookOpts(); renderWmOpts();
  if (tuneIndex != null) renderTune();
  musicUi(); renderClips(); renderStatus(); drawWave(); updateEmpty(); updateAddTile();
  replanAll(); requestAnimationFrame(layoutGrid);
}
// Undo / Redo: put a snapshot back
function applyDoc(d) {
  state.settings = { ...DEFAULTS, ...clone(d.settings) };
  setTakes(d.takes);
  const known = new Map([...graveyard.values(), ...state.clips].map((c) => [c.id, c]));
  const next = [];
  for (const sc of d.clips) {
    const c = known.get(sc.id);
    if (!c) continue;
    c.trim = sc.trim ? sc.trim.slice() : null; if (sc.parts) c.parts = clone(sc.parts); else delete c.parts; if (sc.hold) c.hold = sc.hold; else delete c.hold; if (sc.vfade) c.vfade = { ...sc.vfade }; else delete c.vfade;
    c.manualCrop = sc.manualCrop; c.cropX = sc.cropX; c.cropY = sc.cropY; c.cropZoom = sc.cropZoom;
    if (sc.audioFx) c.audioFx = clone(sc.audioFx); else delete c.audioFx;
    next.push(c); graveyard.delete(c.id);
  }
  for (const c of state.clips) if (!next.includes(c) && c.status !== 'error') { player.dropClip(c.id); bury(c); }
  state.clips = [...next, ...state.clips.filter((c) => c.status === 'error')];
  if ((state.music?.id || null) !== d.music) {
    if (state.music) bury(state.music);
    const m = d.music ? graveyard.get(d.music) : null;
    if (m) { graveyard.delete(m.id); state.music = m; }
    else { state.music = null; state.musicAnalysis = syntheticMusic(130, 120); }
  }
  state.beatOffset = d.beatOffset || 0; applyBeatOffset();
  state.musicStart = d.musicStart || 0;
  for (const c of state.clips) if (c.status === 'ready' && !c.trackState) queueTrack(c);
  refreshAll();
}
const history = createHistory({
  snapshot: docState,
  apply: applyDoc,
  onChange: (why) => { updateUndoUi(); if (why !== 'reset') projects.changed(); },
});
function updateUndoUi() {
  $('#btnUndo').disabled = !history.canUndo();
  $('#btnRedo').disabled = !history.canRedo();
}
function undo() { if (history.undo()) toast('Undone'); else toast('Nothing to undo'); updateUndoUi(); }
function redo() { if (history.redo()) toast('Redone'); else toast('Nothing to redo'); updateUndoUi(); }
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
// any change you make: take a snapshot once things settle (a slider drag is one step)
for (const ev of ['input', 'change', 'pointerup', 'keyup', 'drop', 'click']) document.addEventListener(ev, () => { history.touch(); setTimeout(updateUndoUi, 500); }, true);
window.addEventListener('keydown', (e) => {
  const typing = e.target.matches?.('input[type=text], input[type=number], textarea');
  const a = hotkeys.action(e);
  if (a === 'save' && (!typing || e.ctrlKey || e.metaKey)) { e.preventDefault(); if (state.settings.mode === 'quick') quickApi?.flush().catch(() => {}); else projects.save(); }
  else if (a === 'open' && (!typing || e.ctrlKey || e.metaKey)) { e.preventDefault(); projects.show(); }
  else if (typing || finder.isOpen() || state.settings.mode === 'quick') return; // typing: the text box's own undo
  else if (a === 'undo') { e.preventDefault(); undo(); }
  else if (a === 'redo') { e.preventDefault(); redo(); }
}, true);

// a clip or song as a project file reference: still in the cache, already copied for a project, or uploaded now
async function mediaRef(x) {
  if (x.mediaRef) return x.mediaRef;
  if (x.url?.startsWith('/cache/')) return { cache: x.url };
  if (!x.file) return null;
  const r = await fetch('/api/projects/media?name=' + encodeURIComponent(x.file.name || x.name || 'clip.mp4'), { method: 'POST', body: x.file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Couldn’t save ${x.name}`);
  return (x.mediaRef = { media: j.media });
}
// the project's picture in the list: the first clip's thumbnail
const projectThumb = () => state.clips.find((c) => c.status === 'ready' && c.thumb)?.thumb || '';
async function buildProjectDoc() {
  const d = clone(docState());
  const ready = state.clips.filter((c) => c.status === 'ready');
  const live = state.clips.filter((c) => c.status !== 'error');
  const takes = d.takes.map((t, i) => {
    const v = state.variants[i];
    return { ...t, savedPlan: !v.sourcePlan && v.plan && ready.length
      ? { sig: planSig(i, ready), ids: ready.map((c) => c.id).join('|'), plan: planJson(v.plan) } : v.savedPlan || null };
  });
  const mode = state.settings.mode === 'quick' ? state.editorMode || 'edits' : state.settings.mode;
  const focused = state.focused, credits = state.credits || [], safeZone = state.safeZone, thumb = projectThumb();
  const m = state.music;
  const clips = [];
  for (const c of live) {
    const sc = d.clips.find((x) => x.id === c.id);
    clips.push({ ...sc, name: c.name, color: c.color, photo: !!c.photo, still: c.still === true, quickAsset: !!c.quickAsset, thumb: c.quickAsset ? c.thumb : undefined,
      origin: c.origin || null, src: await mediaRef(c) });
  }
  const doc = {
    ...d, clips, mode, focused, credits, safeZone, thumb,
    music: m ? { id: m.id, name: m.name, origin: m.origin || null, src: await mediaRef(m) } : null,
    takes,
  };
  // the server says which copies it kept; one that's gone (a project was deleted meanwhile) is uploaded again next time
  const afterSave = (saved) => {
    let lost = false;
    for (const sc of saved?.clips || []) { const c = state.clips.find((x) => x.id === sc.id); if (!c) continue; if (sc.src) c.mediaRef = sc.src; else if (c.mediaRef) { delete c.mediaRef; lost = true; } }
    if (m && saved?.music) { if (saved.music.src) m.mediaRef = saved.music.src; else if (m.mediaRef) { delete m.mediaRef; lost = true; } }
    doc.takes.forEach((t, i) => {
      const v = state.variants[i];
      if (v && t.savedPlan && t.savedPlan.sig === planSig(i, state.clips.filter((c) => c.status === 'ready'))) v.savedPlan = t.savedPlan;
    });
    return lost;
  };
  return { doc, afterSave };
}
function clearProject() {
  for (const c of state.clips) { player.dropClip(c.id); if (c.url?.startsWith('blob:')) URL.revokeObjectURL(c.url); }
  state.clips = []; graveyard.clear();
  state.planClips = []; state.credits = []; quickAudioFiles.clear();
  state.music = null; state.musicAnalysis = syntheticMusic(130, 120); state.musicStart = 0; state.beatOffset = 0;
}
function newProjectState() {
  clearProject();
  state.settings = { ...DEFAULTS, mode: state.settings.mode };
  setTakes(DEFAULT_LINEUP.map((styleId) => ({ styleId, seed: (Math.random() * 1e9) | 0, custom: {} })));
  for (const v of state.variants) applyStyleDefaults(v);
  player.stop(); player._autostarted = false; updatePlayIcon();
  refreshAll(); history.reset();
}
async function openProjectDoc(pr) {
  const d = pr.doc;
  projectLoading = true;
  try {
    clearProject();
    player.stop(); player._autostarted = false; updatePlayIcon();
    state.settings = { ...DEFAULTS, ...clone(d.settings) };
    if (state.settings.mode === 'quick') state.settings.mode = d.mode === 'stream' ? 'stream' : 'edits';
    state.credits = d.credits || [];
    if (SAFE_ZONES[d.safeZone] || d.safeZone === 'off') state.safeZone = d.safeZone;
    setTakes(d.takes || []);
    state.focused = Math.max(0, Math.min(state.variants.length - 1, Number(d.focused) || 0));
    for (const sc of d.clips || []) {
      if (!sc.url) continue;
      const quickAsset = !!sc.quickAsset;
      const still = quickAsset && sc.still === true;
      // Older saves marked every scanned video as a still and some re-saves also marked it as a photo.
      // Standalone photos are converted to photo_*.mp4 before being archived as proj_c_photo_*.mp4.
      const legacyVideoFlag = !quickAsset && sc.still === true && !/^\/cache\/(?:proj_c_)?photo_[a-z0-9]+\.mp4$/i.test(sc.url);
      const photo = still || (!!sc.photo && !legacyVideoFlag);
      const clip = { id: sc.id, name: sc.name, url: sc.url, status: 'loading', sub: 'opening…', remote: true, photo, still,
        quickAsset, thumb: still ? sc.url : sc.thumb, color: sc.color || CLIP_COLORS[state.clips.length % CLIP_COLORS.length],
        origin: sc.origin || { local: true, title: sc.name }, mediaRef: sc.src || undefined, trim: sc.trim || null, manualCrop: !!sc.manualCrop, cropX: sc.cropX ?? 0.5, cropY: sc.cropY ?? 0.5, cropZoom: sc.cropZoom ?? 1, ...(sc.hold ? { hold: sc.hold } : {}), ...(sc.vfade ? { vfade: { ...sc.vfade } } : {}) };
      if (sc.parts) clip.parts = clone(sc.parts);
      if (sc.audioFx) clip.audioFx = clone(sc.audioFx);
      if (sc.srcOffset) clip.srcOffset = sc.srcOffset;
      state.clips.push(clip);
      if (clip.origin) lookupRights(clip.origin);
    }
    refreshAll();
    const quickClips = state.clips.filter((c) => c.quickAsset);
    const quicks = state.variants.map((v) => v.sourcePlan?.plan?.quick).filter(Boolean);
    const audio = [...new Set(quicks.flatMap((q) => [q.voice, q.song]).filter((url) => url?.startsWith('/api/doc/asset?')))];
    const decoded = Promise.allSettled(audio.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('A Quick project audio file is missing.');
      quickAudioFiles.set(url, await decodeAudio(await response.arrayBuffer()));
    }));
    for (const c of state.clips) if (!c.quickAsset) queueAnalysis(c);
    const visuals = Promise.all(quickClips.map(async (c) => {
      try {
        if (c.still) {
          const image = new Image(); image.src = c.url; await image.decode();
          c.w = image.naturalWidth; c.h = image.naturalHeight;
          c.duration = Math.max(8, Number(d.settings?.length) || 8);
        } else {
          const video = await loadVideo(c.url, 12000);
          c.w = video.videoWidth; c.h = video.videoHeight; c.duration = video.duration;
          video.removeAttribute('src'); video.load(); video.remove();
        }
        c.usableEnd = c.duration; c.sub = `${c.w}×${c.h}`; c.status = 'ready';
        c.speechState = 'done';
      } catch (error) { c.status = 'error'; c.sub = error.message; }
    }));
    if (d.music?.url) {
      const blob = await (await fetch(d.music.url)).blob();
      await setMusic(new File([blob], d.music.name || 'song.mp3', { type: blob.type || 'audio/mpeg' }), d.music.origin || null, d.music.url);
      if (state.music) { state.music.id = d.music.id || state.music.id; state.music.mediaRef = d.music.src || undefined; if (d.music.origin?.local) state.music.origin = d.music.origin; }
      state.beatOffset = d.beatOffset || 0; applyBeatOffset(); state.musicStart = d.musicStart || 0;
      musicUi(); drawWave();
    }
    const [decodedAudio] = await Promise.all([decoded, visuals, clipQueue]);
    if (decodedAudio.some((result) => result.status === 'rejected')) toast('Some Quick project audio could not be opened.', true);
  } finally { projectLoading = false; }
  const ready = state.clips.filter((c) => c.status === 'ready');
  state.variants.forEach((v, i) => {
    if (v.savedPlan && remapSavedPlan(v.savedPlan, ready)) v.savedPlan = { ...v.savedPlan, sig: planSig(i, ready) };
  });
  renderClips(); renderStatus();
  replanAll(); refreshEff(); updateCards(); history.reset(); updateUndoUi();
}
const projects = initProjects({ buildDoc: buildProjectDoc, openDoc: openProjectDoc, newProject: newProjectState,
  hasContent: () => state.clips.some((c) => c.status !== 'error') || !!state.music, toast, esc,
  // a new project saves itself only once its clips are in (nothing still downloading)
  ready: () => !state.clips.some((c) => c.status === 'loading'),
  // a first save without a name: called after the first clip (or the song)
  suggestName: () => (state.clips.find((c) => c.status !== 'error')?.name || state.music?.name || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 60) });
updateUndoUi();
setTimeout(() => history.reset(), 0);

// ---------------- 1.2: transcript, clip audio, dropdowns, hotkeys ----------------
// a clip's gear / double-clicking its wave: the clip in the preview, to edit all of it there: which part plays (with
// its viral moments, Smart trim, the heat bar and its transcript) and its sound (volume, tone, fades)
function openClipPreview(c, anchor) {
  if (!c) return;
  if (c.status !== 'ready' || !c.duration) { clipAudio.open(c, anchor); return; }
  clipAudio.close();
  finder.editClip(c, {
    part: () => clipTrim(c),
    setPart: (a, b) => { setTrim(c, a, b); renderClips(); replanAll(); toast(`${c.name}: the edits now use ${fmtT(clipTrim(c)[0])}–${fmtT(clipTrim(c)[1])}`); },
    sound: (host) => clipAudio.embed(c, host),
    // the clip as it came: the whole video, no parts cut out, its sound back to normal
    changed: () => !!c.trim || !!c.audioFx || (c.parts || []).some((p) => !p.on || p.gone),
    revert: () => { c.trim = null; delete c.parts; delete c.audioFx; renderClips(); replanAll(); clipAudio.refresh(); player.views.forEach((v) => { if (v) v.dirty = true; }); },
    close: () => clipAudio.close(),
    refresh: () => clipAudio.refresh(),
  });
}
const transcript = createTranscript({ state, toast, setTrim, clipFull, clipTrim,
  onTrim: () => { renderClips(); replanAll(); }, analyzeSpeech, openSettings: () => $('#btnSettings').click(), explainViral: (e) => viralInfo(e) });
const clipAudio = createClipAudio({ toast, esc, onChange: () => { renderClipsSoon(); player.views.forEach((v) => { if (v) v.dirty = true; }); try { if (state.variants[state.focused]?.plan) drawTimeline(player.now(), player.duration()); } catch {} },
  // the part of the clip the edits use: same as the start / length row in the clip list
  trim: { get: clipTrim, full: clipFull, set: setTrim, best: bestClipPart, done: () => { renderClips(); replanAll(); } },
  // every clip's level under the song (was the Clip audio slider in Edit)
  mix: { get: () => Number(state.settings.clipVol) || 0, set: (v) => { const el = $('#clipVol'); el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); } },
  // about how long a cut of this clip runs in the edit you're on (for the fade handles)
  cutLen: (c) => {
    // the clip from its first moment in the edit you're on to its last: its fades go at the two ends
    const k = state.planClips.indexOf(c), P = state.variants[state.focused]?.plan;
    if (!P || k < 0 || !P.segments.some((s) => s.clip === k)) return Math.max(1, Math.min(30, clipTrim(c)[1] - clipTrim(c)[0]));
    const [a, b] = clipSpan(P, k); return b - a;
  },
  // edit time (from the clip's first moment) -> the clip's own time at that moment, or null while another clip plays
  editMap: (c) => {
    const k = state.planClips.indexOf(c), P = state.variants[state.focused]?.plan;
    if (!P || k < 0 || !P.segments.some((s) => s.clip === k)) return null;
    const [a] = clipSpan(P, k);
    return { at: (t) => { const T = a + t, sg = P.segments.find((s) => T >= s.start && T < s.end); return sg && sg.clip === k ? sg.srcStart + srcOffset(sg, T - sg.start) : null; } };
  } });
initDropdowns([document.querySelector('.side'), $('#tune')]);
// the key hints on buttons follow your hotkeys
function keyHints() {
  const set = (sel, id) => { const k = $(sel); if (k) { k.textContent = hotkeys.label(id); k.hidden = !hotkeys.key(id); } };
  set('#btnGenerate kbd', 'generate'); set('#btnFind kbd', 'finder');
}
renderHotkeySettings($('#hkBox'), hotkeys, keyHints);
keyHints();
// Music → Edit: the song's sound and which part of it plays
const songEditor = createSongEditor({ state, toast, esc, suggestWindow, currentLength, saveSettings,
  setLength: (L) => { state.settings.length = L; applyMainToAll('length'); saveSettings(); syncInputs(); drawWave(); regenAll('length'); },
  onStart: () => { drawWave(); replanAll(); player.seek(0); },
  onSound: (k) => { if (k === 'musicVol' || k === 'musicMute' || /Fade/.test(k)) player.setMusicVolume(); else player.restartAudio(); syncInputs(); } });
$('#btnEditMusic').onclick = (e) => (songEditor.isOpen() ? songEditor.close() : songEditor.open(e.currentTarget));
wave.addEventListener('dblclick', (e) => { if (state.music) { e.preventDefault(); songEditor.open($('#btnEditMusic')); } }); // double-click the song's wave: its settings
// drag the edges between panels to resize them
initPanes({ onResize: (k) => { if (k === 'sb') shotBar?.refresh(); requestAnimationFrame(() => { layoutGrid(); drawWave(); }); } });

// ---- the timeline, more: where a dragged cut will land, and a scroll bar to move along it when zoomed in ----
const tlScroll = document.createElement('div');
tlScroll.className = 'tl-scroll'; tlScroll.innerHTML = '<i title="Drag to move along the timeline"></i>';
tlw.appendChild(tlScroll);
const drawTimelineBase = drawTimeline;
drawTimeline = function (t, D) {
  drawTimelineBase(t, D);
  const [v0, v1] = tlView(D), span = Math.max(1e-6, v1 - v0);
  // the scroll bar's thumb shows the part of the edit you see
  tlScroll.classList.toggle('on', tlZoom > 1.01);
  const th = tlScroll.firstChild;
  th.style.left = `${(v0 / D) * 100}%`; th.style.width = `${Math.max(2, (span / D) * 100)}%`;
  if (!cutDrag?.moved || cutDrag.t == null || cutDrag.cancel) return;
  const p = state.variants[state.focused].plan; if (!p) return;
  const segs = p.segments, sp = dropSpot(cutDrag.si, cutDrag.t); if (!sp) return;
  const at = sp.at;
  const g = tl.getContext('2d'), W = tl.width, H = tl.height, x = ((at - v0) / span) * W, dpr = devicePixelRatio || 1;
  // a grey ghost of the cut: an empty slot where it was, and a see-through copy that follows your pointer
  const src = segs[cutDrag.si];
  if (src) {
    const X = (q) => ((q - v0) / span) * W, y0 = Math.round(H * TL_LANES.cuts[0]) + 2 * dpr, yh = H - y0 - dpr;
    const ox = X(src.start), ow = Math.max(4 * dpr, X(src.end) - ox);
    g.save();
    g.fillStyle = 'rgba(20,20,22,0.85)'; g.fillRect(ox, y0, ow, yh);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.setLineDash([4 * dpr, 3 * dpr]); g.lineWidth = dpr; g.strokeRect(ox + 0.5 * dpr, y0 + 0.5 * dpr, ow - dpr, yh - dpr);
    g.setLineDash([]);
    const gx = X(cutDrag.t) - ow / 2, gy = y0 - 3 * dpr;
    g.globalAlpha = 0.6; g.fillStyle = '#9a9a9e'; g.fillRect(gx, gy, ow, yh);
    g.globalAlpha = 0.9; g.strokeStyle = '#e8e8ea'; g.lineWidth = dpr; g.strokeRect(gx + 0.5 * dpr, gy + 0.5 * dpr, ow - dpr, yh - dpr);
    g.globalAlpha = 1; g.fillStyle = '#111'; g.font = `700 ${10 * dpr}px Inter Tight, sans-serif`; g.textBaseline = 'middle';
    if (ow > 14 * dpr) g.fillText(String(cutDrag.si + 1), gx + 4 * dpr, gy + yh / 2);
    g.restore();
  }
  // the drop line is yellow (the playhead is green), with an arrow on top
  g.fillStyle = sp.same ? 'rgba(255,255,255,0.45)' : getComputedStyle(document.documentElement).getPropertyValue('--tape').trim() || '#ffd23f'; g.fillRect(x - 1.5 * dpr, 0, 3 * dpr, H);
  g.beginPath(); g.moveTo(x - 6 * dpr, 0); g.lineTo(x + 6 * dpr, 0); g.lineTo(x, 8 * dpr); g.fill();
};
let tlScrollDrag = null;
tlScroll.addEventListener('pointerdown', (e) => {
  e.stopPropagation(); e.preventDefault();
  const D = player.duration(), r = tlScroll.getBoundingClientRect(), [v0, v1] = tlView(D);
  if (e.target === tlScroll) tlStart = ((e.clientX - r.left) / r.width) * D - (v1 - v0) / 2; // click the track: jump there
  tlManual = performance.now(); tlScroll.classList.add('dragging');
  tlScrollDrag = { x: e.clientX, s: tlStart, w: r.width, D };
  tlScroll.setPointerCapture(e.pointerId);
  tlView(D); drawTimeline(player.now(), D);
});
tlScroll.addEventListener('pointermove', (e) => {
  if (!tlScrollDrag) return;
  if (!(e.buttons & 1)) { tlScrollDrag = null; return; }
  tlStart = tlScrollDrag.s + ((e.clientX - tlScrollDrag.x) / tlScrollDrag.w) * tlScrollDrag.D; tlManual = performance.now();
  tlView(tlScrollDrag.D); drawTimeline(player.now(), tlScrollDrag.D);
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) tlScroll.addEventListener(ev, () => { tlScrollDrag = null; tlScroll.classList.remove('dragging'); tlManual = performance.now(); });

// ---- + Own clip: your own video from anywhere (Find clips, your PC, or dropped on the timeline), put in at the playhead ----
const ownBtn = document.createElement('button');
ownBtn.className = 'small own-add'; ownBtn.id = 'btnOwnClip';
ownBtn.textContent = '+ Own clip';
ownBtn.title = 'Put your own video into the edit at the playhead: from your PC, from Find clips, or drop a video file on the timeline';
$('#btnAddCut').insertAdjacentElement('afterend', ownBtn);
const ownMenu = document.createElement('div');
ownMenu.className = 'add-menu own-menu'; ownMenu.hidden = true;
ownMenu.innerHTML = `<button data-own="pc">From my PC…<small>a video or photo</small></button>
  <button data-own="find">From Find clips…<small>movies, streams, viral, stock</small></button>
  <button data-own="gif">A GIF…<small>GIPHY reactions</small></button>
  <div class="own-tip">It goes in at the playhead. You can also drop a file on the timeline.</div>`;
ownBtn.insertAdjacentElement('afterend', ownMenu);
const ownFile = document.createElement('input');
ownFile.type = 'file'; ownFile.accept = 'video/*,image/*,.mkv,.mov'; ownFile.multiple = true; ownFile.hidden = true;
document.body.appendChild(ownFile);
let ownAt = 0;
ownBtn.onclick = (e) => { e.stopPropagation(); ownMenu.hidden = !ownMenu.hidden; };
document.addEventListener('pointerdown', (e) => { if (!ownMenu.hidden && !ownMenu.contains(e.target) && e.target !== ownBtn) ownMenu.hidden = true; });
ownMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-own]'); if (!b) return;
  ownMenu.hidden = true;
  if (b.dataset.own === 'find' || b.dataset.own === 'gif') {
    ownPending = { at: player.now(), until: Date.now() + 20 * 60e3 };
    if (b.dataset.own === 'gif') finder.openSource('movies', 'giphy'); else finder.open();
    toast(`What you add next goes into the edit at ${fmt(ownPending.at)}`);
    return;
  }
  ownAt = player.now(); ownFile.click();
});
// a new clip: wait until it's ready, then put it in the edit at that moment (each file after the one before)
async function insertOwn(files, at) {
  const before = new Set(state.clips.map((c) => c.id));
  addFiles(files, null, { preview: false });
  toast(`Adding ${files.length > 1 ? files.length + ' videos' : files[0].name}: it goes in at ${fmt(at)} as soon as it's ready`);
  for (let k = 0; k < 600; k++) {
    await sleep(300);
    const fresh = state.clips.filter((c) => !before.has(c.id));
    if (fresh.length && fresh.every((c) => c.status !== 'loading' && (c.status !== 'ready' || state.planClips.some((pc) => pc.id === c.id)))) {
      let t = at;
      for (const c of fresh) { if (c.status !== 'ready') continue; addCutAt(t, c.id); t = player.now(); }
      return;
    }
  }
}
ownFile.onchange = () => { const f = [...ownFile.files]; ownFile.value = ''; if (f.length) insertOwn(f, ownAt); };
tlw.addEventListener('dragover', (e) => { if (draggingFiles(e)) { e.preventDefault(); e.stopPropagation(); tlw.classList.add('drop-here'); } });
tlw.addEventListener('dragleave', () => tlw.classList.remove('drop-here'));
tlw.addEventListener('drop', (e) => {
  if (!draggingFiles(e)) return;
  e.preventDefault(); e.stopPropagation(); tlw.classList.remove('drop-here');
  document.body.classList.remove('dragging'); dragDepth = 0;
  const files = [...e.dataTransfer.files].filter((f) => VIDEO_EXT.test(f.name) || IMAGE_EXT.test(f.name) || /^video\//.test(f.type));
  if (!files.length) return toast('Drop a video file on the timeline');
  insertOwn(files, tlTime(e));
});

// first run: the walkthrough, then what to install; Settings → Help
try { initOnboarding(); } catch (e) { console.warn('onboarding', e); }

// ---------------- QUICK MODE: Topic to video and Long video to clips, on their own page ----------------
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
const topicVid = initTopicVideo({ toast, mount: $('#qvTopicWork'), settings: $('#quickSide'), side: $('#quickProjects'), pick, filterChips, strSel,
  openFinder: (tab, onPick) => finder.open(tab, onPick),
  addToEdit: async (job, mode = 'edits') => {
    if (job.pid) {
      const response = await fetch('/api/doc/transfer?' + new URLSearchParams({ id: job.pid }));
      const project = await response.json();
      if (!response.ok) throw new Error(project.error || 'Could not open the Quick project.');
      const doc = quickToEditor(project, mode, job.focus);
      const saved = await projects.transfer(project.title, doc);
      if (!saved) throw new Error('The takes opened, but Cutsona could not save the transferred project.');
      toast(`Opened ${doc.takes.length} existing take${doc.takes.length === 1 ? '' : 's'} in ${mode === 'stream' ? 'Clipper' : 'Edit'} Mode.`);
    } else {
      const url = new URL(job.url, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith('/exports/')) throw new Error('The local export is missing.');
      const name = decodeURIComponent(url.pathname.slice('/exports/'.length));
      await projects.transfer(job.name, { settings: { mode }, clips: [{ id: 'q' + Date.now(), name, url: url.pathname, src: { export: name } }],
        takes: [{ styleId: 'beat', seed: 1, custom: {} }] });
    }
} });
const flushEditorOnClose = window.__cutsonaFlush;
window.__cutsonaFlush = async () => { await topicVid.flush(); await flushEditorOnClose(); };
function quickTab(t) {
  LS('cutsona.qvTab', t);
  document.querySelectorAll('#quickView .qv-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.qt === t));
  document.querySelectorAll('#quickView .qv-body').forEach((b) => { b.hidden = b.dataset.qt !== t; });
  $('#quickSide').hidden = t !== 'topic';
  $('#quickLongSide').hidden = t !== 'long';
  $('#quickView').scrollTop = 0;
  if (t !== 'topic') topicVid.pause();
}
document.querySelectorAll('#quickView .qv-tabs button').forEach((b) => { b.onclick = () => { if (b.dataset.qt !== 'long') longVideo.pause(); quickTab(b.dataset.qt); }; });
quickTab(LS('cutsona.qvTab') === 'long' ? 'long' : 'topic');

const longVideo = initLongVideo({ mount: $('#qvLong'), sidebar: $('#quickLongSide'), toast, esc, LS, pick, filterChips,
  openFinder: (...args) => finder.open(...args) });
quickApi = { ...topicVid, pause: () => { topicVid.pause(); longVideo.pause(); } };
if (state.settings.mode === 'quick') topicVid.open();

// strong words (VADER, open source): emotional lines rank higher as quotes and highlights
loadLexicon().then(() => { if (state.clips.length) replanSoon(); }).catch(() => {});
