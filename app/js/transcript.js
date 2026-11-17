// A clip's transcript: every word with its time. Click a word to start the clip there, Shift+click (or right-click)
// a word to end it there. "Smart" keeps whole sentences: the start goes back to the start of the sentence when you
// click just after it began, and the end lands where a sentence ends close to the length you want.
// Words come from the speech tools on this PC, or from the video's own captions when it came from a link.
import { sentencesOf, searchSentences, smartStart, smartEnd, fmtT, escHtml as esc, markWords } from './words.js';
import { scoreWords, analyzeViral, viralMoments, scorePart, viralClass, scoreColor } from './viral.js';
const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3.5 5 6 5 11a5 5 0 0 1-10 0c0-2.2 1-3.8 2.3-5 .2 1.6 1 2.7 2.2 3.2C11 8 12.3 5.2 12 2z"/></svg>';

export function createTranscript({ state, toast, setTrim, clipFull, clipTrim, onTrim, analyzeSpeech, openSettings, explainViral }) {
  const root = document.createElement('div');
  root.className = 'tw-dlg'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Transcript');
  document.body.appendChild(root);
  let clip = null, words = [], sents = [], a = 0, b = 0, len = 15, smart = true, q = '', from = '', tick = 0, video = null;
  // virality: per-word scores of these words; the clip's viral analysis (the whole-clip scan, or the words alone)
  let vs = [], VA = null, trimK = -1, trimL = 0;
  try { const v = JSON.parse(localStorage.getItem('cutsona.twOpts') || '{}'); if (v.len > 0) len = v.len; if (v.smart === false) smart = false; } catch {}
  const saveOpts = () => { try { localStorage.setItem('cutsona.twOpts', JSON.stringify({ len, smart })); } catch {} };

  // the words of a clip: speech tools, else the captions of the video it came from (shifted to the clip's start)
  async function loadWords(c) {
    if (c.words?.length) return { words: c.words, from: 'speech' };
    if (c.ytWords?.length) return { words: c.ytWords, from: 'captions' };
    const url = c.origin?.url || c.origin?.page;
    if (/^https:\/\//i.test(url || '')) {
      const r = await fetch('/api/transcript?url=' + encodeURIComponent(url));
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.words?.length) {
        const off = Number(c.srcOffset) || 0, D = c.duration || Infinity;
        c.ytWords = j.words.map((w) => ({ ...w, start: +(w.start - off).toFixed(2), end: +(w.end - off).toFixed(2) })).filter((w) => w.start >= -0.2 && w.start < D);
        if (c.ytWords.length) return { words: c.ytWords, from: 'captions' };
      }
    }
    if (c.speechState !== 'done' && c.speechState !== 'failed' && analyzeSpeech) { await analyzeSpeech(c); if (c.words?.length) return { words: c.words, from: 'speech' }; }
    return { words: [], from: '' };
  }

  async function open(c) {
    clip = c; q = '';
    const [ta, tb] = clipTrim(c); a = ta; b = tb;
    root.hidden = false;
    root.innerHTML = `<div class="tw-card">
      <div class="tw-h"><b>Transcript</b><span class="tw-name" title="${esc(c.name)}">${esc(c.name)}</span><button class="small tw-x">Done</button></div>
      <div class="tw-body"><div class="tw-empty"><div class="spinner"></div>Reading what’s said in this clip…</div></div></div>`;
    root.querySelector('.tw-x').onclick = close;
    try {
      const r = await loadWords(c);
      if (clip !== c) return;
      words = r.words; from = r.from; sents = sentencesOf(words);
    } catch { words = []; sents = []; }
    vs = scoreWords(words);
    // the whole-clip scan judged together with these words (the scan may have been done before the words were known)
    VA = c.viralScan ? analyzeViral({ ...c.viralScan, words }) : c.viral?.analysis ? c.viral : words.length ? analyzeViral({ duration: clipFull(c), step: 0.25, words }) : null;
    trimK = -1;
    if (clip !== c) return;
    draw();
  }
  function close() {
    clearInterval(tick);
    if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch {} }
    video = null; root.hidden = true; root.innerHTML = ''; clip = null;
  }

  function draw() {
    const c = clip;
    if (!sents.length) {
      const failed = c.speechState === 'failed';
      root.querySelector('.tw-body').innerHTML = `<div class="tw-empty">
        <b>No words found for this clip</b>
        <span>${failed ? esc(c.speechError || 'The speech tools couldn’t listen to it.') : c.audioBuffer ? 'Nobody seems to speak in it, or the speech tools aren’t set up yet.' : 'This clip has no sound.'}</span>
        ${failed ? '<button class="small primary-act tw-setup">Set up the speech tools</button>' : ''}</div>`;
      root.querySelector('.tw-setup')?.addEventListener('click', () => { close(); openSettings?.(); });
      return;
    }
    root.querySelector('.tw-body').innerHTML = `
      <div class="tw-top">
        <div class="tw-player"><video class="tw-v" preload="auto" playsinline></video>
          <div class="tw-pbar"><button class="tw-play" aria-label="Play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button><span class="tw-time">0:00.0</span>
          <button class="small tw-playsel">▶ Play the part</button></div></div>
        <div class="tw-side">
          <div class="tw-range"><div><small>Start</small><b class="tw-a"></b></div><div><small>End</small><b class="tw-b"></b></div><div><small>Length</small><b class="tw-l"></b></div></div>
          <label class="tw-len">Wanted length <input type="number" class="tw-lenin" min="0.5" step="0.5" value="${len}"> s</label>
          <div class="tw-lens">${[5, 10, 15, 30, 60].map((s) => `<button class="chip${len === s ? ' on' : ''}" data-len="${s}">${s}s</button>`).join('')}<button class="chip ghosty" data-len="all">Whole clip</button></div>
          <label class="fd-check"><input type="checkbox" class="tw-smart" ${smart ? 'checked' : ''}> Smart: whole sentences</label>
          <div class="tw-vrow"><button class="small tw-smarttrim" title="Smart trim: the most viral part of the wanted length (a hook at the start, a payoff at the end, whole sentences). Press again for the next best"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 7.9 20 18M8.1 16.1 20 6"/></svg>Smart trim</button>
            <button class="tw-pscore" hidden title="This part's viral score. Click: what the fire and the number mean"></button></div>
          <small class="tw-pwhy"></small>
          <button class="primary tw-use">Use this part</button>
          <small class="tw-hint">Click a word: the clip starts there. <b>Shift+click</b> or right-click a word: it ends there. ${from === 'captions' ? 'Words from the video’s captions.' : 'Words from the speech tools.'}</small>
        </div>
      </div>
      <div class="tw-wavebox"><canvas class="tw-wave"></canvas><small class="tw-wnote">The part that will be used is lit up; white ticks are scene changes${state.settings.order !== 'story' ? '. With Clip order on Scattered, the edit picks different scenes from inside it' : ''}. Drag its edges or the middle; click to listen there.</small></div>
      ${VA?.moments?.length ? `<div class="tw-vm"><span class="tw-vm-h">${FLAME}Viral moments <button class="tw-vm-q" title="What the fire and the number mean">?</button></span>${VA.moments.slice(0, 6).map((m, k) => `<button class="tw-vmc ${scoreColor(m.score)}" data-a="${m.start}" data-b="${m.end}" title="${esc(m.why.join(' · '))}${m.hookText || m.text ? `\n“${esc(m.hookText || m.text)}”` : ''}"><b>${m.score}</b>#${k + 1} ${fmtT(m.start)}–${fmtT(m.end)}</button>`).join('')}</div>` : ''}
      <div class="tw-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="text" class="tw-q" placeholder="Search the transcript: a word or a line" spellcheck="false"><span class="tw-n"></span></div>
      <div class="tw-text"></div>`;
    video = root.querySelector('.tw-v');
    video.addEventListener('play', () => window.dispatchEvent(new CustomEvent('cutsona:preview-play')));
    video.src = c.previewUrl || c.url;
    video.currentTime = a;
    renderText(); drawRange(); bind();
    clearInterval(tick);
    tick = setInterval(() => {
      if (!video || root.hidden) return;
      const t = video.currentTime;
      root.querySelector('.tw-time').textContent = fmtT(t);
      root.querySelector('.tw-play').innerHTML = video.paused ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
      if (video._stopAt && t >= video._stopAt) { video.pause(); video._stopAt = 0; }
      drawWave();
      const box = root.querySelector('.tw-text');
      box.querySelectorAll('.w.now').forEach((x) => x.classList.remove('now'));
      const k = words.findIndex((w) => t >= w.start && t < w.end + 0.05);
      const el = k >= 0 ? box.querySelector(`.w[data-i="${k}"]`) : null;
      if (el) { el.classList.add('now'); if (!video.paused && !box.matches(':hover')) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    }, 90);
  }
  function renderText() {
    const box = root.querySelector('.tw-text');
    const hits = q.trim() ? new Set(searchSentences(sents, q).map((h) => h.i)) : null;
    root.querySelector('.tw-n').textContent = hits ? (hits.size ? `${hits.size} line${hits.size === 1 ? '' : 's'}` : 'not said') : `${words.length} words`;
    let wi = 0;
    const idx = new Map(words.map((w, i) => [w, i]));
    box.innerHTML = sents.map((s, k) => {
      const sv = vs[k] && Math.abs(vs[k].start - s.start) < 0.01 ? vs[k] : null;
      const ws = s.words.map((w, j) => { wi = idx.get(w); const vc = !hits && sv ? viralClass(sv.wordViral[j] || 0) : ''; return `<span class="w${vc ? ' ' + vc : ''}" data-i="${wi}">${hits ? markWords(String(w.text), q) : esc(w.text)}</span>`; }).join(' ');
      return `<p class="tw-s ${hits && !hits.has(k) ? 'dim' : ''} ${hits && hits.has(k) ? 'hit' : ''} ${sv && sv.viral >= 0.6 ? 'hot' : ''}"${sv ? ` title="This line: viral ${Math.round(sv.viral * 100)}/100"` : ''}><button class="tw-t" data-t="${s.start}" title="Start the clip at this line">${fmtT(s.start)}</button>${ws}</p>`;
    }).join('');
    if (hits?.size) box.querySelector('.tw-s.hit')?.scrollIntoView({ block: 'center' });
    markSel();
  }
  function markSel() {
    const first = words.findIndex((w) => w.start >= a - 0.05);
    root.querySelectorAll('.tw-text .w').forEach((el) => {
      const i = Number(el.dataset.i), w = words[i];
      el.classList.toggle('sel', w.start >= a - 0.05 && w.end <= b + 0.3);
      el.classList.toggle('first', i === first);
    });
  }
  // the clip's sound: what gets cut lit up, scene changes as ticks, words as dots, the playhead
  function drawWave() {
    const cv = root.querySelector('.tw-wave'); if (!cv || !clip) return;
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (!r.width) return;
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'), f = F(), buf = clip.audioBuffer, css = (k, d) => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d;
    const acc = css('--tape', '#ffc933'), on = css('--on', '#34d17a'), X = (t) => (t / f) * W;
    g.clearRect(0, 0, W, H);
    const x0 = X(a), x1 = X(b), mid = H * 0.55, hh = H * 0.8;
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x0, 0, x1 - x0, H);
    if (buf) {
      const d = buf.getChannelData(0), per = (f / buf.duration) * d.length / W;
      for (let x = 0; x < W; x += 2 * dpr) {
        let m = 0; const i0 = Math.floor(x * per);
        for (let i = i0; i < i0 + per * 2 * dpr && i < d.length; i += 16) m = Math.max(m, Math.abs(d[i]));
        const h = Math.max(1, Math.min(1, m * 1.4) * hh);
        g.fillStyle = x >= x0 && x <= x1 ? acc : 'rgba(168,165,157,0.35)';
        g.fillRect(x, mid - h / 2, 1.3 * dpr, h);
      }
    }
    // how viral each second is: a heat line along the top (orange / red = likeliest to go viral)
    const vc = VA?.curve;
    if (vc?.length) for (let x = 0; x < W; x += dpr) {
      const v = vc[Math.min(vc.length - 1, Math.floor(((x / W) * f) / VA.step))] || 0;
      if (v < 0.32) continue;
      g.fillStyle = v > 0.7 ? `rgba(255,77,77,${0.55 + v * 0.45})` : v > 0.5 ? `rgba(255,150,60,${0.45 + v * 0.45})` : `rgba(255,214,90,${0.3 + v * 0.4})`;
      g.fillRect(x, H - 4 * dpr, dpr, 4 * dpr);
    }
    // words (where someone speaks) and scene changes
    g.fillStyle = 'rgba(242,240,234,0.55)';
    for (const w of words) g.fillRect(X(w.start), 2 * dpr, Math.max(1, X(w.end) - X(w.start)), 2 * dpr);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (const sc of clip.scenes || []) g.fillRect(X(sc) - 0.5 * dpr, H - 7 * dpr, 1 * dpr, 7 * dpr);
    // the part's edges
    g.fillStyle = acc; g.fillRect(x0, 0, 2.5 * dpr, H); g.fillRect(x1 - 2.5 * dpr, 0, 2.5 * dpr, H);
    g.strokeStyle = acc; g.lineWidth = 1.2 * dpr; g.strokeRect(x0, 0.6 * dpr, Math.max(1, x1 - x0), H - 1.2 * dpr);
    if (video) { g.fillStyle = on; g.fillRect(X(video.currentTime) - 1 * dpr, 0, 2 * dpr, H); }
  }
  function drawRange() {
    drawWave();
    root.querySelector('.tw-a').textContent = fmtT(a);
    root.querySelector('.tw-b').textContent = fmtT(b);
    root.querySelector('.tw-l').textContent = `${(b - a).toFixed(1)}s`;
    if (VA?.analysis) {
      const r = scorePart(VA.analysis, a, b), ps = root.querySelector('.tw-pscore');
      ps.hidden = false; ps.className = `tw-pscore ${scoreColor(r.score)}`; ps.innerHTML = `${FLAME}${r.score}<small>viral</small>`;
      root.querySelector('.tw-pwhy').textContent = r.why.join(' · ');
    }
    root.querySelectorAll('.tw-lens [data-len]').forEach((x) => x.classList.toggle('on', Number(x.dataset.len) === len));
    markSel();
  }
  const F = () => clipFull(clip);
  function startAt(t) {
    a = Math.max(0, Math.min(F() - 0.5, t - 0.08));
    if (smart) a = Math.max(0, smartStart(sents, t));
    b = Math.min(F(), smart ? smartEnd(sents, a, len) : a + len);
    if (b - a < 0.5) b = Math.min(F(), a + 0.5);
    drawRange();
  }
  function endAt(w) {
    b = Math.min(F(), Math.max(a + 0.5, w.end + (smart ? 0.25 : 0.1)));
    len = +(b - a).toFixed(1);
    root.querySelector('.tw-lenin').value = len;
    drawRange();
  }
  function bind() {
    // the wave: drag an edge of the part, drag the part, or click to listen there
    const cv = root.querySelector('.tw-wave');
    let wd = null;
    const tOf = (e) => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(F(), ((e.clientX - r.left) / r.width) * F())); };
    const pxOf = (t) => { const r = cv.getBoundingClientRect(); return r.left + (t / F()) * r.width; };
    cv.addEventListener('pointerdown', (e) => {
      const t = tOf(e), ea = Math.abs(e.clientX - pxOf(a)) <= 8, eb = Math.abs(e.clientX - pxOf(b)) <= 8;
      wd = { mode: ea ? 'a' : eb ? 'b' : t > a && t < b ? 'move' : 'seek', t0: t, a0: a, b0: b, moved: false };
      cv.setPointerCapture(e.pointerId);
      if (wd.mode === 'seek') seek(t);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!wd) { const ea = Math.abs(e.clientX - pxOf(a)) <= 8 || Math.abs(e.clientX - pxOf(b)) <= 8; cv.style.cursor = ea ? 'ew-resize' : 'pointer'; return; }
      if (!(e.buttons & 1)) { wd = null; return; }
      const t = tOf(e); wd.moved = true;
      if (wd.mode === 'a') a = Math.max(0, Math.min(b - 0.5, t));
      else if (wd.mode === 'b') b = Math.min(F(), Math.max(a + 0.5, t));
      else if (wd.mode === 'move') { const L = wd.b0 - wd.a0; a = Math.max(0, Math.min(F() - L, wd.a0 + t - wd.t0)); b = a + L; }
      else seek(t);
      if (wd.mode !== 'seek') { len = +(b - a).toFixed(1); root.querySelector('.tw-lenin').value = len; drawRange(); }
    });
    const wup = () => { if (wd && wd.mode === 'move' && !wd.moved) seek(wd.t0); wd = null; };
    cv.addEventListener('pointerup', wup); cv.addEventListener('pointercancel', wup);
    const box = root.querySelector('.tw-text');
    box.addEventListener('click', (e) => {
      const tb = e.target.closest('.tw-t');
      if (tb) { startAt(Number(tb.dataset.t)); seek(a); return; }
      const el = e.target.closest('.w'); if (!el) return;
      const w = words[Number(el.dataset.i)];
      if (e.shiftKey) endAt(w); else { startAt(w.start); seek(a); }
    });
    box.addEventListener('contextmenu', (e) => { const el = e.target.closest('.w'); if (!el) return; e.preventDefault(); endAt(words[Number(el.dataset.i)]); });
    root.querySelector('.tw-q').addEventListener('input', (e) => { q = e.target.value; renderText(); });
    root.querySelector('.tw-q').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const h = searchSentences(sents, q)[0]; if (h) { startAt(h.s.start); seek(a); }
    });
    const lenIn = root.querySelector('.tw-lenin');
    lenIn.addEventListener('change', () => { const L = Number(lenIn.value); if (L > 0) { len = L; saveOpts(); b = Math.min(F(), smart ? smartEnd(sents, a, len) : a + len); drawRange(); } });
    root.querySelector('.tw-lens').addEventListener('click', (e) => {
      const x = e.target.closest('[data-len]'); if (!x) return;
      if (x.dataset.len === 'all') { a = 0; b = F(); drawRange(); return; }
      len = Number(x.dataset.len); lenIn.value = len; saveOpts();
      b = Math.min(F(), smart ? smartEnd(sents, a, len) : a + len); drawRange();
    });
    root.querySelector('.tw-smart').onchange = (e) => { smart = e.target.checked; saveOpts(); startAt(a + 0.08); };
    // Smart trim: the most viral part of the wanted length; press again for the next best
    root.querySelector('.tw-smarttrim').onclick = () => {
      if (!VA?.analysis) { toast('Smart trim needs the clip’s words or its viral scan: still working on it'); return; }
      const scan = { duration: F(), step: 0.25 }, list = viralMoments(scan, { lengths: [Math.max(3, len)], max: 5, analysis: VA.analysis }).filter((m) => m.end <= F() + 0.3);
      if (!list.length) { toast('Nothing that long in this clip'); return; }
      trimK = trimL === len ? (trimK + 1) % list.length : 0; trimL = len;
      const m = list[trimK]; a = m.start; b = Math.min(F(), m.end); drawRange(); seek(a);
      toast(`Smart trim${list.length > 1 ? ` (${trimK + 1} of ${list.length})` : ''}: ${fmtT(a)}–${fmtT(b)}, viral ${m.score}. ${m.why[0] || ''}`);
    };
    root.querySelector('.tw-pscore').onclick = (e) => explainViral?.(e);
    root.querySelector('.tw-vm-q')?.addEventListener('click', (e) => explainViral?.(e));
    root.querySelector('.tw-vm')?.addEventListener('click', (e) => {
      const m = e.target.closest('.tw-vmc'); if (!m) return;
      a = Number(m.dataset.a); b = Math.min(F(), Number(m.dataset.b)); len = +(b - a).toFixed(1); root.querySelector('.tw-lenin').value = len; drawRange(); seek(a);
    });
    root.querySelector('.tw-use').onclick = () => {
      setTrim(clip, a, b); onTrim(clip);
      toast(`${clip.name}: now ${fmtT(a)} to ${fmtT(b)} (${(b - a).toFixed(1)}s)`);
      close();
    };
    root.querySelector('.tw-play').onclick = () => { if (!video) return; video._stopAt = 0; if (video.paused) video.play().catch(() => {}); else video.pause(); };
    root.querySelector('.tw-playsel').onclick = () => { if (!video) return; video.currentTime = a; video._stopAt = b; video.play().catch(() => {}); };
  }
  function seek(t) { if (video) { video.currentTime = t; } }
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  window.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') { close(); e.stopPropagation(); return; }
    if (e.target.matches?.('input[type=text], input[type=number]')) { e.stopPropagation(); return; }
    // the editor's shortcuts wait while the transcript is open; Space plays the clip here
    if (e.code === 'Space' && video) { e.preventDefault(); video._stopAt = 0; if (video.paused) video.play().catch(() => {}); else video.pause(); }
    if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
  }, true);
  return { open, close, isOpen: () => !root.hidden };
}
