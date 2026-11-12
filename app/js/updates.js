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
    $('.upd-body', modal).innerHTML = `<p class="upd-intro">Cutsona <b>${esc(info.latest)}</b> is out. You have ${esc(info.current)}.
      Updating keeps your clips, settings, keys and exports exactly as they are.</p>`
      + info.notes.map((n) => `<section class="upd-rel"><div class="upd-rel-h"><b>${esc(n.version)}${n.name && n.name.replace(/^v?[\d.]+\s*/, '') ? ': ' + esc(n.name.replace(/^v?[\d.]+\s*[-:–]?\s*/, '')) : ''}</b>
        <span>${esc(fmtDate(n.date))}${n.url ? ` <a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">On GitHub</a>` : ''}</span></div>
        <div class="upd-md">${md(n.body, esc)}</div></section>`).join('');
    $('[data-upd="go"]', modal).textContent = `Update to ${info.latest}`;
  }
  function open() { if (!info?.available) return; renderModal(); modal.hidden = false; $('[data-upd="go"]', modal).focus(); }
  function close() { if (!updating) modal.hidden = true; }
  modal.addEventListener('click', (e) => {
    if (e.target === modal) return close();
    const b = e.target.closest('[data-upd]'); if (!b) return;
    if (b.dataset.upd === 'close') close(); else if (b.dataset.upd === 'go') update();
  });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  async function update() {
    if (updating) return;
    updating = true;
    const go = $('[data-upd="go"]', modal), st = $('.upd-status', modal), later = $('[data-upd="close"]', modal);
    go.disabled = true; later.disabled = true;
    st.innerHTML = '<span class="spinner"></span> Downloading and installing…';
    const desk = window.cutsonaDesktop;
    if (desk?.installUpdate) {
      // the desktop app downloads the new installer, then closes, updates and opens again by itself
      desk.onUpdate?.((u) => { if (u.percent != null) st.innerHTML = `<span class="spinner"></span> Downloading ${Math.round(u.percent)}%…`; if (u.ready) st.innerHTML = '<span class="spinner"></span> Installing: Cutsona will open again in a moment…'; });
      try { await desk.installUpdate(); }
      catch (e) { updating = false; go.disabled = false; later.disabled = false; st.textContent = e?.message || 'The update didn’t finish.'; }
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
      updating = false; go.disabled = false; later.disabled = false;
      st.textContent = e.message;
    }
  }

  // Settings → Updates
  const ver = $('#updVersion'), note = $('#updNote'), btnCheck = $('#btnCheckUpd'), btnSee = $('#btnSeeUpd');
  function show(j) {
    info = j;
    if (ver) ver.textContent = j.current ? `Cutsona ${j.current}` : '';
    const avail = !!j.available;
    pill.hidden = !avail;
    if (avail) pill.textContent = `Update to ${j.latest}`;
    if (btnSee) btnSee.hidden = !avail;
    if (note) {
      note.classList.toggle('err', !!j.error);
      note.textContent = j.reason === 'not-set-up' ? 'Updates aren’t set up in this copy of Cutsona.'
        : j.error ? j.error
          : avail ? `Cutsona ${j.latest} is out: see what’s new, then update with one click.`
            : `You have the newest Cutsona.${j.checkedAt ? ` Checked ${new Date(j.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}`;
    }
  }
  async function check(force = false) {
    try {
      const j = window.cutsonaDesktop?.checkUpdate ? await window.cutsonaDesktop.checkUpdate(force)
        : await (await fetch('/api/update' + (force ? '?force=1' : ''), { cache: 'no-store' })).json();
      show(j); return j;
    } catch { return null; }
  }
  pill.onclick = open;
  if (btnSee) btnSee.onclick = open;
  if (btnCheck) btnCheck.onclick = async () => {
    btnCheck.disabled = true; if (note) note.textContent = 'Checking…';
    const j = await check(true); btnCheck.disabled = false;
    if (j?.available) open();
  };
  // a look when Cutsona opens (the server has usually checked already), a message a moment later if there's news,
  // a fresh look whenever Settings opens, and every few hours
  check();
  setTimeout(async () => {
    const j = await check();
    if (j?.available) toast(`Cutsona ${j.latest} is out: press “Update to ${j.latest}” at the top to see what’s new`);
  }, 5000);
  document.getElementById('btnSettings')?.addEventListener('click', () => check());
  setInterval(() => check(), 3 * 3600e3);
  return { open, check };
}
