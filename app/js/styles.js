// Edit styles. Each variant uses one of these as its "recipe".
// cutBeats: weights for how many beats a shot lasts. trans: weighted transition picks.
// fx: extra shader effects that stay on for the whole edit (see FX_KEYS).
export const STYLES = {
  dimension: {
    name: 'Dimension', color: '#8b7bff', desc: '3D card tilt, flips, echo trails',
    cutBeats: { 2: 0.55, 4: 0.35, 1: 0.1 },
    speed: [{ type: 'const', r: 1, p: 0.7 }, { type: 'const', r: 0.6, p: 0.15 }, { type: 'velocity', lo: 0.4, hi: 2.0, p: 0.15 }],
    trans: { flip: 0.45, zoom: 0.2, spin: 0.15, whip: 0.2 }, impactTrans: { flash: 0.5, flip: 0.5 }, transDur: 0.34,
    beat: { punch: 0.07, tilt: 0.2, rgb: 0.003, decay: 0.16 },
    impact: { flash: 0.55, punch: 0.12, rgb: 0.01 },
    cont: { card: 0.86, orbit: 0.16, bassZoom: 0.035, ghosts: 1, glow: 0.35, round: 0.025, shadow: 0.6 },
    look: { contrast: 1.12, sat: 1.18, tint: [0.96, 1.0, 1.08], vignette: 0.35, grain: 0.025 },
  },
  velocity: {
    name: 'Velocity', color: '#ff5d8f', desc: 'Speed ramps, whip pans, motion blur',
    cutBeats: { 2: 0.5, 4: 0.4, 1: 0.1 },
    speed: [{ type: 'velocity', lo: 0.3, hi: 2.6, p: 0.6 }, { type: 'ramp', from: 2.4, to: 0.35, p: 0.25 }, { type: 'const', r: 1, p: 0.15 }],
    trans: { whip: 0.6, zoom: 0.25, flash: 0.15 }, impactTrans: { flash: 0.6, zoom: 0.4 }, transDur: 0.3,
    beat: { punch: 0.085, shake: 0.004, decay: 0.14 },
    impact: { flash: 0.7, punch: 0.15, shake: 0.012 },
    cont: { card: 1, bassZoom: 0.03, push: 0.06 },
    look: { contrast: 1.25, sat: 1.22, tint: [1.04, 1.0, 0.95], vignette: 0.4, grain: 0.02 },
  },
  glitch: {
    name: 'Glitch', color: '#3df5ff', desc: 'RGB split, stutters, datamosh blocks',
    cutBeats: { 1: 0.45, 2: 0.45, 4: 0.1 },
    speed: [{ type: 'const', r: 1, p: 0.6 }, { type: 'stutter', r: 1, q: 0.12, until: 0.5, p: 0.3 }, { type: 'const', r: 1.5, p: 0.1 }],
    trans: { glitch: 0.5, rgb: 0.3, cut: 0.2 }, impactTrans: { glitch: 0.6, flash: 0.4 }, transDur: 0.26,
    beat: { rgb: 0.014, glitch: 0.55, punch: 0.04, decay: 0.12 },
    impact: { invert: 1, rgb: 0.035, glitch: 1 },
    cont: { card: 1, bassZoom: 0.02 },
    look: { contrast: 1.18, sat: 0.95, tint: [0.98, 1.0, 1.1], vignette: 0.3, grain: 0.08, scan: 0.22 },
  },
  impact: {
    name: 'Impact', color: '#ffb02e', desc: 'Camera shake, punch zooms, flash cuts',
    cutBeats: { 1: 0.3, 2: 0.55, 4: 0.15 },
    speed: [{ type: 'const', r: 1, p: 0.75 }, { type: 'ramp', from: 1.8, to: 0.4, p: 0.25 }],
    trans: { flash: 0.4, cut: 0.25, shake: 0.2, zoom: 0.15 }, impactTrans: { flash: 1 }, transDur: 0.24,
    beat: { punch: 0.11, shake: 0.022, flashDown: 0.25, decay: 0.13 },
    impact: { flash: 0.9, shake: 0.05, punch: 0.2, bw: 1 },
    cont: { card: 1, bassZoom: 0.05 },
    look: { contrast: 1.3, sat: 1.1, vignette: 0.55, grain: 0.04 },
  },
  cinematic: {
    name: 'Cinematic', color: '#e8c48a', desc: 'Slow push-ins, warm cinematic grade',
    cutBeats: { 4: 0.5, 8: 0.4, 2: 0.1 },
    speed: [{ type: 'const', r: 1, p: 0.6 }, { type: 'const', r: 0.55, p: 0.3 }, { type: 'ramp', from: 1.2, to: 0.5, p: 0.1 }],
    trans: { blur: 0.45, dip: 0.3, zoom: 0.25 }, impactTrans: { dip: 0.5, flash: 0.5 }, transDur: 0.5,
    beat: { punch: 0.018, decay: 0.3 },
    impact: { flash: 0.35, punch: 0.04 },
    cont: { card: 1, push: 0.09, bars: 0.11, glow: 0.25 },
    look: { contrast: 1.12, sat: 0.92, tint: [1.08, 1.0, 0.9], vignette: 0.5, grain: 0.05 },
  },
  kaleido: {
    name: 'Kaleido', color: '#b6ff5c', desc: 'Mirror worlds, spins, hue shifts',
    cutBeats: { 2: 0.6, 4: 0.3, 1: 0.1 },
    speed: [{ type: 'const', r: 1, p: 0.6 }, { type: 'velocity', lo: 0.4, hi: 2.0, p: 0.4 }],
    trans: { spin: 0.5, zoom: 0.3, flip: 0.2 }, impactTrans: { spin: 0.5, flash: 0.5 }, transDur: 0.32,
    beat: { punch: 0.06, rgb: 0.006, decay: 0.15 },
    impact: { flash: 0.5, rgb: 0.02, punch: 0.1 },
    cont: { card: 1, bassZoom: 0.04, mirrorChance: 0.55, hueSpeed: 0.0, glow: 0.3 },
    look: { contrast: 1.15, sat: 1.35, vignette: 0.3, grain: 0.02 },
  },
  strobe: {
    name: 'Strobe', color: '#f2f2f2', desc: 'B&W strobe on beats, hard shake',
    cutBeats: { 1: 0.5, 2: 0.4, 4: 0.1 },
    speed: [{ type: 'const', r: 1, p: 0.8 }, { type: 'stutter', r: 1, q: 0.1, until: 0.4, p: 0.2 }],
    trans: { flash: 0.5, cut: 0.3, shake: 0.2 }, impactTrans: { flash: 1 }, transDur: 0.2,
    beat: { punch: 0.07, shake: 0.016, bwAlt: 1, decay: 0.12 },
    impact: { invert: 1, shake: 0.04, flash: 0.6 },
    cont: { card: 1, bassZoom: 0.04 },
    look: { contrast: 1.45, sat: 1.05, vignette: 0.5, grain: 0.06 },
  },
  zoom: {
    name: 'Zoom', color: '#ff7a3d', desc: 'Zoom-blur transitions, bass bounce',
    cutBeats: { 2: 0.6, 1: 0.2, 4: 0.2 },
    speed: [{ type: 'const', r: 1, p: 0.7 }, { type: 'velocity', lo: 0.45, hi: 1.9, p: 0.3 }],
    trans: { zoom: 0.55, zoomOut: 0.3, rgb: 0.15 }, impactTrans: { zoom: 0.5, flash: 0.5 }, transDur: 0.3,
    beat: { punch: 0.1, decay: 0.15 },
    impact: { flash: 0.5, punch: 0.18, rgb: 0.012 },
    cont: { card: 1, bassZoom: 0.06, glow: 0.2 },
    look: { contrast: 1.15, sat: 1.3, vignette: 0.35, grain: 0.02 },
  },
  retro: {
    name: 'Retro VHS', color: '#ff9de2', desc: 'VHS color bleed, tracking glitches, CRT screen',
    cutBeats: { 2: 0.5, 4: 0.35, 1: 0.15 },
    speed: [{ type: 'const', r: 1, p: 0.75 }, { type: 'stutter', r: 1, q: 0.12, until: 0.4, p: 0.25 }],
    trans: { glitch: 0.4, cut: 0.3, rgb: 0.3 }, impactTrans: { glitch: 0.6, flash: 0.4 }, transDur: 0.26,
    beat: { rgb: 0.008, glitch: 0.25, punch: 0.03, decay: 0.14 },
    impact: { rgb: 0.03, glitch: 1, flash: 0.3 },
    cont: { card: 1, bassZoom: 0.02 },
    look: { contrast: 1.05, sat: 1.25, tint: [1.05, 0.98, 1.05], vignette: 0.4, grain: 0.07, scan: 0.3 },
    fx: { bleed: 1, crt: 0.35 },
  },
  neon: {
    name: 'Neon', color: '#c04bff', desc: 'Glowing outlines, color cycling, bass pulses',
    cutBeats: { 2: 0.55, 1: 0.25, 4: 0.2 },
    speed: [{ type: 'const', r: 1, p: 0.7 }, { type: 'velocity', lo: 0.45, hi: 1.9, p: 0.3 }],
    trans: { zoom: 0.4, rgb: 0.3, spin: 0.3 }, impactTrans: { flash: 0.5, zoom: 0.5 }, transDur: 0.3,
    beat: { punch: 0.08, rgb: 0.008, decay: 0.15 },
    impact: { flash: 0.5, punch: 0.14, rgb: 0.02 },
    cont: { card: 1, bassZoom: 0.05, glow: 0.5, hueSpeed: 0.6 },
    look: { contrast: 1.2, sat: 1.4, vignette: 0.45, grain: 0.02 },
    fx: { edge: 0.85 },
  },
  film: {
    name: 'Old Film', color: '#d9b77e', desc: 'Sepia, dust, scratches, light leaks',
    cutBeats: { 4: 0.5, 2: 0.35, 8: 0.15 },
    speed: [{ type: 'const', r: 1, p: 0.7 }, { type: 'const', r: 0.6, p: 0.3 }],
    trans: { dip: 0.45, blur: 0.35, cut: 0.2 }, impactTrans: { flash: 0.6, dip: 0.4 }, transDur: 0.45,
    beat: { punch: 0.02, decay: 0.3 },
    impact: { flash: 0.4, punch: 0.05 },
    cont: { card: 1, push: 0.07, bars: 0.08 },
    look: { contrast: 1.0, sat: 0.85, vignette: 0.6, grain: 0.09 },
    fx: { sepia: 0.6, film: 1, leak: 0.35 },
  },
  dreamy: {
    name: 'Dreamy', color: '#ffc4e8', desc: 'Soft glow, light leaks, slow motion',
    cutBeats: { 4: 0.55, 2: 0.3, 8: 0.15 },
    speed: [{ type: 'const', r: 1, p: 0.5 }, { type: 'const', r: 0.55, p: 0.4 }, { type: 'ramp', from: 1.2, to: 0.5, p: 0.1 }],
    trans: { blur: 0.5, dip: 0.2, zoom: 0.3 }, impactTrans: { flash: 0.6, blur: 0.4 }, transDur: 0.55,
    beat: { punch: 0.02, decay: 0.35 },
    impact: { flash: 0.45, punch: 0.05 },
    cont: { card: 1, push: 0.06, glow: 0.9 },
    look: { contrast: 0.92, sat: 1.15, tint: [1.05, 0.98, 1.04], vignette: 0.3, grain: 0.02, bright: 0.03 },
    fx: { leak: 0.45 },
  },
  comic: {
    name: 'Comic', color: '#ffe14d', desc: 'Halftone dots, ink outlines, punchy cuts',
    cutBeats: { 2: 0.5, 1: 0.3, 4: 0.2 },
    speed: [{ type: 'const', r: 1, p: 0.8 }, { type: 'ramp', from: 1.8, to: 0.4, p: 0.2 }],
    trans: { flash: 0.35, zoom: 0.35, shake: 0.3 }, impactTrans: { flash: 1 }, transDur: 0.24,
    beat: { punch: 0.1, shake: 0.012, decay: 0.13 },
    impact: { flash: 0.7, punch: 0.2, shake: 0.03 },
    cont: { card: 1, bassZoom: 0.04 },
    look: { contrast: 1.3, sat: 1.35, vignette: 0.2 },
    fx: { halftone: 0.7, ink: 0.85, poster: 6 },
  },
  quake: {
    name: 'Earthquake', color: '#ff4d4d', desc: 'Heavy shake, chromatic hits, zoom slams',
    cutBeats: { 1: 0.4, 2: 0.45, 4: 0.15 },
    speed: [{ type: 'const', r: 1, p: 0.8 }, { type: 'stutter', r: 1, q: 0.1, until: 0.4, p: 0.2 }],
    trans: { shake: 0.5, flash: 0.3, zoom: 0.2 }, impactTrans: { flash: 0.5, shake: 0.5 }, transDur: 0.22,
    beat: { punch: 0.12, shake: 0.04, rgb: 0.006, decay: 0.12 },
    impact: { flash: 0.8, shake: 0.09, punch: 0.25, rgb: 0.03 },
    cont: { card: 1, bassZoom: 0.07 },
    look: { contrast: 1.35, sat: 1.15, vignette: 0.55, grain: 0.04 },
  },
  pixel: {
    name: '8-Bit', color: '#5dff9a', desc: 'Pixel art, retro colors, glitch steps',
    cutBeats: { 1: 0.35, 2: 0.5, 4: 0.15 },
    speed: [{ type: 'const', r: 1, p: 0.7 }, { type: 'stutter', r: 1, q: 0.12, until: 0.5, p: 0.3 }],
    trans: { glitch: 0.4, cut: 0.4, rgb: 0.2 }, impactTrans: { glitch: 0.5, flash: 0.5 }, transDur: 0.22,
    beat: { punch: 0.06, decay: 0.13, pixelBeat: 0.03 },
    impact: { flash: 0.5, punch: 0.12, glitch: 1 },
    cont: { card: 1, bassZoom: 0.03 },
    look: { contrast: 1.2, sat: 1.35, vignette: 0.2 },
    fx: { pixel: 0.008, poster: 5 },
  },
  liquid: {
    name: 'Liquid', color: '#4dd8ff', desc: 'Wavy warps, fisheye drops, spins',
    cutBeats: { 2: 0.55, 4: 0.35, 1: 0.1 },
    speed: [{ type: 'const', r: 1, p: 0.6 }, { type: 'velocity', lo: 0.4, hi: 2.0, p: 0.4 }],
    trans: { spin: 0.4, zoom: 0.35, zoomOut: 0.25 }, impactTrans: { zoom: 0.5, flash: 0.5 }, transDur: 0.34,
    beat: { punch: 0.07, fishBeat: 0.35, decay: 0.16 },
    impact: { flash: 0.5, punch: 0.12, rgb: 0.015 },
    cont: { card: 1, bassZoom: 0.04, glow: 0.25 },
    look: { contrast: 1.15, sat: 1.3, tint: [0.95, 1.0, 1.08], vignette: 0.35, grain: 0.02 },
    fx: { wave: 0.8, fish: 0.15 },
  },
};

