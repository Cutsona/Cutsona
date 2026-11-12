// Projects and undo.
// History: snapshots of everything you can change (settings, takes, clip trims and framing, the song window).
// A snapshot is taken once things settle after you do something, so dragging a slider is one step, not fifty.
// Projects: save the whole edit (clips, song, settings, takes, keyframes and the exact cuts), open it again later.
// A named project saves itself a few seconds after each change.

export function createHistory({ snapshot, apply, onChange = () => {}, limit = 150 }) {
  let last = null, undo = [], redo = [], applying = false, timer = 0;
  const read = () => JSON.stringify(snapshot());
  function commit() {
    clearTimeout(timer); timer = 0;
    if (applying) return false;
    const s = read();
    if (last === null) { last = s; return false; }
    if (s === last) return false;
    undo.push(last); if (undo.length > limit) undo.shift();
    redo = []; last = s; onChange('commit');
    return true;
  }
  function step(from, to) {
    commit();
    if (!from.length) return false;
    const target = from.pop();
    to.push(last); last = target;
    applying = true;
    try { apply(JSON.parse(target)); } finally { applying = false; }
    last = read(); // what the app actually looks like now (it may tidy a value up)
    onChange(from === undo ? 'undo' : 'redo');
    return true;
  }
  return {
    touch(ms = 450) { if (applying) return; clearTimeout(timer); timer = setTimeout(commit, ms); },
    commit,
    undo: () => step(undo, redo),
    redo: () => step(redo, undo),
    reset() { clearTimeout(timer); undo = []; redo = []; last = read(); onChange('reset'); },
    canUndo: () => undo.length > 0 || (timer && read() !== last),
    canRedo: () => redo.length > 0,
    get applying() { return applying; },
  };
}

