// Quick Mode → Topic to video: type a topic (or several, or write your own script), check the script, pick a voice,
// music, captions and a look, and Cutsona makes the whole narrated video (docmaker.js on the server does the work).
// Lives on its own page (Quick Mode); the videos you made are listed beside the video.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import { initDocEditor } from './docedit.js';
import { fmtT } from './words.js';
import { FILTERS, VIDEO_FORMATS } from './styles.js';
import { TOPIC_CAPTION_STYLES, captionSampleHtml, paintCaptionSample } from './captions.js';
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };

// ideas for the 🎲 button: things a short documentary works well for (each has a long Wikipedia article)
const TOPICS = ['The Titanic', 'Black holes', 'The Roman Empire', 'Michael Jordan', 'The Great Pyramid of Giza', 'Area 51', 'The Bermuda Triangle',
  'Nikola Tesla', 'The Moon landing', 'Pompeii', 'The Mariana Trench', 'Chernobyl disaster', 'Vikings', 'Samurai', 'Cleopatra', 'The Great Wall of China',
  'Mount Everest', 'The Amazon rainforest', 'Leonardo da Vinci', 'The Cold War', 'Ancient Egypt', 'The Aztec Empire', 'Tutankhamun', 'The Hindenburg disaster',
  'The Space Shuttle Challenger disaster', 'Muhammad Ali', 'Kobe Bryant', 'The International Space Station', 'Mars', 'Jupiter', 'Saturn', 'The Sun',
  'Dinosaurs', 'Tyrannosaurus', 'Megalodon', 'Great white shark', 'Blue whale', 'Octopus', 'Volcano', 'Yellowstone Caldera', 'Tsunami', 'Tornado',
  'The Wright brothers', 'Albert Einstein', 'Isaac Newton', 'Marie Curie', 'The Beatles', 'Elvis Presley', 'Michael Jackson', 'Tupac Shakur', 'The Olympic Games',
  'FIFA World Cup', 'Bitcoin', 'The Internet', 'Artificial intelligence', 'Video game crash of 1983', 'Nintendo', 'Minecraft', 'Grand Theft Auto', 'Machu Picchu',
  'Easter Island', 'Stonehenge', 'Atlantis', 'The Library of Alexandria', 'The Black Death', 'Napoleon', 'Alexander the Great', 'Genghis Khan', 'Spartacus',
  'Al Capone', 'D. B. Cooper', 'The Zodiac Killer', 'Bigfoot', 'Loch Ness Monster', 'Roswell incident', 'Apollo 13', 'Voyager 1', 'Hubble Space Telescope'];
const LEGACY_FILM = { cine2383: 'film_cinema', fuji3510: 'film_fuji_print', animelut: 'film_anime' };
const CAP_LANGS = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'],
  ['ru', 'Russian'], ['uk', 'Ukrainian'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['id', 'Indonesian'], ['vi', 'Vietnamese']];
const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const mmss = fmtT;