// ---- two more styles ----
STYLES.beat = {
  name: 'Simple Beat', color: '#d4ff3a', desc: 'Clean cuts on the beat',
  cutBeats: { 1: 0.35, 2: 0.55, 4: 0.1 },
  speed: [{ type: 'const', r: 1, p: 1 }],
  trans: { cut: 1 }, impactTrans: { cut: 0.6, flash: 0.4 }, transDur: 0.18,
  beat: { punch: 0.035, decay: 0.12 },
  impact: { flash: 0.45, punch: 0.06 },
  cont: { card: 1 },
  look: { contrast: 1.08, sat: 1.08, vignette: 0.2, grain: 0.01 },
};
// Beat Sync: the plain one. Hard cuts on the beat and nothing else: no zooms, flashes, shakes, filters or effects.
STYLES.pure = {
  name: 'Beat Sync', color: '#9dff6a', desc: 'Just cuts on the beat. No effects, no filter',
  cutBeats: { 1: 0.3, 2: 0.55, 4: 0.15 },
  speed: [{ type: 'const', r: 1, p: 1 }],
  trans: { cut: 1 }, impactTrans: { cut: 1 }, transDur: 0.1,
  beat: { decay: 0.12 }, impact: {},
  cont: { card: 1 },
  look: { contrast: 1, sat: 1 },
  pure: true,
};
STYLES.mosh = {
  name: 'Mosh', color: '#ff2bd6', desc: 'Datamosh smears, pixel displace, VHS tracking',
  cutBeats: { 1: 0.35, 2: 0.5, 4: 0.15 },
  speed: [{ type: 'const', r: 1, p: 0.75 }, { type: 'velocity', lo: 0.5, hi: 1.8, p: 0.25 }],
  trans: { glitch: 0.5, rgb: 0.25, cut: 0.25 }, impactTrans: { glitch: 0.6, flash: 0.4 }, transDur: 0.26,
  beat: { rgb: 0.006, punch: 0.05, moshBeat: 0.9, decay: 0.16 },
  impact: { flash: 0.4, rgb: 0.025, glitch: 0.8 },
  cont: { card: 1, bassZoom: 0.03 },
  look: { contrast: 1.15, sat: 1.25, vignette: 0.35, grain: 0.05, scan: 0.12 },
  fx: { pixdisp: 0.35, track: 0.5 },
};

