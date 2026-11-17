// Settings: where finished videos are saved, light / dark theme, and the accent color (the yellow by default).
// Theme and accent live in this browser (localStorage), the export folder on this PC (the server keeps it).

const KEY = 'cutsona.look';
export const ACCENTS = [
  ['#ffc933', 'Tape yellow'], ['#ff8a3d', 'Orange'], ['#ff5a5f', 'Red'], ['#ff6fb5', 'Pink'], ['#a78bff', 'Violet'],
  ['#4d9fff', 'Blue'], ['#2fd6e0', 'Cyan'], ['#5ee08a', 'Green'], ['#c6f04a', 'Lime'], ['#f2f0ea', 'White'],
];
const DEFAULT_ACCENT = '#ffc933';
// the color of options that are switched ON (the green dot / filled On buttons)
export const ON_COLORS = [
  ['#34d17a', 'Green'], ['#5ee0c8', 'Mint'], ['#2fd6e0', 'Cyan'], ['#4d9fff', 'Blue'], ['#a78bff', 'Violet'],
  ['#ff6fb5', 'Pink'], ['#ff5a5f', 'Red'], ['#ff8a3d', 'Orange'], ['#ffc933', 'Yellow'], ['#f2f0ea', 'White'],
];
const DEFAULT_ON = '#34d17a';

let look = { theme: 'dark', accent: DEFAULT_ACCENT, on: DEFAULT_ON };
try { look = { ...look, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(look)); } catch {} };

const hexRgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
  const n = parseInt(m ? m[1] : 'ffc933', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };

// the accent as canvas colors (the waveform, the trim strip...): accentRGBA(0.5) -> "rgba(255,201,51,0.5)"
let accRgb = hexRgb(look.accent);
export const accentHex = () => toHex(...accRgb);
export const accentRGBA = (a = 1) => `rgba(${accRgb[0]},${accRgb[1]},${accRgb[2]},${a})`;

function systemTheme() { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
export function applyLook() {
  const root = document.documentElement;
  const theme = look.theme === 'system' ? systemTheme() : look.theme;
  root.dataset.theme = theme;
  accRgb = hexRgb(look.accent);
  const [r, g, b] = accRgb, L = lum(accRgb);
  // hover = a little lighter, pressed = a little darker; text on it = black or white, whichever reads better
  root.style.setProperty('--tape', toHex(r, g, b));
  root.style.setProperty('--tape-2', toHex(r + (255 - r) * 0.25, g + (255 - g) * 0.25, b + (255 - b) * 0.25));
  root.style.setProperty('--tape-3', toHex(r * 0.88, g * 0.88, b * 0.88));
  root.style.setProperty('--tape-ink', L > 0.36 ? '#161400' : '#ffffff');
  // in light mode a very light accent (white, lime) would vanish as an outline: use the text color for focus rings
  root.style.setProperty('--ring', theme === 'light' && L > 0.6 ? 'var(--paper)' : 'var(--tape)');
  // the ON color, and black or white text on it
  const on = hexRgb(look.on || DEFAULT_ON);
  root.style.setProperty('--on', toHex(...on));
  root.style.setProperty('--on-ink', lum(on) > 0.3 ? '#04140a' : '#ffffff');
  document.dispatchEvent(new CustomEvent('cutsona:look'));
  // the desktop window's own buttons (minimize / maximize / close) take the header's colors
  const dk = window.cutsonaDesktop;
  if (dk?.frameless) {
    root.classList.add('frameless');
    requestAnimationFrame(() => { const cs = getComputedStyle(document.querySelector('header.top') || root); dk.setTitleBar?.(cs.backgroundColor && !/rgba\(0, 0, 0, 0\)/.test(cs.backgroundColor) ? cssHex(cs.backgroundColor) : (theme === 'light' ? '#f4f2ec' : '#1f1f22'), theme === 'light' ? '#1d1d1f' : '#f2f0ea'); });
  }
}
function cssHex(c) { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('') : '#1f1f22'; }
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (look.theme === 'system') applyLook(); });
applyLook();