export function initTopicVideo({ toast, addToEdit = null, openFinder, mount, settings, side, pick, filterChips, strSel }) {
  const opt = (k, d) => LS('cutsona.tv' + k) ?? d;
  const film = opt('Look', '');
  const preferredFilter = opt('Filter', LEGACY_FILM[film] || 'film_' + film);
  const st = { step: 'topic', topic: '', many: false, list: opt('List', ''), vertical: opt('Vert', '0') === '1', title: '', scenes: [], source: '',
    voice: opt('Voice', 'ryan'), pace: opt('Pace', 'normal'), music: opt('Music', 'calm'), musicLevel: opt('MusicLvl', 'normal'), captions: opt('Caps', '1') !== '0',
    capStyle: opt('CapStyle', 'bold'), capLang: opt('CapLang', 'en'), filter: Object.hasOwn(FILTERS, preferredFilter) ? preferredFilter : 'none', titleCard: opt('TitleCard', '1') !== '0',
    takes: Number(opt('Takes', 4)) || 4, folder: null, folderCount: 0, voices: null, job: null, own: false, queue: null, view: null, project: null,
    duration: opt('LengthSeconds', opt('Duration', '') || String((Number(opt('Min', 3)) || 3) * 60)),
    aspect: opt('Aspect', opt('Vert', '0') === '1' ? '9:16' : '16:9'), scriptStyle: opt('ScriptStyle', 'overview'), matches: [], sources: [], saved: [] };
  const root = mount;
  st.vertical = Number(st.aspect.split(':')[1]) > Number(st.aspect.split(':')[0]);
  root.classList.add('tv-page');
  const api = async (url, body) => { const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; };
  const words = () => st.scenes.reduce((a, s) => a + s.text.split(/\s+/).filter(Boolean).length, 0);
  const chips = (name, list, cur) => `<div class="tv-chips" data-name="${name}">${list.map(([v, l]) => `<button class="chip${String(v) === String(cur) ? ' on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const topics = () => st.list.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20);
  const LENGTHS = [[60, '1 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']];
  let customLength = st.duration !== 'script' && !LENGTHS.some(([seconds]) => String(seconds) === st.duration);
  const duration = () => st.duration === 'script' ? 0 : Math.max(15, Math.min(1200, Number(st.duration) || 0));
  const validDuration = () => !customLength || !!$('#tvDuration', settings)?.reportValidity();
  const field = (key, label, values, current = st[key], menu = false) => `<div class="field"${menu ? ' data-dd-force' : ''}><span>${label}</span>${pick(key, values, current)}</div>`;

  // ---- the videos you made (sidebar) ----
  const recent = () => { try { return JSON.parse(LS('cutsona.qvRecent') || '[]'); } catch { return []; } };
  const remember = (j, title, pid = null) => { const r = recent().filter((x) => x.name !== j.name); r.unshift({ name: j.name, url: j.url, title, dur: j.duration || 0, at: Date.now(), vertical: st.project?.vertical ?? st.vertical, pid: pid || j.project || null }); LS('cutsona.qvRecent', JSON.stringify(r.slice(0, 30))); drawSide(); };
  // the editor (takes side by side, the timeline, swapping pictures)
  const editor = initDocEditor({ toast, openFinder, addToEdit, sidebar: settings, pick, filterChips,
    onExported: (j, title, pid, k) => { remember(j, (st.project?.takes.length || 1) > 1 ? `${title} (take ${k + 1})` : title, pid); toast(`Take ${k + 1} saved: ${j.name}`); },
    onBack: () => { editor.close(); st.step = 'topic'; st.project = null; root.classList.remove('editing'); draw(); } });
  async function openProject(pid) {
    try { await editor.flush(); st.project = await api('/api/doc/project?id=' + encodeURIComponent(pid)); st.step = 'edit'; st.view = null; draw(); drawSide(); }
    catch (e) { toast(e.message, true); }
  }
  async function refreshSaved() {
    try { st.saved = (await api('/api/doc/projects')).items || []; drawSide(); } catch {}
  }
  function drawSide() {
    if (!side) return;
    const r = recent();
    side.innerHTML = `<div class="panel-h"><h3>Saved Quick projects</h3></div>`
      + (st.saved.length ? `<ul class="qs-list">${st.saved.map((x) => `<li><button class="qs-project" data-qs-project="${esc(x.id)}"><i class="qs-shape ${x.vertical ? 'v' : ''}"></i><span><b>${esc(x.title)}</b><small>${x.takes} take${x.takes === 1 ? '' : 's'} · ${mmss(x.total)}</small></span></button></li>`).join('')}</ul>`
        : '<p class="qs-empty">Projects appear here as soon as the takes are ready.</p>')
      + (r.length ? `<div class="panel-h"><h3>Recent exports</h3><button class="small ghost" data-qs="clear">Clear</button></div><ul class="qs-list">${r.map((x, i) => `<li data-qs-i="${i}" class="${st.view?.name === x.name ? 'on' : ''}"><i class="qs-shape ${x.vertical ? 'v' : ''}"></i><span><b>${esc(x.title)}</b><small>${x.dur ? mmss(x.dur) + ' · ' : ''}${ago(x.at)}</small></span></li>`).join('')}</ul>` : '');
  }
  side?.addEventListener('click', (e) => {
    const project = e.target.closest('[data-qs-project]');
    if (project) { openProject(project.dataset.qsProject); return; }
    if (e.target.closest('[data-qs="clear"]')) { LS('cutsona.qvRecent', '[]'); drawSide(); return; }
    const li = e.target.closest('[data-qs-i]'); if (!li) return;
    const x = recent()[+li.dataset.qsI]; if (!x) return;
    st.view = x; st.step = 'view'; draw('main'); drawSide();
  });

  function optionsHtml() {
    const header = (i, label) => `<div class="panel-h"><h3><span class="step">${i}</span> ${label}</h3></div>`;
    const onOff = [[true, 'On'], [false, 'Off']];
    return `<section class="panel">${header(1, 'Video')}
      ${field('duration', 'Video length', [...LENGTHS, ['custom', 'Custom'], ...(st.step === 'script' || st.duration === 'script' ? [['script', 'Fit script']] : [])], customLength ? 'custom' : st.duration)}
      ${customLength ? `<label class="field tv-duration"><span>Seconds</span><input id="tvDuration" type="number" min="15" max="1200" step="1" required value="${esc(st.duration)}"></label>` : ''}
      ${field('scriptStyle', 'Script style', [['overview', 'Overview'], ['history', 'Timeline']])}
      ${st.many && st.step === 'topic' ? '' : field('takes', 'Takes', [[1, '1'], [2, '2'], [4, '4']])}
      ${field('aspect', 'Format', VIDEO_FORMATS.map((x) => [x, x]))}
      ${field('pictures', 'Pictures', [['web', 'From the internet'], ['folder', st.folder ? `My folder (${st.folderCount})` : 'My folder…']], st.folder ? 'folder' : 'web', true)}
      <div class="field"><span>Filter</span>${filterChips(st.filter, undefined, 'None')}</div>
      ${field('titleCard', 'Title card', onOff)}
    </section><section class="panel">${header(2, 'Voice and sound')}
      <label class="field"><span>Voice</span><select data-sel="voice" id="tvVoice">${voiceOpts()}</select></label>
      ${field('pace', 'Speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']])}
      ${field('music', 'Music', [['calm', 'Calm'], ['epic', 'Epic'], ['mystery', 'Mystery'], ['inspiring', 'Inspiring'], ['none', 'None']])}
      ${st.music === 'none' ? '' : field('musicLevel', 'Music level', [['low', 'Low'], ['normal', 'Normal'], ['high', 'Loud']])}
    </section><section class="panel">${header(3, 'Captions')}
      ${field('captions', 'Captions', onOff)}
      ${st.captions ? `${field('capStyle', 'Caption style', Object.entries(TOPIC_CAPTION_STYLES))}${captionSampleHtml()}
      <label class="field"><span>Language</span>${strSel('capLang', CAP_LANGS, st.capLang)}</label>` : ''}
    </section>`;
  }
  function stepHtml() {
    if (st.step === 'topic') {
      return `<h2>What's the video about?</h2><p class="tv-sub">Type a topic and Cutsona writes the script, records the voice, finds pictures and music, adds captions and makes the video.</p>
        <div class="tv-many">${chips('many', [[0, 'One topic'], [1, 'Several topics']], st.many ? 1 : 0)}</div>
        ${st.many
          ? `<textarea id="tvList" class="tv-list" rows="6" placeholder="One topic per line. Cutsona makes them one after another.\nThe Titanic\nBlack holes\nVikings">${esc(st.list)}</textarea>
             <div class="tv-meta"><button class="small ghost" data-a="rand3">🎲 Add 3 ideas</button><span>${topics().length} video${topics().length === 1 ? '' : 's'}</span></div>`
          : `<div class="tv-in tv-in-row"><input id="tvTopic" placeholder="A topic: the Titanic, Black holes, Michael Jordan, the Roman Empire…" value="${esc(st.topic)}"><button class="small ghost tv-dice" data-a="rand" title="A random topic">🎲</button></div>`}
        <div class="ob-actions">${st.many ? `<button class="small primary" data-a="batch" ${topics().length ? '' : 'disabled'}>Make ${topics().length > 1 ? `all ${topics().length}` : 'it'}</button>`
          : '<button class="small ghost" data-a="own">Write my own script</button><button class="small primary" data-a="write">Write the script</button>'}</div>`;
    }
    if (st.step === 'sources') {
      const groups = [...new Set(st.matches.map((x) => x.provider))];
      return `<h2>Research for ${esc(st.topic)}</h2><p class="tv-sub">Use matching sources together, or start with a specific result.</p>
        <button class="small primary tv-research-run" data-match="auto">Write from matching sources</button>
        <div class="tv-research">${groups.map((provider) => `<section><h3>${esc(provider)}</h3><div class="tv-sources">${st.matches.flatMap((x, i) => x.provider === provider ? [x.reference
          ? `<a class="small" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(x.title)}</b><small>Read reference ↗</small></a>`
          : `<button class="small" data-match="${i}"><b>${esc(x.title)}</b><small>${esc(x.summary.slice(0, 150))}</small></button>`] : []).join('')}</div></section>`).join('')}</div>
        <div class="ob-actions"><button class="small ghost" data-a="back">Back</button></div>`;
    }
    if (st.step === 'script') {
      const secs = Math.round(words() / 2.5);
      return `<h2>${st.own ? 'Your script' : 'The script'}</h2>
        <p class="tv-sub">${st.own ? 'One line or paragraph per scene.' : 'Edit the script. Each box is one scene with its own pictures.'}</p>
        ${st.sources.length ? `<p class="tv-meta">Sources ${st.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.provider || x.title)}</a>`).join(' · ')}</p>` : ''}
        <label class="tv-in tv-title"><span>Title</span><input id="tvTitle" value="${esc(st.title)}" placeholder="Title (shown at the start)"></label>
        ${st.own && !st.scenes.length ? `<textarea id="tvOwn" class="tv-list" rows="10" placeholder="Paste or write your script here. Each paragraph becomes a scene."></textarea>` : `<ol class="tv-scenes">${st.scenes.map((s, i) => `<li><textarea data-i="${i}" rows="2">${esc(s.text)}</textarea><button class="tv-del" data-del="${i}" title="Remove this scene">×</button></li>`).join('')}</ol>
        <div class="tv-meta"><button class="small ghost" data-a="add">+ Scene</button><span>${st.scenes.length} scenes · about ${mmss(secs)} long</span></div>`}
        <div class="ob-actions"><button class="small ghost" data-a="back">Back</button><button class="small primary" data-a="make" ${st.scenes.length || st.own ? '' : 'disabled'}>${st.takes > 1 ? `Make ${st.takes} takes` : 'Make the video'}</button></div>`;
    }
    if (st.step === 'make') {
      const j = st.job || {};
      let h = `<h2>${j.status === 'done' ? 'Your video is ready' : j.status === 'error' ? 'That didn\'t work' : st.takes > 1 ? `Making ${st.takes} takes` : 'Making your video'}</h2>`;
      if (j.status === 'done') h += resultHtml(j.url, j.name, j.note);
      else if (j.status === 'error') h += `<p class="tv-err">${esc(j.error)}</p><div class="ob-actions"><button class="small ghost" data-a="back2">Back to the script</button></div>`;
      else h += `<div class="tv-prog"><i style="width:${Math.round(j.pct || 1)}%"></i></div><p class="tv-phase">${esc(j.phase || 'Starting')}…</p><p class="tv-note">Next: ${st.takes > 1 ? `the ${st.takes} takes side by side` : 'your video'} on a timeline, where you can swap any picture, change the captions, the look and the music, then export.</p>`;
      return h;
    }
    if (st.step === 'batch') {
      const q = st.queue || [], done = q.filter((x) => x.status === 'done').length, busy = q.some((x) => x.status === 'working' || x.status === 'waiting');
      return `<h2>${busy ? `Making ${q.length} videos` : `${done} of ${q.length} videos made`}</h2><p class="tv-sub">One after another, each with the selected settings. Click a finished one to watch it.</p>
        <ol class="tv-queue">${q.map((x, i) => `<li class="${x.status}" ${x.status === 'done' ? `data-qi="${i}"` : ''}><b>${esc(x.title || x.topic)}</b><span>${x.status === 'done' ? `ready · ${mmss(x.duration || 0)}` : x.status === 'error' ? esc(x.error) : x.status === 'waiting' ? 'waiting' : esc(x.phase || 'Starting') + '…'}</span>${x.status === 'working' ? `<i class="tv-qbar"><i style="width:${Math.round(x.pct || 1)}%"></i></i>` : ''}</li>`).join('')}</ol>
        <div class="ob-actions">${busy ? '<button class="small ghost" data-a="stopq">Stop after this one</button>' : '<button class="small primary" data-a="again">Make more</button>'}</div>`;
    }
    if (st.step === 'view' && st.view) {
      return `<h2>${esc(st.view.title)}</h2>${resultHtml(st.view.url, st.view.name, '', st.view.pid)}`;
    }
    return '';
  }
  function resultHtml(url, name, note = '', pid = null) {
    return `<video class="tv-video ${st.vertical || st.view?.vertical ? 'v' : ''}" src="${esc(url)}" controls playsinline></video><p class="tv-done">${esc(name)} · saved in your exports folder${note ? ` · ${esc(note)}` : ''}</p>
      <div class="ob-actions"><button class="small ghost" data-a="again">Make another</button>${pid ? `<button class="small" data-a="edit" data-pid="${esc(pid)}">Edit</button>` : ''}${addToEdit ? '<button class="small" data-a="toedit">Send to Edit Mode</button><button class="small" data-a="toclipper">Send to Clipper Mode</button>' : ''}<button class="small primary" data-a="show">Show in folder</button></div>`;
  }
  let drawnStep;
  function draw(part = 'all') {
    if (st.step === 'edit' && st.project) {
      root.classList.add('editing');
      if (!editor.isOpen(st.project) || !root.querySelector('.de')) editor.open(st.project, root);
      return;
    }
    if (root.classList.contains('editing')) { editor.close(); root.classList.remove('editing'); part = 'all'; }
    if (part !== 'main' || drawnStep !== st.step) {
      settings.innerHTML = optionsHtml();
      paintCaptionSample(settings, { topic: st, vertical: st.vertical });
    }
    drawnStep = st.step;
    if (part === 'opts') return;
    const keep = $('#tvOwn', root)?.value, active = document.activeElement;
    const focus = active?.id;
    root.innerHTML = `<div class="tv-main">${stepHtml()}</div>`;
    if (keep && $('#tvOwn', root)) $('#tvOwn', root).value = keep;
    const next = focus && document.getElementById(focus);
    if (next && root.contains(next)) {
      next.focus();
      if (next.matches('textarea, input[type=text], input:not([type])') && next.value) next.setSelectionRange(next.value.length, next.value.length);
    }
    root.querySelector('video')?.addEventListener('error', () => { const p = root.querySelector('.tv-done'); if (p) p.textContent = 'This video isn\'t in your exports folder anymore.'; });
  }
  function voiceOpts() {
    const v = st.voices || { natural: [{ id: 'ryan', name: 'Ryan: deep, documentary', ready: false, mb: 140 }], system: [] };
    return [...v.natural.map((x) => `<option value="${x.id}"${st.voice === x.id ? ' selected' : ''}>${esc(x.name)}${x.ready ? '' : ` (downloads ${x.mb} MB once)`}</option>`),
      ...v.system.map((n) => `<option value="${esc(n)}"${st.voice === n ? ' selected' : ''}>${esc(n.replace(/^Microsoft /, '').replace(/ Desktop$/, ''))} (Windows voice)</option>`)].join('');
  }
  const spec = () => ({ voice: st.voice, pace: st.pace, aspect: st.aspect, vertical: st.vertical, music: st.music, musicLevel: st.musicLevel, captions: st.captions, capStyle: st.capStyle,
    capLang: st.capLang, filter: st.filter, titleCard: st.titleCard, folder: st.folder, duration: duration() });
  const scriptSpec = (topic) => ({ topic, minutes: duration() / 60 || 3, style: st.scriptStyle });
  // one video: start it, then follow it until it's done (onTick on every update)
  async function makeOne(script, onTick) {
    const { id } = await api('/api/doc/make', { title: script.title, scenes: script.scenes, source: script.url, sources: script.sources, ...spec() });
    for (;;) {
      await new Promise((r) => setTimeout(r, 900));
      const j = await api('/api/doc/status?id=' + id).catch(() => null);
      if (!j) continue;
      onTick(j);
      if (j.status === 'done' || j.status === 'error') return j;
    }
  }
  async function writeScript() {
    if (!validDuration()) return;
    const t = ($('#tvTopic', root)?.value || '').trim();
    if (!t) { toast('Type a topic first'); return; }
    st.topic = t;
    const b = root.querySelector('[data-a="write"]'); b.disabled = true; b.textContent = 'Reading about it…';
    try {
      const { items } = await api('/api/doc/topics', { topic: t });
      if (!items.length) throw new Error('No research sources found. Try a more specific topic or write your own script.');
      st.matches = items; st.step = 'sources'; draw('main');
    } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Write the script'; }
  }
  async function chooseSource(match, button) {
    button.disabled = true;
    try {
      const j = await api('/api/doc/script', { ...scriptSpec(st.topic), choice: match?.id });
      if (st.step !== 'sources') return;
      Object.assign(st, { title: j.title, scenes: j.scenes, source: j.url, sources: j.sources || [], step: 'script', own: false });
      draw('main');
    } catch (e) { toast(e.message, true); }
    finally { button.disabled = false; }
  }
  async function make() {
    if (!validDuration()) return;
    if (st.own && !st.scenes.length) {
      const text = $('#tvOwn', root)?.value || '';
      if (!text.trim()) { toast('Write the script first'); return; }
      const j = await api('/api/doc/script', { own: text, title: $('#tvTitle', root)?.value || '' }).catch((e) => { toast(e.message, true); return null; });
      if (!j) return;
      st.scenes = j.scenes; st.title = $('#tvTitle', root)?.value || j.title || 'My video';
    }
    if (!st.scenes.length) return;
    st.step = 'make'; st.job = { pct: 1, phase: 'Starting' }; draw('main');
    const title = st.title || st.topic;
    try {
      // a project: the voice, the pictures each line can show and the takes; then the editor
      const { id } = await api('/api/doc/prepare', { title, scenes: st.scenes, ...spec(), takes: st.takes, source: st.source, sources: st.sources });
      for (;;) {
        await new Promise((r) => setTimeout(r, 900));
        const j = await api('/api/doc/status?id=' + id).catch(() => null);
        if (!j) continue;
        if (j.status === 'error') { st.job = j; if (st.step === 'make') draw('main'); return; }
        if (j.status === 'ready') {
          st.project = j.project;
          if (st.step === 'make') { st.step = 'edit'; draw(); }
          refreshSaved();
          toast(`“${title}”: ${j.project.takes.length > 1 ? `${j.project.takes.length} takes are` : 'it\'s'} ready to check and export${j.note ? ` (${j.note})` : ''}`);
          return;
        }
        st.job = j; if (st.step === 'make') draw('main');
      }
    } catch (e) { st.job = { status: 'error', error: e.message }; draw('main'); }
  }
  // several topics: script and video for each, one after another
  async function batch() {
    if (!validDuration()) return;
    const list = topics();
    if (!list.length) return;
    st.queue = list.map((topic) => ({ topic, status: 'waiting' })); st.stop = false; st.step = 'batch'; draw('main');
    for (const q of st.queue) {
      if (st.stop) { q.status = 'error'; q.error = 'stopped'; continue; }
      q.status = 'working'; q.phase = 'Writing the script'; if (st.step === 'batch') draw('main');
      try {
        const s = await api('/api/doc/script', scriptSpec(q.topic));
        q.title = s.title;
        const j = await makeOne(s, (x) => { Object.assign(q, { phase: x.phase, pct: x.pct }); if (st.step === 'batch') draw('main'); });
        if (j.status === 'done') { Object.assign(q, { status: 'done', url: j.url, name: j.name, duration: j.duration, pid: j.project }); remember(j, s.title); }
        else Object.assign(q, { status: 'error', error: j.error || 'failed' });
      } catch (e) { Object.assign(q, { status: 'error', error: e.message }); }
      if (st.step === 'batch') draw('main');
    }
    toast(`${st.queue.filter((x) => x.status === 'done').length} of ${st.queue.length} videos made`);
  }
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.i != null) st.scenes[+t.dataset.i].text = t.value;
    if (t.id === 'tvTitle') st.title = t.value;
    if (t.id === 'tvTopic') st.topic = t.value;
    if (t.id === 'tvList') {
      st.list = t.value; LS('cutsona.tvList', t.value);
      const n = topics().length, b = root.querySelector('[data-a="batch"]'), m = root.querySelector('.tv-meta span');
      if (b) { b.disabled = !n; b.textContent = `Make ${n > 1 ? `all ${n}` : 'it'}`; }
      if (m) m.textContent = `${n} video${n === 1 ? '' : 's'}`;
    }
    if (t.id === 'tvOwn') root.querySelector('[data-a="make"]').disabled = !t.value.trim();
  });
  settings.addEventListener('input', (e) => {
    if (e.target.id === 'tvDuration') { st.duration = e.target.value; LS('cutsona.tvLengthSeconds', st.duration); }
  });
  settings.addEventListener('change', (e) => {
    if (e.target.id === 'tvVoice') { st.voice = e.target.value; LS('cutsona.tvVoice', st.voice); }
    if (e.target.dataset.sel === 'capLang') { st.capLang = e.target.value; LS('cutsona.tvCapLang', st.capLang); }
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'tvTopic') writeScript(); e.stopPropagation(); });
  const SAVE = { takes: 'Takes', scriptStyle: 'ScriptStyle', aspect: 'Aspect', music: 'Music', captions: 'Caps', pace: 'Pace', musicLevel: 'MusicLvl', capStyle: 'CapStyle', filter: 'Filter', titleCard: 'TitleCard' };
  settings.addEventListener('click', async (e) => {
    const choice = e.target.closest('button[data-k]');
    if (!choice || st.step === 'edit') return;
    const { k, v } = choice.dataset;
    if (k === 'pictures') {
      if (v === 'web') st.folder = null;
      else {
        try {
          const j = await api('/api/doc/folder', {});
          if (j.cancelled) return;
          if (!j.count) { toast('That folder has no pictures or videos', true); return; }
          st.folder = j.dir; st.folderCount = j.count;
        } catch (error) { toast(error.message, true); return; }
      }
    } else if (k === 'duration') {
      customLength = v === 'custom';
      if (!customLength) { st.duration = v; LS('cutsona.tvLengthSeconds', v); }
      else if (st.duration === 'script') { st.duration = '60'; LS('cutsona.tvLengthSeconds', st.duration); }
    } else if (SAVE[k]) {
      st[k] = k === 'takes' ? Number(v) : k === 'captions' || k === 'titleCard' ? v === 'true' : v;
      LS('cutsona.tv' + SAVE[k], typeof st[k] === 'boolean' ? Number(st[k]) : st[k]);
      if (k === 'aspect') { const [w, h] = v.split(':').map(Number); st.vertical = h > w; }
    }
    draw(k === 'takes' ? 'all' : 'opts');
    if (k === 'duration' && customLength) $('#tvDuration', settings)?.focus();
  });
  root.addEventListener('click', async (e) => {
    const source = e.target.closest('[data-match]');
    if (source && st.step === 'sources') { await chooseSource(st.matches[+source.dataset.match], source); return; }
    const c = e.target.closest('.tv-chips[data-name="many"] .chip');
    if (c) { st.many = c.dataset.v === '1'; draw(); return; }
    const qi = e.target.closest('[data-qi]');
    if (qi) { const x = st.queue[+qi.dataset.qi]; st.view = { name: x.name, url: x.url, title: x.title, dur: x.duration, vertical: st.vertical, pid: x.pid }; st.step = 'view'; draw('main'); drawSide(); return; }
    const del = e.target.closest('[data-del]');
    if (del) { st.scenes.splice(+del.dataset.del, 1); draw('main'); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    const name = st.step === 'view' ? st.view?.name : st.job?.name, url = st.step === 'view' ? st.view?.url : st.job?.url;
    if (a === 'write') writeScript();
    else if (a === 'rand') { st.topic = TOPICS[Math.floor(Math.random() * TOPICS.length)]; draw('main'); $('#tvTopic', root)?.focus(); }
    else if (a === 'rand3') { const have = new Set(topics()); const add = TOPICS.filter((x) => !have.has(x)).sort(() => Math.random() - 0.5).slice(0, 3); st.list = [...topics(), ...add].join('\n'); LS('cutsona.tvList', st.list); draw('main'); }
    else if (a === 'batch') batch();
    else if (a === 'stopq') { st.stop = true; toast('Stopping after the one being made'); }
    else if (a === 'own') { Object.assign(st, { step: 'script', own: true, scenes: [], title: st.topic || '', source: '', sources: [] }); draw('main'); }
    else if (a === 'add') { st.scenes.push({ text: '' }); draw('main'); root.querySelector(`textarea[data-i="${st.scenes.length - 1}"]`)?.focus(); }
    else if (a === 'back') { st.step = 'topic'; draw('main'); }
    else if (a === 'back2') { st.step = 'script'; draw('main'); }
    else if (a === 'make') make();
    else if (a === 'edit') openProject(e.target.closest('[data-pid]').dataset.pid);
    else if (a === 'again') { Object.assign(st, { step: 'topic', scenes: [], job: null, topic: '', view: null }); draw('main'); drawSide(); }
    else if (a === 'show' && name) fetch('/api/open?name=' + encodeURIComponent(name), { method: 'POST' });
    else if ((a === 'toedit' || a === 'toclipper') && addToEdit && url) {
      root.querySelector('video')?.pause();
      try { await addToEdit({ url, name, pid: st.view?.pid }, a === 'toclipper' ? 'stream' : 'edits'); }
      catch (error) { toast(error.message, true); }
    }
  });
  async function open() {
    draw(); drawSide(); refreshSaved();
    if (!st.voices) { try { st.voices = await api('/api/doc/voices'); if (!st.voices.canNatural && st.voices.system[0] && /^(ryan|lessac)$/.test(st.voice)) st.voice = st.voices.system[0]; draw('opts'); } catch {} }
  }
  function pause() { root.querySelector('video')?.pause(); editor.pause(); }
  return { open, pause, drawSide, flush: async () => { await editor.flush(); await refreshSaved(); } };
}
