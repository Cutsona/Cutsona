// First run: a 4-step walkthrough, a check of the tools Cutsona needs (with install buttons), and error reports
// people can send (nothing is sent by itself: you see the report, then copy it, save it or open it as a GitHub issue).
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} return null; };
const REPO = 'https://github.com/Cutsona/Cutsona';

// ---------------- errors: kept quietly, offered as a report ----------------
const errors = [];
let chip = null, chipShownFor = '';
function keepError(kind, msg, where = '') {
  msg = String(msg || '').slice(0, 600);
  if (!msg || /ResizeObserver loop|Script error\.?$|AbortError|The play\(\) request was interrupted/i.test(msg)) return;
  const last = errors[errors.length - 1];
  if (last && last.msg === msg) { last.n++; return; }
  errors.push({ at: new Date().toISOString(), kind, msg, where: String(where).slice(0, 300), n: 1 });
  if (errors.length > 30) errors.shift();
  offerReport(msg);
}
addEventListener('error', (e) => keepError('error', e.message, `${(e.filename || '').split('/').pop()}:${e.lineno}:${e.colno}${e.error?.stack ? '\n' + String(e.error.stack).split('\n').slice(0, 6).join('\n') : ''}`));
addEventListener('unhandledrejection', (e) => keepError('promise', e.reason?.message || e.reason, String(e.reason?.stack || '').split('\n').slice(0, 6).join('\n')));
function offerReport(msg) {
  if (LS('cutsona.noErrChip') === '1' || chipShownFor === msg) return;
  chipShownFor = msg;
  if (!chip) {
    chip = document.createElement('div'); chip.className = 'err-chip'; chip.setAttribute('role', 'status');
    chip.innerHTML = '<span>Something went wrong.</span><button class="small">Send a report</button><button class="err-x" aria-label="Hide">×</button>';
    chip.querySelector('button.small').onclick = () => { chip.hidden = true; openReport(); };
    chip.querySelector('.err-x').onclick = () => { chip.hidden = true; };
    document.body.appendChild(chip);
  }
  chip.hidden = false;
  clearTimeout(chip._t); chip._t = setTimeout(() => { if (chip) chip.hidden = true; }, 12000);
}
async function reportText(note = '') {
  let st = {};
  try { st = await (await fetch('/api/status')).json(); } catch {}
  const dk = window.cutsonaDesktop;
  const S = window.__cutsona?.state;
  const lines = [
    `Cutsona ${dk?.version || st.version || '?'} (${dk ? 'desktop' : 'browser'}), ${dk?.platform || st.platform || navigator.platform}`,
    `${navigator.userAgent}`,
    `ffmpeg: ${st.ffmpeg ? 'yes' : 'no'}, yt-dlp: ${st.ytdlp ? 'yes' : 'no'}, cores: ${navigator.hardwareConcurrency || '?'}`,
    S ? `mode: ${S.settings?.mode || 'edit'}, clips: ${S.clips?.length || 0}, takes: ${S.variants?.length || 0}, song: ${S.music ? 'yes' : 'no'}` : '',
    '',
    note ? `What happened:\n${note}\n` : '',
    errors.length ? `Errors (${errors.length}):\n` + errors.map((e) => `- ${e.at} [${e.kind}${e.n > 1 ? ' ×' + e.n : ''}] ${e.msg}${e.where ? '\n    ' + e.where.replace(/\n/g, '\n    ') : ''}`).join('\n') : 'No errors were caught this session.',
  ];
  return lines.filter((l) => l !== '').join('\n');
}
let dlg = null;
export async function openReport() {
  if (!dlg) {
    dlg = document.createElement('div'); dlg.className = 'ob-modal'; dlg.hidden = true;
    dlg.innerHTML = `<div class="ob-box ob-report" role="dialog" aria-label="Report a problem">
      <h2>Report a problem</h2>
      <p>Nothing is sent by itself. Say what you were doing, then send it the way you like.</p>
      <textarea class="rp-note" rows="3" placeholder="What were you doing when it went wrong? (optional)"></textarea>
      <pre class="rp-text"></pre>
      <div class="ob-actions">
        <button class="small" data-rp="copy">Copy</button>
        <button class="small" data-rp="save">Save as file</button>
        <button class="small primary" data-rp="issue">Open on GitHub</button>
        <button class="small ghost" data-rp="close">Close</button>
      </div>
      <label class="rp-mute"><input type="checkbox" class="rp-nochip"> Don't offer reports when something goes wrong</label>
    </div>`;
    document.body.appendChild(dlg);
    const refresh = async () => { $('.rp-text', dlg).textContent = await reportText($('.rp-note', dlg).value.trim()); };
    $('.rp-note', dlg).addEventListener('input', () => { clearTimeout(dlg._t); dlg._t = setTimeout(refresh, 250); });
    $('.rp-nochip', dlg).onchange = (e) => LS('cutsona.noErrChip', e.target.checked ? '1' : null);
    dlg.addEventListener('click', async (e) => {
      if (e.target === dlg) { dlg.hidden = true; return; }
      const b = e.target.closest('[data-rp]'); if (!b) return;
      const text = await reportText($('.rp-note', dlg).value.trim());
      if (b.dataset.rp === 'close') dlg.hidden = true;
      else if (b.dataset.rp === 'copy') { try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1500); } catch {} }
      else if (b.dataset.rp === 'save') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = `cutsona-report-${Date.now()}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
      else if (b.dataset.rp === 'issue') {
        const title = (errors[errors.length - 1]?.msg || $('.rp-note', dlg).value.trim() || 'Problem report').slice(0, 90);
        const body = '```\n' + text.slice(0, 6000) + '\n```';
        window.open(`${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
      }
    });
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') dlg.hidden = true; e.stopPropagation(); });
  }
  $('.rp-nochip', dlg).checked = LS('cutsona.noErrChip') === '1';
  $('.rp-text', dlg).textContent = await reportText($('.rp-note', dlg).value.trim());
  dlg.hidden = false; $('.rp-note', dlg).focus();
}

