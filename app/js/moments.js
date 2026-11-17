// Score complete source windows, keeping setup, action and reaction together.
import { feeling } from './sounds.js';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function speechPhrases(words = [], duration = Infinity) {
  const phrases = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    phrases.push({ start: Math.max(0, group[0].start - 0.12), end: Math.min(duration, group.at(-1).end + 0.22),
      text: group.map(w => w.text).join(' ') });
    group = [];
  };
  for (const word of words) {
    if (group.length && (word.start - group.at(-1).end > 0.65 || word.end - group[0].start > 12)) flush();
    group.push(word);
    if (/[.!?]["'”’]*$/.test(word.text)) flush();
  }
  flush();
  for (let i = 1; i < phrases.length; i++) {
    if (phrases[i - 1].end > phrases[i].start) {
      const boundary = (phrases[i - 1].end - 0.22 + phrases[i].start + 0.12) / 2;
      phrases[i - 1].end = boundary; phrases[i].start = boundary;
    }
  }
  return phrases;
}

export function findMoments(curve, duration, { words = [], scenes = [], quality = [] } = {}) {
  const phrases = speechPhrases(words, duration);
  const out = [];
  const scoreWindow = (start, end, peak) => {
    let total = 0, count = 0, poor = 0;
    for (let t = start; t < end; t += 0.1) {
      total += curve[Math.min(curve.length - 1, Math.floor(t * 10))] || 0;
      count++;
      const q = quality[Math.min(quality.length - 1, Math.floor(t / duration * quality.length))];
      if (q != null && q < 0.15) poor++;
    }
    return clamp(total / Math.max(1, count) * 0.7 + peak * 0.3 - poor / Math.max(1, count) * 0.8, 0, 1);
  };
  if (phrases.length) {
    for (let i = 0; i < phrases.length; i++) {
      let end = phrases[i].end;
      for (let j = i + 1; j < phrases.length && phrases[j].end - phrases[i].start <= 10 && phrases[j].start - end < 1.2; j++) end = phrases[j].end;
      const start = phrases[i].start;
      const peak = Math.max(0, ...curve.slice(Math.floor(start * 10), Math.ceil(end * 10)));
      out.push({ t: start, start, end, score: scoreWindow(start, end, peak), speech: true, reason: 'Complete speech with context' });
    }
  } else {
    // Only real local peaks; a fallback covers quiet footage without inventing hype.
    const peaks = [];
    for (let i = 0; i < curve.length; i++) {
      if (curve[i] < 0.16) continue;
      let peak = true;
      for (let j = Math.max(0, i - 12); j <= Math.min(curve.length - 1, i + 12); j++) {
        if (curve[j] > curve[i] || (j < i && curve[j] === curve[i])) { peak = false; break; }
      }
      if (peak) peaks.push(i / 10);
    }
    if (!peaks.length) peaks.push(duration / 2);
    for (const t of peaks) {
      const before = [0, ...scenes.filter(s => s <= t)].at(-1);
      const after = scenes.find(s => s > t) ?? duration;
      const start = Math.max(before, t - 2), end = Math.min(after, t + 3);
      if (end - start < 0.5) continue;
      out.push({ t, start, end, sceneStart: before, sceneEnd: after, score: scoreWindow(start, end, curve[Math.floor(t * 10)] || 0), speech: false,
        reason: peaks.length === 1 && !curve.some(v => v > 0.16) ? 'Continuous quiet scene' : 'Action with setup and reaction' });
    }
  }
  return out.length ? out : [{ t: 0, start: 0, end: duration, score: 0, speech: false, reason: 'Continuous source scene' }];
}

const hash01 = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// seconds of [a, b] that sit on a still picture (title card, poster, end screen, frozen frame)
export function stillOverlap(clip, a, b) {
  let o = 0;
  for (const [s, e] of clip.stills || []) o += Math.max(0, Math.min(b, e) - Math.max(a, s));
  return o;
}

// The judgement calls a human editor makes on top of "is this a good moment":
//  · open with a hook (one of the strongest moments first)
//  · match the music: big moments on loud parts / drops, calmer footage on quiet parts
//  · keep variety: don't lean on one clip, don't cut back to the same shot you just left
//  · skip blurry / dark stretches, and shots that straddle a scene change (they flash two shots in one)
// ctx: { first, impact, use: seconds used per clip so far, share: each clip's fair share (0..1) }
export function editorSense(clip, ci, start, end, moment, meanInterest, importance, previous, ctx) {
  if (!ctx) return 0;
  const intensity = clamp(meanInterest * 0.6 + (moment.score || 0) * 0.5, 0, 1);
  let s = 0;
  if (ctx.first) s += intensity * 0.7;                                     // hook
  if (ctx.intro && moment.speech) s += 0.6;                                // opening hold: a line of dialogue, like movie edits
  s += (importance - 0.5) * (intensity - 0.35) * 0.9;                      // energy match
  if (ctx.impact) s += intensity * 0.35;                                   // drop / hit lands on a big moment
  // variety across clips (only when there's a choice)
  if (ctx.use && ctx.share && ctx.use.length > 1) {
    const total = ctx.use.reduce((a, b) => a + b, 0);
    if (total > 2) { const over = ctx.use[ci] / total - ctx.share[ci]; if (over > 0.12) s -= (over - 0.12) * 1.6; }
    if (previous && previous.ci === ci && Math.abs(start - previous.end) > 0.4) s -= 0.15;
  }
  // back to the shot we just left = looks like a mistake
  if (previous && previous.ci === ci && Math.abs(start - previous.end) > 0.4) {
    const scenes = clip.scenes || [];
    const a = Math.min(start, previous.end), b = Math.max(start, previous.end);
    if (!scenes.some((x) => x > a && x < b)) s -= 0.3;
  }
  if (!moment.speech) {
    // a scene change inside the window (not right at its edges) flashes two shots in one
    for (const x of clip.scenes || []) if (x > start + 0.25 && x < end - 0.25) { s -= 0.3; break; }
    // blurry / dark / frozen parts
    const q = clip.quality;
    if (q?.length && clip.duration) {
      let poor = 0, k = 0;
      for (let t = start; t < end; t += 0.25) { const v = q[Math.min(q.length - 1, Math.floor(t / clip.duration * q.length))]; if (v != null && v < 0.15) poor++; k++; }
      s -= (poor / Math.max(1, k)) * 0.6;
    }
  }
  return s;
}
// avoid: per clip, the source windows the OTHER edits already use (so the 4 edits show different footage)
// reuse: false = only footage this edit hasn't shown yet; true = footage is running out, least-shown first
// Scattered edits: the farther a part is from everything already used of this clip (and the less it repeats a
// scene), the better, so the edit reaches across the whole clip instead of circling its loudest moments
function spreadBonus(usedHere, start, end, L, sameScene) {
  if (!usedHere.length) return 0.08;
  let near = Infinity;
  for (const u of usedHere) near = Math.min(near, start >= u[1] ? start - u[1] : u[0] >= end ? u[0] - end : 0);
  return Math.min(1, near / (L * 0.12)) * 0.45 - (sameScene ? 0.3 : 0);
}
export function chooseWindow(clips, need, used, previous, importance = 0.5, variation = 0, avoid = null, reuse = false, ctx = null) {
  let best = null;
  clips.forEach((clip, ci) => {
    const limit = Math.max(0, Math.min(clip.duration, clip.usableEnd ?? clip.duration) - 0.04), from = clip.trimIn || 0;
    if (limit - from < need) return;
    // footage without speech: also consider every part of the clip (not only its peaks), so the 4 edits
    // and re-rolls always have somewhere different to go
    const extra = [];
    if (!clip.words?.length && (variation || avoid || ctx?.spread)) {
      const scenes = clip.scenes || [];
      for (let s = from; s + need <= limit; s += Math.max(0.75, need * 0.6)) {
        if (scenes.some((b) => b > s + 0.2 && b < s + need - 0.2)) continue;
        let m = 0, k = 0;
        for (let t = s; t < s + need; t += 0.3) { m += clip.interest?.[Math.floor(t * 10)] || 0; k++; }
        extra.push({ t: s + need * 0.4, start: s, end: s + need, sceneStart: s, sceneEnd: s + need, score: (m / Math.max(1, k)) * 0.75, speech: false, reason: 'Action with setup and reaction' });
      }
    }
    // Scattered: spread the picks over the whole clip, a different scene each time
    const L = Math.max(0.5, limit - from), scenesOf = clip.scenes || [];
    const sceneAt = (t) => { let k = 0; for (const x of scenesOf) { if (x <= t) k++; else break; } return k; };
    const usedScenes = ctx?.spread && !ctx.first && !ctx.intro ? new Set(used[ci].map((u) => sceneAt((u[0] + u[1]) / 2))) : null;
    for (const moment of [...(clip.moments || []), ...extra]) {
      const sceneStart = Math.max(from, moment.sceneStart ?? 0), sceneEnd = Math.min(limit, moment.sceneEnd ?? limit);
      const starts = moment.speech ? [moment.start] : [clamp(moment.t - need * 0.4, sceneStart, Math.max(sceneStart, sceneEnd - need))];
      for (const rawStart of starts) {
        const start = Math.max(0, rawStart);
        if (start + need > sceneEnd + 0.001) continue;
        if (clip.stills?.length && stillOverlap(clip, start, start + need) > 0.04) continue;
        // Never step back into (or just before) the shot we just showed; earlier unshown parts are fine.
        if (previous && ci === previous.ci && start < previous.end - 0.04 && start + need > (previous.start ?? 0) - 0.5) continue;
        let overlap = 0, taken = 0;
        for (const u of used[ci]) overlap += Math.max(0, Math.min(start + need, u[1]) - Math.max(start, u[0]));
        if (!reuse && overlap > need * 0.25) continue; // already shown in this edit
        if (avoid?.[ci]) for (const u of avoid[ci]) taken += Math.max(0, Math.min(start + need, u[1]) - Math.max(start, u[0]));
        let mean = 0, count = 0;
        for (let t = start; t < start + need; t += 0.2) { mean += clip.interest?.[Math.floor(t * 10)] || 0; count++; }
        const end = start + need;
        const phrase = moment.speech ? speechPhrases(clip.words, limit) : [];
        const atEnd = phrase.some(p => Math.abs(p.end - end) < 0.55);
        const interrupts = phrase.some(p => p.start + 0.15 < end && p.end - 0.15 > end);
        const smart = editorSense(clip, ci, start, end, moment, mean / Math.max(1, count), importance, previous, ctx);
        const score = smart + moment.score * 0.65 + mean / Math.max(1, count) * 0.5 + (atEnd ? 0.3 : 0)
          - (interrupts ? 0.4 : 0) - overlap / need * 2 + (previous?.ci === ci && Math.abs(start - previous.end) < 0.4 ? 0.25 : 0)
          - (moment.speech && previous?.ci === ci ? Math.max(0, start - previous.end - 0.8) * 0.12 : 0)
          // footage the other edits use (counted once per edit) is avoided, the more edits the stronger
          - Math.min(3, taken / need) * 2.5
          // each take/seed prefers different moments, so re-rolls and the 4 edits don't repeat each other
          + (variation ? (hash01((ci + 1) * 13.37 + start * 3.1 + (variation % 100000) * 0.017) - 0.5) * 0.35 : 0)
          + (usedScenes ? spreadBonus(used[ci], start, end, L, usedScenes.has(sceneAt((start + end) / 2)) && scenesOf.length > 1) : 0);
        if (!best || score > best.score) best = { ci, start, end, score, reason: usedScenes && !used[ci].length ? 'A new part of the clip' : moment.reason, speech: moment.speech, mEnd: moment.end };
      }
    }
  });
  return best;
}

// ---------------- "In order" (story) edits ----------------
// All clips laid end to end in Clips-list order make one timeline. An in-order edit only moves forward
// along it, and paces itself so the whole edit walks through the whole thing (start of the first clip
// near the start of the edit, end of the last clip near the end), picking good moments on the way.
export function storyTimeline(clips) {
  let total = 0;
  // a trimmed clip only counts its picked part (offs are shifted so offs[ci] + time-in-clip is the story position)
  const offs = clips.map((c) => { const a = c.trimIn || 0, o = total - a; total += Math.max(0, Math.min(c.duration || 0, c.usableEnd ?? c.duration ?? 0) - a); return o; });
  return { offs, total };
}
// from: timeline position the edit has reached · target: where it should be by now
export function chooseInOrder(clips, need, used, from, target, tl, variation = 0, avoid = null, reuse = false) {
  let best = null;
  const spread = Math.max(need * 3, tl.total * 0.06);
  clips.forEach((clip, ci) => {
    const limit = Math.max(0, Math.min(clip.duration || 0, clip.usableEnd ?? clip.duration ?? 0) - 0.04), from0 = clip.trimIn || 0;
    if (limit - from0 < need) return;
    const off = tl.offs[ci];
    if (off + limit < from) return; // already behind us
    const starts = [];
    for (const m of clip.moments || []) {
      if (m.speech) starts.push({ s: m.start, m });
      else starts.push({ s: clamp(m.t - need * 0.4, m.sceneStart ?? 0, Math.max(m.sceneStart ?? 0, Math.min(limit, m.sceneEnd ?? limit) - need)), m });
    }
    // every part of the clip is a candidate too (not just its best moments), so an in-order edit can follow the
    // whole video closely; with dialogue, only spots that don't cut a word in half
    const W = clip.words || [];
    const midWord = (t) => { // (words are in time order: find the last one starting before t)
      let lo = 0, hi = W.length - 1, k = -1;
      while (lo <= hi) { const md = (lo + hi) >> 1; if (W[md].start < t - 0.06) { k = md; lo = md + 1; } else hi = md - 1; }
      return k >= 0 && W[k].end > t + 0.06;
    };
    // (a long video: a coarser grid, near where the edit is now)
    const step = Math.max(0.4, need * 0.5, (limit - from0) / 400);
    for (let s = from0; s + need <= limit; s += step) if (!midWord(s) && !midWord(s + need)) starts.push({ s, m: null });
    for (const { s: raw, m } of starts) {
      const start = Math.max(from0, raw), end = start + need, g = off + start;
      if (end > limit + 0.001 || g < from - 0.04) continue;
      if (clip.stills?.length && stillOverlap(clip, start, end) > 0.04) continue;
      let overlap = 0, taken = 0;
      for (const u of used[ci]) overlap += Math.max(0, Math.min(end, u[1]) - Math.max(start, u[0]));
      if (!reuse && overlap > need * 0.25) continue;
      if (avoid?.[ci]) for (const u of avoid[ci]) taken += Math.max(0, Math.min(end, u[1]) - Math.max(start, u[0]));
      let mean = 0, k = 0;
      for (let t = start; t < end; t += 0.2) { mean += clip.interest?.[Math.floor(t * 10)] || 0; k++; }
      mean /= Math.max(1, k);
      const score = (m ? m.score * 0.6 : 0) + mean * 0.6
        - (Math.abs(g - target) / spread) * 0.5          // stay on pace with the edit
        - (g - from > spread * 2 ? 0.4 : 0)              // don't skip big parts of the video
        // keep enough footage ahead for the rest of the edit, so it ends on the last clip instead of wrapping around
        - (tl.left > need && tl.total - (g + need) < (tl.left - need) * 0.9 && tl.total >= tl.left ? 1.5 : 0)
        - (overlap / need) * 2 - Math.min(3, taken / need) * 1.2
        + (tl.intro && m?.speech ? 0.6 : 0)                // opening hold: prefer a line of dialogue
        // each take its own path through the video (a different seed picks different moments along the way)
        + (variation ? (hash01((ci + 1) * 7.77 + Math.round(start * 2) * 1.15 + (variation % 100000) * 0.013) - 0.5) * 0.7 : 0);
      if (!best || score > best.score) best = { ci, start, end, score, speech: !!m?.speech, mEnd: m?.end, reason: m?.reason ? `In order, ${m.reason}` : 'In order' };
    }
  });
  return best;
}

// ---------------- "Best quote" and "Best scene" ----------------
// Words that make a line quotable / inspiring (motivation, life lessons, big statements)
const INSPIRE = new Set(('never always believe dream dreams life live living love heart fear afraid hope win winning won lose losing lost fail failure ' +
  'success successful change world future today tomorrow everything nothing anything possible impossible keep stop start remember truth true power ' +
  'strong stronger strength greatest great best work hard chance choose choice decide matter matters purpose goal goals grind faith god family respect ' +
  'proud pain struggle grow learn mind soul free freedom legend champion trust yourself destiny brave courage give up quit rise fight focus believe ' +
  'patience discipline greatness better become difference beautiful forever moment chance worth deserve happiness happy enough').split(' '));
const PATTERNS = [/\bnever give up\b/i, /\bif you\b/i, /\byou have to\b/i, /\byou can\b/i, /\bdon'?t\b/i, /\bthe key\b/i, /\bthe secret\b/i,
  /\bremember\b/i, /\bat the end of the day\b/i, /\bin life\b/i, /\bone day\b/i, /\bthe only\b/i, /\bnobody\b/i, /\bwhen you\b/i, /\bnot .{1,30} but\b/i];
const FILLER = /\b(um+|uh+|like,|you know|i mean|kinda|sorta)\b/gi;
// intros / outros / promos are never "the best quote"
const PROMO = /\b(thanks? (so much )?for watching|subscribe|like and|link in|in the description|check out|comment below|follow (me|us)|patreon|sponsor|merch|smash that|notification|next video|this video|welcome back|hey guys|what'?s up guys)\b/i;

export function quoteScore(text, { gapBefore = 1, gapAfter = 1, loud = 0.4 } = {}) {
  const words = text.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const n = words.length;
  if (n < 4) return 0;
  const lenScore = n < 6 ? 0.4 : n <= 28 ? 1 : Math.max(0, 1 - (n - 28) / 20);
  const hits = words.filter(w => INSPIRE.has(w)).length;
  const pattern = PATTERNS.filter(p => p.test(text)).length;
  const personal = /\b(you|your|we|our|i)\b/i.test(text) ? 1 : 0;
  const strongEnd = /[!.]["'”’]*$/.test(text.trim()) ? 1 : 0;
  const filler = (text.match(FILLER) || []).length;
  const isolated = Math.min(1, (gapBefore + gapAfter) / 1.2);
  if (PROMO.test(text)) return 0;
  // (+ how strongly the line feels, from VADER's word scores, once its word list is loaded)
  return Math.max(0, 0.22 * lenScore + 0.3 * Math.min(1, hits / 3) + 0.18 * Math.min(1, pattern / 2) + 0.08 * personal
    + 0.06 * strongEnd + 0.08 * isolated + 0.08 * Math.min(1, loud * 1.6) - 0.08 * filler + 0.22 * feeling(text));
}

// ---------------- crowd ratings (what people actually rewatch and quote) ----------------
// clip.crowd (from the server): heatmap = YouTube "Most replayed" [start, end, value] in clip time,
// marks = timestamps people point at in comments, comments = top comments { text, likes },
// quotes = the movie / show's memorable quotes on Wikiquote.
const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function trigrams(s) {
  const w = norm(s).split(' ').filter(Boolean), set = new Set();
  for (let i = 0; i + 2 < w.length; i++) set.add(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]);
  return set;
}
// share of the shorter text's 3-word runs found in the other one (needs at least 2 shared runs)
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a.size < b.size ? a : b) if ((a.size < b.size ? b : a).has(x)) n++;
  return n >= 2 || (n === 1 && Math.min(a.size, b.size) === 1) ? n / Math.min(a.size, b.size) : 0;
}
const crowdIdx = new WeakMap();
function crowdIndex(cr) {
  let ix = crowdIdx.get(cr);
  if (!ix) {
    // quotes: index 3-word run -> quotes containing it (there can be thousands of quotes)
    const qmap = new Map(), qsize = [];
    (cr.quotes || []).forEach((q, i) => {
      const s = trigrams(q); qsize[i] = s.size;
      for (const t of s) { let l = qmap.get(t); if (!l) qmap.set(t, (l = [])); l.push(i); }
    });
    ix = { qmap, qsize, comments: (cr.comments || []).map((c) => ({ set: trigrams(c.text), likes: c.likes || 0 })).filter((c) => c.set.size) };
    crowdIdx.set(cr, ix);
  }
  return ix;
}
const fmtK = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(n));
// replay curve (0..1 at 10 samples / s) from "Most replayed" + timestamps in comments
export function replayCurve(clip) {
  const cr = clip.crowd, n = Math.ceil((clip.duration || 0) * 10);
  if (!cr || !n) return null;
  const rep = new Float32Array(n);
  const hm = cr.heatmap || [];
  if (hm.length) {
    const vs = hm.map((h) => h[2]), mx = Math.max(...vs), mn = Math.min(...vs);
    for (const [a, b, v] of hm) for (let i = Math.max(0, Math.floor(a * 10)); i < Math.min(n, Math.ceil(b * 10)); i++) rep[i] = (v - mn) / Math.max(1e-6, mx - mn);
  }
  for (const { t, likes } of cr.marks || []) {
    const w = Math.min(1, 0.4 + Math.log10((likes || 0) + 1) * 0.15);
    for (let i = Math.max(0, Math.floor((t - 1.5) * 10)); i < Math.min(n, Math.ceil((t + 4) * 10)); i++) rep[i] = Math.max(rep[i], w);
  }
  return rep.some((v) => v > 0) ? rep : null;
}
// how much people love the line / moment [start, end]
export function crowdBoost(clip, text, start, end) {
  const cr = clip.crowd;
  if (!cr) return { bonus: 0, why: '' };
  let famous = 0, fan = 0, likes = 0, rep = 0;
  const T = text ? trigrams(text) : null;
  if (T && T.size) {
    const ix = crowdIndex(cr);
    const hits = new Map();
    for (const t of T) for (const i of ix.qmap.get(t) || []) hits.set(i, (hits.get(i) || 0) + 1);
    for (const [i, n] of hits) {
      const m = Math.min(T.size, ix.qsize[i]);
      if (n >= 2 || (n === 1 && m === 1)) famous = Math.max(famous, n / m);
    }
    for (const c of ix.comments) if (overlap(T, c.set) >= 0.5) { fan += Math.log10(c.likes + 10); likes += c.likes; }
  }
  if (clip.replay) {
    let k = 0;
    for (let t = start; t < end; t += 0.2) { rep += clip.replay[Math.floor(t * 10)] || 0; k++; }
    rep /= Math.max(1, k);
  }
  const bonus = (famous >= 0.5 ? 0.45 + 0.3 * famous : 0) + Math.min(0.55, fan * 0.13) + rep * 0.4;
  const why = famous >= 0.5 ? 'Famous quote (Wikiquote)' : fan ? `Fans quote this (${fmtK(likes)} likes)` : rep > 0.55 ? 'Most replayed part' : '';
  return { bonus, why, famous, fan, rep };
}
const wordsIn = (clip, a, b) => (clip.words || []).filter((w) => w.start >= a - 0.05 && w.end <= b + 0.05).map((w) => w.text).join(' ');
// Fold the crowd ratings into the clip: replayed / pointed-at seconds count as more interesting, and
// moments (incl. full sentences) that people quote or rewatch score higher. Safe to call again.
export function applyCrowd(clip) {
  if (!clip.crowd) return;
  if (!clip.baseInterest) clip.baseInterest = Float32Array.from(clip.interest || []);
  const base = clip.baseInterest;
  clip.replay = replayCurve(clip);
  if (clip.replay) {
    const iv = Float32Array.from(base);
    for (let i = 0; i < iv.length; i++) if (base[i] > 0) iv[i] = Math.min(1, base[i] * (0.7 + 0.6 * (clip.replay[i] || 0)) + 0.25 * (clip.replay[i] || 0));
    clip.interest = iv;
  }
  clip.moments = boostMoments(clip, findMoments(clip.interest, clip.usableEnd ?? clip.duration, { words: clip.words, scenes: clip.scenes, quality: clip.quality }));
}
export function boostMoments(clip, moments) {
  if (!clip.crowd) return moments;
  return moments.map((m) => {
    const b = crowdBoost(clip, m.speech ? wordsIn(clip, m.start, m.end) : '', m.start, m.end);
    return b.bonus > 0.05 ? { ...m, score: Math.min(1.6, m.score + b.bonus), reason: b.why ? `${b.why}, ${m.reason}` : m.reason, crowd: b.bonus } : m;
  });
}