// ---- next-level looks ----
STYLES.hyper = {
  name: 'Hyper Detail', color: '#00e5ff', desc: 'Extreme detail, crunchy color, shockwaves on the drops',
  cutBeats: { 1: 0.35, 2: 0.5, 4: 0.15 },
  speed: [{ type: 'const', r: 1, p: 0.7 }, { type: 'ramp', from: 1.9, to: 0.45, p: 0.3 }],
  trans: { cut: 0.5, zoom: 0.3, whip: 0.2 }, impactTrans: { flash: 0.5, zoom: 0.5 }, transDur: 0.26,
  beat: { punch: 0.06, shockBeat: 1, decay: 0.13 },
  impact: { flash: 0.4, punch: 0.12 },
  cont: { card: 1, bassZoom: 0.02 },
  look: { contrast: 1.16, sat: 1.08, vignette: 0.38, grain: 0.012, sharp: 0.6 },
  fx: { detail: 1, chroma: 0.55 },
};
STYLES.prism = {
  name: 'Prism Rush', color: '#ff7bf2', desc: 'Prism splits, slice glitches, whip cuts',
  cutBeats: { 1: 0.45, 2: 0.45, 4: 0.1 },
  speed: [{ type: 'const', r: 1, p: 0.65 }, { type: 'velocity', lo: 0.5, hi: 2.2, p: 0.35 }],
  trans: { whip: 0.45, cut: 0.35, rgb: 0.2 }, impactTrans: { flash: 0.4, glitch: 0.6 }, transDur: 0.26,
  beat: { punch: 0.05, sliceBeat: 1, decay: 0.14 },
  impact: { flash: 0.35, punch: 0.1, rgb: 0.02 },
  cont: { card: 1, bassZoom: 0.03 },
  look: { contrast: 1.15, sat: 1.3, vignette: 0.3, grain: 0.02 },
  fx: { prism: 0.55 },
};

