// Auto-captions, drawn the way an ASS subtitle renderer (libass) lays them out:
// ALL-CAPS groups of up to 5 words, Segoe UI Black, thick dark outline + soft drop shadow,
// one highlighted key word (the last word that isn't a filler word), bottom-center at 16.3% margin,
// split into two balanced lines when wider than 80% of the frame, shrunk only if still too wide.

// Caption palettes (primary = text, secondary = highlighted word, outline)
// [label, text color, highlight color, outline color, options]
// options: phrase = whole sentence at once · italic · keepCase = no ALL CAPS · noHighlight · size (65 = default)
//          y = distance from the bottom (fraction of height) · outline / shadow widths
export const CAPTION_STYLES = {
  stream_word: ['Stream Word (one big word at a time)', '#ffffff', '#ffffff', '#000000',
    { word: true, noHighlight: true, size: 92, y: 0.3, outline: 6, shadow: 3, family: 'Impact, "Arial Black", sans-serif', weight: 400 }],
  glow_word: ['Glow Word (one word, green glow)', '#ffffff', '#ffffff', '#0b0b0b',
    { word: true, noHighlight: true, size: 80, y: 0.3, outline: 2.5, glow: '#39ff6a', family: '"Arial Black", "Segoe UI Black", sans-serif', weight: 900 }],
  edit_caps: ['Edit Caps (bold italic sentences)', '#ffffff', '#ffffff', '#141414',
    { phrase: true, italic: true, noHighlight: true, size: 76, y: 0.3, outline: 1.8, shadow: 6, shadowAlpha: 0.75, maxW: 0.88 }],
  movie_sub: ['Movie Subtitle (small, clean)', '#ffffff', '#ffffff', '#000000',
    { phrase: true, keepCase: true, noHighlight: true, size: 40, y: 0.075, outline: 1.4, shadow: 2, shadowAlpha: 0.6, family: 'Georgia, "Times New Roman", serif', weight: 400 }],
  yellow_pop: ['Yellow Pop (Viral Classic)', '#ffffff', '#fde047', '#06080d'],
  pure_white: ['Pure White Crisp', '#ffffff', '#ffffff', '#000000'],
  cyber_cyan: ['Cyber Cyan Glow', '#ffffff', '#22d3ee', '#060c11'],
  neon_green: ['Terminal Neon Green', '#ffffff', '#4ade80', '#0a180a'],
  hormozi_gold: ['Hormozi Gold & Green', '#fde047', '#4ade80', '#050505'],
  crimson_fire: ['Crimson Fire Pop', '#ffffff', '#f43f5e', '#140408'],
  electric_purple: ['Electric Violet Neon', '#ffffff', '#c084fc', '#100614'],
  hot_magenta: ['Synthwave Hot Pink', '#ffffff', '#f472b6', '#120512'],
  sunset_orange: ['Blaze Orange Highlight', '#ffffff', '#fb923c', '#120a06'],
  cobalt_sky: ['GitHub Sky Blue', '#ffffff', '#58a6ff', '#040a14'],
  matrix_hacker: ['Matrix Full Green', '#4ade80', '#ffffff', '#041204'],
  golden_luxury: ['Luxury Gold & Ivory', '#fef3c7', '#fbbf24', '#100905'],
  ice_mint: ['Arctic Mint & Teal', '#ecfeff', '#2dd4bf', '#041410'],
  blood_moon: ['Red Alert & Yellow', '#f87171', '#fde047', '#0f0505'],
  pastel_lilac: ['Soft Lilac & Rose', '#f5f3ff', '#fda4af', '#180e18'],
  stealth_slate: ['Stealth Silver & Ice', '#cbd5e1', '#7dd3fc', '#0a1018'],
  inverted_ink: ['Inverted Ink on White', '#0d1014', '#d84e1d', '#ffffff'],
  retro_amber: ['CRT Retro Amber', '#fbbf24', '#ffffff', '#140a04'],
};
// older saved values
const STYLE_ALIASES = { cyan: 'cyber_cyan', white: 'pure_white' };

