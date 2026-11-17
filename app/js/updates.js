// Updates in the app: a "Cutsona x.y is out" button in the header, the changelog, and one-click updating.
// The desktop app updates itself from GitHub Releases (desktop/main.js, through window.cutsonaDesktop);
// a copy run from source code uses the server side (updater.js) and the git tags of the repo in version.json.
const $ = (s, r = document) => r.querySelector(s);

// release notes are Markdown: a small, safe subset (headings, lists, bold, italics, code, https links)
function md(text, esc) {
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  const out = [];
  let list = false;
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const li = /^\s*[-*+]\s+(.*)/.exec(line), h = /^#{1,6}\s+(.*)/.exec(line);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (h) out.push(`<h5>${inline(h[1])}</h5>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('') || '<p class="upd-none">No notes for this version.</p>';
}

export function initUpdates({ toast, esc }) {
  const pill = $('#btnUpdate');
  const modal = document.createElement('div');
  modal.className = 'settings upd-modal'; modal.hidden = true;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'What’s new in Cutsona');
  modal.innerHTML = `<div class="set-card">
      <div class="set-h"><b>What’s new in Cutsona</b><button class="small" data-upd="close">Later</button></div>
      <div class="set-b upd-body"></div>
      <div class="upd-foot"><span class="upd-status" aria-live="polite"></span><button class="primary" data-upd="go">Update now</button></div>
    </div>`;
  document.body.appendChild(modal);
  let info = null, updating = false;

  const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };
  function renderModal() {
    if (!info) return;
    $('.upd-body', modal).innerHTML = (info.local
      ? `<p class="upd-intro">A new Cutsona is ready: <b>${esc(info.latest)}</b>. You have ${esc(info.current)}.
      Update now and Cutsona closes, installs it and opens again by itself (about half a minute). Your clips, settings, projects and exports stay exactly as they are.</p>`
      : `<p class="upd-intro">Cutsona <b>${esc(info.latest)}</b> is out. You have ${esc(info.current)}.
      Updating keeps your clips, settings, keys and exports exactly as they are.</p>`)
      + info.notes.map((n) => `<section class="upd-rel"><div class="upd-rel-h"><b>${esc(n.version)}${n.name && n.name.replace(/^v?[\d.]+\s*/, '') ? ': ' + esc(n.name.replace(/^v?[\d.]+\s*[-:–]?\s*/, '')) : ''}</b>
        <span>${esc(fmtDate(n.date))}${n.url ? ` <a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">On GitHub</a>` : ''}</span></div>
        <div class="upd-md">${md(n.body, esc)}</div></section>`).join('');
    $('[data-upd="go"]', modal).textContent = info.local ? 'Update now' : `Update to ${info.latest}`;
  }
  function open() { if (!info?.available) return; renderModal(); modal.hidden = false; $('[data-upd="go"]', modal).focus(); }
  let later = ''; // "Later" on a pop-up: that version doesn't pop up again (the Update button at the top stays)
  function close() { if (!updating) { modal.hidden = true; later = info?.latest || ''; } }
  modal.addEventListener('click', (e) => {
    if (e.target === modal) return close();
    const b = e.target.closest('[data-upd]'); if (!b) return;
    if (b.dataset.upd === 'close') close(); else if (b.dataset.upd === 'go') update();
  });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  async function update() {
    if (updating) return;
    updating = true;
    const go = $('[data-upd="go"]', modal), st0 = $('.upd-status', modal), later = $('[data-upd="close"]', modal);
    // (the status shows in the pop-up and in Settings → Updates, whichever you pressed Update in)
    const sNote = $('#updNote'), sBtn = $('#btnDoUpd');
    const st = { set innerHTML(h) { st0.innerHTML = h; if (sNote) { sNote.classList.remove('err'); sNote.innerHTML = h; } }, set textContent(t) { st0.textContent = t; if (sNote) sNote.textContent = t; } };
    go.disabled = true; later.disabled = true; if (sBtn) sBtn.disabled = true;
    st.innerHTML = '<span class="spinner"></span> Downloading and installing…';
    const desk = window.cutsonaDesktop;
    if (desk?.installUpdate) {
      // the desktop app downloads the new installer, then closes, updates and opens again by itself
      desk.onUpdate?.((u) => { if (u.percent != null) st.innerHTML = `<span class="spinner"></span> Downloading ${Math.round(u.percent)}%…`; if (u.ready) st.innerHTML = '<span class="spinner"></span> Installing: Cutsona will open again in a moment…'; });
      // your edit is saved first, so it opens again just as it was
      try { await window.__cutsonaFlush?.(); } catch {}
      try { await desk.installUpdate(); }
      catch (e) { updating = false; go.disabled = false; later.disabled = false; if (sBtn) sBtn.disabled = false; st.textContent = e?.message || 'The update didn’t finish.'; }
      return;
    }
    try {
      const r = await fetch('/api/update/apply', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The update didn’t finish.');
      st.innerHTML = `<span class="spinner"></span> Installed ${esc(j.version || info.latest)}. Restarting Cutsona…`;
      // wait for the new version to answer, then reload into it
      const want = j.version || info.latest, t0 = Date.now();
      await new Promise((res) => setTimeout(res, 2500));
      while (Date.now() - t0 < 60000) {
        try { const s = await (await fetch('/api/status', { cache: 'no-store' })).json(); if (s.version === want) { location.reload(); return; } } catch {}
        await new Promise((res) => setTimeout(res, 1000));
      }
      st.textContent = 'Cutsona was updated but didn’t start again by itself. Close Cutsona and open it again.';
    } catch (e) {
      updating = false; go.disabled = false; later.disabled = false; if (sBtn) sBtn.disabled = false;
      st.textContent = e.message;
    }
  }

  // Settings → Updates
  const ver = $('#updVersion'), note = $('#updNote'), btnCheck = $('#btnCheckUpd'), btnSee = $('#btnSeeUpd');
  // Settings → Updates: "Update now" right there (no extra window): it downloads, installs and opens Cutsona again
  let btnDo = $('#btnDoUpd');
  if (!btnDo && btnCheck) {
    btnDo = document.createElement('button'); btnDo.className = 'small primary-act'; btnDo.id = 'btnDoUpd'; btnDo.hidden = true; btnDo.textContent = 'Update now';
    btnCheck.insertAdjacentElement('beforebegin', btnDo);
  }
  // the version, and whether it's the newest, by the wordmark in the header
  const chip = document.createElement('button');
  chip.className = 'ver-chip checking'; chip.id = 'verChip'; chip.innerHTML = '<span class="vc-v"></span><i></i><span class="vc-s">Checking…</span>';
  document.querySelector('header.top .brand')?.insertAdjacentElement('afterend', chip);
  const v0 = window.cutsonaDesktop?.version; if (v0) chip.querySelector('.vc-v').textContent = 'v' + v0;
  chip.onclick = async () => {
    if (info?.available) return open();
    chip.className = 'ver-chip checking'; chip.querySelector('.vc-s').textContent = 'Checking…';
    await check(true);
  };
  function showChip(j) {
    const cur = j.current || v0 || '';
    chip.querySelector('.vc-v').textContent = cur ? 'v' + String(cur).replace(/^v/, '') : '';
    const state = j.available ? 'new' : j.reason === 'not-set-up' ? 'dev' : j.error ? 'err' : 'ok';
    chip.className = 'ver-chip ' + state;
    chip.querySelector('.vc-s').textContent = state === 'new' ? (j.local ? 'Update ready' : `${j.latest} is out`) : state === 'ok' ? 'Up to date' : state === 'dev' ? 'Updates off' : 'Can\'t check';
    chip.title = state === 'new' ? 'A new Cutsona is ready: click to see what\'s new and update'
      : state === 'ok' ? `You have the newest Cutsona${j.checkedAt ? ` (checked ${new Date(j.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})` : ''}. Click to check again`
        : state === 'dev' ? 'Updates aren\'t set up in this copy of Cutsona' : `Couldn't check for updates: ${j.error}. Click to try again`;
  }
  function show(j) {
    info = j;
    showChip(j);
    if (ver) ver.textContent = j.current ? `Cutsona ${j.current}` : '';
    const avail = !!j.available;
    pill.hidden = !avail;
    if (avail) pill.textContent = j.local ? 'Update ready' : `Update to ${j.latest}`;
    if (btnSee) btnSee.hidden = !avail;
    if (btnDo) { btnDo.hidden = !avail; btnDo.textContent = avail ? (j.local ? 'Update now' : `Update to ${j.latest}`) : 'Update now'; }
    if (note) {
      note.classList.toggle('err', !!j.error);
      note.textContent = j.reason === 'not-set-up' ? 'Updates aren’t set up in this copy of Cutsona.'
        : j.error ? j.error
          : avail ? (j.local ? 'A new Cutsona is ready: press Update now (it installs and opens again by itself).' : `Cutsona ${j.latest} is out: see what’s new, then update with one click.`)
            : `You have the newest Cutsona.${j.checkedAt ? ` Checked ${new Date(j.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}`;
    }
  }
  async function check(force = false) {
    try {
      const j = window.cutsonaDesktop?.checkUpdate ? await window.cutsonaDesktop.checkUpdate(force)
        : await (await fetch('/api/update' + (force ? '?force=1' : ''), { cache: 'no-store' })).json();
      show(j); return j;
    } catch (e) { showChip({ error: 'no connection', current: info?.current }); return null; }
  }
  pill.onclick = open;
  if (btnSee) btnSee.onclick = open;
  if (btnDo) btnDo.onclick = () => { if (info?.available) { renderModal(); update(); } };
  // Check for updates: when there is one, it updates right away (that's what you pressed it for)
  if (btnCheck) btnCheck.onclick = async () => {
    btnCheck.disabled = true; if (note) note.textContent = 'Checking…';
    const j = await check(true); btnCheck.disabled = false;
    if (j?.available) { renderModal(); update(); }
  };
  // a look when Cutsona opens (the server has usually checked already), a message a moment later if there's news,
  // a fresh look whenever Settings opens, and every few hours
  check();
  // live: the moment an update is out, it pops up (the desktop app tells the page; a copy run from source asks every 10 minutes)
  const pop = (j) => { if (!j?.available || updating) return; show(j); if (later !== j.latest && modal.hidden) open(); };
  if (window.cutsonaDesktop?.onLive) window.cutsonaDesktop.onLive(pop);
  else setInterval(async () => { const before = info?.latest; const j = await check(); if (j?.available && j.latest !== before) pop(j); }, 10 * 60e3);
  setTimeout(async () => {
    const j = await check();
    if (j?.available) pop(j);
  }, 5000);
  document.getElementById('btnSettings')?.addEventListener('click', () => check());
  setInterval(() => check(), 3 * 3600e3);
  return { open, check };
}
