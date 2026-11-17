// Smarter clips with open-source models (downloaded once, run on this PC):
// - YAMNet (Google, Apache 2.0, via MediaPipe Tasks Audio) hears what happens in a clip's sound: laughter, cheering
//   and applause, screaming and shouting, gasps, explosions and crashes. Those are the moments people react to.
// - VADER (C.J. Hutto, MIT) knows how strongly words feel ("insane", "love", "terrible"), so emotional lines rank higher.
let clfP = null, lexP = null, lexicon = null;

export function loadSoundModel() {
  if (!clfP) {
    clfP = (async () => {
      const r = await fetch('/api/sounds', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'could not download the sound detector');
      const mp = await import('/vision/audio/audio_bundle.mjs');
      const files = await mp.FilesetResolver.forAudioTasks('/vision/audio/wasm');
      return mp.AudioClassifier.createFromOptions(files, { baseOptions: { modelAssetPath: '/vision/audio/yamnet.tflite' }, maxResults: 25, scoreThreshold: 0.04 });
    })();
    clfP.catch(() => { clfP = null; });
  }
  return clfP;
}

// YAMNet's 521 sound names, grouped into what matters for a clip
const KINDS = {
  laugh: /^(Laughter|Baby laughter|Giggle|Snicker|Belly laugh|Chuckle, chortle)$/,
  cheer: /^(Cheering|Applause|Clapping|Crowd|Hubbub, speech noise, speech babble|Children playing)$/,
  scream: /^(Screaming|Shout|Yell|Children shouting|Battle cry|Whoop|Bellow|Wail, moan|Crying, sobbing)$/,
  gasp: /^(Gasp|Sigh|Whistling)$/,
  boom: /^(Explosion|Gunshot, gunfire|Machine gun|Boom|Burst, pop|Smash, crash|Shatter|Slam|Thump, thud|Bang)$/,
  music: /^(Music|Musical instrument)$/,
};
// every half second of the clip: how sure YAMNet is of each kind of sound (0..1)
export async function soundEvents(audioBuffer, onPct = () => {}) {
  const clf = await loadSoundModel();
  const sr = 16000, dur = audioBuffer.duration;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(dur * sr)), sr);
  const src = off.createBufferSource(); src.buffer = audioBuffer; src.connect(off.destination); src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  const n = Math.ceil(dur * 2), out = Object.fromEntries(Object.keys(KINDS).map((k) => [k, new Float32Array(n)]));
  const CH = sr * 30; // half a minute at a time, so the page stays smooth
  for (let a = 0; a < mono.length; a += CH) {
    const part = mono.subarray(a, Math.min(mono.length, a + CH + sr)); // (a second of overlap)
    let res = [];
    try { res = clf.classify(part, sr) || []; } catch (e) { console.warn('sounds', e); }
    for (const r of res) {
      const t = a / sr + (r.timestampMs || 0) / 1000;
      const cats = r.classifications?.[0]?.categories || [];
      for (const [k, re] of Object.entries(KINDS)) {
        let p = 0; for (const c of cats) if (re.test(c.categoryName)) p = Math.max(p, c.score);
        if (p <= 0) continue;
        // a window is about a second long: it covers this half-second and the next
        for (const i of [Math.floor(t * 2), Math.floor(t * 2) + 1]) if (i >= 0 && i < n) out[k][i] = Math.max(out[k][i], p);
      }
    }
    onPct(Math.min(99, Math.round((a + CH) / mono.length * 100)));
    await new Promise((r) => setTimeout(r, 0));
  }
  return { step: 0.5, ...out };
}
// how much the crowd / the people in it react at time t (0..~1.5)
export function reactionAt(s, t) {
  if (!s) return 0;
  const i = Math.floor(t / s.step);
  const g = (k) => s[k]?.[i] || 0;
  return 1.1 * g('laugh') + 0.9 * g('cheer') + 0.8 * g('scream') + 0.5 * g('gasp') + 0.45 * g('boom');
}
// the strongest reactions, as short labels for "why this part"
export function reactionLabel(s, a, b) {
  if (!s) return '';
  const names = { laugh: 'laughter', cheer: 'cheering', scream: 'screaming', gasp: 'gasps', boom: 'a big hit' }, found = [];
  for (const k of Object.keys(names)) {
    let top = 0; for (let i = Math.max(0, Math.floor(a / s.step)); i <= Math.min(s[k].length - 1, Math.ceil(b / s.step)); i++) top = Math.max(top, s[k][i]);
    if (top > 0.35) found.push([names[k], top]);
  }
  return found.sort((x, y) => y[1] - x[1]).slice(0, 2).map((x) => x[0]).join(' and ');
}

// ---- VADER: how strongly a word feels (-4..4) ----
export function loadLexicon() {
  if (!lexP) {
    lexP = (async () => {
      await fetch('/api/sounds', { method: 'POST' });
      const txt = await (await fetch('/vision/text/vader_lexicon.txt')).text();
      const m = new Map();
      for (const line of txt.split('\n')) { const [w, v] = line.split('\t'); if (w && v && /^[a-z']+$/.test(w)) m.set(w, Number(v)); }
      lexicon = m;
      return m;
    })();
    lexP.catch(() => { lexP = null; });
  }
  return lexP;
}
// a line's emotional strength, 0..1 (VADER's word scores with its boosters, "!" and ALL CAPS)
const BOOST = new Set(['absolutely', 'amazingly', 'completely', 'extremely', 'freaking', 'fucking', 'hella', 'incredibly', 'insanely', 'literally', 'really', 'so', 'super', 'totally', 'very', 'way']);
export function feeling(text) {
  if (!lexicon || !text) return 0;
  const toks = String(text).split(/\s+/).filter(Boolean);
  let sum = 0, boost = 1;
  for (const raw of toks) {
    const w = raw.toLowerCase().replace(/[^a-z']/g, '');
    if (BOOST.has(w)) { boost = 1.3; continue; }
    const v = lexicon.get(w);
    if (v) { let x = Math.abs(v) * boost; if (raw.length > 2 && raw === raw.toUpperCase() && /[A-Z]/.test(raw)) x *= 1.25; sum += x; }
    boost = 1;
  }
  const bangs = Math.min(3, (String(text).match(/!/g) || []).length);
  sum += bangs * 0.6;
  // VADER's normalisation: x / sqrt(x² + 15)
  return sum / Math.sqrt(sum * sum + 15);
}
export const lexiconReady = () => !!lexicon;
