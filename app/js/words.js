// Words with times (from speech recognition or a video's captions): sentences, search and "smart" part edges.
// A word is { start, end, text } in seconds.

// group words into sentences: a full stop / ? / !, a pause, or a long run of words ends one
export function sentencesOf(words = []) {
  const out = [];
  let cur = null;
  for (const w of words) {
    if (!w || !String(w.text || '').trim()) continue;
    if (cur && (w.start - cur.end > 0.8 || cur.words.length >= 24)) cur = null;
    if (!cur) { cur = { start: w.start, end: w.end, words: [] }; out.push(cur); }
    cur.words.push(w); cur.end = Math.max(cur.end, w.end);
    if (/[.?!…]["'”’)\]]*$/.test(String(w.text).trim())) cur = null;
  }
  for (const s of out) s.text = s.words.map((w) => String(w.text).trim()).join(' ').replace(/\s+([,.!?…])/g, '$1');
  return out;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// sentences that contain the search (every typed word, in any order; an exact phrase ranks first)
export function searchSentences(sents, query) {
  const q = norm(query);
  if (!q) return [];
  const terms = q.split(' ');
  const hits = [];
  sents.forEach((s, i) => {
    const t = ' ' + norm(s.text) + ' ';
    if (!terms.every((w) => t.includes(w))) return;
    const exact = t.includes(' ' + q + ' ') ? 2 : t.includes(q) ? 1 : 0;
    // the word where the hit starts, so a click can jump right to it
    const first = s.words.find((w) => norm(w.text).includes(terms[0])) || s.words[0];
    hits.push({ i, s, at: first.start, score: exact });
  });
  return hits.sort((a, b) => b.score - a.score || a.at - b.at);
}

// where a part should start if you pick time t: the start of the sentence being said, if it began just before,
// otherwise just before the next word (never in the middle of a word)
export function smartStart(sents, t) {
  const s = sents.find((x) => t >= x.start - 0.3 && t <= x.end + 0.2);
  if (s && t - s.start < 4) return Math.max(0, s.start - 0.15);
  for (const x of sents) for (const w of x.words) if (w.end >= t) return Math.max(0, w.start - 0.12);
  return t;
}

// where a part of about `len` seconds from `a` should end: at the end of a sentence close to that length (a little
// shorter, or a few seconds longer at most: a 30 s part stays about 30 s), otherwise at a + len, after the word
// being said there
export function smartEnd(sents, a, len) {
  const want = a + len, lo = want - Math.max(1.5, len * 0.15), hi = want + Math.min(3, Math.max(0.6, len * 0.12));
  let best = null, bd = Infinity;
  for (const s of sents) {
    if (s.end <= a + Math.min(1, len * 0.5) || s.end < lo || s.end > hi) continue;
    // (a sentence end just after the length is as good as one a bit before it)
    const d = s.end >= want ? (s.end - want) * 0.8 : want - s.end;
    if (d < bd) { bd = d; best = s; }
  }
  if (best) return best.end + 0.25;
  for (const s of sents) for (const w of s.words || []) if (w.start < want && w.end >= want) return w.end - want < 0.8 ? w.end + 0.12 : want;
  return want;
}

export const fmtT = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// a sentence as HTML with the searched words marked
export function markWords(text, query) {
  const terms = norm(query).split(' ').filter((w) => w.length > 1 || /\d/.test(w));
  let h = escHtml(text);
  if (!terms.length) return h;
  const re = new RegExp(`(${terms.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return h.replace(re, '<mark>$1</mark>');
}
