// Keyboard shortcuts you can change: every action has a default key, Settings → Hotkeys lets you press a new one.
// A key is written like "Space", "R", "Shift+ArrowLeft" or "Ctrl+S" (the key's name as the browser reports it).
export const ACTIONS = [
  // [id, label, default key, group]
  ['play', 'Play / pause', 'Space', 'Playback'],
  ['back', 'Back a little', 'ArrowLeft', 'Playback'],
  ['fwd', 'Forward a little', 'ArrowRight', 'Playback'],
  ['start', 'Back to the start', 'Home', 'Playback'],
  ['prevShot', 'Previous shot', '[', 'Playback'],
  ['nextShot', 'Next shot', ']', 'Playback'],
  ['reroll', 'New take of this style', 'R', 'Takes'],
  ['generate', 'New takes (all)', 'G', 'Takes'],
  ['export', 'Export this take', 'E', 'Takes'],
  ['solo', 'Watch one take big', 'V', 'Takes'],
  ['tune', 'Set up this take', 'C', 'Takes'],
  ['finder', 'Find clips', 'F', 'Takes'],
  ['overlay', 'Add a photo / video on the takes', 'P', 'Takes'],
  ['transcript', 'Transcript of the first clip', 'T', 'Takes'],
  ['zoomIn', 'Zoom the timeline in', '=', 'Timeline'],
  ['zoomOut', 'Zoom the timeline out', '-', 'Timeline'],
  ['addKey', 'Add a camera keyframe (shot editor)', 'K', 'Timeline'],
  ['deleteCut', 'Delete the selected cut / keyframe', 'Delete', 'Timeline'],
  ['undo', 'Undo', 'Ctrl+Z', 'Project'],
  ['redo', 'Redo', 'Ctrl+Y', 'Project'],
  ['save', 'Save the project', 'Ctrl+S', 'Project'],
  ['open', 'Open a project', 'Ctrl+O', 'Project'],
];
const KEY = 'cutsona.hotkeys';
const DEFAULT = Object.fromEntries(ACTIONS.map(([id, , k]) => [id, k]));

// what a key press is called: modifiers first, then the key (letters in capitals, digits / signs as typed)
export function comboOf(e) {
  let k = e.key;
  if (k === ' ' || e.code === 'Space') k = 'Space';
  else if (k.length === 1) k = k.toUpperCase();
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  // Shift with a letter or a named key; for signs like + or _ the sign itself already says it
  if (e.shiftKey && (k.length > 1 || /[A-Z]/.test(k))) mods.push('Shift');
  return [...mods, k].join('+');
}
// keys a shortcut can't take (the app, Windows or the takes need them), and keys that would also do something else
const RESERVED = [
  [/^[1-9]$/, 'Keys 1 to 9 always pick a take'],
  [/^(F5|Ctrl\+R)$/i, 'reloads Cutsona'],
  [/^(F12|Ctrl\+Shift\+I)$/i, 'opens the developer tools'],
  [/^Escape$/, 'closes menus and windows in Cutsona'],
  [/^Tab$|^Shift\+Tab$/, 'moves between buttons'],
  [/^Alt\+F4$/i, 'Windows uses it to close the app'],
  [/^Alt\+Tab$|^Ctrl\+Alt\+Delete$/i, 'Windows uses it'],
  [/^Enter$/, 'presses the button you are on'],
];
const SOFT = [
  [/^Ctrl\+[CVXA]$/i, (c) => `${c} also copies, pastes, cuts or selects text in text boxes`],
  [/^Ctrl\+[FPWNT]$/i, (c) => `${c} is a common shortcut in other apps (find, print, close, new)`],
  [/^Alt$|^Alt\+/i, () => 'Alt shortcuts can open Windows menus'],
];
const pretty = (c) => String(c || '').replace('Arrow', '').replace('Left', '←').replace('Right', '→').replace('Up', '↑').replace('Down', '↓').replace(/\+/g, ' + ').replace(' +  + ', ' + +');

export function createHotkeys() {
  let map = { ...DEFAULT };
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); for (const [id, k] of Object.entries(s)) if (id in DEFAULT && typeof k === 'string') map[id] = k; } catch {}
  const save = () => { const o = {}; for (const [id, k] of Object.entries(map)) if (k !== DEFAULT[id]) o[id] = k; try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} };
  // the extra keys that always worked keep working next to the main one (Shift+← for the previous shot, + for zoom)
  const ALIASES = { prevShot: ['Shift+ArrowLeft'], nextShot: ['Shift+ArrowRight'], zoomIn: ['+'], zoomOut: ['_'], deleteCut: ['Backspace'], redo: ['Ctrl+Shift+Z'] };
  return {
    // the action a key press means, or null
    action(e) {
      const c = comboOf(e);
      if (!c) return null;
      for (const [id, k] of Object.entries(map)) if (k && k.toLowerCase() === c.toLowerCase()) return id;
      for (const [id, list] of Object.entries(ALIASES)) if (map[id] === DEFAULT[id] && list.some((k) => k.toLowerCase() === c.toLowerCase())) return id;
      return null;
    },
    key: (id) => map[id] || '',
    label: (id) => pretty(map[id]),
    set(id, combo) {
      // a key can only do one thing: whatever had it loses it
      for (const [other, k] of Object.entries(map)) if (other !== id && k && combo && k.toLowerCase() === combo.toLowerCase()) map[other] = '';
      map[id] = combo; save();
    },
    // what a key would clash with, before it's given to an action:
    // { hard: why } it can't be used; { other, otherLabel } another action has it; { soft: why } it works, but also does something else
    conflict(id, combo) {
      if (!combo) return null;
      const lc = combo.toLowerCase();
      for (const [re, why] of RESERVED) if (re.test(combo)) return { hard: why };
      for (const [other, k] of Object.entries(map)) if (other !== id && k && k.toLowerCase() === lc) return { other, otherLabel: ACTIONS.find((a) => a[0] === other)[1] };
      for (const [other, list] of Object.entries(ALIASES)) if (other !== id && map[other] === DEFAULT[other] && list.some((k) => k.toLowerCase() === lc)) return { other, otherLabel: ACTIONS.find((a) => a[0] === other)[1], alias: true };
      for (const [re, why] of SOFT) if (re.test(combo)) return { soft: why(pretty(combo)) };
      return null;
    },
    swap(id, combo, other) { const mine = map[id]; map[id] = combo; map[other] = mine && mine.toLowerCase() !== combo.toLowerCase() ? mine : ''; save(); },
    reset(id) { if (id) map[id] = DEFAULT[id]; else map = { ...DEFAULT }; save(); },
    isDefault: (id) => map[id] === DEFAULT[id],
    all: () => ACTIONS.map(([id, label, def, group]) => ({ id, label, group, key: map[id], def })),
    pretty,
  };
}

