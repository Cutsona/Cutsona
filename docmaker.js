// Cutsona - Topic to video: a narrated video (documentary / explainer) from just a topic or a folder.
// Script (from Wikipedia, or your own), a voice (a natural Piper voice, or Windows' own), pictures and clips for every
// line, background music under the voice, captions, then one MP4 in the exports folder. Everything runs on this PC.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PIPER_ZIP = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US';
const PIPER_VOICES = [
  { id: 'ryan', name: 'Ryan: deep, documentary', file: 'en_US-ryan-high', url: `${HF}/ryan/high/en_US-ryan-high`, mb: 121 },
  { id: 'lessac', name: 'Lessac: clear, friendly', file: 'en_US-lessac-medium', url: `${HF}/lessac/medium/en_US-lessac-medium`, mb: 63 },
];
const SKIP_SECTIONS = /^(references|see also|external links|notes|further reading|bibliography|sources|citations|gallery|footnotes|works cited|explanatory notes|filmography|discography|awards and nominations|selected works)$/i;
const STOP = new Set('The A An In On At Of And But Or For With From By As To It Its This That These Those He She They His Her Their We Our You Your I After Before During Since While When Where Which Who What However Although Because Following Today Later Also In Some Many Most Other There Here Then Thus Both Each Every Such One Two Three First Second Under Over'.split(' '));

const editorStyles = import('./app/js/styles.js');
const FONT_NAMES = { default: '', arial: 'Arial', georgia: 'Georgia', courier: 'Courier New' };
const EFFECT_NAMES = ['grain', 'vignette', 'bars', 'vhs'];

// FFmpeg equivalents of the editor's picture filters. Keep these under titles and captions.
function presetVideoFilters(preset, width, height) {
  const { look = {}, fx = {}, hueSpin, glow } = preset;
  const filters = [];
  const contrast = look.contrast ?? 1, saturation = (look.sat ?? 1) + (fx.chroma || 0) * 0.4;
  const brightness = (look.bright || 0) + (fx.leak || 0) * 0.03;
  if (contrast !== 1 || saturation !== 1 || brightness) filters.push(`eq=contrast=${contrast}:saturation=${saturation}:brightness=${brightness}`);
  const sharp = (look.sharp || 0) + (fx.detail || 0) * 0.5;
  if (sharp) filters.push(`unsharp=5:5:${sharp}`);
  if (look.tint) {
    const [r, g, b] = look.tint;
    filters.push(`colorchannelmixer=rr=${r}:gg=${g}:bb=${b}`);
  }
  if (fx.split) filters.push(`colorbalance=rs=${-0.15 * fx.split}:bs=${0.2 * fx.split}:rh=${0.21 * fx.split}:bh=${-0.12 * fx.split}`);
  if (fx.sepia) {
    const a = fx.sepia;
    filters.push(`colorchannelmixer=rr=${1 - a * 0.607}:rg=${a * 0.769}:rb=${a * 0.189}:gr=${a * 0.349}:gg=${1 - a * 0.314}:gb=${a * 0.168}:br=${a * 0.272}:bg=${a * 0.534}:bb=${1 - a * 0.869}`);
  }
  if (fx.duo) {
    const components = [2, 0, 1].map((i, c) => {
      const lo = fx.duoA[i] * 255, range = fx.duoB[i] - fx.duoA[i];
      return `c${c}=${lo}+val*${range}`;
    });
    filters.push('format=gbrp', `pseudocolor=index=1:opacity=${fx.duo}:${components.join(':')}`);
  }
  if (fx.thermal) filters.push('format=yuv444p', 'pseudocolor=preset=inferno');
  if (fx.bleed || fx.prism) filters.push('format=yuv444p', `chromashift=cbh=${fx.bleed ? 6 : 10}:crh=${fx.bleed ? -6 : -10}`);
  if (fx.pixel) {
    const w = Math.round(1 / fx.pixel);
    filters.push(`scale=w=${w}:h=-1:flags=area`, `scale=w=${width}:h=${height}:flags=neighbor`);
  }
  if (fx.poster) {
    const level = Math.floor(255 / (fx.poster - 1));
    const q = `'round(val/${level})*${level}'`;
    filters.push(`lutrgb=r=${q}:g=${q}:b=${q}`);
  }
  if (fx.sketch) filters.push('edgedetect=low=0.04:high=0.16', 'negate');
  else if (fx.edge >= 0.5) filters.push('edgedetect=low=0.06:high=0.2:mode=colormix');
  if (fx.ink) filters.push(`unsharp=7:7:${fx.ink * 1.7}`);
  if (fx.dither) filters.push("format=gray", "geq=lum='if(gt(lum(X,Y),63+mod(X+2*Y,4)*42),220,18)'");
  if (hueSpin) filters.push(`hue=H=t*${hueSpin}`);
  if (glow) filters.push(`gblur=sigma=${glow * 1.4}`);
  if (look.scan) filters.push(`drawgrid=w=0:h=4:t=1:color=black@${look.scan * 0.5}`);
  if (look.grain) filters.push(`noise=alls=${Math.round(look.grain * 150)}:allf=t+u`);
  if (look.vignette) filters.push(`vignette=angle=${look.vignette}`);
  return filters;
}