// ---------------- what Cutsona needs: ffmpeg, yt-dlp, the speech tools ----------------
let req = null;
async function needs() {
  let st = {}, sp = {};
  try { st = await (await fetch('/api/status')).json(); } catch {}
  try { sp = await (await fetch('/api/speech')).json(); } catch {}
  return [
    { k: 'ffmpeg', name: 'FFmpeg', why: 'Reads and saves every video: needed for everything', ok: !!st.ffmpeg, must: true },
    { k: 'ytdlp', name: 'Downloader (yt-dlp)', why: 'Gets clips and songs from YouTube, Twitch, Kick and more', ok: !!st.ytdlp, can: true },
    { k: 'speech', name: 'Speech tools', why: 'Captions, transcripts and cutting between sentences', ok: !!sp.ready, can: true, job: sp.job },
  ];
}
export async function openRequirements({ auto = false } = {}) {
  const list = await needs();
  if (auto && list.every((x) => x.ok)) return false;
  if (!req) {
    req = document.createElement('div'); req.className = 'ob-modal'; req.hidden = true;
    document.body.appendChild(req);
    req.addEventListener('click', async (e) => {
      if (e.target === req) { req.hidden = true; return; }
      const b = e.target.closest('[data-rq]'); if (!b) return;
      if (b.dataset.rq === 'close') { req.hidden = true; return; }
      if (b.dataset.rq === 'never') { LS('cutsona.reqNever', '1'); req.hidden = true; return; }
      if (b.dataset.rq === 'all' || b.dataset.rq === 'ytdlp') { b.disabled = true; try { await fetch('/api/tools/ytdlp', { method: 'POST' }); } catch {} }
      if (b.dataset.rq === 'all' || b.dataset.rq === 'speech') { try { await fetch('/api/speech/setup', { method: 'POST' }); } catch {} }
      poll();
    });
  }
  let timer = 0;
  const draw = (items) => {
    const missing = items.filter((x) => !x.ok), busy = items.some((x) => x.job?.busy);
    req.innerHTML = `<div class="ob-box ob-req" role="dialog" aria-label="What Cutsona needs">
      <h2>${missing.length ? 'A few things to set up' : 'All set'}</h2>
      <p>${missing.length ? 'Cutsona works best with these. One click installs them (free, on this PC only).' : 'Everything Cutsona needs is installed.'}</p>
      <ul class="rq-list">${items.map((x) => `<li class="${x.ok ? 'ok' : x.job?.busy ? 'busy' : 'no'}">
        <i></i><div><b>${esc(x.name)}</b><small>${esc(x.job?.busy ? x.job.phase || 'Installing…' : x.job?.error && !x.ok ? x.job.error : x.why)}</small></div>
        ${x.ok ? '<span class="rq-ok">Ready</span>' : x.can ? `<button class="small" data-rq="${x.k}" ${x.job?.busy ? 'disabled' : ''}>${x.job?.busy ? 'Installing…' : 'Install'}</button>` : '<span class="rq-bad">Reinstall Cutsona</span>'}</li>`).join('')}</ul>
      <div class="ob-actions">
        ${missing.some((x) => x.can) && !busy ? '<button class="small primary" data-rq="all">Install all</button>' : ''}
        <button class="small ghost" data-rq="close">${missing.length ? 'Later' : 'Done'}</button>
        ${missing.length && auto ? '<button class="small ghost" data-rq="never">Don\'t ask again</button>' : ''}
      </div></div>`;
  };
  const poll = async () => { clearTimeout(timer); const items = await needs(); draw(items); if (!req.hidden && items.some((x) => x.job?.busy || (x.k === 'ytdlp' && !x.ok))) timer = setTimeout(poll, 1500); };
  draw(list); req.hidden = false;
  return true;
}
// before a feature that needs a tool that isn't there: say so, with the install button
export async function needTool(k) {
  const list = await needs(), x = list.find((y) => y.k === k);
  if (x && !x.ok) { openRequirements(); return false; }
  return true;
}