// ---- edits like the popular movie / TV edit accounts ----
// Movie Edit: hold one moment (a line of dialogue if there is one) while the song builds, cut on the drop,
// then a new shot on EVERY beat with clean hard cuts, in story order, natural look, fade to black at the end.
STYLES.movie = {
  name: 'Movie Edit', color: '#f2efe6', desc: 'Holds a moment until the drop, then a new shot on every beat',
  cutBeats: { 1: 1 },
  speed: [{ type: 'const', r: 1, p: 1 }],
  trans: { cut: 1 }, impactTrans: { cut: 1 }, transDur: 0.1,
  beat: { punch: 0, decay: 0.1 }, impact: { flash: 0, punch: 0 },
  cont: { card: 1 },
  look: { contrast: 1.07, sat: 1.04, vignette: 0.14, grain: 0.012, sharp: 0.25 },
  intro: { min: 3.2, max: 6.5 }, endFade: 0.8, voiceCaptions: true,
  everyBeat: true,        // never slow the cutting down in quiet parts
  speechOnlyIntro: true,  // dialogue is kept whole in the opening hold only; after the drop it's a music edit
  // what a new edit card with this style starts with (still changeable per edit, and main settings override)
  defaults: { order: 'story', captions: 'on', captionStyle: 'movie_sub', captionFont: 'segoe' },
};
// Caption Edit: dialogue-led edit, each line played in full with big bold-italic sentence captions,
// punchy "CC" look (contrast, color, sharpen), clean cuts with an occasional motion-blur whip.
STYLES.captionedit = {
  name: 'Caption Edit', color: '#ffffff', desc: 'Dialogue in full, bold sentence captions, punchy CC look',
  cutBeats: { 2: 0.6, 1: 0.25, 4: 0.15 },
  speed: [{ type: 'const', r: 1, p: 1 }],
  trans: { cut: 0.85, whip: 0.15 }, impactTrans: { cut: 0.6, whip: 0.4 }, transDur: 0.22,
  beat: { punch: 0, decay: 0.12 }, impact: { punch: 0.035, shake: 0.008 },
  cont: { card: 1 },
  look: { contrast: 1.24, sat: 1.28, vignette: 0.22, grain: 0.01, sharp: 0.9 },
  endFade: 0.5,
  defaults: { pick: 'quotes', captions: 'on', captionStyle: 'edit_caps', captionFont: 'franklin' },
};

// Per-style details: `run` = beats per source moment (so each style cuts to new footage at its own rhythm),
// `parts` = the style's signature effects, which can be ticked on/off on each edit card.
const META = {
  pure: { run: 2, parts: [] },
  hyper: { run: 3, parts: [['detail', 'extreme detail'], ['shock', 'shockwave drops'], ['chroma', 'color boost']] },
  prism: { run: 2, parts: [['prism', 'prism split'], ['slice', 'slice glitch'], ['whip', 'whip pans']] },
  beat: { run: 2, parts: [['punch', 'beat zoom'], ['flash', 'flash on drops']] },
  dimension: { run: 6, parts: [['tilt', '3D card tilt'], ['flips', 'flips'], ['echo', 'echo trails']] },
  velocity: { run: 4, parts: [['speed', 'speed ramps'], ['whip', 'whip pans'], ['blur', 'motion blur']] },
  glitch: { run: 2, desc: 'RGB split, datamosh blocks, invert hits', parts: [['rgb', 'RGB split'], ['glitch', 'datamosh blocks'], ['invert', 'invert hits']] },
  impact: { run: 4, parts: [['shake', 'camera shake'], ['punch', 'punch zooms'], ['flash', 'flash cuts']] },
  cinematic: { run: 12, parts: [['push', 'slow push-ins'], ['grade', 'warm grade'], ['glow', 'soft glow']] },
  kaleido: { run: 4, parts: [['mirror', 'mirror worlds'], ['spin', 'spins'], ['hue', 'hue shifts']] },
  strobe: { run: 2, parts: [['strobe', 'B&W strobe'], ['shake', 'hard shake'], ['invert', 'invert hits']] },
  zoom: { run: 4, parts: [['zoomblur', 'zoom-blur transitions'], ['bass', 'bass bounce'], ['punch', 'punch zooms']] },
  retro: { run: 4, parts: [['bleed', 'VHS color bleed'], ['glitch', 'tracking glitches'], ['crt', 'CRT screen']] },
  neon: { run: 4, parts: [['edge', 'glowing outlines'], ['hue', 'color cycling'], ['bass', 'bass pulses']] },
  film: { run: 8, parts: [['sepia', 'sepia'], ['film', 'dust & scratches'], ['leak', 'light leaks']] },
  dreamy: { run: 8, parts: [['glow', 'soft glow'], ['leak', 'light leaks'], ['speed', 'slow motion']] },
  comic: { run: 3, parts: [['halftone', 'halftone dots'], ['ink', 'ink outlines'], ['punch', 'punchy zooms']] },
  quake: { run: 2, parts: [['shake', 'heavy shake'], ['rgb', 'chromatic hits'], ['punch', 'zoom slams']] },
  pixel: { run: 2, parts: [['pixel', 'pixel art'], ['poster', 'retro colors'], ['glitch', 'glitch steps']] },
  liquid: { run: 4, parts: [['wave', 'wavy warps'], ['fish', 'fisheye drops'], ['spin', 'spins']] },
  mosh: { run: 3, parts: [['mosh', 'datamosh smears'], ['pixdisp', 'pixel displace'], ['track', 'VHS tracking']] },
  movie: { run: 1, parts: [['intro', 'hold until the drop'], ['every', 'new shot every beat'], ['fadeend', 'fade to black']] },
  captionedit: { run: 2, parts: [['sharp', 'CC sharpen'], ['grade', 'punchy color'], ['whip', 'motion-blur whips'], ['fadeend', 'fade to black']] },
};
for (const [k, m] of Object.entries(META)) Object.assign(STYLES[k], m);
STYLES.kaleido.cont.hueSpeed = 0.25;