module.exports = function docMaker(D) {
  // D: { ffmpeg(), curl, curlFile, BIN_DIR, CACHE_DIR, TMP_DIR, exportDir(), config, ytSongSearch, grabSong, pexelsSearch, uid, pickFolder }
  const jobs = new Map();
  const PIPER_DIR = path.join(D.BIN_DIR, 'piper');
  const piperExe = () => path.join(PIPER_DIR, 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper');
  const voiceFile = (v) => path.join(PIPER_DIR, 'voices', v.file + '.onnx');
  const voiceReady = (v) => fs.existsSync(voiceFile(v)) && fs.existsSync(voiceFile(v) + '.json') && fs.existsSync(piperExe());
  const enc = encodeURIComponent;
  const getJ = async (url) => JSON.parse(await D.curl(url, { accept: 'application/json', maxTime: 30 }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function applyPreset(key, legacyLook, input, inputs, graph, width, height) {
    const { FILTERS } = await editorStyles;
    const preset = Object.hasOwn(FILTERS, key) ? FILTERS[key] : FILTERS.none;
    const lut = preset.lut || legacyLook;
    if (lut && D.lut) {
      const file = preset.lut ? await D.lut(lut) : await D.lut(lut).catch(() => null);
      if (file) {
        const index = inputs.filter((arg) => arg === '-i').length;
        inputs.push('-i', file);
        graph.push(`${input}[${index}:v]haldclut[graded]`);
        input = '[graded]';
      }
    }
    return { input, filters: presetVideoFilters(preset, width, height) };
  }

  // ---------------- the script ----------------
  const cleanText = (s) => {
    let t = String(s || '');
    for (let k = 0; k < 3; k++) t = t.replace(/\s*\([^()]*\)/g, '');            // (born 1946), (/ˈaɪ/), (listen)
    return t.replace(/\[[^\]]*\]/g, '').replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').replace(/ ;/g, ';').trim();
  };
  const ABBR = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|No|Inc|Ltd|Co|Corp|Mt|Ft|Gen|Col|Lt|Capt|Gov|Sen|Rev|Prof|approx|ca|c|U\.S|U\.K|D\.C|e\.g|i\.e)\./g;
  const sentences = (para) => para.replace(ABBR, (m) => m.replace(/\./g, '․')).split(/(?<=[.!?])\s+(?=["“A-Z0-9])/)
    .map((x) => x.replace(/․/g, '.').trim()).filter((x) => x.length > 2);
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  // what to show while a line is read: the names in it (places, people, events), its years, the section it's in
  function keysOf(sent, section, title) {
    const out = [], toks = sent.replace(/[“”"()]/g, ' ').split(/\s+/);
    for (let i = 0; i < toks.length; i++) {
      const w = toks[i].replace(/[,.;:!?']+$/g, '').replace(/'s$/, '');
      if (!/^[A-Z][a-zA-Z\-]+$/.test(w) || (i === 0 && STOP.has(w)) || STOP.has(w)) continue;
      let name = w, j = i + 1;
      while (j < toks.length) { const n = toks[j].replace(/[,.;:!?']+$/g, '').replace(/'s$/, ''); if (/^[A-Z][a-zA-Z\-]+$/.test(n) || (/^(of|de|the|von|van|da)$/.test(n) && /^[A-Z]/.test(toks[j + 1] || ''))) { name += ' ' + n; j++; if (/[,.;:!?]$/.test(toks[j - 1])) break; } else break; }
      i = j - 1;
      if (name.length > 2 && name.toLowerCase() !== title.toLowerCase() && !out.includes(name)) out.push(name);
    }
    const year = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(sent);
    if (section && !/^(lead|overview|summary|introduction)$/i.test(section)) out.push(`${title} ${section}`);
    return { names: out.slice(0, 4), year: year ? year[1] : null };
  }
  const plain = (text) => cleanText(String(text || '').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/(?:&#039;|&#39;|&apos;)/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' '));
  const research = async (url) => JSON.parse(await D.curl(url, { accept: 'application/json', maxTime: 8 }));
  const recentTopics = new Map();
  async function topicMatches(topic) {
    if (!topic) return [];
    const cached = recentTopics.get(topic.toLowerCase());
    if (cached && Date.now() - cached.at < 120000) return cached.items;
    const [wiki, nasa, loc, science, papers, health] = await Promise.all([
      research(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(topic)}&srlimit=5&format=json`).catch(() => null),
      research(`https://images-api.nasa.gov/search?q=${enc(topic)}&media_type=image&page_size=8`).catch(() => null),
      research(`https://www.loc.gov/search/?q=${enc(topic)}&fo=json&at=results&c=8`).catch(() => null),
      Promise.all([
        `slug=${enc(topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}`,
        `search=${enc(topic)}&per_page=4`
      ].map((query) => research(`https://science.nasa.gov/wp-json/wp/v2/topic?${query}&_fields=id,link,title,excerpt,content`).catch(() => [])))
        .then((results) => results.filter(Array.isArray).flat()),
      research(`https://api.crossref.org/works?query.title=${enc(topic)}&rows=8&filter=has-abstract:true&select=title,abstract,DOI,license`).catch(() => null),
      research(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${new URLSearchParams({ query: `TITLE:"${topic.replace(/["\\]/g, '')}" AND OPEN_ACCESS:Y`, resultType: 'core', format: 'json', pageSize: '5' })}`).catch(() => null)
    ]);
    const candidates = [
      ...(wiki?.query?.search || []).slice(0, 4).map((x) => ({ id: `wiki:${x.pageid}`, title: x.title, summary: plain(x.snippet), provider: 'Wikipedia', url: `https://en.wikipedia.org/?curid=${x.pageid}` })),
      ...(Array.isArray(science) ? science : []).flatMap((x) => {
        const paragraphs = String(x.content?.rendered || '').match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
        const content = paragraphs.map(plain).filter(Boolean).join(' ').slice(0, 18000);
        const summary = plain(x.excerpt?.rendered) || content.slice(0, 700);
        return /^https:\/\/science\.nasa\.gov\//.test(x.link) && x.title?.rendered
          ? [{ id: `science:${x.id}`, title: plain(x.title.rendered), summary, content, provider: 'NASA Science', url: x.link }] : [];
      }),
      ...(papers?.message?.items || []).flatMap((x) => x.DOI && x.title?.[0] && x.abstract
        ? [{ id: `doi:${x.DOI}`, title: plain(x.title[0]), summary: plain(x.abstract), provider: 'Crossref', url: `https://doi.org/${x.DOI}`,
          license: x.license?.find((l) => /creativecommons\.org\/licenses\/by(?:-sa)?\//i.test(l.URL || ''))?.URL }] : []),
      ...(health?.resultList?.result || []).flatMap((x) => x.title && x.abstractText && x.source && x.id
        ? [{ id: `pmc:${x.source}:${x.id}`, title: plain(x.title), summary: plain(x.abstractText), provider: 'Europe PMC', url: `https://europepmc.org/article/${enc(x.source)}/${enc(x.id)}` }] : []),
      ...(nasa?.collection?.items || []).slice(0, 5).flatMap((x) => {
        const n = x.data?.[0];
        return n?.nasa_id && n.title && n.description ? [{ id: `nasa:${n.nasa_id}`, title: n.title, summary: plain(n.description), provider: 'NASA', url: `https://images.nasa.gov/details/${enc(n.nasa_id)}` }] : [];
      }),
      ...(loc?.results || []).slice(0, 5).flatMap((x) => {
        const desc = Array.isArray(x.description) ? x.description.join(' ') : x.description;
        return x.title && x.id && desc ? [{ id: `loc:${x.id}`, title: x.title, summary: plain(desc), provider: 'Library of Congress', url: x.id }] : [];
      })
    ].filter((x) => x.summary.length >= 45 && !/\(disambiguation\)$/i.test(x.title));
    const terms = topicWords(topic);
    const relevance = (title) => { const titleTerms = topicWords(title); return terms.filter((word) => titleTerms.includes(word)).length; };
    const seen = new Set();
    const items = candidates.filter((x) => {
      if (x.provider !== 'Wikipedia' && terms.length && relevance(x.title) < Math.ceil(terms.length / 2)) return false;
      const key = x.url.startsWith('https://doi.org/') ? x.url : `${x.provider}:${x.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (items.length) {
      recentTopics.set(topic.toLowerCase(), { at: Date.now(), items });
      if (recentTopics.size > 20) recentTopics.delete(recentTopics.keys().next().value);
    }
    return items;
  }
  function topicWords(topic) {
    return [...new Set((topic.toLowerCase().match(/\b(?:[a-z]{3,}|\d+)\b/g) || []).filter((word) => !STOP.has(word[0].toUpperCase() + word.slice(1)))
      .map((word) => word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word))];
  }
  const reusableText = (x) => !['Crossref', 'Europe PMC'].includes(x.provider) || !!x.license;
  async function researchScript(topic, minutes, style, choice) {
    const matches = await topicMatches(topic);
    const match = matches.find((x) => x.id === choice) || matches.find(reusableText);
    if (!match) throw new Error(`No research sources found for “${topic}”. Try a more specific topic or write your own script.`);
    const credit = ({ title, provider, url, license }) => ({ title, provider, url, license });
    if (!reusableText(match)) throw new Error('This record is a reference. Choose “Write from matching sources” or an article with reusable text.');
    if (match.provider === 'Wikipedia') {
      const script = await wikiScript(match.title, minutes, style);
      const terms = topicWords(topic);
      const context = matches.filter((x) => x.provider !== 'Wikipedia' && terms.length && terms.every((w) => topicWords(x.title).includes(w)));
      const extras = [...new Set(context.map((x) => x.provider))].map((provider) => context.find((x) => x.provider === provider));
      for (const extra of extras) {
        const text = reusableText(extra) && sentences(extra.summary).find((s) => words(s) >= 8 && words(s) <= 35);
        if (!text) continue;
        script.scenes.push(...scenesOf([{ text, section: extra.provider }], script.title));
        script.sources.push(credit(extra));
      }
      return script;
    }
    const lines = sentences(match.content || match.summary).filter((text) => words(text) >= 6 && words(text) <= 48).slice(0, Math.max(2, Math.round(minutes * 5)));
    if (!lines.length) throw new Error('This source has too little text for a script. Choose another source.');
    return { title: match.title, url: match.url, sources: [credit(match)], scenes: scenesOf(lines.map((text) => ({ text, section: 'Overview' })), match.title) };
  }
  async function wikiScript(title, minutes, style) {
    if (!title) throw new Error(`Wikipedia has nothing on “${topic}”. Try other words, or write your own script.`);
    const e = await getJ(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&titles=${enc(title)}&format=json`);
    const page = Object.values(e.query?.pages || {})[0] || {};
    const raw = String(page.extract || '');
    if (raw.length < 200) throw new Error(`There isn't enough about “${title}” to tell. Try a bigger topic, or write your own script.`);
    // sections: the lead, then each "== Heading ==" (the deeper ones count as part of their section)
    const secs = []; let cur = { name: 'Lead', paras: [] };
    for (const line of raw.split(/\n/)) {
      const h = /^(=+)\s*(.+?)\s*=+\s*$/.exec(line);
      if (h) { if (h[1].length === 2) { secs.push(cur); cur = { name: h[2], paras: [] }; } continue; }
      const t = cleanText(line);
      if (t.length > 40 && /[.!?]$/.test(t)) cur.paras.push(t);
    }
    secs.push(cur);
    const use = secs.filter((x) => x.paras.length && !SKIP_SECTIONS.test(x.name));
    const budget = Math.round(Math.max(0.5, minutes) * 150); // words: about 150 a minute
    const good = (x) => words(x) >= 6 && words(x) <= 48 && !/^(see|for other|this article|it is not to be confused)/i.test(x) && (x.match(/\d/g) || []).length < 14;
    const picked = []; let used = 0;
    // the lead first (the summary of the whole story), up to 40% of the time
    const lead = use[0]?.name === 'Lead' ? use.shift() : null;
    if (lead) for (const p of lead.paras) for (const x of sentences(p)) { if (!good(x) || used + words(x) > budget * (use.length ? 0.4 : 1)) continue; picked.push({ text: x, section: 'Lead' }); used += words(x); }
    // then every section in order: its opening lines, more where there's room
    for (let round = 0; round < 4 && used < budget * 0.95; round++) {
      for (const sec of use) {
        const all = sec.paras.flatMap((p, pi) => sentences(p).map((x, si) => ({ x, pi, si }))).filter((o) => good(o.x));
        const per = Math.max(1, Math.round(((budget - used) / Math.max(1, use.length)) / 22));
        let n = 0;
        for (const o of all) {
          if (n >= per) break;
          if (picked.some((pp) => pp.text === o.x)) continue;
          if (round === 0 && o.si > 1) continue; // first time round: the first lines of its paragraphs
          if (used + words(o.x) > budget * 1.05) break;
          picked.push({ text: o.x, section: sec.name, order: use.indexOf(sec) * 1e4 + o.pi * 100 + o.si }); used += words(o.x); n++;
        }
        if (used >= budget * 0.95) break;
      }
    }
    // the story in its own order (lead first, then the sections as Wikipedia has them)
    const year = (line) => Number(line.text.match(/\b(?:1[0-9]{3}|20[0-9]{2})\b/)?.[0]) || Infinity;
    const body = picked.filter((p) => p.section !== 'Lead')
      .sort((a, b) => (style === 'history' ? year(a) - year(b) : 0) || a.order - b.order);
    const lines = [...picked.filter((p) => p.section === 'Lead'), ...body];
    if (!lines.length) throw new Error(`Couldn't make a script about “${title}”. Write your own instead.`);
    const url = `https://en.wikipedia.org/wiki/${enc(title.replace(/ /g, '_'))}`;
    return { title, url, sources: [{ title, provider: 'Wikipedia', url, license: 'CC BY-SA' }], scenes: scenesOf(lines, title) };
  }
  // a scene: one or two sentences, about 8 to 30 words (one picture or clip each, two for long ones)
  function scenesOf(lines, title) {
    const out = [];
    for (const l of lines) {
      const last = out[out.length - 1];
      if (last && last.section === l.section && words(last.text) + words(l.text) <= 30 && words(last.text) < 14) last.text += ' ' + l.text;
      else out.push({ text: l.text, section: l.section });
    }
    return out.map((s) => ({ text: s.text, section: s.section, ...keysOf(s.text, s.section, title) }));
  }
  function ownScript(text, title) {
    const paras = String(text || '').split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean);
    const lines = paras.flatMap((p, k) => sentences(p).map((x) => ({ text: x, section: 'p' + k })));
    return scenesOf(lines, title || '');
  }

  // ---------------- the voice ----------------
  function windowsVoices() {
    if (process.platform !== 'win32') return Promise.resolve([]);
    return new Promise((resolve) => {
      const ps = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { if ($_.Enabled) { $_.VoiceInfo.Name } }";
      const p = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
      let out = ''; p.stdout.on('data', (d) => { out += d; }); p.on('error', () => resolve([])); p.on('close', () => resolve(out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)));
    });
  }
  async function ensurePiper(v, job) {
    if (process.platform !== 'win32') throw new Error('Natural voices are set up on Windows only for now: pick a system voice.');
    fs.mkdirSync(path.join(PIPER_DIR, 'voices'), { recursive: true });
    if (!fs.existsSync(piperExe())) {
      job.phase = 'Getting the voice engine (about 20 MB, once)';
      const zip = path.join(PIPER_DIR, 'piper.zip');
      await D.curlFile(PIPER_ZIP, zip);
      await run('tar', ['-xf', zip, '-C', PIPER_DIR], PIPER_DIR);
      try { fs.unlinkSync(zip); } catch {}
      if (!fs.existsSync(piperExe())) throw new Error('The voice engine did not unpack. Try again.');
    }
    if (!voiceReady(v)) {
      job.phase = `Getting the voice ${v.name.split(':')[0]} (about ${v.mb} MB, once)`;
      await D.curlFile(v.url + '.onnx.json?download=true', voiceFile(v) + '.json');
      await D.curlFile(v.url + '.onnx?download=true', voiceFile(v) + '.part');
      fs.renameSync(voiceFile(v) + '.part', voiceFile(v));
    }
  }
  function run(cmd, args, cwd, stdin = null, onErr = null) {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { cwd, windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => { err += d; if (err.length > 30000) err = err.slice(-30000); onErr?.(String(d)); });
      p.stdout.on('data', () => {});
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`${path.basename(cmd)} failed: ${err.trim().slice(-800)}`))));
      if (stdin != null) p.stdin.end(stdin); else p.stdin.end();
    });
  }
  const ff = (args, cwd) => run(D.ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], cwd);
  // the spoken length of a WAV, from its header
  function wavDur(file) {
    const b = fs.readFileSync(file);
    let byteRate = 0, data = 0;
    for (let o = 12; o + 8 <= b.length;) {
      const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
      if (id === 'fmt ') byteRate = b.readUInt32LE(o + 16);
      if (id === 'data') { data = Math.min(sz, b.length - o - 8); break; }
      o += 8 + sz + (sz & 1);
    }
    return byteRate ? data / byteRate : 0;
  }
  // numbers and symbols read the way a narrator says them
  const speakable = (t) => String(t).replace(/&/g, ' and ').replace(/%/g, ' percent').replace(/\bc\.\s?(\d)/g, 'around $1').replace(/[–—]/g, ', ').replace(/["“”]/g, '').replace(/\s{2,}/g, ' ').trim();
  async function speak(scenes, voice, dir, job, pace = 'normal') {
    const pv = PIPER_VOICES.find((v) => v.id === voice);
    const outs = scenes.map((_, i) => path.join(dir, `v${i}.wav`));
    if (pv) {
      await ensurePiper(pv, job);
      job.phase = 'Recording the voice';
      // one engine run for every line (each line its own file)
      const lines = scenes.map((s, i) => JSON.stringify({ text: speakable(s.text), output_file: outs[i] })).join('\n') + '\n';
      let done = 0;
      await run(piperExe(), ['--model', voiceFile(pv), '--json-input', '--sentence_silence', '0.25', '--length_scale', String({ slow: 1.18, fast: 0.9 }[pace] || 1.04)], dir, lines, (s) => { done += (s.match(/Wrote /g) || []).length; job.pct = Math.min(30, 4 + (done / scenes.length) * 26); });
    } else {
      if (process.platform !== 'win32') throw new Error('No voice on this system: pick a natural voice.');
      job.phase = 'Recording the voice';
      const list = path.join(dir, 'lines.json');
      fs.writeFileSync(list, JSON.stringify(scenes.map((s, i) => ({ t: speakable(s.text), o: outs[i] }))), 'utf8');
      const ps = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;`
        + ` if ($env:CZ_VOICE) { try { $s.SelectVoice($env:CZ_VOICE) } catch {} }; $s.Rate = ${{ slow: -2, fast: 2 }[pace] || 0};`
        + ` foreach ($l in (Get-Content -Raw -Encoding UTF8 $env:CZ_LIST | ConvertFrom-Json)) { $s.SetOutputToWaveFile($l.o); $s.Speak($l.t); $s.SetOutputToNull() }; $s.Dispose()`;
      await new Promise((resolve, reject) => {
        const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, env: { ...process.env, CZ_VOICE: voice || '', CZ_LIST: list } });
        let err = ''; p.stderr.on('data', (d) => { err += d; });
        p.on('error', reject); p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('The Windows voice failed: ' + err.slice(-400)))));
      });
    }
    return outs.map((o) => { if (!fs.existsSync(o)) throw new Error('A line of the voice was not recorded.'); return wavDur(o); });
  }

  // ---------------- pictures and clips ----------------
  const BAD_IMG = /logo|icon|flag of|coat of arms|signature|symbol|map of|locator|blank|commons-|wiki|question_book|edit-clear|padlock|disambig|portal|\.svg|diagram|chart|graph/i;
  async function commonsSearch(term, n = 12) {
    try {
      const j = await getJ(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${n}&gsrsearch=${enc((/\s/.test(term.trim()) ? `"${term.trim()}"` : term) + ' filetype:bitmap')}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1920`);
      return Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0)).map(imgOf).filter(Boolean);
    } catch { return []; }
  }
  function imgOf(pg) {
    const ii = pg.imageinfo?.[0];
    if (!ii || !/jpe?g|png|webp/i.test(ii.mime || '') || BAD_IMG.test(pg.title || '') || /[\u0400-\u04FF\u0590-\u08FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(pg.title || '') || (ii.width || 0) < 500 || (ii.height || 0) < 300) return null;
    return { kind: 'img', url: ii.thumburl || ii.url, thumb: ii.thumburl ? ii.thumburl.replace(/\/\d+px-/, '/360px-') : ii.url, key: pg.title, w: ii.width, h: ii.height,
      credit: { title: pg.title, provider: 'Wikimedia', url: ii.descriptionurl || ii.url } };
  }
  async function articleImages(title) {
    try {
      const j = await getJ(`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&generator=images&titles=${enc(title)}&gimlimit=60&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1920`);
      return Object.values(j.query?.pages || {}).map(imgOf).filter(Boolean);
    } catch { return []; }
  }
  const MEDIA = /\.(jpe?g|png|webp|bmp|mp4|mov|m4v|mkv|webm)$/i;
  const AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i;
  function folderMedia(dir) {
    const out = [];
    const walk = (d, depth) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory() && depth < 2) walk(p, depth + 1); else if (f.isFile() && MEDIA.test(f.name)) out.push(p); } };
    walk(dir, 0);
    return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((p) => ({ kind: /\.(mp4|mov|m4v|mkv|webm)$/i.test(p) ? 'vid' : 'img', file: p, key: path.basename(p) }));
  }
  // what each scene can show: its own searches first, then the article's pictures, then the topic's; a few per
  // scene, so every take can show different ones and you can swap any picture for another
  async function candidatesFor(title, scenes, opts, job) {
    if (opts.folder) {
      const media = folderMedia(opts.folder);
      if (!media.length) throw new Error('That folder has no pictures or videos.');
      return scenes.map((_, i) => Array.from({ length: Math.min(media.length, 8) }, (_, k) => media[(i * 2 + k) % media.length]));
    }
    job.phase = 'Finding pictures for every line';
    const pool = [...(await articleImages(title)), ...(await commonsSearch(title, 40))];
    // stock video (Pexels key in Settings) for the lines that name nothing in particular
    const stock = D.config.pexelsKey ? (await D.pexelsSearch(title, opts.vertical ? 'vertical' : 'horizontal', 30, 'video').catch(() => [])).map((v) => ({ kind: 'vid', url: v.url, key: v.title, w: v.w, h: v.h, thumb: v.thumb || v.image || '' })) : [];
    const out = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i], list = [];
      job.pct = 30 + (i / scenes.length) * 12;
      const terms = [...(s.names || []), ...(s.year ? [`${title} ${s.year}`] : [])].slice(0, 2);
      for (const t of terms) {
        let r = await commonsSearch(t.includes(title) || !title ? t : `${t} ${title.split(/[ (]/)[0]}`, 8);
        if (r.length < 2 && t !== title) r = [...r, ...await commonsSearch(t, 8)];
        list.push(...r.slice(0, 5));
      }
      if (!s.names?.length && stock.length) list.push(stock[(i * 2) % stock.length], stock[(i * 2 + 1) % stock.length]);
      for (let k = 0; list.length < 10 && k < pool.length; k++) list.push(pool[(i * 3 + k) % pool.length]);
      out.push([...new Map(list.filter(Boolean).map((x) => [x.url, x])).values()].slice(0, 10));
    }
    if (!out.some((l) => l.length)) throw new Error(`Couldn't find pictures for “${title}”. Add your own folder of pictures instead.`);
    const flat = out.flat();
    out.forEach((l, i) => { if (!l.length) l.push(flat[(i * 7) % flat.length]); });
    return out;
  }
  // the pictures / clips a take uses, into the project's folder (each once, named after its address)
  async function download(items, dir, job, pct = [45, 10]) {
    let k = 0, n = 0;
    const uniq = [...new Map(items.filter((x) => x && x.url && !x.file).map((x) => [x.url, x])).values()];
    if (job) job.phase = `Downloading pictures (${uniq.length})`;
    // (Wikimedia wants a real name for the program asking, and a breath between downloads)
    const get = (url, f) => new Promise((resolve) => {
      const p = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-sL', '--fail', '--max-time', '120', '-A', 'Cutsona/1.2 (https://github.com/Cutsona/Cutsona; video maker)', '-o', f, url], { windowsHide: true });
      p.on('error', () => resolve(false)); p.on('close', (c) => resolve(c === 0 && fs.existsSync(f) && fs.statSync(f).size > 4000));
    });
    const work = async () => {
      while (k < uniq.length) {
        const x = uniq[k++], ext = x.kind === 'vid' ? '.mp4' : (/\.png(\?|$)/i.test(x.url) ? '.png' : '.jpg');
        const f = path.join(dir, 'm_' + require('crypto').createHash('sha1').update(x.url).digest('hex').slice(0, 12) + ext);
        if (fs.existsSync(f) && fs.statSync(f).size > 4000) x.file = f;
        else if (await get(x.url, f) || (await sleep(1200), await get(x.url, f))) x.file = f;
        if (job) job.pct = pct[0] + (++n / uniq.length) * pct[1];
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    for (const x of items) if (x && !x.file) { const same = uniq.find((u) => u.url === x.url); if (same?.file) x.file = same.file; }
  }

  // ---------------- music ----------------
  const MOODS = { calm: 'calm documentary background music no copyright', epic: 'epic cinematic documentary music no copyright', mystery: 'dark mystery documentary background music no copyright', inspiring: 'inspiring piano documentary background music no copyright' };
  async function music(kind, job, skip = []) {
    if (!kind || kind === 'none') return null;
    if (job) job.phase = 'Getting the music';
    const list = (await D.ytSongSearch(MOODS[kind] || MOODS.calm).catch(() => [])).filter((x) => !skip.includes(x.url));
    const long = list.filter((x) => (x.duration || 0) >= 90);
    const pick = long.slice(0, 8)[Math.floor(Math.random() * Math.min(8, long.length || 1))] || list[0];
    if (!pick) return null;
    const mj = { id: D.uid() };
    try { await D.grabSong(mj, pick.url, pick.title); return { file: path.join(D.CACHE_DIR, path.basename(mj.url)), url: mj.url, title: pick.title, mood: kind, src: pick.url, credit: attribution(pick) }; } catch { return null; }
  }

  // ---------------- captions ----------------
  const assTime = (t) => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
  const assEsc = (s) => String(s).replace(/[{}]/g, '').replace(/\\/g, '');
  function captionsAss(scenes, starts, W, H, title, opts) {
    const V = H > W, cs = opts.capStyle || 'bold', clean = cs === 'clean';
    const cap = Math.round((V ? H * 0.042 : H * 0.06) * (clean ? 0.82 : 1) * (opts.capScale || 1));
    const align = { top: 8, middle: 5, bottom: 2 }[opts.capPosition] || 2;
    const mv = Math.round(opts.capPosition === 'top' ? H * 0.10 : V ? H * 0.28 : H * 0.08);
    const font = FONT_NAMES[opts.capFont] || (clean ? 'Arial' : 'Arial Black');
    // bold: white Arial Black with an outline · clean: smaller, normal case · boxed: on a dark box · yellow: yellow words
    const capStyle = cs === 'boxed'
      ? `Style: Cap,${font},${cap},&H00FFFFFF,&H0000FFFF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,3,${Math.round(cap * 0.22)},0,${align},${Math.round(W * 0.08)},${Math.round(W * 0.08)},${mv},1\n`
      : `Style: Cap,${font},${cap},${cs === 'yellow' ? '&H0000E5FF' : '&H00FFFFFF'},&H0000FFFF,&H00000000,&H64000000,${clean ? -1 : 0},0,0,0,100,100,0,0,1,${Math.round(cap * (clean ? 0.07 : 0.09))},${Math.round(cap * 0.05)},${align},${Math.round(W * 0.08)},${Math.round(W * 0.08)},${mv},1\n`;
    const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n`
      + 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
      + capStyle
      + `Style: Banner,Arial,${Math.round(H * 0.028)},&H00FFFFFF,&H0000FFFF,&H300E0E0E,&H300E0E0E,-1,0,0,0,100,100,0,0,3,${Math.round(H * 0.008)},0,8,20,20,${Math.round(H * 0.04)},1\n`
      + `Style: Title,Arial Black,${Math.round(V ? H * 0.06 : H * 0.12)},&H00FFFFFF,&H0000FFFF,&H00000000,&H96000000,0,0,0,0,100,100,1,0,1,${Math.round(H * 0.006)},${Math.round(H * 0.004)},5,${Math.round(W * 0.08)},${Math.round(W * 0.08)},0,1\n`
      + '\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
    const ev = [];
    if (opts.banner && title) ev.push(`Dialogue: 2,${assTime(0)},${assTime(opts.total)},Banner,,0,0,0,,${assEsc(title)}`);
    if (title && opts.titleCard !== false) ev.push(`Dialogue: 1,${assTime(0.2)},${assTime(3.4)},Title,,0,0,0,,{\\fad(350,450)\\fscx92\\fscy92\\t(0,3200,\\fscx100\\fscy100)}${assEsc(title.toUpperCase())}`);
    if (opts.captions !== false) scenes.forEach((s, i) => {
      const ws = (s.cap || s.text).split(/\s+/).filter(Boolean), chunks = [];
      for (let k = 0; k < ws.length;) { let n = Math.min(V ? 3 : 5, ws.length - k); if (ws.length - (k + n) === 1) n++; chunks.push(ws.slice(k, k + n).join(' ')); k += n; }
      const total = chunks.reduce((a, c) => a + c.length + 2, 0), span = s.dur;
      let t = starts[i];
      for (const c of chunks) {
        const d = span * (c.length + 2) / total;
        ev.push(`Dialogue: 0,${assTime(t)},${assTime(t + d - 0.02)},Cap,,0,0,0,,{\\fad(60,0)\\fscx106\\fscy106\\t(0,110,\\fscx100\\fscy100)}${assEsc(V && !clean ? c.toUpperCase() : c)}`);
        t += d;
      }
    });
    return head + ev.join('\n') + '\n';
  }

  // ---------------- a project: the voice, the pictures each line can show, the songs, and up to 4 takes ----------------
  // Kept in cache/quick/<id>/ (project.json + its files), so every take can be changed and exported again later.
  const QUICK = path.join(D.CACHE_DIR, 'quick');
  const projDir = (id) => path.join(QUICK, String(id).replace(/[^\w-]/g, ''));
  const LOOK_POOL = ['portra', 'kodachrome', 'velvia', 'cine2383', 'fuji3510', 'polaroid', 'trix', ''];
  const STYLE_POOL = ['bold', 'boxed', 'yellow', 'clean'];
  const MOOD_POOL = ['calm', 'epic', 'mystery', 'inspiring'];
  const fileUrl = (P, f) => `/api/doc/file?id=${P.id}&f=${enc(path.basename(f))}`;
  const pub = (P, m) => ({ kind: m.kind, url: m.file ? fileUrl(P, m.file) : m.url, thumb: m.file && m.kind === 'img' ? fileUrl(P, m.file) : (m.thumb || ''), key: m.key || '', w: m.w, h: m.h, local: !!m.file, own: !!m.own });
  const pubMusic = (m) => ({ url: m.url, title: m.title, mood: m.mood });
  const saveP = (P) => {
    const file = path.join(projDir(P.id), 'project.json'), tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(P));
    fs.renameSync(tmp, file);
  };
  const loadP = (id) => { try { return JSON.parse(fs.readFileSync(path.join(projDir(id), 'project.json'), 'utf8')); } catch { return null; } };
  const assetUrl = (id, kind, index = 0) => '/api/doc/asset?' + new URLSearchParams({ id, kind, index });
  function assetFile(P, kind, index) {
    if (kind === 'voice') return path.join(projDir(P.id), 'voice.wav');
    if (kind === 'visual') return P.media[index]?.file;
    if (kind === 'music') return P.music[index]?.file;
  }
  // what the app gets: every picture as a URL it can show
  const forApp = (P) => ({ id: P.id, title: P.title, W: P.W, H: P.H, vertical: P.vertical, total: P.total, voice: `/api/doc/file?id=${P.id}&f=voice.wav`,
    scenes: P.scenes.map((x) => ({ text: x.text, cap: x.cap || x.text, start: x.start, dur: x.dur, len: x.len })), cands: P.cands,
    media: P.media.map((m) => pub(P, m)), music: P.music.map((m) => m && pubMusic(m)), takes: P.takes, opts: P.opts, source: P.source || '', sources: P.sources || [] });
  // Reload after a download before appending, so edits or another download made while it ran are kept.
  function addAsset(id, asset) {
    const P = loadP(id);
    if (!P) throw new Error('That project isn’t there anymore.');
    const audio = asset.kind === 'audio';
    const list = audio ? P.music : P.media;
    const mid = list.push(asset) - 1;
    if (audio) asset.url = fileUrl(P, asset.file);
    saveP(P);
    return { mid, ...(audio ? pubMusic(asset) : pub(P, asset)) };
  }
  const attribution = (item) => ({
    title: String(item.title || '').slice(0, 160), creator: String(item.channel || '').slice(0, 120),
    license: String(item.license || '').slice(0, 120), url: String(item.page || item.url || '').slice(0, 1600)
  });
  async function importAsset(P, item) {
    const url = String(item.url || '').slice(0, 3000);
    if (!/^https?:\/\//i.test(url)) throw new Error('Choose a clip or song with a web link.');
    const id = D.uid(), dir = projDir(P.id), credit = attribution(item);
    if (item.photo && !item.audio) {
      const image = { kind: 'img', url, key: credit.title, w: +item.w || 0, h: +item.h || 0, credit };
      await download([image], dir, null);
      if (!image.file) throw new Error('That picture could not be downloaded.');
      return image;
    }
    const job = { id, req: { url, audio: !!item.audio, title: credit.title, source: item.source, start: item.start, end: item.end, duration: item.duration, maxRes: item.res === '4K' ? 2160 : 1080 } };
    await D.grabClip(job);
    const src = path.join(D.CACHE_DIR, path.basename(job.url || ''));
    const file = path.join(dir, `picked_${id}${item.audio ? '.mp3' : '.mp4'}`);
    await fs.promises.copyFile(src, file);
    return item.audio ? { kind: 'audio', file, title: job.name || credit.title, mood: 'custom', credit }
      : { kind: 'vid', file, key: credit.title, thumb: item.thumb, w: +item.w || 0, h: +item.h || 0, credit };
  }
  // the time each picture is on screen: its scene's share (the first one also covers the opening breath, the last the ending)
  function timeline(P, pieces) {
    const n = P.scenes.map((_, i) => pieces.filter((x) => x.scene === i).length);
    return pieces.map((x) => ({ ...x, d: (P.scenes[x.scene].len + (x.scene === 0 ? 0.6 : 0) + (x.scene === P.scenes.length - 1 ? 1.6 : 0)) / Math.max(1, n[x.scene]) }));
  }
  // a take: for every line its pictures (a different set from the other takes where there are enough), camera moves,
  // a look, a caption style and a song
  function makeTake(P, k, per) {
    const pieces = [];
    P.scenes.forEach((_, i) => {
      const c = P.cands[i], n = Math.min(per[i], Math.max(1, c.length));
      for (let j = 0; j < n; j++) {
        let mid = c[(k * n + j) % c.length];
        const prev = pieces[pieces.length - 1];
        if (prev && prev.mid === mid && c.length > 1) mid = c[(k * n + j + 1) % c.length];
        pieces.push({ scene: i, mid, move: (k + pieces.length) % 4 });
      }
    });
    const o = P.opts;
    return { pieces, filter: o.filter,
      look: o.filter ? '' : k === 0 ? o.look : LOOK_POOL.filter((x) => x !== o.look)[(k * 3 + P.seed) % (LOOK_POOL.length - 1)],
      capStyle: k === 0 ? o.capStyle : STYLE_POOL.filter((x) => x !== o.capStyle)[(k - 1) % 3], music: P.music.length ? k % P.music.length : -1 };
  }
  async function prepare(job, spec) {
    const id = job.id, dir = projDir(id); fs.mkdirSync(dir, { recursive: true });
    const { FILTERS, VIDEO_FORMATS } = await editorStyles;
    const aspect = VIDEO_FORMATS.includes(spec.aspect) ? spec.aspect : spec.vertical ? '9:16' : '16:9';
    const [aw, ah] = aspect.split(':').map(Number), scale = Math.min(1920 / Math.max(aw, ah), 1080 / Math.min(aw, ah));
    const W = Math.round(aw * scale / 2) * 2, H = Math.round(ah * scale / 2) * 2;
    spec.vertical = H > W;
    const scenes = spec.scenes.map((x) => ({ ...x, text: String(x.text || '').trim() })).filter((x) => x.text);
    if (!scenes.length) throw new Error('The script is empty.');
    const durs = await speak(scenes, spec.voice, dir, job, spec.pace);
    const GAP = 0.32; let at = 0.6; // a breath before the first line
    const spoken = durs.reduce((sum, d) => sum + d, 0);
    const targetSpeech = spec.duration - GAP * scenes.length - 2.2;
    const rate = spec.duration ? spoken / targetSpeech : 1;
    if (rate < 0.5 || rate > 2 || !Number.isFinite(rate)) {
      const natural = Math.round(spoken + GAP * scenes.length + 2.2);
      throw new Error(`This script runs about ${natural} seconds. Choose a closer duration or adjust the script.`);
    }
    scenes.forEach((x, i) => { x.dur = durs[i] / rate; x.len = x.dur + GAP; x.start = at; at += x.len; });
    const total = at + 1.6; // and a moment at the end
    // the voice: every line at its time, silence between
    const vin = [], vf = [];
    scenes.forEach((x, i) => { vin.push('-i', `v${i}.wav`); vf.push(`[${i}:a]aresample=48000,aformat=channel_layouts=mono,${rate === 1 ? '' : `atempo=${rate.toFixed(6)},`}adelay=${Math.round(x.start * 1000)}:all=1[a${i}]`); });
    await ff([...vin, '-filter_complex', `${vf.join(';')};${scenes.map((_, i) => `[a${i}]`).join('')}amix=inputs=${scenes.length}:normalize=0:duration=longest,apad=whole_dur=${total.toFixed(2)},atrim=0:${total.toFixed(2)}[v]`, '-map', '[v]', '-c:a', 'pcm_s16le', 'voice.wav'], dir);
    scenes.forEach((_, i) => fs.rm(path.join(dir, `v${i}.wav`), () => {}));
    // captions in another language (the voice stays): every line translated (Argos, on this computer)
    if (spec.captions !== false && spec.capLang && spec.capLang !== 'en' && D.translate) {
      job.phase = 'Translating the captions';
      try { const t = await D.translate(scenes.map((x) => x.text), 'en', spec.capLang); scenes.forEach((x, i) => { if (t[i]) x.cap = t[i]; }); }
      catch (e) { job.note = 'The captions stayed in English: ' + e.message; }
    }
    const cl = await candidatesFor(spec.title, scenes, spec, job);
    const media = [], idx = new Map();
    const add = (m) => { const key = m.file || m.url; if (!idx.has(key)) { idx.set(key, media.length); media.push({ ...m }); } return idx.get(key); };
    const cands = cl.map((l) => l.map(add));
    // a song for each take (different moods when there's more than one take)
    const T = Math.max(1, Math.min(4, Number(spec.takes) || 1)), mus = [];
    if (spec.music !== 'none') {
      const moods = T === 1 ? [spec.music] : [spec.music, ...MOOD_POOL.filter((m) => m !== spec.music)].slice(0, T);
      for (const m of moods) {
        const got = await music(m, job, mus.map((x) => x?.src));
        if (got) {
          const file = path.join(dir, path.basename(got.file));
          try { await fs.promises.link(got.file, file); } catch { await fs.promises.copyFile(got.file, file); }
          mus.push({ ...got, file, url: fileUrl({ id }, file) });
        }
        job.pct = 42 + mus.length * 2;
      }
    }
    const P = { id, title: spec.title, W, H, vertical: !!spec.vertical, total, scenes: scenes.map(({ text, cap, start, dur, len }) => ({ text, cap, start, dur, len })),
      media, cands, music: mus, seed: Math.floor(Math.random() * 7), source: spec.source || '', sources: spec.sources,
      opts: { look: spec.look, filter: Object.hasOwn(FILTERS, spec.filter) ? spec.filter : null, capStyle: spec.capStyle, captions: spec.captions !== false, titleCard: spec.titleCard !== false, musicLevel: spec.musicLevel, capLang: spec.capLang } };
    // a new picture about every 4 seconds (a slow documentary feel, but never one picture for too long)
    const per = scenes.map((x) => Math.max(1, Math.min(5, Math.round((x.dur || 6) / 4.2))));
    P.takes = Array.from({ length: T }, (_, k) => makeTake(P, k, per));
    const used = [...new Set(P.takes.flatMap((t) => t.pieces.map((x) => x.mid)))].map((m) => media[m]);
    await download(used, dir, job, [50, 40]);
    // a picture that didn't download: another of its line's (or any) that did
    const okM = (m) => !!media[m]?.file;
    for (const t of P.takes) for (const x of t.pieces) if (!okM(x.mid)) x.mid = P.cands[x.scene].find(okM) ?? media.findIndex((m) => m.file);
    if (P.takes.some((t) => t.pieces.some((x) => x.mid < 0))) throw new Error('None of the pictures could be downloaded. Check the internet connection, or use your own folder.');
    saveP(P);
    return P;
  }

  // ---------------- exporting a take ----------------
  async function build(job, P, take, o) {
    const W = P.W, H = P.H, FPS = 30, dir = projDir(P.id);
    const tmp = path.join(D.TMP_DIR, 'doc_' + job.id); fs.mkdirSync(tmp, { recursive: true });
    try {
      const need = take.pieces.map((x) => P.media[x.mid]).filter(Boolean);
      await download(need, dir, job, [2, 8]);
      const pieces = timeline(P, take.pieces).map((x) => ({ ...x, m: P.media[x.mid] })).filter((x) => x.m?.file);
      if (!pieces.length) throw new Error('None of the pictures are there.');
      let next = 0, built = 0;
      const lanes = Math.max(1, Math.min(4, Math.floor((require('os').cpus().length || 4) / 3)));
      const buildOne = async (k) => {
        const { m, d } = pieces[k];
        const out = path.join(tmp, `p${k}.mp4`), dd = d.toFixed(3);
        const fi = k === 0 ? 0.6 : take.transition === 'cut' ? 0 : 0.18;
        const fo = k === pieces.length - 1 ? 1.2 : take.transition === 'cut' ? 0 : 0.18;
        const fades = [fi && `fade=t=in:st=0:d=${fi}`, fo && `fade=t=out:st=${Math.max(0, d - fo).toFixed(3)}:d=${fo}`].filter(Boolean).map((x) => x + ',').join('');
        const ar = (m.w && m.h) ? m.w / m.h : W / H, fit = ar / (W / H) < 0.72 || ar / (W / H) > 1.6;
        // slow camera moves: 0 push in, 1 pull out, 2 slide right, 3 slide left, 4 still
        const mv = Number.isInteger(pieces[k].move) ? pieces[k].move : k % 4, N = Math.max(1, Math.round(d * FPS)), ev = (x) => Math.round(x / 2) * 2;
        const xExpr = mv === 2 ? `(iw-ow)*(t/${dd})` : `(iw-ow)*(1-t/${dd})`;
        const move = mv === 4 ? `scale=${W}:${H}`
          : mv < 2
            // push in / pull out (drawn at 1.5x first, so the slow zoom stays smooth)
            ? `scale=${ev(W * 1.5)}:${ev(H * 1.5)},zoompan=z='${mv === 0 ? `1+0.13*on/${N}` : `1.13-0.13*on/${N}`}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`
            : `scale=${ev(W * 1.12)}:${ev(H * 1.12)},crop=${W}:${H}:x='${xExpr}':y='(ih-oh)/2'`;
        if (m.kind === 'img') {
          const vf = fit
            ? `split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:6,eq=brightness=-0.18:saturation=0.8[bg];[b]scale=${Math.round(W * 0.9)}:${Math.round(H * 0.9)}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,${move},`
            : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${move},`;
          await ff(['-loop', '1', '-framerate', String(FPS), '-t', dd, '-i', m.file, '-filter_complex', `[0:v]${vf}${fades}setsar=1,format=yuv420p[v]`, '-map', '[v]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-an', out], tmp);
        } else {
          await ff(['-stream_loop', '-1', '-t', dd, '-i', m.file, '-filter_complex', `[0:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${move},${fades}setsar=1,format=yuv420p[v]`, '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-an', out], tmp);
        }
        built++; job.phase = `Building picture ${built} of ${pieces.length}`; job.pct = 10 + (built / pieces.length) * 75;
      };
      await Promise.all(Array.from({ length: lanes }, async () => { while (next < pieces.length) await buildOne(next++); }));
      fs.writeFileSync(path.join(tmp, 'list.txt'), pieces.map((_, k) => `file 'p${k}.mp4'`).join('\n'));
      job.phase = 'Putting it together'; job.pct = 87;
      await ff(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'video.mp4'], tmp);
      const scenes = P.scenes.map((x, i) => ({ ...x, cap: o.caps?.[i] ?? x.cap }));
      const title = o.title ?? P.title;
      fs.writeFileSync(path.join(tmp, 'subs.ass'), captionsAss(scenes, scenes.map((x) => x.start), W, H, title, { ...take, captions: o.captions !== false, titleCard: o.titleCard, total: P.total }), 'utf8');
      job.phase = 'Adding the voice, music and captions'; job.pct = 92;
      const name = `${String(title || 'Video').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 70) || 'Video'} - Cutsona ${P.vertical ? 'short' : 'video'}`;
      let outName = name + '.mp4';
      for (let i = 2; fs.existsSync(path.join(D.exportDir(), outName)); i++) outName = `${name} (${i}).mp4`;
      const out = path.join(D.exportDir(), outName), total = P.total;
      const ins = ['-i', 'video.mp4', '-i', path.join(dir, 'voice.wav')];
      const mvol = { low: 0.2, high: 0.46 }[o.musicLevel] || 0.32;
      const mus = take.music >= 0 ? P.music[take.music] : null;
      let af = `[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=1.0[vo]`;
      if (mus?.file && fs.existsSync(mus.file)) {
        ins.push('-stream_loop', '-1', '-i', mus.file);
        // the music sits low and dips further under the voice, then fades out at the end
        af = `[1:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[vo][key];[2:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(2)},volume=${mvol},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, total - 3).toFixed(2)}:d=3[m];[m][key]sidechaincompress=threshold=0.02:ratio=9:attack=15:release=450[md];[vo][md]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[ao]`;
      } else af += ';[vo]anull[ao]';
      const videoFilters = [];
      const grade = await applyPreset(take.filter, take.look, '[0:v]', ins, videoFilters, W, H);
      let picture = grade.input;
      const fx = grade.filters;
      if (take.effects?.includes('vhs')) fx.push('chromashift=cbh=3:crh=-3', 'noise=alls=9:allf=t');
      if (take.effects?.includes('grain')) fx.push('noise=alls=15:allf=t+u');
      if (take.effects?.includes('vignette')) fx.push('vignette=angle=0.35');
      if (take.effects?.includes('bars')) fx.push('drawbox=y=0:w=iw:h=ih*0.065:c=black:t=fill', 'drawbox=y=ih*0.935:w=iw:h=ih*0.065:c=black:t=fill');
      fx.push('tpad=stop_duration=0.1:stop_mode=clone', 'subtitles=subs.ass');
      videoFilters.push(`${picture}${fx.join(',')}[text]`); picture = '[text]';
      const logo = P.media[take.logo];
      if (logo?.file && logo.kind === 'img') {
        const k = ins.filter((x) => x === '-i').length; ins.push('-i', logo.file);
        videoFilters.push(`[${k}:v]scale=${Math.max(2, Math.round(W * 0.12))}:-1[logo]`,
          `${picture}[logo]overlay=x=W-w-W*0.035:y=H*0.035[branded]`);
        picture = '[branded]';
      }
      const crf = { high: 17, compact: 25 }[take.quality] || 20;
      await ff([...ins, '-filter_complex', [af, ...videoFilters].join(';'), '-map', picture, '-map', '[ao]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', total.toFixed(2), out], tmp);
      const credits = [...(P.sources || []), ...pieces.map(({ m }) => m.credit || (m.url && attribution({ url: m.url, title: m.key }))),
        mus && (mus.credit || (mus.src && attribution({ url: mus.src, title: mus.title })))].filter((x) => x?.url);
      if (P.source && !credits.some((x) => x.url === P.source)) credits.unshift({ title: P.title, url: P.source });
      const lines = [...new Map(credits.map((x) => [x.url, x])).values()].map((x) => [x.title, x.creator, x.provider, x.license, x.url].filter(Boolean).join(' — '));
      await fs.promises.writeFile(out.replace(/\.mp4$/i, '.credits.txt'), `${title}\n\n${lines.length ? lines.join('\n') : 'User-supplied media and narration.'}\n`, 'utf8');
      job.status = 'done'; job.pct = 100; job.phase = 'Done';
      job.file = out; job.name = outName; job.url = `/exports/${encodeURIComponent(outName)}`; job.duration = total; job.project = P.id;
    } finally {
      setTimeout(() => fs.rm(tmp, { recursive: true, force: true }, () => {}), 2000);
    }
  }
  // one video straight through (Several topics): a project with one take, exported as it is
  async function render(job, spec) {
    const P = await prepare(job, { ...spec, takes: 1 });
    await build(job, P, P.takes[0], { captions: spec.captions, titleCard: spec.titleCard, musicLevel: spec.musicLevel });
  }
  async function exportHighlight(source, { start, end, layout, corner, filter, capStyle, cues, name }) {
    const tmp = path.join(D.TMP_DIR, 'highlight_' + D.uid());
    fs.mkdirSync(tmp, { recursive: true });
    const W = 1080, H = 1920;
    try {
      const duration = end - start;
      const text = cues.filter((x) => x.end > start && x.start < end)
        .map((x) => { const at = Math.max(0, x.start - start); return { text: x.text, start: at, dur: Math.min(duration, x.end - start) - at }; });
      if (text.length) fs.writeFileSync(path.join(tmp, 'subs.ass'), captionsAss(text, text.map((x) => x.start), W, H, '', { captions: true, capStyle }), 'utf8');
      let layoutGraph;
      if (layout === 'stack') {
        const x = corner.endsWith('right') ? 'iw-ow' : '0', y = corner.startsWith('bottom') ? 'ih-oh' : '0';
        layoutGraph = `[0:v]split[a][b];[a]crop=trunc(iw*0.38/2)*2:trunc(ih*0.38/2)*2:${x}:${y},scale=1080:704:force_original_aspect_ratio=increase,crop=1080:704[c];[b]scale=1080:1216:force_original_aspect_ratio=decrease,pad=1080:1216:(ow-iw)/2:(oh-ih)/2[d];[c][d]vstack[composed]`;
      } else if (layout === 'fit') {
        layoutGraph = '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[composed]';
      } else layoutGraph = '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[composed]';
      const ins = ['-ss', String(start), '-i', source], graph = [layoutGraph];
      const grade = await applyPreset(filter, null, '[composed]', ins, graph, W, H);
      if (text.length) grade.filters.push('subtitles=subs.ass');
      grade.filters.push('setsar=1', 'format=yuv420p');
      graph.push(`${grade.input}${grade.filters.join(',')}[portrait]`);
      const stem = String(name || 'Long video highlight').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || 'Long video highlight';
      const outName = `${stem} - ${D.uid().slice(-6)}.mp4`;
      const rendered = path.join(tmp, 'highlight.mp4');
      await ff([...ins, '-t', String(duration), '-filter_complex', graph.join(';'), '-map', '[portrait]', '-map', '0:a:0?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-r', '30', '-movflags', '+faststart', rendered], tmp);
      await fs.promises.copyFile(rendered, path.join(D.exportDir(), outName), fs.constants.COPYFILE_EXCL);
      return { name: outName, url: '/exports/' + enc(outName), duration };
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }
  const filterKey = (key) => typeof key === 'string' && /^[a-z][a-z0-9_]{0,24}$/.test(key) ? key : '';
  const readSpec = (b) => ({ title: String(b.title || 'Video').slice(0, 120), scenes: Array.isArray(b.scenes) ? b.scenes.slice(0, 400) : [], voice: String(b.voice || 'ryan'),
    vertical: !!b.vertical, aspect: b.aspect, filter: filterKey(b.filter), music: String(b.music || 'calm'), captions: b.captions !== false, titleCard: b.titleCard !== false,
    duration: b.duration ? Math.max(15, Math.min(1200, Number(b.duration) || 0)) : 0,
    pace: ['slow', 'fast'].includes(b.pace) ? b.pace : 'normal', capStyle: ['clean', 'boxed', 'yellow'].includes(b.capStyle) ? b.capStyle : 'bold',
    capLang: /^[a-z]{2,3}$/.test(String(b.capLang || '')) ? String(b.capLang) : 'en', look: /^[a-z0-9]{2,20}$/.test(String(b.look || '')) ? String(b.look) : '',
    musicLevel: ['low', 'high'].includes(b.musicLevel) ? b.musicLevel : 'normal', takes: Number(b.takes) || 1, source: String(b.source || '').slice(0, 300),
    sources: Array.isArray(b.sources) ? b.sources.filter((x) => /^https?:\/\//i.test(x?.url || '')).slice(0, 10)
      .map((x) => ({ ...attribution(x), provider: String(x.provider || '').slice(0, 80) })) : [],
    folder: b.folder && fs.existsSync(String(b.folder)) ? String(b.folder) : null });
  // a take as the app sends it back (only pictures of this project, moves 0-4)
  const cleanTake = (P, t) => ({
    pieces: (Array.isArray(t?.pieces) ? t.pieces : []).map((x) => ({ scene: Math.max(0, Math.min(P.scenes.length - 1, x.scene | 0)), mid: x.mid | 0, move: Math.max(0, Math.min(4, x.move | 0)) })).filter((x) => P.media[x.mid]),
    look: /^[a-z0-9]{0,20}$/.test(String(t?.look || '')) ? String(t?.look || '') : '', capStyle: STYLE_POOL.includes(t?.capStyle) ? t.capStyle : 'bold',
    music: Number.isInteger(t?.music) && t.music >= 0 && t.music < P.music.length ? t.music : -1,
    filter: filterKey(t?.filter),
    effects: Array.isArray(t?.effects) ? EFFECT_NAMES.filter((key) => t.effects.includes(key)) : [],
    transition: t?.transition === 'cut' ? 'cut' : 'fade',
    capFont: Object.hasOwn(FONT_NAMES, t?.capFont) ? t.capFont : 'default',
    capScale: Math.max(0.7, Math.min(1.5, Number(t?.capScale) || 1)),
    capPosition: ['top', 'middle'].includes(t?.capPosition) ? t.capPosition : 'bottom',
    banner: t?.banner === true,
    logo: Number.isInteger(t?.logo) && P.media[t.logo]?.kind === 'img' ? t.logo : null,
    quality: ['compact', 'high'].includes(t?.quality) ? t.quality : 'standard' });

  // ---------------- the routes ----------------
  async function route(req, res, p, q, json, readJson) {
    if (!p.startsWith('/api/doc/')) return false;
    if (p === '/api/doc/voices') {
      const win = await windowsVoices();
      json(res, 200, { natural: PIPER_VOICES.map((v) => ({ id: v.id, name: v.name, ready: voiceReady(v), mb: v.mb + (fs.existsSync(piperExe()) ? 0 : 21) })), system: win, canNatural: process.platform === 'win32' });
      return true;
    }
    if (p === '/api/doc/topics' && req.method === 'POST') {
      const b = await readJson(req);
      const items = (await topicMatches(String(b.topic || '').trim().slice(0, 200)))
        .map(({ content, ...entry }) => ({ ...entry, reference: !reusableText(entry) }));
      json(res, 200, { items });
      return true;
    }
    if (p === '/api/doc/script' && req.method === 'POST') {
      const b = await readJson(req);
      try {
        if (b.own) json(res, 200, { title: String(b.title || '').slice(0, 120), scenes: ownScript(b.own, b.title) });
        else json(res, 200, await researchScript(String(b.topic || '').trim().slice(0, 200), Math.max(0.5, Math.min(20, Number(b.minutes) || 3)), b.style, b.choice));
      } catch (e) { json(res, 400, { error: e.message }); }
      return true;
    }
    if (p === '/api/doc/folder' && req.method === 'POST') {
      try {
        const dir = await D.pickFolder('', 'Pick the folder with your pictures and clips');
        if (!dir) { json(res, 200, { cancelled: true }); return true; }
        json(res, 200, { dir, count: folderMedia(dir).length });
      } catch (e) { json(res, 400, { error: e.message }); }
      return true;
    }
    // one video straight through
    if (p === '/api/doc/make' && req.method === 'POST') {
      const b = await readJson(req);
      const job = { id: D.uid(), status: 'working', phase: 'Starting', pct: 1 };
      jobs.set(job.id, job);
      render(job, readSpec(b)).catch((e) => { job.status = 'error'; job.error = e.message; });
      json(res, 200, { id: job.id });
      return true;
    }
    // a project to edit: the voice, every line's pictures and up to 4 takes
    if (p === '/api/doc/prepare' && req.method === 'POST') {
      const b = await readJson(req);
      const job = { id: D.uid(), status: 'working', phase: 'Starting', pct: 1 };
      jobs.set(job.id, job);
      prepare(job, readSpec(b)).then((P) => { job.status = 'ready'; job.pct = 100; job.project = forApp(P); }).catch((e) => { job.status = 'error'; job.error = e.message; });
      json(res, 200, { id: job.id });
      return true;
    }
    if (p === '/api/doc/project') {
      const P = loadP(q.get('id'));
      if (!P) json(res, 404, { error: 'That project isn\'t there anymore.' }); else json(res, 200, forApp(P));
      return true;
    }
    if (p === '/api/doc/projects') {
      const dirs = fs.existsSync(QUICK) ? fs.readdirSync(QUICK, { withFileTypes: true }) : [];
      const items = dirs.filter((d) => d.isDirectory()).flatMap((d) => {
        const P = loadP(d.name);
        if (!P?.takes?.length) return [];
        const at = fs.statSync(path.join(projDir(P.id), 'project.json')).mtimeMs;
        return [{ id: P.id, title: P.title, total: P.total, takes: P.takes.length, vertical: P.vertical, at }];
      }).sort((a, b) => b.at - a.at);
      json(res, 200, { items });
      return true;
    }
    if (p === '/api/doc/transfer') {
      const id = q.get('id'), P = id && /^[\w-]+$/.test(id) && loadP(id);
      if (!P) { json(res, 404, { error: 'That Quick project is missing.' }); return true; }
      try {
        const used = [...new Set(P.takes.flatMap((t) => [...t.pieces.map((x) => x.mid), ...(Number.isInteger(t.logo) ? [t.logo] : [])]))];
        const mus = [...new Set(P.takes.map((t) => t.music).filter((i) => i >= 0))];
        const voice = assetFile(P, 'voice', 0);
        if (!fs.existsSync(voice)) throw new Error('The project’s narration file is missing.');
        for (const mid of used) if (!P.media[mid]?.file || !fs.existsSync(P.media[mid].file)) throw new Error(`The project needs “${P.media[mid]?.key || 'a scene asset'}”. Replace it in Quick Mode and send again.`);
        for (const index of mus) {
          const song = P.music[index];
          if (!song?.file || !fs.existsSync(song.file)) throw new Error(`The project’s song “${song?.title || 'Unknown'}” is missing.`);
          const dir = projDir(id), file = path.join(dir, path.basename(song.file));
          if (song.file !== file) {
            try { fs.linkSync(song.file, file); } catch { if (!fs.existsSync(file)) fs.copyFileSync(song.file, file); }
            song.file = file; song.url = fileUrl(P, file);
          }
        }
        if (mus.length) saveP(P);
        const doc = forApp(P);
        doc.voice = assetUrl(id, 'voice');
        for (const mid of used) doc.media[mid] = { ...doc.media[mid], credit: P.media[mid].credit, url: assetUrl(id, 'visual', mid), ref: { quick: { id, index: mid } } };
        for (const i of mus) doc.music[i].url = assetUrl(id, 'music', i);
        json(res, 200, doc);
      } catch (error) { json(res, 400, { error: error.message }); }
      return true;
    }
    if (p === '/api/doc/asset') {
      const id = q.get('id'), kind = q.get('kind'), n = q.get('index');
      const P = id && /^[\w-]+$/.test(id) && /^\d+$/.test(n || '') && loadP(id);
      const file = P && assetFile(P, kind, Number(n));
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) json(res, 404, { error: 'Project media is missing.' });
      else D.serveFile(req, res, file);
      return true;
    }
    // the changes you made (takes, captions, title), kept with the project
    if (p === '/api/doc/save' && req.method === 'POST') {
      const b = await readJson(req), P = loadP(b.id);
      if (!P) { json(res, 404, { error: 'unknown project' }); return true; }
      if (Array.isArray(b.takes)) P.takes = b.takes.slice(0, 8).map((t) => cleanTake(P, t));
      if (Array.isArray(b.caps)) P.scenes.forEach((x, i) => { if (typeof b.caps[i] === 'string') x.cap = b.caps[i].slice(0, 600); });
      if (typeof b.title === 'string') P.title = b.title.slice(0, 120);
      if (b.opts && typeof b.opts === 'object') for (const k of ['captions', 'titleCard']) if (typeof b.opts[k] === 'boolean') P.opts[k] = b.opts[k];
      if (b.opts?.musicLevel) P.opts.musicLevel = ['low', 'high'].includes(b.opts.musicLevel) ? b.opts.musicLevel : 'normal';
      saveP(P); json(res, 200, { ok: true });
      return true;
    }
    // more pictures for a line: a search (Wikimedia Commons, and Pexels photos and clips with a key)
    if (p === '/api/doc/search' && req.method === 'POST') {
      const b = await readJson(req), P = loadP(b.id), t = String(b.q || '').trim().slice(0, 120);
      if (!P || !t) { json(res, 400, { error: 'Type what to look for' }); return true; }
      const found = [...await commonsSearch(t, 18)];
      if (D.config.pexelsKey) {
        const o = P.vertical ? 'vertical' : 'horizontal';
        found.push(...(await D.pexelsSearch(t, o, 10, 'video').catch(() => [])).map((v) => ({ kind: 'vid', url: v.url, key: v.title, w: v.w, h: v.h, thumb: v.thumb })));
        found.push(...(await D.pexelsSearch(t, o, 10, 'photo').catch(() => [])).map((v) => ({ kind: 'img', url: v.url, key: v.title, w: v.w, h: v.h, thumb: v.thumb })));
      }
      const mids = found.map((m) => { const k = P.media.findIndex((x) => x.url === m.url); if (k >= 0) return k; P.media.push(m); return P.media.length - 1; });
      saveP(P);
      json(res, 200, { items: mids.map((k) => ({ mid: k, ...pub(P, P.media[k]) })) });
      return true;
    }
    // a picture you picked: on this computer before it's shown
    if (p === '/api/doc/fetch' && req.method === 'POST') {
      const b = await readJson(req), P = loadP(b.id), m = P?.media[b.mid | 0];
      if (!m) { json(res, 404, { error: 'unknown picture' }); return true; }
      if (!m.file) {
        await download([m], projDir(P.id), null);
        if (!m.file) { json(res, 502, { error: 'That picture could not be downloaded. Try another.' }); return true; }
        const latest = loadP(P.id);
        latest.media[b.mid | 0].file = m.file;
        saveP(latest);
      }
      json(res, 200, { mid: b.mid | 0, ...pub(P, m) });
      return true;
    }
    if (p === '/api/doc/import' && req.method === 'POST') {
      const b = await readJson(req), P = loadP(b.id);
      if (!P) { json(res, 404, { error: 'That project isn’t there anymore.' }); return true; }
      try { json(res, 200, addAsset(P.id, await importAsset(P, b.item || {}))); }
      catch (e) { json(res, 400, { error: e.message }); }
      return true;
    }
    // your own picture, clip or music
    if (p === '/api/doc/upload' && req.method === 'POST') {
      const P = loadP(q.get('id')), name = path.basename(String(q.get('name') || 'file'));
      const audio = q.get('kind') === 'audio';
      if (!P || !(audio ? AUDIO : MEDIA).test(name)) { json(res, 400, { error: audio ? 'Pick an audio file such as MP3, WAV or M4A.' : 'Pick a picture or video.' }); return true; }
      const f = path.join(projDir(P.id), 'own_' + D.uid() + '_' + name.replace(/[^\w.-]/g, '_').slice(-60));
      try {
        await new Promise((ok, no) => { let n = 0; const w = fs.createWriteStream(f); req.on('data', (d) => { n += d.length; if (n > 800 * 1024 * 1024) { req.destroy(); no(new Error('That file is too big (800 MB at most)')); } }); req.pipe(w); w.on('finish', ok); w.on('error', no); req.on('error', no); });
        if (audio) {
          const mp3 = f + '.mp3';
          try { await ff(['-i', f, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-q:a', '2', mp3], projDir(P.id)); }
          finally { await fs.promises.unlink(f).catch(() => {}); }
          json(res, 200, addAsset(P.id, { kind: 'audio', file: mp3, title: name, mood: 'custom' }));
        } else {
          const vid = /\.(mp4|mov|m4v|mkv|webm)$/i.test(name);
          json(res, 200, addAsset(P.id, { kind: vid ? 'vid' : 'img', file: f, key: name, own: true, w: Number(q.get('w')) || 0, h: Number(q.get('h')) || 0 }));
        }
      } catch (e) { json(res, 400, { error: e.message }); return true; }
      return true;
    }
    if (p === '/api/doc/file') {
      const id = q.get('id') || '', name = path.basename(String(q.get('f') || ''));
      if (!/^[\w-]+$/.test(id) || !name || name === '.' || name === '..') { json(res, 404, { error: 'not found' }); return true; }
      let f = path.join(projDir(id), name);
      if (!fs.existsSync(f) && MEDIA.test(name)) {
        f = loadP(id)?.media.find((m) => m.file && path.basename(m.file) === name)?.file;
      }
      if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) { json(res, 404, { error: 'not found' }); return true; }
      D.serveFile(req, res, f);
      return true;
    }
    // export one take as you changed it
    if (p === '/api/doc/render' && req.method === 'POST') {
      const b = await readJson(req), P = loadP(b.id);
      if (!P) { json(res, 404, { error: 'That project isn\'t there anymore.' }); return true; }
      const take = cleanTake(P, b.take);
      if (!take.pieces.length) { json(res, 400, { error: 'This take has no pictures' }); return true; }
      const job = { id: D.uid(), status: 'working', phase: 'Starting', pct: 1 };
      jobs.set(job.id, job);
      build(job, P, take, { caps: Array.isArray(b.caps) ? b.caps.map((x) => String(x ?? '').slice(0, 600)) : null, title: typeof b.title === 'string' ? b.title.slice(0, 120) : null,
        captions: b.captions !== false, titleCard: b.titleCard !== false, musicLevel: b.musicLevel }).catch((e) => { job.status = 'error'; job.error = e.message; });
      json(res, 200, { id: job.id });
      return true;
    }
    if (p === '/api/doc/status') {
      const job = jobs.get(q.get('id'));
      if (!job) json(res, 404, { error: 'unknown job' });
      else { const { dir: _d, ...out } = job; json(res, 200, out); }
      return true;
    }
    return false;
  }
  return { route, exportHighlight, projectMedia: (ref) => {
    if (!/^[\w-]+$/.test(ref?.id || '') || !Number.isInteger(ref.index) || ref.index < 0) return null;
    const P = loadP(ref.id), file = P && assetFile(P, 'visual', ref.index);
    return file && fs.existsSync(file) ? assetUrl(ref.id, 'visual', ref.index) : null;
  } };
};