export function initSettings({ toast, esc }) {
  const box = document.getElementById('settings');
  const $ = (s) => box.querySelector(s);
  let server = { exportDir: '', defaultExportDir: '', canPick: true };

  function renderLook() {
    box.querySelectorAll('#setTheme [data-theme]').forEach((b) => b.classList.toggle('on', b.dataset.theme === look.theme));
    const cur = look.accent.toLowerCase();
    box.querySelectorAll('#setAccent [data-accent]').forEach((b) => b.classList.toggle('on', b.dataset.accent === cur));
    $('#accentPick').value = accentHex();
    const preset = ACCENTS.find(([h]) => h === cur);
    $('#accentName').textContent = preset ? preset[1] : `Custom ${cur}`;
    $('.sw-custom').classList.toggle('on', !preset);
    const oc = (look.on || DEFAULT_ON).toLowerCase(), op = ON_COLORS.find(([h]) => h === oc);
    box.querySelectorAll('#setOnColor [data-oncolor]').forEach((b) => b.classList.toggle('on', b.dataset.oncolor === oc));
    $('#onPick').value = toHex(...hexRgb(oc));
    $('#onName').textContent = op ? op[1] : `Custom ${oc}`;
    $('#setOnColor .sw-custom').classList.toggle('on', !op);
  }
  function renderDir(note = '') {
    $('#setDir').value = server.exportDir || '';
    const isDefault = server.exportDir === server.defaultExportDir;
    $('#btnResetDir').disabled = isDefault;
    $('#btnPickDir').hidden = !server.canPick;
    $('#setDirNote').textContent = note || (isDefault ? 'Cutsona’s own exports folder. Pick any folder, like Videos or a synced drive.' : 'Every export is saved straight into this folder.');
  }
  async function loadServer() {
    try { server = await (await fetch('/api/settings')).json(); } catch { server.exportDir = ''; }
    renderDir();
  }
  async function setDir(query, okMsg) {
    const btns = box.querySelectorAll('.set-dir button');
    btns.forEach((b) => (b.disabled = true));
    try {
      const r = await fetch('/api/settings/export-dir?' + query, { method: 'POST' });
      const j = await r.json();
      btns.forEach((b) => (b.disabled = false));
      $('#setDirNote').classList.toggle('err', !r.ok);
      if (!r.ok) { renderDir(j.error || 'That folder can’t be used.'); return; }
      if (j.cancelled) { renderDir(); return; }
      server.exportDir = j.exportDir;
      renderDir(); toast(okMsg(j.exportDir));
    } catch {
      btns.forEach((b) => (b.disabled = false));
      $('#setDirNote').classList.add('err'); renderDir('Cutsona isn’t running: start it again and retry.');
    }
  }

  box.querySelector('#setAccent').innerHTML = ACCENTS.map(([h, n]) => `<button data-accent="${h}" title="${esc(n)}" aria-label="${esc(n)}" style="--sw:${h}"></button>`).join('')
    + '<label class="sw-custom" title="Any color"><input type="color" id="accentPick" aria-label="Pick any accent color"><span>Custom</span></label>';
  box.querySelector('#setOnColor').innerHTML = ON_COLORS.map(([h, n]) => `<button data-oncolor="${h}" title="${esc(n)}" aria-label="${esc(n)}" style="--sw:${h}"></button>`).join('')
    + '<label class="sw-custom" title="Any color"><input type="color" id="onPick" aria-label="Pick any color for options that are on"><span>Custom</span></label>';

  box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.theme) { look.theme = b.dataset.theme; save(); applyLook(); renderLook(); }
    else if (b.dataset.accent) { look.accent = b.dataset.accent; save(); applyLook(); renderLook(); }
    else if (b.id === 'btnAccentReset') { look.accent = DEFAULT_ACCENT; save(); applyLook(); renderLook(); }
    else if (b.dataset.oncolor) { look.on = b.dataset.oncolor; save(); applyLook(); renderLook(); }
    else if (b.id === 'btnOnReset') { look.on = DEFAULT_ON; save(); applyLook(); renderLook(); }
    else if (b.id === 'btnPickDir') {
      // the desktop app has the system's own folder picker
      if (window.cutsonaDesktop?.pickFolder) window.cutsonaDesktop.pickFolder(server.exportDir).then((d) => { if (d) setDir('dir=' + encodeURIComponent(d), (x) => `Exports now save to ${x}`); });
      else setDir('pick=1', (d) => `Exports now save to ${d}`);
    }
    else if (b.id === 'btnUseDir') setDir('dir=' + encodeURIComponent($('#setDir').value), (d) => `Exports now save to ${d}`);
    else if (b.id === 'btnResetDir') setDir('reset=1', () => 'Exports save to the Cutsona exports folder again');
    else if (b.id === 'btnOpenDir') fetch('/api/open', { method: 'POST' });
    else if (b.id === 'btnSetClose') close();
    else if (b.id === 'btnCheckSources') checkSources();
    else if (b.id === 'btnSpeechSetup') setupSpeech();
  });

  // Captions and speech: Whisper needs a small Python environment, set up here with one button
  let speechTimer = 0;
  function renderSpeech(j) {
    const job = j.job || {};
    $('#speechState').textContent = j.ready ? 'ready' : job.busy ? 'setting up…' : 'not set up';
    $('#btnSpeechSetup').hidden = !!j.ready || !!job.busy;
    $('#btnSpeechSetup').textContent = job.error ? 'Try again' : 'Set up speech tools';
    $('#speechPyLink').hidden = !job.needPython;
    const note = $('#speechNote');
    note.classList.toggle('err', !!job.error);
    note.textContent = j.ready ? 'Captions and sentence-aware cuts work. Speech never leaves this PC.'
      : job.busy ? `${job.phase}…` : job.error || 'Captions and cutting between sentences need them. Cutsona downloads them once (about 300 MB); speech never leaves this PC.';
  }
  async function loadSpeech() {
    clearTimeout(speechTimer);
    try {
      const j = await (await fetch('/api/speech')).json();
      renderSpeech(j);
      if (j.job?.busy && !box.hidden) speechTimer = setTimeout(loadSpeech, 1500);
    } catch {}
  }
  async function setupSpeech() {
    try { renderSpeech(await (await fetch('/api/speech/setup', { method: 'POST' })).json()); } catch {}
    speechTimer = setTimeout(loadSpeech, 800);
  }

  // Check sources: is every site Find clips / Find songs uses answering? Each row fills in as its site answers.
  const STATE_WORD = { ok: 'Working', slow: 'Slow', down: 'Down', empty: 'Not sending results', setup: 'Needs a key', wait: 'Checking…' };
  async function checkSources() {
    const btn = $('#btnCheckSources'), list = $('#srcList'), note = $('#srcNote');
    btn.disabled = true; note.classList.remove('err'); note.textContent = 'Asking each site for a few results…';
    let sources = [];
    try { sources = (await (await fetch('/api/sources')).json()).sources; }
    catch { btn.disabled = false; note.classList.add('err'); note.textContent = 'Cutsona isn’t running: start it again and retry.'; return; }
    const row = (s) => `<li class="src-row src-${s.state}" data-key="${esc(s.key)}"><i aria-hidden="true"></i><b>${esc(s.name)}</b><span class="src-state">${STATE_WORD[s.state] || ''}${s.ms && s.state !== 'down' ? ` · ${(s.ms / 1000).toFixed(1)}s` : ''}</span>${s.note && s.state !== 'ok' && s.state !== 'wait' ? `<small>${esc(s.note)}</small>` : ''}</li>`;
    list.innerHTML = sources.map((s) => row({ ...s, state: 'wait' })).join('');
    const results = await Promise.all(sources.map(async (s) => {
      let r;
      try { r = await (await fetch('/api/sources/check?key=' + encodeURIComponent(s.key))).json(); }
      catch { r = { ...s, state: 'down', note: 'Cutsona couldn’t ask this site.' }; }
      const li = list.querySelector(`[data-key="${CSS.escape(s.key)}"]`);
      if (li) li.outerHTML = row(r);
      return r;
    }));
    btn.disabled = false;
    const tried = results.filter((r) => r.state !== 'setup'), good = tried.filter((r) => r.state === 'ok' || r.state === 'slow');
    const bad = tried.filter((r) => r.state === 'down' || r.state === 'empty');
    if (tried.length && !good.length) { note.classList.add('err'); note.textContent = 'None of the sites answered. Check your internet connection, then try again.'; }
    else note.textContent = bad.length ? `${good.length} of ${tried.length} sites are working. ${bad.map((r) => r.name).join(', ')} ${bad.length === 1 ? 'is' : 'are'} having problems on their side, not yours.` : `All ${tried.length} sites are working.`;
  }
  $('#accentPick').addEventListener('input', (e) => { look.accent = e.target.value.toLowerCase(); save(); applyLook(); renderLook(); });
  $('#onPick').addEventListener('input', (e) => { look.on = e.target.value.toLowerCase(); save(); applyLook(); renderLook(); });
  $('#setDir').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnUseDir').click(); });
  box.addEventListener('pointerdown', (e) => { if (e.target === box) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) { e.stopPropagation(); close(); } }, true);

  let lastFocus = null;
  // Settings / Credits tabs
  function showTab(t) {
    box.querySelectorAll('[data-set-tab]').forEach((b) => { const on = b.dataset.setTab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    box.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== t; });
  }
  box.querySelector('.set-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-set-tab]'); if (b) showTab(b.dataset.setTab); });
  function open() { showTab('settings'); lastFocus = document.activeElement; box.hidden = false; renderLook(); loadServer(); loadSpeech(); $('#btnSetClose').focus(); }
  function close() { box.hidden = true; lastFocus?.focus?.(); }
  return { open, close, isOpen: () => !box.hidden };
}