// What switching a part OFF does to a (copied) style
const dropTrans = (s, ...types) => {
  for (const o of [s.trans, s.impactTrans]) { for (const t of types) delete o[t]; if (!Object.keys(o).length) o.cut = 1; }
};
const fxOff = (...keys) => (s) => { s.fx = { ...(s.fx || {}) }; for (const k of keys) s.fx[k] = 0; };
const PART_OFF = {
  tilt: (s) => { s.cont.card = 1; s.cont.orbit = 0; s.beat.tilt = 0; s.cont.round = 0; s.cont.shadow = 0; },
  flips: (s) => dropTrans(s, 'flip'),
  echo: (s) => { s.cont.ghosts = 0; },
  speed: (s) => { s.speed = [{ type: 'const', r: 1, p: 1 }]; },
  whip: (s) => dropTrans(s, 'whip'),
  blur: (s) => { s.noBlur = true; },
  rgb: (s) => { s.beat.rgb = 0; s.impact.rgb = 0; dropTrans(s, 'rgb'); s.noRgb = true; },
  glitch: (s) => { s.beat.glitch = 0; s.impact.glitch = 0; dropTrans(s, 'glitch'); },
  invert: (s) => { s.impact.invert = 0; },
  shake: (s) => { s.beat.shake = 0; s.impact.shake = 0; dropTrans(s, 'shake'); },
  punch: (s) => { s.beat.punch = 0; s.impact.punch = 0; },
  flash: (s) => { s.impact.flash = 0; s.beat.flashDown = 0; dropTrans(s, 'flash'); },
  push: (s) => { s.cont.push = 0; },
  grade: (s) => { s.look = { contrast: 1, sat: 1, vignette: s.look.vignette || 0, grain: s.look.grain || 0, scan: s.look.scan || 0 }; },
  vignette: (s) => { s.look = { ...s.look, vignette: 0 }; },
  grain: (s) => { s.look = { ...s.look, grain: 0, scan: 0 }; },
  bw: (s) => { s.impact.bw = 0; },
  dip: (s) => dropTrans(s, 'dip'),
  blurtrans: (s) => dropTrans(s, 'blur'),
  glow: (s) => { s.cont.glow = 0; },
  mirror: (s) => { s.cont.mirrorChance = 0; },
  spin: (s) => dropTrans(s, 'spin'),
  hue: (s) => { s.cont.hueSpeed = 0; },
  strobe: (s) => { s.beat.bwAlt = 0; },
  zoomblur: (s) => dropTrans(s, 'zoom', 'zoomOut'),
  bass: (s) => { s.cont.bassZoom = 0; },
  pixel: (s) => { fxOff('pixel')(s); s.beat.pixelBeat = 0; },
  fish: (s) => { fxOff('fish')(s); s.beat.fishBeat = 0; },
  mosh: (s) => { s.beat.moshBeat = 0; },
  sharp: (s) => { s.look = { ...s.look, sharp: 0 }; },
  intro: (s) => { s.intro = null; },
  every: (s) => { s.cutBeats = { 2: 0.6, 1: 0.25, 4: 0.15 }; s.run = 2; s.everyBeat = false; },
  fadeend: (s) => { s.endFade = 0; },
};
for (const k of ['bleed', 'crt', 'edge', 'sepia', 'film', 'leak', 'halftone', 'ink', 'poster', 'wave', 'pixdisp', 'track',
  'detail', 'chroma', 'prism', 'thermal', 'sketch', 'dither']) PART_OFF[k] = fxOff(k);
PART_OFF.shock = (s) => { s.beat.shockBeat = 0; fxOff('shock')(s); };
PART_OFF.slice = (s) => { s.beat.sliceBeat = 0; fxOff('slice')(s); };

// EVERY effect a style uses, so each one can be ticked off: the style's signature parts first (with
// their own names), then everything else it does — transitions, beat hits, look, built-in filters.
const hasT = (s, ...t) => t.some((k) => (s.trans[k] || 0) > 0 || (s.impactTrans[k] || 0) > 0);
const moving = (s) => s.speed.some((x) => x.type !== 'const' || Math.abs((x.r ?? 1) - 1) > 0.01);
const COMPONENTS = [
  ['speed', 'speed ramps & slow-mo', moving],
  ['tilt', '3D card tilt', (s) => (s.cont.card ?? 1) < 1 || s.cont.orbit || s.beat.tilt],
  ['flips', 'flip transitions', (s) => hasT(s, 'flip')],
  ['whip', 'whip pans', (s) => hasT(s, 'whip')],
  ['spin', 'spin transitions', (s) => hasT(s, 'spin')],
  ['zoomblur', 'zoom transitions', (s) => hasT(s, 'zoom', 'zoomOut')],
  ['dip', 'dip to black', (s) => hasT(s, 'dip')],
  ['blurtrans', 'blur transitions', (s) => hasT(s, 'blur')],
  ['blur', 'motion blur', (s) => hasT(s, 'whip', 'zoom', 'zoomOut', 'spin', 'blur') || s.speed.some((x) => x.type === 'velocity' || x.type === 'ramp')],
  ['punch', 'beat zooms', (s) => s.beat.punch || s.impact.punch],
  ['bass', 'bass bounce', (s) => s.cont.bassZoom],
  ['push', 'slow push-ins', (s) => s.cont.push],
  ['flash', 'flashes', (s) => s.impact.flash || s.beat.flashDown || hasT(s, 'flash')],
  ['shake', 'camera shake', (s) => s.beat.shake || s.impact.shake || hasT(s, 'shake')],
  ['rgb', 'RGB split', (s) => s.beat.rgb || s.impact.rgb || hasT(s, 'rgb')],
  ['glitch', 'glitches', (s) => s.beat.glitch || s.impact.glitch || hasT(s, 'glitch')],
  ['invert', 'invert hits', (s) => s.impact.invert],
  ['bw', 'B&W hits', (s) => s.impact.bw],
  ['strobe', 'B&W strobe', (s) => s.beat.bwAlt],
  ['echo', 'echo trails', (s) => s.cont.ghosts],
  ['glow', 'glow', (s) => s.cont.glow],
  ['mirror', 'mirror', (s) => s.cont.mirrorChance],
  ['hue', 'color cycling', (s) => s.cont.hueSpeed],
  ['pixel', 'pixel art', (s) => s.fx?.pixel || s.beat.pixelBeat],
  ['poster', 'retro colors', (s) => s.fx?.poster],
  ['fish', 'fisheye', (s) => s.fx?.fish || s.beat.fishBeat],
  ['wave', 'wavy warps', (s) => s.fx?.wave],
  ['mosh', 'datamosh smears', (s) => s.beat.moshBeat],
  ['pixdisp', 'pixel displace', (s) => s.fx?.pixdisp],
  ['track', 'VHS tracking', (s) => s.fx?.track],
  ['bleed', 'VHS color bleed', (s) => s.fx?.bleed],
  ['crt', 'CRT screen', (s) => s.fx?.crt],
  ['edge', 'glowing outlines', (s) => s.fx?.edge],
  ['halftone', 'halftone dots', (s) => s.fx?.halftone],
  ['ink', 'ink outlines', (s) => s.fx?.ink],
  ['sepia', 'sepia', (s) => s.fx?.sepia],
  ['film', 'dust & scratches', (s) => s.fx?.film],
  ['leak', 'light leaks', (s) => s.fx?.leak],
  ['detail', 'extreme detail', (s) => s.fx?.detail],
  ['chroma', 'color boost', (s) => s.fx?.chroma],
  ['prism', 'prism split', (s) => s.fx?.prism],
  ['slice', 'slice glitch', (s) => s.fx?.slice || s.beat.sliceBeat],
  ['shock', 'shockwave drops', (s) => s.beat.shockBeat],
  ['thermal', 'thermal camera', (s) => s.fx?.thermal],
  ['sketch', 'pencil sketch', (s) => s.fx?.sketch],
  ['dither', '1-bit dither', (s) => s.fx?.dither],
  ['sharp', 'sharpen', (s) => s.look.sharp > 0],
  ['fadeend', 'fade to black', (s) => s.endFade > 0],
  ['grade', 'color grade', (s) => Math.abs((s.look.contrast ?? 1) - 1) > 0.02 || Math.abs((s.look.sat ?? 1) - 1) > 0.02 || s.look.tint || s.look.bright],
  ['vignette', 'dark corners', (s) => s.look.vignette > 0],
  ['grain', 'film grain', (s) => s.look.grain > 0 || s.look.scan > 0],
];
export function styleParts(styleId) {
  const s = STYLES[styleId] || STYLES.dimension;
  const out = [...(s.parts || [])], have = new Set(out.map((p) => p[0]));
  for (const [k, label, uses] of COMPONENTS) if (!have.has(k) && uses(s)) { out.push([k, label]); have.add(k); }
  return out;
}

