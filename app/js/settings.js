// Settings: where finished videos are saved, light / dark theme, and the accent color (the yellow by default).
// Theme and accent live in this browser (localStorage), the export folder on this PC (the server keeps it).

const KEY = 'cutsona.look';
export const ACCENTS = [
  ['#ffc933', 'Tape yellow'], ['#ff8a3d', 'Orange'], ['#ff5a5f', 'Red'], ['#ff6fb5', 'Pink'], ['#a78bff', 'Violet'],
  ['#4d9fff', 'Blue'], ['#2fd6e0', 'Cyan'], ['#5ee08a', 'Green'], ['#c6f04a', 'Lime'], ['#f2f0ea', 'White'],
];
const DEFAULT_ACCENT = '#ffc933';

let look = { theme: 'dark', accent: DEFAULT_ACCENT };
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
  document.dispatchEvent(new CustomEvent('cutsona:look'));
}
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
  }
  function renderDir(note = '') {
    $('#setDir').value = server.exportDir || '';
    const isDefault = server.exportDir === server.defaultExportDir;
    $('#btnResetDir').disabled = isDefault;
    $('#btnPickDir').hidden = !server.canPick;
    $('#setDirNote').textContent = note || (isDefault ? 'The exports folder inside Cutsona. Pick any folder, like Videos or a synced drive.' : 'Every export is saved straight into this folder.');
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

  box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.theme) { look.theme = b.dataset.theme; save(); applyLook(); renderLook(); }
    else if (b.dataset.accent) { look.accent = b.dataset.accent; save(); applyLook(); renderLook(); }
    else if (b.id === 'btnAccentReset') { look.accent = DEFAULT_ACCENT; save(); applyLook(); renderLook(); }
    else if (b.id === 'btnPickDir') setDir('pick=1', (d) => `Exports now save to ${d}`);
    else if (b.id === 'btnUseDir') setDir('dir=' + encodeURIComponent($('#setDir').value), (d) => `Exports now save to ${d}`);
    else if (b.id === 'btnResetDir') setDir('reset=1', () => 'Exports save to the Cutsona exports folder again');
    else if (b.id === 'btnOpenDir') fetch('/api/open', { method: 'POST' });
    else if (b.id === 'btnSetClose') close();
  });
  $('#accentPick').addEventListener('input', (e) => { look.accent = e.target.value.toLowerCase(); save(); applyLook(); renderLook(); });
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
  function open() { showTab('settings'); lastFocus = document.activeElement; box.hidden = false; renderLook(); loadServer(); $('#btnSetClose').focus(); }
  function close() { box.hidden = true; lastFocus?.focus?.(); }
  return { open, close, isOpen: () => !box.hidden };
}