// Caption fonts (Windows system fonts)
// [label, CSS family, weight, em ratio]. libass sizes a font so ascent+descent = Fontsize, so the
// glyphs are smaller than a CSS font of the same number; the ratio converts between the two.
export const CAPTION_FONTS = {
  segoe: ['Segoe UI Black (Modern Viral)', '"Segoe UI Black", "Segoe UI"', 900, 0.75],
  impact: ['Impact (Viral Reel)', 'Impact', 400, 0.82],
  arial_black: ['Arial Black (Ultra Heavy)', '"Arial Black", Arial', 900, 0.71],
  bahnschrift: ['Bahnschrift (Geometric Tech)', 'Bahnschrift', 700, 0.83],
  trebuchet: ['Trebuchet MS Bold (Clean Creator)', '"Trebuchet MS"', 700, 0.86],
  consola: ['Consolas Bold (Developer / Code)', 'Consolas', 700, 0.85],
  verdana: ['Verdana Bold (Wide Legible)', 'Verdana', 700, 0.82],
  tahoma: ['Tahoma Bold (Punchy UI)', 'Tahoma', 700, 0.83],
  franklin: ['Franklin Gothic (Headline Press)', '"Franklin Gothic Medium"', 700, 0.88],
  georgia: ['Georgia Bold (Editorial Serif)', 'Georgia', 700, 0.88],
  courier: ['Courier New Bold (Typewriter)', '"Courier New"', 700, 0.88],
  lucida_console: ['Lucida Console (Terminal Mono)', '"Lucida Console"', 700, 0.99],
  calibri: ['Calibri Bold (Smooth Modern)', 'Calibri', 700, 0.82],
  candara: ['Candara Bold (Humanist Flare)', 'Candara', 700, 0.82],
  corbel: ['Corbel Bold (Crisp Tech Sans)', 'Corbel', 700, 0.82],
  palatino: ['Palatino Bold (Cinema Prestige)', '"Palatino Linotype"', 700, 0.73],
  times: ['Times New Roman Bold (Classic)', '"Times New Roman"', 700, 0.87],
  comic: ['Comic Sans Bold (Playful)', '"Comic Sans MS"', 700, 0.72],
};

// Stop words — never chosen as the highlighted word
const STOP = new Set(['A', 'AN', 'THE', 'AND', 'OR', 'TO', 'OF', 'IN', 'ON', 'FOR', 'WITH', 'IS', 'ARE', 'BE', 'BEEN', 'BEING', 'CAN', 'COULD', 'WILL',
  'WOULD', 'FROM', 'BY', 'AS', 'AT', 'INTO', 'OVER', 'THAN', 'THAT', 'THIS', 'THESE', 'THOSE', 'IT', 'ITS', "IT'S", 'IT’S', "HERE'S", 'HERE’S', 'YOUR',
  'YOU', 'WE', 'OUR', 'WHILE', 'WHERE', 'WHEN', 'SO', 'ALSO', 'MORE', 'MOST', 'VERY', 'ANY', 'ALL', 'READ', 'OPEN', 'EXPLORE',
  // spoken filler, so a "UM" or "LIKE" never gets the color
  'UM', 'UH', 'LIKE', 'YEAH', 'OH', 'I', "I'M", 'I’M', 'ME', 'MY', 'JUST', 'GONNA', 'GOT', 'GET', 'DO', 'DID', 'WAS', 'WERE', 'HE', 'SHE', 'THEY', 'THEM']);

