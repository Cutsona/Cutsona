// Viral searcher: which parts of a video are most likely to go viral on TikTok, Reels and Shorts, and why.
//
// It judges what the viral scan (viralscan.js on the server) saw second by second, the way people scroll:
//   - the first seconds decide everything: a hook (a line that makes you stop, a question, a big reaction, a shock)
//   - something has to happen: laughs, screams, sudden loud moments, fast action, a new shot every few seconds
//   - words that travel: emotion, conflict, stakes and money, absolutes ("never", "the best"), talking to "you"
//   - no dead air, no intros or "subscribe" talk, no black screens
//   - a payoff: the part ends on a punchline, a reaction or a strong line, not mid-sentence
//   - what real viewers did: YouTube's "Most replayed" heat, when the video has it
// Everything is scored 0..100. Pure functions: the same scan always gives the same answer.
import { sentencesOf } from './words.js';
import { quoteScore } from './moments.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const STEP = 0.5; // the viral curve: one value every half second

// [pattern, weight, kind]: phrases and words that make people stop, react, share and comment
const LEX = [
  [/\b(wait (for it|till|until|what)|watch (this|what happens|till the end)|you won'?t believe|you will not believe|no ?one (talks|tells|knows|expected)|nobody (talks|tells|knows|expected)|here'?s (why|how|the thing|what happened)|this is (why|how|what happens)|the (truth|secret|reason|problem|craziest part|worst part|best part) (is|about|was|why)|stop (doing|scrolling|it)|listen to (this|me)|pay attention|let me tell you|did you know|imagine (if|being)|what if|story ?time|plot twist|i can'?t believe|guess what|you need to (see|hear|know)|this changed|i was today years old|hear me out|the moment (when|i|he|she|they))\b/gi, 1.0, 'hook'],
  [/\b(oh my god|oh my gosh|omg|what the (hell|heck|fuck|f+)|no way|let'?s go+|holy (shit|crap|cow|moly)|are you (serious|kidding)|bro+|broo+|dude|yo+o|wow+|whoa+|oh no+|hell no|hell yeah|shut up|i'?m dead|i'?m crying|deadass|no shot|on god|insane|crazy|unreal|ridiculous|clutch|goated|cooked|unbelievable|what just happened|did you see that|get out)\b/gi, 0.85, 'reaction'],
  [/\[(laughter|laughs|laughing|applause|cheering|cheers|screams?|screaming|gasps?|crowd roars?)\]|\((laughs|laughter|laughing|applause|screams?)\)|\b(ha(ha)+|haha|lmao+|lmfao|lol+|hahaha+)\b/gi, 0.95, 'laugh'],
  [/\b(love|loved|hate|hated|scared|terrified|angry|furious|mad|cried|crying|tears|heartbroken|proud|shocked|shocking|disgusting|beautiful|amazing|incredible|terrible|horrible|devastated|obsessed|embarrassing|awkward|cringe|savage|brutal|wild|nightmare|dream)\b/gi, 0.55, 'emotion'],
  [/\b(wrong|lie|lied|lying|liar|fake|scam|scammed|exposed|cheat|cheated|cheating|fight|fought|beef|cancel+ed|banned|fired|sued|arrested|overrated|underrated|unpopular opinion|hot take|honestly|the truth|controversial|disrespect|disrespectful|toxic|betrayed|caught|secret|illegal|forbidden|warning|mistake|regret)\b/gi, 0.6, 'conflict'],
  [/\$\s?\d[\d,.]*\s?(k|m|million|billion)?|\b\d[\d,.]*\s?(k|m|million|billion|thousand|hundred|percent|%|dollars|bucks|grand|times|years|hours|days)\b|\b(millions?|billions?|thousands?|money|rich|broke|free|for free|win|won|winning|lost|lose|losing|record|world record|first ever|first time|last time|never again)\b(?!')/gi, 0.5, 'stakes'],
  [/\b(best|worst|most|least|never|always|everyone|everybody|everything|nothing|ever|only|biggest|craziest|greatest|hardest|funniest|scariest|weirdest|smartest|dumbest|literally|actually|seriously)\b/gi, 0.35, 'absolute'],
  [/\b(you|your|you'?re|y'?all|yourself)\b/gi, 0.18, 'you'],
  [/\b(fuck\w*|f+\*+k?\w*|shit\w*|s\*+t|damn|hell|ass|bitch\w*|crap)\b/gi, 0.42, 'intense'],
];
// what kills a clip: promos and intros, filler, "um"
const PROMO = /\b(thanks? (so much )?for watching|subscribe|like and (share|subscribe)|link in (the )?(bio|description)|in the description|comment below|follow (me|us)|patreon|sponsor(ed)?|use (my )?code|merch|smash that|notification|next video|in this video|welcome back|hey guys|what'?s up guys|today we'?re going to|before we (start|begin)|let'?s get (started|into it))\b/i;
const FILLER = /\b(um+|uh+|erm+|hmm+|you know|i mean|kinda|sorta|basically)\b/gi;

// every sentence: its words, how viral it sounds (0..1), what kind of line it is, and which words carry it
export function scoreWords(words = []) {
  const sents = sentencesOf(words);
  for (const s of sents) {
    // where each word sits in the sentence's text, so a phrase match lights up the right words
    let text = '', offs = [];
    // (curly apostrophes as plain ones: "won’t" is "won't", not "won" + "t"; same length, so the offsets hold)
    for (const w of s.words) { const t = String(w.text).trim().replace(/[’‘`]/g, "'"); if (text) text += ' '; offs.push([text.length, text.length + t.length]); text += t; }
    const wv = new Float32Array(s.words.length), kinds = new Set();
    let sum = 0;
    for (const [re, wt, kind] of LEX) {
      re.lastIndex = 0;
      let m, hits = 0;
      while ((m = re.exec(text))) {
        hits++;
        const a = m.index, b = a + m[0].length;
        offs.forEach(([x, y], k) => { if (y > a && x < b) wv[k] = Math.max(wv[k], wt); });
        if (!m[0].length) re.lastIndex++;
      }
      if (hits) { kinds.add(kind); sum += wt * Math.min(1.6, 1 + 0.3 * (hits - 1)); }
    }
    const q = /\?["'”’)]*$/.test(text), ex = /!["'”’)]*$/.test(text);
    if (q) { kinds.add('question'); sum += 0.35; }
    if (ex) sum += 0.2;
    const n = s.words.length, fill = (text.match(FILLER) || []).length;
    const promo = PROMO.test(text);
    const quote = quoteScore(text, { gapBefore: 1, gapAfter: 1, loud: 0.5 });
    // pace: words per second (fast, packed talk keeps people watching)
    const pace = n / Math.max(0.6, s.end - s.start);
    let v = 1 - Math.exp(-sum / 1.4);                      // the lexicon, saturating
    v = 0.72 * v + 0.28 * Math.min(1, quote * 1.6);        // quotable lines
    v += pace > 2.2 && pace < 5.5 ? 0.06 : pace < 1.2 ? -0.08 : 0;
    v -= 0.06 * fill + (n < 3 && !kinds.has('reaction') && !kinds.has('laugh') ? 0.15 : 0);
    if (promo) { v *= 0.15; kinds.add('promo'); }
    s.viral = clamp(v); s.kinds = [...kinds]; s.wordViral = Array.from(wv, (x) => +x.toFixed(2)); s.promo = promo;
    s.hook = !promo && (kinds.has('hook') || kinds.has('question') || kinds.has('reaction') || kinds.has('laugh') || (kinds.has('conflict') && v > 0.45));
  }
  return sents;
}

// the viral curve: 0..1 every half second, from what was seen, heard and said
export function viralCurve(scan, sents = null) {
  const D = scan.duration || 0, n = Math.max(1, Math.ceil(D / STEP)), k = Math.round(STEP / (scan.step || 0.25));
  const at = (arr, i) => { if (!arr?.length) return 0; let m = 0, c = 0; for (let j = i * k; j < (i + 1) * k && j < arr.length; j++) { m = Math.max(m, arr[j]); c++; } return c ? m : 0; };
  const mean = (arr, i) => { if (!arr?.length) return 0; let m = 0, c = 0; for (let j = i * k; j < (i + 1) * k && j < arr.length; j++) { m += arr[j]; c++; } return c ? m / c : 0; };
  sents = sents || scoreWords(scan.words || []);
  const speech = new Float32Array(n), talk = new Float32Array(n);
  for (const s of sents) {
    for (let i = Math.floor(s.start / STEP); i <= Math.min(n - 1, Math.floor(s.end / STEP)); i++) { speech[i] = Math.max(speech[i], s.viral); talk[i] = 1; }
    // the word that lands (the punchline, the "no way"): a spike right there
    s.words.forEach((w, j) => { const x = s.wordViral[j]; if (x >= 0.5) { const i = Math.min(n - 1, Math.floor(w.start / STEP)); speech[i] = Math.max(speech[i], Math.min(1, s.viral + x * 0.35)); } });
  }
  // shot changes per 3 s: a new shot every 1-3 s is the sweet spot
  const cutPace = new Float32Array(n);
  for (const c of scan.cuts || []) for (let i = Math.max(0, Math.floor((c - 1.5) / STEP)); i < Math.min(n, Math.ceil((c + 1.5) / STEP)); i++) cutPace[i] += 1;
  // "Most replayed": what viewers rewatched
  const replay = new Float32Array(n);
  const hm = scan.heatmap || [];
  if (hm.length) {
    const vs = hm.map((h) => h[2]), mx = Math.max(...vs), mn = Math.min(...vs);
    for (const [a, b, v] of hm) for (let i = Math.max(0, Math.floor(a / STEP)); i < Math.min(n, Math.ceil(b / STEP)); i++) replay[i] = (v - mn) / Math.max(1e-6, mx - mn);
  }
  const dark = new Uint8Array(n);
  for (const [a, b] of scan.dark || []) for (let i = Math.max(0, Math.floor(a / STEP)); i < Math.min(n, Math.ceil(b / STEP)); i++) dark[i] = 1;
  const hasSound = !!scan.loud?.length, hasPic = !!scan.motion?.length, hasWords = sents.length > 0, hasRep = hm.length > 0;
  const curve = new Float32Array(n), parts = { speech, loud: new Float32Array(n), burst: new Float32Array(n), motion: new Float32Array(n), replay, talk };
  for (let i = 0; i < n; i++) {
    const loud = mean(scan.loud, i), burst = at(scan.burst, i), bright = at(scan.bright, i), motion = mean(scan.motion, i);
    parts.loud[i] = loud; parts.burst[i] = burst; parts.motion[i] = motion;
    const pace = cutPace[i] ? clamp(1 - Math.abs(cutPace[i] - 1.5) / 3) : 0;
    let w = 0, v = 0;
    const add = (x, wt) => { v += x * wt; w += wt; };
    if (hasWords) add(speech[i], 0.34);
    if (hasSound) { add(loud, 0.14); add(burst, 0.2); add(bright, 0.08); }
    if (hasPic) { add(motion, 0.14); add(pace, 0.06); }
    if (hasRep) add(replay[i], 0.3);
    v = w ? v / w : 0;
    // a big reaction (a laugh, a scream, a hit) lifts the seconds around it whatever else is going on
    v = Math.max(v, burst * 0.85, hasWords ? speech[i] * 0.9 : 0);
    if (!hasWords) v *= 0.9; // no words: no hook line, no quotes (it can still go viral on what happens)
    if (dark[i]) v *= 0.08;
    if (hasSound && loud < 0.06 && !talk[i] && motion < 0.08) v *= 0.35; // dead air
    curve[i] = clamp(v);
  }
  // smooth a little: a moment, not a single frame
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = clamp(0.25 * (curve[i - 1] ?? curve[i]) + 0.5 * curve[i] + 0.25 * (curve[i + 1] ?? curve[i]));
  return { curve: out, parts, sents, dark };
}

const fmt = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; };
const short = (t, n = 64) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

// how viral the part [a, b] is: hook, body, peak, payoff, dead air, replays -> 0..100
function judge(A, a, b, good, complete = true) {
  const { curve, parts, dark } = A, n = curve.length;
  const cv = (x, y) => { let s = 0, c = 0, pk = 0; for (let i = Math.max(0, Math.floor(x / STEP)); i < Math.min(n, Math.ceil(y / STEP)); i++) { s += curve[i]; c++; pk = Math.max(pk, curve[i]); } return { mean: c ? s / c : 0, peak: pk }; };
  const h = cv(a, a + Math.min(3, (b - a) * 0.3)), first = good.find((s) => s.start >= a - 0.2 && s.start < a + 2.5);
  // the line that opens it counts most when it's said right away (within a second), less after a pause
  const soon = first ? (first.start - a <= 1 ? 1 : 0.45) : 0;
  const hook = clamp(h.peak * 0.6 + h.mean * 0.4 + (first?.hook ? 0.25 * soon : 0) + (first?.kinds.includes('question') ? 0.08 * soon : 0));
  const body = cv(a, b), tail = cv(a + (b - a) * 0.6, b);
  const payoff = clamp(tail.peak * 0.7 + (tail.peak > body.mean + 0.12 ? 0.2 : 0));
  let dead = 0, steps = 0, darkN = 0, rep = 0;
  for (let i = Math.max(0, Math.floor(a / STEP)); i < Math.min(n, Math.ceil(b / STEP)); i++) {
    steps++; if (dark[i]) darkN++;
    if (!parts.talk[i] && parts.loud[i] < 0.08 && parts.motion[i] < 0.1 && parts.burst[i] < 0.1) dead++;
    rep += parts.replay[i];
  }
  dead /= Math.max(1, steps); rep /= Math.max(1, steps);
  const L = b - a, lenFit = L >= 7 && L <= 35 ? 1 : L <= 60 ? 0.85 : 0.6;
  const raw = 0.27 * hook + 0.27 * body.mean + 0.16 * body.peak + 0.12 * payoff + 0.06 * (complete ? 1 : 0.6) + 0.05 * lenFit + 0.12 * rep - 0.45 * dead - 0.6 * (darkN / Math.max(1, steps));
  const score = Math.round(100 * Math.pow(clamp((raw - 0.12) / 0.74), 0.85));
  return { start: +a.toFixed(2), end: +b.toFixed(2), score, hook, body: body.mean, peak: body.peak, payoff, dead, rep, first };
}
// a part you picked yourself: its score and why
export function scorePart(A, a, b) {
  const good = A.sents.filter((s) => !s.promo), c = judge(A, a, b, good, true);
  return { score: c.score, ...explain(c, A) };
}

// The best parts to cut out and post: windows of about `lengths` seconds that start on a hook and end on a payoff,
// whole sentences only, scored 0..100 with the reasons. Up to `max`, not overlapping much.
export function viralMoments(scan, { lengths = [15, 30, 45, 60], max = 6, analysis = null } = {}) {
  const A = analysis || viralCurve(scan), { curve, sents } = A, n = curve.length, D = scan.duration || n * STEP;
  if (!n || D < 2) return [];
  const good = sents.filter((s) => !s.promo);
  // starts: where sentences begin (a part never starts mid-sentence); with little talking, also every 2 seconds
  // (moved back to the start of a sentence being said there)
  const cover = good.reduce((x, s) => x + (s.end - s.start), 0) / Math.max(1, D), sparse = cover < 0.5;
  const inside = (t) => good.find((s) => t > s.start + 0.05 && t < s.end - 0.05);
  const starts = good.map((s) => Math.max(0, s.start - 0.15));
  if (!good.length || sparse) for (let t = 0; t < D - 2; t += 2) { const s = inside(t); starts.push(s ? Math.max(0, s.start - 0.15) : t); }
  const uniq = [...new Set(starts.map((x) => +x.toFixed(2)))].sort((x, y) => x - y);
  const ends = good.length ? good.map((s) => s.end + 0.25) : null;
  const cands = [];
  for (const L of lengths.filter((x) => x <= D + 0.5)) {
    for (const a of uniq) {
      if (a > D - Math.min(L, D) * 0.6) continue;
      let b = Math.min(D, a + L);
      if (ends && !sparse) {
        let best = null, bd = Infinity;
        for (const e of ends) { if (e <= a + L * 0.75 || e > a + L + Math.min(3, Math.max(0.6, L * 0.12)) || e > D + 0.3) continue; const d = Math.abs(e - (a + L)); if (d < bd) { bd = d; best = e; } }
        if (best == null) continue;
        b = Math.min(D, best);
      } else {
        // never stop in the middle of a line: finish it (if it's not much longer), else stop before it
        const s = inside(b);
        if (s) b = s.end + 0.25 <= a + L + Math.min(3, Math.max(0.6, L * 0.12)) ? Math.min(D, s.end + 0.25) : Math.max(a + L * 0.75, s.start - 0.1);
      }
      if (b - a < Math.min(4, D * 0.5)) continue;
      cands.push(judge(A, a, b, good, !inside(a + 0.2) && !inside(b - 0.2)));
    }
  }
  cands.sort((x, y) => y.score - x.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= max) break;
    if (picked.some((p) => Math.min(p.end, c.end) - Math.max(p.start, c.start) > 0.3 * Math.min(p.end - p.start, c.end - c.start))) continue;
    picked.push(c);
  }
  return picked.map((c) => ({ start: c.start, end: c.end, score: c.score, ...explain(c, A) }));
}

// why a part should do well (and its best line), in plain words
function explain(c, A) {
  const { sents, parts } = A, why = [];
  const inside = sents.filter((s) => s.start >= c.start - 0.2 && s.end <= c.end + 0.3 && !s.promo);
  const best = [...inside].sort((x, y) => y.viral - x.viral)[0];
  if (c.first?.hook) why.push(`Hooks right away: “${short(c.first.text, 46)}”`);
  else if (c.hook > 0.6) why.push('Strong first seconds');
  // the biggest reaction: a laugh, a scream, a hit
  let bi = -1, bv = 0;
  for (let i = Math.floor(c.start / STEP); i < Math.min(parts.burst.length, Math.ceil(c.end / STEP)); i++) if (parts.burst[i] > bv) { bv = parts.burst[i]; bi = i; }
  const laugh = inside.find((s) => s.kinds.includes('laugh'));
  if (laugh) why.push(`Laughs at ${fmt(laugh.start)}`);
  else if (bv > 0.45) why.push(`Big reaction at ${fmt(bi * STEP)}`);
  if (c.rep > 0.5) why.push('Viewers replay this part the most');
  if (best && best.viral > 0.45 && best !== c.first) why.push(`Quotable: “${short(best.text, 50)}”`);
  const kinds = new Set(inside.flatMap((s) => s.kinds));
  if (kinds.has('conflict')) why.push('Drama: people will comment');
  else if (kinds.has('stakes')) why.push('Real stakes (money, records, wins)');
  else if (kinds.has('emotion')) why.push('Lots of emotion');
  let mv = 0, k = 0; for (let i = Math.floor(c.start / STEP); i < Math.min(parts.motion.length, Math.ceil(c.end / STEP)); i++) { mv += parts.motion[i]; k++; }
  if (k && mv / k > 0.45) why.push('Lots of action');
  if (c.dead < 0.04 && inside.length >= 2) why.push('No dead air');
  if (c.payoff > 0.65) why.push('Ends on a high');
  if (!why.length) why.push(c.score >= 50 ? 'Steady and watchable' : 'Quiet part');
  return { why: why.slice(0, 4), text: best?.text || '', hookText: c.first?.text || '' };
}

// short peaks (2-7 s) for beat edits: the reactions, punchlines and action Cutsona should cut to
export function viralHotspots(A, D, max = 24) {
  const { curve, sents } = A, n = curve.length, out = [];
  for (let i = 1; i < n - 1; i++) {
    const v = curve[i];
    if (v < 0.35) continue;
    let peak = true;
    for (let j = Math.max(0, i - 6); j <= Math.min(n - 1, i + 6); j++) if (curve[j] > v || (j < i && curve[j] === v)) { peak = false; break; }
    if (!peak) continue;
    const t = i * STEP, s = sents.find((x) => t >= x.start - 0.3 && t <= x.end + 0.3 && !x.promo);
    // a line: the whole sentence (with a beat of context before); otherwise the build-up and the moment
    const start = s ? Math.max(0, s.start - 0.4) : Math.max(0, t - 2.2), end = s ? Math.min(D, s.end + 0.6) : Math.min(D, t + 2.4);
    out.push({ t: start, start, end, score: v, viral: true, speech: !!s, reason: s ? `Viral line: “${short(s.text, 50)}”` : 'Viral moment (reaction / action)' });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

// a whole clip: its curve, best parts, hotspots and one score (0..100)
export function analyzeViral(scan, opts = {}) {
  const A = viralCurve(scan);
  const moments = viralMoments(scan, { ...opts, analysis: A });
  const hot = viralHotspots(A, scan.duration || 0);
  const top = moments.map((m) => m.score);
  const score = top.length ? Math.round(0.6 * top[0] + 0.25 * (top[1] ?? top[0] * 0.8) + 0.15 * (top[2] ?? top[0] * 0.7)) : 0;
  return { score, curve: A.curve, sents: A.sents, moments, hot, step: STEP, analysis: A };
}

// the words to light up in a transcript: { sentence index -> [word scores] } as HTML helpers
export function viralClass(x) { return x >= 0.85 ? 'vw3' : x >= 0.55 ? 'vw2' : x >= 0.35 ? 'vw1' : ''; }
export function sentenceHtml(s, esc) {
  return s.words.map((w, k) => { const c = viralClass(s.wordViral?.[k] || 0), t = esc(String(w.text).trim()); return c ? `<span class="${c}">${t}</span>` : t; }).join(' ').replace(/\s+([,.!?…])/g, '$1');
}
export const scoreColor = (s) => (s >= 75 ? 'hot' : s >= 55 ? 'warm' : s >= 35 ? 'mild' : 'cold');

// One take's chance of going viral (0..100) and what would raise it: what its cuts show (judged with each
// clip's viral curve), how hard it opens, its pace, length, shape, captions and sound.
export function takeVirality(plan, clips, e = {}, { music = false } = {}) {
  if (!plan?.segments?.length) return null;
  const segs = plan.segments, D = plan.duration || segs.at(-1).end;
  const valAt = (c, a, b) => {
    const cur = c?.viral?.curve;
    if (cur?.length) { let s = 0, k = 0, pk = 0; for (let i = Math.floor(a / STEP); i <= Math.min(cur.length - 1, Math.floor(b / STEP)); i++) { s += cur[i]; k++; pk = Math.max(pk, cur[i]); } return k ? 0.6 * s / k + 0.4 * pk : 0; }
    const iv = c?.interest; if (!iv?.length) return 0.35;
    let s = 0, k = 0; for (let i = Math.floor(a * 10); i <= Math.min(iv.length - 1, Math.floor(b * 10)); i++) { s += iv[i]; k++; } return k ? Math.min(1, (s / k) * 1.3) : 0.35;
  };
  let content = 0, firstV = 0;
  const vals = segs.map((s) => { const c = clips[s.clip], src = s.srcDur || s.end - s.start; return valAt(c, s.srcStart, s.srcStart + src); });
  segs.forEach((s, k) => { content += vals[k] * (s.end - s.start); });
  content /= Math.max(0.1, D);
  // the opening 1.5 s: the hook
  for (let k = 0; k < segs.length && segs[k].start < 1.5; k++) firstV = Math.max(firstV, vals[k]);
  const best = Math.max(...vals);
  const hook = clamp(firstV / Math.max(0.25, best) * 0.6 + firstV * 0.4);
  const cutsPerSec = segs.length / Math.max(1, D), speechy = e.pick === 'quotes';
  const pace = speechy ? clamp(1 - Math.abs(cutsPerSec - 0.35) / 0.6) : clamp(1 - Math.abs(cutsPerSec - 1.1) / 1.6);
  const lenFit = D >= 7 && D <= 35 ? 1 : D < 7 ? 0.65 : D <= 60 ? 0.82 : D <= 90 ? 0.6 : 0.4;
  const [fa, fb] = String(e.format || '9:16').split(':').map(Number), asp = fa / fb;
  const shape = asp < 0.7 ? 1 : asp < 1.05 ? 0.75 : 0.5;
  const words = clips.some((c) => c?.words?.length || c?.viral?.sents?.length);
  const caps = e.captions === 'on' ? 1 : words ? 0.3 : 0.75;
  const sound = music ? 1 : 0.7;
  const raw = 0.36 * clamp(content * 1.25) + 0.2 * hook + 0.12 * pace + 0.12 * lenFit + 0.08 * shape + 0.06 * caps + 0.06 * sound;
  const score = Math.round(100 * Math.pow(clamp((raw - 0.18) / 0.72), 0.9));
  const why = [], tips = [];
  const tip = (text, gain, fix) => { if (gain > 0) tips.push({ text, gain, fix }); };
  if (hook > 0.7) why.push('Opens on one of its strongest moments'); else tip('Open on the strongest moment: the hook has to land in the first 1-2 seconds', Math.round((0.75 - hook) * 20), 'regen');
  if (content > 0.55) why.push('Packed with viral moments'); else if (content < 0.4) {
    if (e.pick === 'viral') tip('Regen: a new take from the clips’ most viral parts', Math.round((0.55 - content) * 30), 'regen');
    else tip('Use the clips’ most viral parts (What to use → Most viral)', Math.round((0.55 - content) * 30), 'pick');
  }
  if (pace > 0.7) why.push('Good pace'); else tip(speechy ? 'Fewer, longer lines' : cutsPerSec < 1.1 ? 'Faster cuts' : 'Slow the cuts down a little', Math.round((0.8 - pace) * 12), 'pace');
  if (lenFit >= 1) why.push(`${Math.round(D)}s: a length people watch to the end`); else tip(D > 35 ? 'Shorter: 15-35 seconds gets watched to the end more' : 'A little longer: 7 seconds or more', Math.round((1 - lenFit) * 12), 'length');
  if (shape < 1) tip('Vertical 9:16 fills the phone screen', Math.round((1 - shape) * 8), 'format');
  if (words && e.captions !== 'on') tip('Turn on captions: most people watch on mute', 5, 'captions');
  if (!music) tip('Add a song: the cuts land on its beat', 3, 'music');
  return { score, why: why.slice(0, 3), tips: tips.sort((x, y) => y.gain - x.gain).slice(0, 3) };
}