// Complete sentences ranked by how quotable they are (each one becomes a source moment)
export function quoteMoments(clip) {
  const phrases = speechPhrases(clip.words || [], clip.usableEnd ?? clip.duration);
  const out = [];
  for (let i = 0; i < phrases.length; i++) {
    // allow a quote to span 2 sentences when they belong together (short gap)
    for (const span of [1, 2]) {
      const last = phrases[i + span - 1];
      if (!last || (span === 2 && last.start - phrases[i].end > 0.6)) continue;
      const start = phrases[i].start, end = last.end;
      if (end - start < 1.2 || end - start > 16) continue;
      const text = phrases.slice(i, i + span).map(p => p.text).join(' ');
      let loud = 0, c = 0;
      for (let t = start; t < end; t += 0.2) { loud += clip.interest?.[Math.floor(t * 10)] || 0; c++; }
      const score = quoteScore(text, { gapBefore: i ? start - phrases[i - 1].end : 1.5, gapAfter: phrases[i + span] ? phrases[i + span].start - end : 1.5, loud: loud / Math.max(1, c) });
      // what people think counts most: lines fans quote in the comments / Wikiquote's memorable quotes / replayed parts
      const cb = crowdBoost(clip, text, start, end);
      const shown = `“${text.length > 70 ? text.slice(0, 68) + '…' : text}”`;
      if (score > 0.28 || cb.bonus >= 0.3) out.push({ t: start, start, end, score: Math.min(1, score * 1.4) + cb.bonus, speech: true, text,
        reason: cb.why ? `${cb.why}: ${shown}` : `Best quote: ${shown}` });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 24);
}

// The strongest visual/action moments, ignoring speech boundaries
export function sceneMoments(clip) {
  const ms = findMoments(clip.interest || new Float32Array(10), clip.usableEnd ?? clip.duration, { scenes: clip.scenes || [], quality: clip.quality || [] });
  return ms.map(m => {
    const cb = crowdBoost(clip, '', m.start, m.end); // most-replayed scenes first
    return { ...m, score: Math.min(1, m.score * 1.2) + cb.bonus, reason: cb.why ? `Best scene, ${cb.why}` : 'Best scene' };
  }).sort((a, b) => b.score - a.score);
}