// Up to 5 words per caption , never across a sentence end or a real pause.
// phrase: whole sentences (up to 10 words / 4.5s) instead of 5-word chunks
export function captionGroups(words = [], phrase = false) {
  const groups = [];
  let group = [];
  // phrase: true = whole sentences · 'word' = one word at a time · false = up to 5 words
  const maxW = phrase === 'word' ? 1 : phrase ? 10 : 5, maxT = phrase === 'word' ? 2 : phrase ? 4.5 : 3;
  const flush = () => { if (group.length) groups.push({ start: group[0].start, end: group.at(-1).end, words: group }); group = []; };
  words.forEach(word => {
    if (group.length && (word.start - group.at(-1).end > 0.6 || word.end - group[0].start > maxT)) flush();
    group.push(word);
    if (group.length >= maxW || /[.!?]["'”’]*$/.test(word.text)) flush();
  });
  flush();
  // Captions sit back-to-back: hold each one until the next starts (short gaps only)
  for (let i = 0; i < groups.length; i++) {
    const next = groups[i + 1];
    groups[i].end = next && next.start - groups[i].end < 0.45 ? next.start : groups[i].end + 0.15;
    const ws = groups[i].words.map(w => w.text.toUpperCase());
    groups[i].highlight = keyWord(ws);
  }
  return groups;
}
function keyWord(words) {
  for (let i = words.length - 1; i >= 0; i--) if (!STOP.has(words[i].replace(/[.,!?:;"'()]/g, ''))) return i;
  return words.length - 1;
}

const groupCache = new WeakMap(), phraseCache = new WeakMap(), wordCache = new WeakMap();
export const captionOpts = (style) => (CAPTION_STYLES[STYLE_ALIASES[style] || style] || [])[4] || {};
export function captionAt(words, time, phrase = false) {
  if (!words?.length) return null;
  const cache = phrase === 'word' ? wordCache : phrase ? phraseCache : groupCache;
  let groups = cache.get(words);
  if (!groups) { groups = captionGroups(words, phrase); cache.set(words, groups); }
  let lo = 0, hi = groups.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, group = groups[mid];
    if (time < group.start) hi = mid - 1;
    else if (time >= group.end) lo = mid + 1;
    else return { group, index: mid, active: group.words.findIndex(w => time >= w.start && time < w.end), highlight: group.highlight };
  }
  return null;
}

// Canvas the same aspect as the output, drawn the way libass renders an ASS style.
// yAt: optional distance from the bottom (fraction of height), e.g. just above a stream clip's split line
export function drawCaptionCanvas(caption, aspect, style = 'yellow_pop', fontKey = 'segoe', yAt = null) {
  const canvas = document.createElement('canvas');
  const H = 1280, W = Math.round(H * aspect);
  canvas.width = W; canvas.height = H;
  if (!caption) return canvas;
  const g = canvas.getContext('2d');
  const [, primary, secondary, outlineColor, opts = {}] = CAPTION_STYLES[STYLE_ALIASES[style] || style] || CAPTION_STYLES.yellow_pop;
  let [, family, weight, ratio] = CAPTION_FONTS[fontKey] || CAPTION_FONTS.segoe;
  if (opts.family) { family = opts.family; weight = opts.weight ?? weight; ratio = 0.85; }
  // Everything scales by width / 1080 (PlayResX = video width)
  const unit = W / 1080;
  let size = Math.round((opts.size ?? 65) * unit); // ASS Fontsize
  const outline = (opts.outline ?? 4.4) * unit, shadow = (opts.shadow ?? 2.5) * unit;
  const words = caption.group.words.map(w => (opts.keepCase ? w.text : w.text.toUpperCase()).replace(/\\/g, '/'));
  const hl = opts.noHighlight ? -1 : caption.highlight ?? keyWord(words);
  const setFont = (s) => { g.font = `${opts.italic ? 'italic ' : ''}${weight} ${s}px ${family}, "Arial Black", Impact, sans-serif`; };
  // Measured at the full font size to decide line breaks / shrinking
  setFont(size);
  const width = (ws) => g.measureText(ws.join(' ')).width;
  // two balanced lines when too wide
  let lines = [words.map((w, i) => i)];
  const maxW = opts.maxW ?? 0.8;
  if (width(words) > W * maxW && words.length > 1) {
    let best = 1, bestW = Infinity;
    for (let i = 1; i < words.length; i++) {
      const m = Math.max(width(words.slice(0, i)), width(words.slice(i)));
      if (m < bestW) { bestW = m; best = i; }
    }
    lines = [words.slice(0, best).map((_, i) => i), words.slice(best).map((_, i) => i + best)];
  }
  const longest = Math.max(...lines.map(l => width(l.map(i => words[i]))));
  if (longest > W * maxW) size = Math.max(20, Math.floor(size * (W * maxW) / longest));
  // ...but libass draws the glyphs at Fontsize × ratio
  setFont(Math.max(8, size * ratio));
  g.textBaseline = 'alphabetic'; g.lineJoin = 'round'; g.miterLimit = 2;
  const lineH = size; // libass line height = Fontsize
  const marginV = Math.round(H * (yAt ?? opts.y ?? 0.163));
  const bottom = H - marginV;
  const space = g.measureText(' ').width;
  const layout = lines.map((line, row) => {
    const parts = line.map(i => ({ i, text: words[i], w: g.measureText(words[i]).width }));
    const total = parts.reduce((s, p) => s + p.w, 0) + space * (parts.length - 1);
    let x = (W - total) / 2;
    const y = bottom - (lines.length - 1 - row) * lineH - size * 0.2;
    for (const p of parts) { p.x = x; x += p.w + space; }
    return { parts, y };
  });
  // 1) drop shadow (50% black, offset like ASS Shadow), 2) outline, 3) fill
  g.fillStyle = g.strokeStyle = `rgba(0,0,0,${opts.shadowAlpha ?? 0.5})`; g.lineWidth = outline * 2;
  if (opts.shadow) { g.shadowColor = `rgba(0,0,0,${opts.shadowAlpha ?? 0.5})`; g.shadowBlur = shadow * 1.5; }
  for (const { parts, y } of layout) for (const p of parts) { g.strokeText(p.text, p.x + shadow, y + shadow); g.fillText(p.text, p.x + shadow, y + shadow); }
  g.shadowColor = 'transparent'; g.shadowBlur = 0;
  // neon glow behind the letters (Glow Word)
  if (opts.glow) {
    g.save(); g.shadowColor = opts.glow; g.fillStyle = opts.glow;
    for (const blur of [size * 0.55, size * 0.3]) { g.shadowBlur = blur; for (const { parts, y } of layout) for (const p of parts) g.fillText(p.text, p.x, y); }
    g.restore();
  }
  g.strokeStyle = outlineColor; g.lineWidth = outline * 2;
  for (const { parts, y } of layout) for (const p of parts) g.strokeText(p.text, p.x, y);
  for (const { parts, y } of layout) for (const p of parts) { g.fillStyle = p.i === hl ? secondary : primary; g.fillText(p.text, p.x, y); }
  return canvas;
}
