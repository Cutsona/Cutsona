// Panels you can resize by dragging their edges: the sidebar, a take's settings panel and the shot editor.
// Double-click a divider to put that panel back to its usual size. Sizes are kept on this PC.
const KEY = 'cutsona.panes';
const DEFAULTS = { side: 344, tune: 340, sb: 186, tl: 120 };

export function initPanes({ onResize = () => {} } = {}) {
  let size = { ...DEFAULTS };
  try { Object.assign(size, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
  if (size.tl === 98) size.tl = DEFAULTS.tl; // the old usual size: the timeline now has a filmstrip row
  const root = document.documentElement;
  const apply = () => {
    root.style.setProperty('--side-w', `${size.side}px`);
    root.style.setProperty('--tune-w', `${size.tune}px`);
    root.style.setProperty('--sbh', `${size.sb}px`);
    root.style.setProperty('--sbw', `${Math.round(size.sb * 16 / 9)}px`);
    root.style.setProperty('--tl-h', `${size.tl}px`);
    root.classList.toggle('side-hidden', !!size.sideHidden);
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(size)); } catch {} };
  // keep a panel inside the window as it gets smaller
  const limits = {
    side: () => [250, Math.max(260, Math.min(620, innerWidth * 0.45))],
    tune: () => [280, Math.max(300, Math.min(640, innerWidth * 0.45))],
    sb: () => [120, Math.max(140, innerHeight * 0.55)],
    tl: () => [64, Math.max(90, Math.min(340, innerHeight * 0.4))],
  };
  const fit = () => { for (const k of Object.keys(limits)) { const [a, b] = limits[k](); size[k] = Math.round(Math.max(a, Math.min(b, size[k]))); } };
  fit(); apply();

  function handle(cls, key, host, before, dir) {
    const h = document.createElement('div');
    h.className = `pane-split ${cls}`;
    h.title = 'Drag to resize. Double-click: usual size';
    h.setAttribute('role', 'separator');
    if (before) host.insertBefore(h, before); else host.appendChild(h);
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY, s0 = size[key];
      h.setPointerCapture(e.pointerId); h.classList.add('dragging'); document.body.classList.add('resizing', dir);
      const move = (ev) => {
        if (!(ev.buttons & 1)) return up();
        const d = dir === 'col' ? ev.clientX - x0 : y0 - ev.clientY;
        const [a, b] = limits[key]();
        size[key] = Math.round(Math.max(a, Math.min(b, s0 + (key === 'tune' ? -d : d))));
        apply(); onResize(key);
      };
      const up = () => {
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('lostpointercapture', up);
        h.classList.remove('dragging'); document.body.classList.remove('resizing', dir);
        save(); onResize(key);
      };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('lostpointercapture', up);
    });
    h.addEventListener('dblclick', () => { size[key] = DEFAULTS[key]; fit(); apply(); save(); onResize(key); });
    return h;
  }
  const layout = document.querySelector('.layout'), stage = document.querySelector('.stage');
  handle('v side-split', 'side', layout, null, 'col');
  handle('h sb-split', 'sb', stage, document.querySelector('#shotBar'), 'row');
  handle('v tune-split', 'tune', stage, null, 'col'); // sits on the left edge of a take's settings panel
  // the timeline: drag the top edge of the bottom bar up to make the timeline taller
  const tr = document.querySelector('#transport');
  if (tr) { const h = handle('h tl-split', 'tl', tr, tr.firstChild, 'row'); h.title = 'Drag up or down to make the timeline taller or shorter. Double-click: usual size'; }
  // the editing tools (the sidebar): slide them out of the way and back
  const side = document.querySelector('.side');
  // a button in the top bar, next to the project's name
  const tog = document.createElement('button');
  tog.className = 'ghost icon-only side-btn'; tog.type = 'button'; tog.id = 'btnSide';
  const label = () => { tog.title = size.sideHidden ? 'Show the editing tools' : 'Hide the editing tools (more room for the takes)'; tog.setAttribute('aria-label', tog.title); tog.setAttribute('aria-expanded', String(!size.sideHidden)); };
  tog.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M9 4.5v15"/><path class="sb-arrow" d="M15.5 9.5 13 12l2.5 2.5"/></svg>';
  const brand = document.querySelector('header .brand');
  if (brand) brand.insertAdjacentElement('afterend', tog); else layout.appendChild(tog);
  label();
  const slide = (hide = !size.sideHidden) => {
    size.sideHidden = hide; label(); tog.classList.toggle('on', !hide);
    document.body.classList.add('side-anim'); apply(); save();
    setTimeout(() => { document.body.classList.remove('side-anim'); onResize('side'); }, 280);
    onResize('side');
  };
  tog.addEventListener('click', () => slide());
  addEventListener('resize', () => { fit(); apply(); });
  return { size: () => ({ ...size }), toggleSide: slide, sideHidden: () => !!size.sideHidden };
}