// ---------------- the walkthrough: add clips, add a song, pick a take, export ----------------
const CLIPPER = [
  { sel: ['#modeSwitch [data-mode="stream"]'], title: '1. Clipper Mode', text: 'For Twitch and Kick highlights: one stream clip becomes a vertical clip with the streamer\'s cam and the game, captions and a banner.' },
  { sel: ['#btnFind', '#clipDrop'], title: '2. Get a stream clip', text: 'Find clips → Streamers: top clips of any channel or game on Twitch and Kick (or 🎲 Random). Or drop your own recording.' },
  { sel: ['#mainLook'], title: '3. Pick the look', text: 'Layout (cam + screen, webcam + screen, cam only, full frame), captions, the banner with the channel name, and the title.' },
  { sel: ['.timeline-wrap', '#timeline'], title: '4. Move the cam and the card', text: 'Click the Camera row, then drag or scroll the cam or the screen: each move is a keyframe. The Card row does the same for the whole picture.' },
  { sel: ['.card .export', '#grid:not([hidden])'], title: '5. Export', text: 'Every take is a different version of the clip. Export the one you like as an MP4, ready to post.' },
];
const STEPS = [
  { sel: ['#btnFind', '#clipDrop'], title: '1. Add clips', text: 'Find clips online (movies, streamers, gaming, viral) or drop your own videos and photos here.' },
  { sel: ['#btnFindSong', '#musicDrop'], title: '2. Add a song', text: 'Every cut lands on its beat. Find one, or drop an MP3.' },
  { sel: ['#grid:not([hidden])', '#empty'], title: '3. Pick a take', text: 'Cutsona makes several versions side by side. Click one to work on it, Regen for a new one, the timeline below to fine-tune.' },
  { sel: ['.card .export', '#btnGenerate'], title: '4. Export', text: 'Export saves the take you like as an MP4, ready to post.' },
  { sel: ['#modeSwitch [data-mode="quick"]'], title: '5. Quick Mode', text: 'In a hurry? Type a topic and get a finished narrated video, or paste a long video and get its best clips.' },
];
let tour = null;
export function startTour(onEnd = () => {}, which = 'edit') {
  if (tour) return;
  const STEPS_ = which === 'clipper' ? CLIPPER : STEPS;
  let n = 0;
  const veil = document.createElement('div'); veil.className = 'tour';
  veil.innerHTML = '<div class="tour-hole"></div><div class="tour-tip" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(veil);
  const hole = $('.tour-hole', veil), tip = $('.tour-tip', veil);
  const end = () => { veil.remove(); removeEventListener('resize', place); removeEventListener('keydown', key, true); tour = null; LS(which === 'clipper' ? 'cutsona.tourClip' : 'cutsona.tourV1', '1'); onEnd(); };
  // the thing to point at: really on screen (not hidden, not covered by something else); else the tip shows by itself
  const shown = (el) => {
    if (!el || !el.offsetParent || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight) return false;
    veil.style.pointerEvents = 'none'; const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20)); veil.style.pointerEvents = '';
    return !!top && (el.contains(top) || top.contains(el));
  };
  const target = () => { for (const s of STEPS_[n].sel) { const el = document.querySelector(s); if (shown(el)) return el; } return null; };
  function place() {
    const el = target(), r = el ? el.getBoundingClientRect() : { left: innerWidth / 2 - 150, top: innerHeight / 2 - 60, width: 300, height: 120 };
    const pad = 8;
    // nothing to point at (no clips yet, say): no spotlight, the tip in the middle
    hole.classList.toggle('none', !el);
    Object.assign(hole.style, el ? { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`, opacity: 1 }
      : { left: `${innerWidth / 2}px`, top: `${innerHeight / 2}px`, width: '0px', height: '0px', opacity: 1 });
    const s = STEPS_[n];
    tip.innerHTML = `<small>${n + 1} of ${STEPS_.length}</small><b>${esc(s.title)}</b><p>${esc(s.text)}</p>
      <div class="tour-b"><button class="small ghost" data-t="skip">Skip</button>${n ? '<button class="small" data-t="back">Back</button>' : ''}<button class="small primary" data-t="next">${n === STEPS_.length - 1 ? 'Start editing' : 'Next'}</button></div>`;
    const tw = 300, th = tip.offsetHeight || 150;
    let x = r.left + r.width + 18, y = r.top;
    if (x + tw > innerWidth - 10) { x = Math.max(10, Math.min(innerWidth - tw - 10, r.left)); y = r.top + r.height + 16; if (y + th > innerHeight - 10) y = Math.max(10, r.top - th - 16); }
    tip.style.left = `${x}px`; tip.style.top = `${Math.max(10, Math.min(innerHeight - th - 10, y))}px`;
    tip.querySelector('[data-t="next"]').focus();
  }
  const key = (e) => { if (e.key === 'Escape') { end(); e.stopPropagation(); } else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); step(1); } else if (e.key === 'ArrowLeft') step(-1); };
  const step = (d) => { n += d; if (n >= STEPS_.length) return end(); n = Math.max(0, n); place(); };
  veil.addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; if (b.dataset.t === 'skip') end(); else step(b.dataset.t === 'back' ? -1 : 1); });
  addEventListener('resize', place); addEventListener('keydown', key, true);
  tour = { end };
  place();
}

// first run: the walkthrough, then (if something's missing) what to install
export function initOnboarding() {
  const afterTour = () => { if (LS('cutsona.reqNever') !== '1') openRequirements({ auto: true }); };
  if (!LS('cutsona.tourV1') && !navigator.webdriver) setTimeout(() => startTour(afterTour), 900);
  else if (LS('cutsona.reqNever') !== '1' && !LS('cutsona.reqSeen')) { LS('cutsona.reqSeen', '1'); setTimeout(afterTour, 1500); }
  // the first time you open Clipper Mode: its own walkthrough
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('#modeSwitch [data-mode="stream"]') && !LS('cutsona.tourClip') && !tour) setTimeout(() => startTour(() => {}, 'clipper'), 700);
  });
  // Settings: run the walkthrough again, check the tools, report a problem
  const upd = document.getElementById('btnCheckUpd')?.closest('.set-sec');
  if (upd && !document.getElementById('btnTourAgain')) {
    const sec = document.createElement('section'); sec.className = 'set-sec';
    sec.innerHTML = `<h4>Help</h4><div class="field"><span>Walkthrough, tools and problems</span>
      <div class="set-row"><button class="small" id="btnTourAgain">Edit Mode walkthrough</button><button class="small" id="btnTourClip">Clipper Mode walkthrough</button><button class="small" id="btnReqCheck">Check what's installed</button><button class="small" id="btnReport">Report a problem</button></div></div>`;
    upd.insertAdjacentElement('afterend', sec);
    const closeSettings = () => document.getElementById('btnSetClose')?.click();
    sec.querySelector('#btnTourAgain').onclick = () => { closeSettings(); setTimeout(() => startTour(), 200); };
    sec.querySelector('#btnTourClip').onclick = () => { closeSettings(); setTimeout(() => { document.querySelector('#modeSwitch [data-mode="stream"]:not(.on)')?.click(); setTimeout(() => startTour(() => {}, 'clipper'), 500); }, 200); };
    sec.querySelector('#btnReqCheck').onclick = () => openRequirements();
    sec.querySelector('#btnReport').onclick = () => openReport();
  }
}