const fmtWhen = (t) => {
  const d = new Date(t), now = new Date(), mins = Math.round((now - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (d.toDateString() === now.toDateString()) return `today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};

// the Projects window and the project name in the header
// hooks: buildDoc() -> { doc, uploads }, openDoc(project), newProject(), hasContent(), toast, esc
export function initProjects({ buildDoc, openDoc, newProject, hasContent, toast, esc, suggestName = () => '' }) {
  const dlg = document.getElementById('projDlg');
  const $ = (s) => dlg.querySelector(s);
  let cur = { id: null, name: 'Untitled project', savedAt: 0 };
  let dirty = false, saving = null, again = false, autoTimer = 0, confirmNew = false, confirmDel = null;

  function renderHeader() {
    document.getElementById('projName').textContent = cur.name;
    const st = document.getElementById('projState');
    st.textContent = saving ? 'Saving…' : !cur.id ? (hasContent() ? 'Not saved' : '') : dirty ? 'Edited' : 'Saved';
    st.className = 'proj-state' + (!cur.id && hasContent() ? ' warn' : '');
  }
  async function save({ name, asNew = false, quiet = false } = {}) {
    if (saving) { again = true; return saving; }
    if (!hasContent()) { if (!quiet) toast('Add a clip or a song first, then save', true); return null; }
    clearTimeout(autoTimer);
    if (!name && !cur.id && cur.name === 'Untitled project') name = suggestName() || cur.name;
    saving = (async () => {
      await null; // so the header below already says "Saving…"
      renderHeader();
      try {
        const { doc, afterSave } = await buildDoc();
        const r = await fetch('/api/projects/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: asNew ? null : cur.id, name: name || cur.name, doc }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Couldn’t save the project');
        cur = { id: j.id, name: j.name, savedAt: j.savedAt };
        dirty = false;
        if (afterSave && afterSave(j.doc)) again = true; // a clip lost its copy: save once more with a fresh one
        if (!quiet) toast(`Saved “${j.name}”`);
        return j;
      } catch (e) { toast(e.message || 'Couldn’t save the project', true); return null; }
      finally { saving = null; renderHeader(); if (!dlg.hidden) renderList(); if (again) { again = false; save({ quiet: true }); } }
    })();
    return saving;
  }
  // after any change: a named project saves itself a moment later
  function changed() {
    dirty = true; renderHeader();
    if (cur.id) { clearTimeout(autoTimer); autoTimer = setTimeout(() => save({ quiet: true }), 2500); }
  }

  async function renderList() {
    const list = $('#projList');
    let projects = [];
    try { projects = (await (await fetch('/api/projects')).json()).projects; } catch { list.innerHTML = '<li class="pj-empty">Cutsona isn’t running: start it again and retry.</li>'; return; }
    $('#projCurName').value = cur.name;
    $('#btnProjSave').textContent = cur.id ? (dirty ? 'Save' : 'Saved') : 'Save';
    $('#btnProjSaveNew').hidden = !cur.id;
    $('#projNewConfirm').hidden = !confirmNew;
    list.innerHTML = projects.length ? projects.map((p) => `<li class="pj ${p.id === cur.id ? 'on' : ''}" data-id="${esc(p.id)}">
        <div class="pj-thumb" style="${p.thumb ? `background-image:url(${esc(p.thumb)})` : ''}"></div>
        <div class="pj-info"><b>${esc(p.name)}</b><small>${p.mode === 'stream' ? 'Stream clips' : 'Edits'} · ${p.clips} clip${p.clips === 1 ? '' : 's'}${p.song ? ' · ♪ ' + esc(p.song.replace(/\.[^.]+$/, '')) : ''} · ${fmtWhen(p.savedAt)}</small></div>
        <div class="pj-act">${confirmDel === p.id
          ? `<span class="pj-q">Delete it for good?</span><button class="small danger" data-del-yes>Delete</button><button class="small" data-del-no>Keep</button>`
          : `${p.id === cur.id ? '<span class="pj-open">Open now</span>' : '<button class="small primary-act" data-open>Open</button>'}<button class="small" data-del title="Delete this project">Delete</button>`}</div></li>`).join('')
      : '<li class="pj-empty">No saved projects yet. Save this one and it shows up here.</li>';
  }
  async function open(id) {
    if (cur.id && dirty) await save({ quiet: true });
    try {
      const r = await fetch('/api/projects/open?id=' + encodeURIComponent(id));
      const pr = await r.json();
      if (!r.ok) throw new Error(pr.error || 'Couldn’t open that project');
      close();
      cur = { id: pr.id, name: pr.name, savedAt: pr.savedAt }; dirty = false; renderHeader();
      await openDoc(pr);
      dirty = false; renderHeader();
      if (pr.missing?.length) toast(`Opened “${pr.name}”, but ${pr.missing.length} clip${pr.missing.length === 1 ? ' is' : 's are'} missing`, true);
      else toast(`Opened “${pr.name}”`);
    } catch (e) { toast(e.message, true); }
  }
  function startNew() {
    newProject();
    cur = { id: null, name: 'Untitled project', savedAt: 0 }; dirty = false; confirmNew = false;
    renderHeader(); close(); toast('New project');
  }

  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg) return close();
    const b = e.target.closest('button'); if (!b) return;
    const id = b.closest('[data-id]')?.dataset.id;
    if (b.id === 'btnProjClose') close();
    else if (b.id === 'btnProjSave') { const n = $('#projCurName').value.trim(); await save({ name: n || cur.name }); }
    else if (b.id === 'btnProjSaveNew') { const n = $('#projCurName').value.trim(); await save({ name: (n && n !== cur.name ? n : `${cur.name} copy`), asNew: true }); }
    else if (b.id === 'btnProjNew') { if (!cur.id && hasContent()) { confirmNew = true; renderList(); } else { if (cur.id && dirty) await save({ quiet: true }); startNew(); } }
    else if (b.id === 'btnProjNewSave') { const j = await save({ name: $('#projCurName').value.trim() || cur.name }); if (j) startNew(); }
    else if (b.id === 'btnProjNewDiscard') startNew();
    else if (b.id === 'btnProjNewCancel') { confirmNew = false; renderList(); }
    else if (b.hasAttribute('data-open') && id) open(id);
    else if (b.hasAttribute('data-del') && id) { confirmDel = id; renderList(); }
    else if (b.hasAttribute('data-del-no')) { confirmDel = null; renderList(); }
    else if (b.hasAttribute('data-del-yes') && id) {
      confirmDel = null;
      await fetch('/api/projects/delete?id=' + encodeURIComponent(id), { method: 'POST' });
      if (id === cur.id) { cur = { id: null, name: cur.name, savedAt: 0 }; dirty = true; renderHeader(); }
      renderList(); toast('Project deleted');
    }
  });
  $('#projCurName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnProjSave').click(); else if (e.key === 'Escape') close(); });
  $('#projCurName').addEventListener('change', async () => {
    const n = $('#projCurName').value.trim();
    if (!n || n === cur.name) return;
    if (cur.id) {
      const r = await fetch('/api/projects/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cur.id, name: n }) });
      if (r.ok) { cur.name = (await r.json()).name; renderHeader(); renderList(); }
    } else { cur.name = n; renderHeader(); }
  });
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  let lastFocus = null;
  function show() { lastFocus = document.activeElement; confirmNew = false; confirmDel = null; dlg.hidden = false; renderList(); $('#projCurName').focus(); $('#projCurName').select(); }
  function close() { dlg.hidden = true; lastFocus?.focus?.(); }
  document.getElementById('btnProject').onclick = show;
  renderHeader();
  return { show, close, save, changed, renderHeader, isOpen: () => !dlg.hidden, current: () => cur };
}
