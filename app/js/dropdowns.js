// Sidebar option groups as dropdowns: a group of 3 or more choices (layout, format, length, filter, banner look…)
// becomes one compact button showing the current choice (with its color or banner preview) that opens the list.
// The original buttons live inside the list, so every existing click handler keeps working unchanged.
const GROUPS = '.pick, .seg, .filters, .themes, .fxchips';
// a list you tick several things in (extra effects): it stays open while you tick, even when the panel redraws
let reopenKey = '', reopenAt = 0;
const chevron = '<svg class="dd-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
let openDd = null;

function close(dd = openDd) {
  if (!dd) return;
  dd.classList.remove('open');
  dd.querySelector('.dd-btn')?.setAttribute('aria-expanded', 'false');
  const menu = dd.querySelector('.dd-menu');
  if (menu) { menu.style.cssText = ''; }
  if (openDd === dd) openDd = null;
}
function place(dd) {
  const btn = dd.querySelector('.dd-btn'), menu = dd.querySelector('.dd-menu');
  const r = btn.getBoundingClientRect();
  const wide = menu.matches('.filters, .themes, .wrap4, .fxchips') ? Math.max(r.width, 300) : Math.max(r.width, 170);
  menu.style.position = 'fixed';
  menu.style.minWidth = `${Math.round(r.width)}px`;
  menu.style.width = `${Math.round(Math.min(wide, innerWidth - 16))}px`;
  menu.style.left = `${Math.round(Math.min(r.left, innerWidth - 8 - Math.min(wide, innerWidth - 16)))}px`;
  const below = innerHeight - r.bottom - 10, above = r.top - 10;
  menu.style.maxHeight = '';
  const h = Math.min(menu.scrollHeight, 420);
  if (below >= Math.min(h, 220) || below >= above) { menu.style.top = `${Math.round(r.bottom + 4)}px`; menu.style.bottom = ''; menu.style.maxHeight = `${Math.max(140, below)}px`; }
  else { menu.style.top = ''; menu.style.bottom = `${Math.round(innerHeight - r.top + 4)}px`; menu.style.maxHeight = `${Math.max(140, above)}px`; }
}
function open(dd) {
  if (openDd && openDd !== dd) close(openDd);
  dd.classList.add('open');
  dd.querySelector('.dd-btn').setAttribute('aria-expanded', 'true');
  openDd = dd;
  place(dd);
  dd.querySelector('.dd-menu > button.on, .dd-menu > button')?.focus({ preventScroll: true });
}

function sync(dd) {
  const menu = dd.querySelector('.dd-menu'), cur = dd.querySelector('.dd-cur');
  if (dd.classList.contains('multi')) {
    const on = [...menu.querySelectorAll(':scope > button.on')].map((b) => b.textContent.replace('✦', '').trim());
    cur.className = 'dd-cur' + (on.length ? '' : ' none');
    cur.innerHTML = on.length ? `<b class="dd-n">${on.length}</b>${on.join(', ').replace(/[&<>]/g, '')}` : 'None: tick to stack';
    return;
  }
  const on = menu.querySelector(':scope > button.on');
  if (on) {
    cur.className = 'dd-cur ' + [...on.classList].filter((c) => c !== 'on').join(' ');
    cur.innerHTML = on.innerHTML;
  } else { cur.className = 'dd-cur none'; cur.textContent = menu.dataset.ddEmpty || 'Choose…'; }
}

function enhance(g) {
  if (g.dataset.dd || g.closest('.dd-menu') || g.closest('[data-no-dd]')) return;
  const opts = [...g.children].filter((b) => b.tagName === 'BUTTON');
  const always = g.matches('.filters, .themes') || g.parentElement.hasAttribute('data-dd-force');
  // two choices stay side by side (On / Off is quicker to see and click than a list)
  if (!always && opts.length < 3) { g.dataset.dd = 'inline'; g.classList.add('dd-inline'); return; }
  g.dataset.dd = '1';
  const multi = g.matches('.fxchips');
  const key = (g.closest('.field')?.querySelector(':scope > span')?.firstChild?.textContent || '') + '|' + g.className;
  const dd = document.createElement('div');
  dd.className = 'dd' + (multi ? ' multi' : '');
  dd.dataset.key = key;
  dd.innerHTML = `<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false"><span class="dd-cur"></span>${chevron}</button>`;
  g.parentNode.insertBefore(dd, g);
  dd.appendChild(g);
  g.classList.add('dd-menu');
  g.setAttribute('role', 'listbox');
  const btn = dd.querySelector('.dd-btn');
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (dd.classList.contains('open')) close(dd); else open(dd); });
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(dd); } });
  // picking an option: its own handler runs (it bubbles on), then the list closes
  g.addEventListener('click', (e) => {
    if (!e.target.closest('button')) return;
    if (multi) { reopenKey = key; reopenAt = performance.now(); setTimeout(() => sync(dd), 0); return; }
    setTimeout(() => { close(dd); sync(dd); }, 0);
  });
  g.addEventListener('keydown', (e) => {
    const list = [...g.querySelectorAll(':scope > button')], k = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[Math.min(list.length - 1, k + 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[Math.max(0, k - 1)]?.focus(); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(dd); btn.focus(); }
  });
  new MutationObserver(() => sync(dd)).observe(g, { subtree: true, attributes: true, attributeFilter: ['class', 'data-dd-empty'], childList: true });
  sync(dd);
  if (multi && key === reopenKey && performance.now() - reopenAt < 1500) requestAnimationFrame(() => { if (dd.isConnected) open(dd); });
  // a field with a dropdown sits on one row: name on the left, the choice on the right
  dd.closest('.field')?.classList.add('dd-row');
}

export function initDropdowns(roots) {
  const scan = (root) => root.querySelectorAll(GROUPS).forEach(enhance);
  for (const root of roots) {
    if (!root) continue;
    scan(root);
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches?.(GROUPS)) enhance(n);
        n.querySelectorAll?.(GROUPS).forEach(enhance);
      }
    }).observe(root, { childList: true, subtree: true });
  }
  document.addEventListener('pointerdown', (e) => { if (openDd && !openDd.contains(e.target)) close(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openDd) { close(); } });
  addEventListener('resize', () => close());
  document.addEventListener('scroll', (e) => { if (openDd && !openDd.querySelector('.dd-menu').contains(e.target)) close(); }, true);
}