// Every effect in the list, whether this style uses it or not (the ones it doesn't use start unticked and
// can be switched on: they're stored in the same list as '+key')
export function allParts(styleId) {
  const own = styleParts(styleId), have = new Set(own.map((p) => p[0]));
  const out = own.map(([k, l]) => ({ key: k, label: l, native: true }));
  for (const [k, l] of COMPONENTS) if (!have.has(k) && PART_ON[k]) { out.push({ key: k, label: l, native: false }); have.add(k); }
  return out;
}
// What switching an effect ON does to a (copied) style that doesn't have it
const addTrans = (s, t, w) => {
  for (const o of [s.trans, s.impactTrans]) {
    if (o.cut) o.cut = Math.max(0.2, o.cut * 0.6);
    o[t] = Math.max(o[t] || 0, w);
  }
  s.transDur = Math.max(s.transDur || 0.1, 0.26);
};
const fxOn = (k, v) => (s) => { s.fx = { ...(s.fx || {}), [k]: Math.max(s.fx?.[k] || 0, v) }; };
const PART_ON = {
  speed: (s) => { s.speed = [{ type: 'velocity', lo: 0.45, hi: 2.0, p: 0.45 }, { type: 'ramp', from: 2.2, to: 0.45, p: 0.25 }, { type: 'const', r: 1, p: 0.3 }]; },
  tilt: (s) => { s.cont.card = Math.min(s.cont.card ?? 1, 0.88); s.cont.orbit = Math.max(s.cont.orbit || 0, 0.12); s.beat.tilt = Math.max(s.beat.tilt || 0, 0.15); s.cont.round = Math.max(s.cont.round || 0, 0.025); s.cont.shadow = Math.max(s.cont.shadow || 0, 0.6); },
  flips: (s) => addTrans(s, 'flip', 0.35),
  whip: (s) => addTrans(s, 'whip', 0.35),
  spin: (s) => addTrans(s, 'spin', 0.25),
  zoomblur: (s) => addTrans(s, 'zoom', 0.35),
  dip: (s) => addTrans(s, 'dip', 0.2),
  blurtrans: (s) => addTrans(s, 'blur', 0.3),
  blur: (s) => { s.noBlur = false; if (!['whip', 'zoom', 'zoomOut', 'spin', 'blur'].some((t) => s.trans[t])) addTrans(s, 'whip', 0.25); },
  punch: (s) => { s.beat.punch = Math.max(s.beat.punch || 0, 0.07); s.impact.punch = Math.max(s.impact.punch || 0, 0.12); },
  bass: (s) => { s.cont.bassZoom = Math.max(s.cont.bassZoom || 0, 0.035); },
  push: (s) => { s.cont.push = Math.max(s.cont.push || 0, 0.06); },
  flash: (s) => { s.impact.flash = Math.max(s.impact.flash || 0, 0.6); s.beat.flashDown = Math.max(s.beat.flashDown || 0, 0.2); },
  shake: (s) => { s.beat.shake = Math.max(s.beat.shake || 0, 0.012); s.impact.shake = Math.max(s.impact.shake || 0, 0.018); },
  rgb: (s) => { s.beat.rgb = Math.max(s.beat.rgb || 0, 0.008); s.impact.rgb = Math.max(s.impact.rgb || 0, 0.02); s.noRgb = false; },
  glitch: (s) => { s.beat.glitch = Math.max(s.beat.glitch || 0, 0.3); s.impact.glitch = Math.max(s.impact.glitch || 0, 0.8); },
  invert: (s) => { s.impact.invert = 1; },
  bw: (s) => { s.impact.bw = 1; },
  strobe: (s) => { s.beat.bwAlt = 1; },
  echo: (s) => { s.cont.ghosts = 1; },
  glow: (s) => { s.cont.glow = Math.max(s.cont.glow || 0, 0.5); },
  mirror: (s) => { s.cont.mirrorChance = Math.max(s.cont.mirrorChance || 0, 0.3); },
  hue: (s) => { s.cont.hueSpeed = Math.max(s.cont.hueSpeed || 0, 0.25); },
  pixel: (s) => { s.beat.pixelBeat = Math.max(s.beat.pixelBeat || 0, 0.03); },
  poster: fxOn('poster', 6),
  fish: (s) => { s.beat.fishBeat = Math.max(s.beat.fishBeat || 0, 0.3); },
  wave: fxOn('wave', 0.6),
  mosh: (s) => { s.beat.moshBeat = Math.max(s.beat.moshBeat || 0, 0.8); },
  pixdisp: fxOn('pixdisp', 0.35), track: fxOn('track', 0.5), bleed: fxOn('bleed', 1), crt: fxOn('crt', 0.5), edge: fxOn('edge', 0.8),
  halftone: fxOn('halftone', 0.7), ink: fxOn('ink', 0.8), sepia: fxOn('sepia', 0.8), film: fxOn('film', 1), leak: fxOn('leak', 0.4),
  sharp: (s) => { s.look = { ...s.look, sharp: Math.max(s.look.sharp || 0, 0.8) }; },
  detail: fxOn('detail', 1), chroma: fxOn('chroma', 0.6), prism: fxOn('prism', 0.55), thermal: fxOn('thermal', 1), sketch: fxOn('sketch', 1), dither: fxOn('dither', 1),
  slice: (s) => { s.beat.sliceBeat = Math.max(s.beat.sliceBeat || 0, 1); },
  shock: (s) => { s.beat.shockBeat = Math.max(s.beat.shockBeat || 0, 1); },
  fadeend: (s) => { s.endFade = Math.max(s.endFade || 0, 0.8); },
  grade: (s) => { s.look = { ...s.look, contrast: 1.2, sat: 1.25 }; },
  vignette: (s) => { s.look = { ...s.look, vignette: Math.max(s.look.vignette || 0, 0.45) }; },
  grain: (s) => { s.look = { ...s.look, grain: Math.max(s.look.grain || 0, 0.05) }; },
};
// A copy of a style with some of its parts switched off ('key') or added ('+key'); used by planner + renderer so both agree
export function styleWith(styleId, off = []) {
  const base = STYLES[styleId] || STYLES.dimension;
  if (!off || !off.length) return base;
  const s = JSON.parse(JSON.stringify(base));
  for (const k of off) if (k[0] === '+' && PART_ON[k.slice(1)]) PART_ON[k.slice(1)](s);
  for (const k of off) if (PART_OFF[k]) PART_OFF[k](s);
  return s;
}