// Settings → Hotkeys: a list of actions, click one and press the new key
export function renderHotkeySettings(box, hk, onChange = () => {}) {
  let wait = null, pend = null, note = null; // pend: { id, combo, c } a key that clashes, waiting for "use it anyway"
  const draw = () => {
    const groups = {};
    for (const a of hk.all()) (groups[a.group] ||= []).push(a);
    box.innerHTML = Object.entries(groups).map(([g, list]) => `<div class="hk-group"><h5>${g}</h5>${list.map((a) => `
      <div class="hk-row ${wait === a.id ? 'waiting' : ''}"><span>${a.label}</span>
        <button class="hk-key ${a.key ? '' : 'none'}" data-hk="${a.id}" title="Click, then press the new key (Esc to cancel, Backspace for none)">${wait === a.id ? 'Press a key…' : a.key ? pretty(a.key) : 'none'}</button>
        <button class="hk-reset" data-hk-reset="${a.id}" ${hk.isDefault(a.id) ? 'hidden' : ''} title="Back to ${pretty(a.def)}">↺</button></div>
      ${note && note.id === a.id ? `<div class="hk-clash hard"><span>${note.text}</span></div>` : ''}
      ${pend && pend.id === a.id ? `<div class="hk-clash"><span>${pend.c.other
        ? `<b>${pretty(pend.combo)}</b> already ${pend.c.alias ? 'also does' : 'does'} <b>${pend.c.otherLabel}</b>.`
        : `<b>${pretty(pend.combo)}</b>: ${pend.c.soft}.`}</span>
        <span class="hk-clash-b">${pend.c.other && !pend.c.alias ? `<button class="small" data-hk-do="swap" title="${pend.c.otherLabel} gets ${a.key ? pretty(a.key) : 'no key'} instead">Swap keys</button>` : ''}
        <button class="small primary-act" data-hk-do="take">${pend.c.other && !pend.c.alias ? `Use it here (${pend.c.otherLabel}: no key)` : 'Use it anyway'}</button>
        <button class="small" data-hk-do="cancel">Cancel</button></span></div>` : ''}`).join('')}</div>`).join('')
      + '<div class="set-row"><button class="small" data-hk-all>All back to the usual keys</button></div>';
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hk]'), r = e.target.closest('[data-hk-reset]');
    const d = e.target.closest('[data-hk-do]');
    if (d && pend) {
      const { id, combo, c } = pend; pend = null;
      if (d.dataset.hkDo === 'swap') hk.swap(id, combo, c.other);
      else if (d.dataset.hkDo === 'take') hk.set(id, combo);
      draw(); onChange(); return;
    }
    if (e.target.closest('[data-hk-all]')) { hk.reset(); wait = null; pend = null; note = null; draw(); onChange(); return; }
    if (r) { hk.reset(r.dataset.hkReset); draw(); onChange(); return; }
    if (b) { pend = null; note = null; wait = wait === b.dataset.hk ? null : b.dataset.hk; draw(); box.querySelector(`[data-hk="${wait}"]`)?.focus(); }
  });
  window.addEventListener('keydown', (e) => {
    if (!wait) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { wait = null; draw(); return; }
    if (e.key === 'Backspace' && !e.ctrlKey) { hk.set(wait, ''); wait = null; draw(); onChange(); return; }
    const c = comboOf(e); if (!c) return;
    if (c.toLowerCase() === hk.key(wait).toLowerCase()) { wait = null; draw(); return; }
    const clash = hk.conflict(wait, c);
    // a key Cutsona or Windows needs: say why, and keep waiting for another one
    if (clash?.hard) { note = { id: wait, text: `<b>${pretty(c)}</b> can't be a shortcut: ${clash.hard}. Press a different key.` }; draw(); return; }
    note = null;
    // the key does something else already: say what, and let the person choose
    if (clash) { pend = { id: wait, combo: c, c: clash }; wait = null; draw(); return; }
    hk.set(wait, c); wait = null; draw(); onChange();
  }, true);
  draw();
  return { refresh: draw, waiting: () => !!wait };
}