// take 1 is always the plain Beat Sync edit; the others are styled
export const DEFAULT_LINEUP = ['pure', 'movie', 'captionedit', 'velocity'];

// Shader effects that styles, filters and extra effects can switch on
export const FX_KEYS = ['pixel', 'poster', 'fish', 'wave', 'crt', 'kaleido', 'bleed', 'edge', 'ink', 'halftone', 'duo', 'sepia', 'leak', 'film', 'split',
  'pixdisp', 'print', 'stars', 'mosh', 'track', 'detail', 'thermal', 'sketch', 'dither', 'prism', 'slice', 'shock', 'chroma'];

// Filters = a color grade + optional effects, laid over any style
export const FILTERS = {
  none: { name: 'Style default', sw: ['#333', '#777'] },
  hdr: { name: 'HDR CC', sw: ['#1b1b1b', '#ffcf6e'], look: { contrast: 1.25, sat: 1.3, sharp: 0.9, vignette: 0.22 } },
  vivid: { name: 'Vivid', sw: ['#ff2d6f', '#ffd400'], look: { contrast: 1.2, sat: 1.55 } },
  teal: { name: 'Teal & Orange', sw: ['#0f8b8d', '#ff8c42'], look: { contrast: 1.18, sat: 1.15 }, fx: { split: 1 } },
  noir: { name: 'Noir B&W', sw: ['#000', '#ddd'], look: { contrast: 1.45, sat: 0, vignette: 0.6, grain: 0.06 } },
  vintage: { name: 'Vintage film', sw: ['#6b4a2b', '#e8c89a'], look: { contrast: 0.95, sat: 0.8, vignette: 0.5, grain: 0.08 }, fx: { sepia: 0.55, film: 1, leak: 0.25 } },
  vhs: { name: 'VHS tape', sw: ['#ff4fd8', '#3df5ff'], look: { contrast: 1.05, sat: 1.25, grain: 0.07, scan: 0.28 }, fx: { bleed: 1 } },
  neon: { name: 'Neon edges', sw: ['#7a00ff', '#00f0ff'], look: { contrast: 1.2, sat: 1.4 }, fx: { edge: 0.9 } },
  cyber: { name: 'Cyberpunk', sw: ['#2a0a4a', '#ff3dbb'], look: { contrast: 1.25, sat: 1.3 }, fx: { duo: 0.5, duoA: [0.12, 0.02, 0.3], duoB: [1.0, 0.3, 0.85] } },
  sunset: { name: 'Golden hour', sw: ['#ff7b00', '#ffd27a'], look: { contrast: 1.1, sat: 1.25, tint: [1.15, 0.97, 0.8] }, fx: { leak: 0.45 } },
  cold: { name: 'Ice cold', sw: ['#123a6b', '#bfe6ff'], look: { contrast: 1.15, sat: 0.85, tint: [0.86, 0.98, 1.18] } },
  faded: { name: 'Faded', sw: ['#666', '#c8c0b8'], look: { contrast: 0.8, sat: 0.72, bright: 0.04 } },
  dreamy: { name: 'Dreamy glow', sw: ['#f6a6d8', '#fff1c1'], look: { contrast: 0.92, sat: 1.15, bright: 0.03 }, fx: { leak: 0.3 }, glow: 0.9 },
  matrix: { name: 'Matrix', sw: ['#001a00', '#4dff6a'], look: { contrast: 1.2 }, fx: { duo: 0.85, duoA: [0, 0.03, 0], duoB: [0.45, 1, 0.45] } },
  infrared: { name: 'Infrared', sw: ['#2a0030', '#ff73bf'], fx: { duo: 0.8, duoA: [0.12, 0, 0.18], duoB: [1, 0.45, 0.75] } },
  comic: { name: 'Comic book', sw: ['#ffe14d', '#e63946'], look: { contrast: 1.3, sat: 1.35 }, fx: { halftone: 0.75, ink: 0.85, poster: 6 } },
  pixel: { name: '8-bit', sw: ['#2b2bff', '#5dff9a'], look: { sat: 1.3 }, fx: { pixel: 0.012, poster: 5 } },
  sepia: { name: 'Sepia', sw: ['#4a3420', '#d8b98a'], look: { contrast: 1.05, vignette: 0.45 }, fx: { sepia: 0.9 } },
  psych: { name: 'Psychedelic', sw: ['#ff00c8', '#00ffa2'], look: { sat: 1.6 }, hueSpin: 0.8 },
  // next-level looks
  detail: { name: 'Extreme detail', sw: ['#0b0f14', '#e8f6ff'], look: { contrast: 1.12, sat: 1.1, sharp: 1.0, vignette: 0.3 }, fx: { detail: 1, chroma: 0.3 } },
  crisp: { name: '4K crisp', sw: ['#1d2a38', '#bfe9ff'], look: { contrast: 1.08, sat: 1.12, sharp: 1.2 }, fx: { detail: 0.5 } },
  drama: { name: 'Dramatic HDR', sw: ['#141414', '#d9a75a'], look: { contrast: 1.28, sat: 0.92, vignette: 0.55, grain: 0.02 }, fx: { detail: 0.85, split: 0.6 } },
  chroma: { name: 'Color boost', sw: ['#ff1f5a', '#1fd1ff'], look: { contrast: 1.12 }, fx: { chroma: 1 } },
  bleach: { name: 'Bleach bypass', sw: ['#2b2f33', '#c9cfd4'], look: { contrast: 1.38, sat: 0.45, vignette: 0.35 }, fx: { detail: 0.4 } },
  anime: { name: 'Anime cel', sw: ['#ff7ab6', '#7ae1ff'], look: { contrast: 1.15, sat: 1.35, bright: 0.02 }, fx: { poster: 8, ink: 0.55, detail: 0.3 } },
  thermal: { name: 'Thermal', sw: ['#3a0060', '#ffd000'], look: { contrast: 1.1 }, fx: { thermal: 1 } },
  night: { name: 'Night vision', sw: ['#001400', '#7dff7a'], look: { contrast: 1.3, vignette: 0.75, grain: 0.09, scan: 0.18, bright: 0.04 }, fx: { duo: 1, duoA: [0, 0.04, 0], duoB: [0.55, 1, 0.5] } },
  xray: { name: 'X-ray', sw: ['#001018', '#d8f6ff'], look: { contrast: 1.25 }, fx: { duo: 1, duoA: [0.85, 0.97, 1], duoB: [0, 0.04, 0.1], edge: 0.25 } },
  sketch: { name: 'Pencil sketch', sw: ['#f3efe6', '#3a3a3a'], look: { contrast: 1.05, sat: 0 }, fx: { sketch: 1 } },
  dither: { name: '1-bit dither', sw: ['#0f1219', '#dbeecc'], look: { contrast: 1.2 }, fx: { dither: 1 } },
  prism: { name: 'Prism', sw: ['#ff3d6e', '#3dd8ff'], look: { contrast: 1.1, sat: 1.2 }, fx: { prism: 0.6 } },
  // film looks: open-source film emulations (HaldCLUTs from the G'MIC / RawTherapee collection, CC BY-SA 4.0),
  // downloaded the first time you pick one
  film_kodachrome: { name: 'Film: Kodachrome 64', sw: ['#7a2a14', '#f2c14e'], lut: 'kodachrome', look: { grain: 0.03 } },
  film_velvia: { name: 'Film: Velvia 50', sw: ['#0d4f8b', '#e9483b'], lut: 'velvia', look: { grain: 0.02 } },
  film_portra: { name: 'Film: Portra 400', sw: ['#b98466', '#f3e1c7'], lut: 'portra', look: { grain: 0.035 } },
  film_superia: { name: 'Film: Superia 400', sw: ['#2e6b4a', '#e8d6a8'], lut: 'superia', look: { grain: 0.04 } },
  film_polaroid: { name: 'Film: Polaroid', sw: ['#6f8d8a', '#f0e2c0'], lut: 'polaroid', look: { grain: 0.03, vignette: 0.25 } },
  film_cinema: { name: 'Film: Cinema print 2383', sw: ['#0f2a33', '#e8a35c'], lut: 'cine2383', look: { vignette: 0.2, grain: 0.02 } },
  film_fuji_print: { name: 'Film: Fuji print 3510', sw: ['#183a36', '#d9c48f'], lut: 'fuji3510', look: { vignette: 0.18, grain: 0.02 } },
  film_trix: { name: 'Film: Tri-X 400 B&W', sw: ['#111', '#e6e6e6'], lut: 'trix', look: { grain: 0.07, vignette: 0.35 } },
  film_hp5: { name: 'Film: HP5 B&W', sw: ['#1b1b1b', '#d8d8d8'], lut: 'hp5', look: { grain: 0.05, vignette: 0.3 } },
  film_anime: { name: 'Film: Anime colors', sw: ['#ff7ab6', '#7ae1ff'], lut: 'animelut' },
};

export const VIDEO_FORMATS = ['9:16', '4:5', '1:1', '16:9', '3:4', '4:3', '2:3', '21:9'];

// Extra effects you can stack on any edit
export const EXTRAS = [
  ['pulse', 'Beat zoom'], ['shake', 'Beat shake'], ['flash', 'Flash on drops'], ['rgb', 'RGB split'], ['glitchHits', 'Glitch hits'],
  ['pixelHits', 'Pixel hits'], ['blurHits', 'Zoom blur'], ['spin', 'Spin hits'], ['tilt3d', '3D tilt'], ['strobe', 'B&W strobe'],
  ['invertHits', 'Invert drops'], ['fisheye', 'Fisheye'], ['wave', 'Wavy'], ['kaleido', 'Kaleidoscope'], ['mirror', 'Mirror'],
  ['vhs', 'VHS'], ['crt', 'CRT screen'], ['leaks', 'Light leaks'], ['neon', 'Neon edges'], ['film', 'Film dust'],
  ['hue', 'Color cycle'], ['glow', 'Glow'], ['vignette', 'Dark corners'],
  // animated "Nexus"-style filters: they move on their own, even on still footage
  ['pixdisplace', 'PixDisplace'], ['print', 'PrintAnimate'], ['stars', 'Stars'], ['datamosh', 'Datamosh'],
  // next-level
  ['detail', 'Extreme detail'], ['chroma', 'Color boost'], ['shockwave', 'Shockwave drops'], ['slices', 'Slice glitch'], ['prism', 'Prism split'],
];
// the ones that are animated on their own (shown with a ✦ in the effect list)
export const ANIMATED_FX = new Set(['pixdisplace', 'print', 'stars', 'datamosh', 'vhs', 'slices']);
