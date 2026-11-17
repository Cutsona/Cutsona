import { viralMoments } from './viral.js';
import { fmtT } from './words.js';
import { FILTERS } from './styles.js';
import { TOPIC_CAPTION_STYLES, captionSampleHtml, drawTopicCaption, paintCaptionSample } from './captions.js';
import { createFilterPreview } from './filter-preview.js';

export function initLongVideo({ mount, sidebar, toast, esc, LS, pick, filterChips, openFinder }) {
  const o = { len: Number(LS('cutsona.lvLen')) || 30, layout: LS('cutsona.lvLayout') === 'stack' ? 'stack' : LS('cutsona.lvLayout') === 'full' ? 'full' : 'fit',
    corner: LS('cutsona.lvCorner') || 'top-left', caps: LS('cutsona.lvCaps') !== '0', capStyle: LS('cutsona.lvCapStyle') || 'bold', auto: LS('cutsona.lvAuto') === '1' };
  const storedFilter = LS('cutsona.lvFilter');
  o.filter = Object.hasOwn(FILTERS, storedFilter) ? storedFilter : 'none';
  const filter = createFilterPreview(drawFrame);
  const state = { url: '', media: null, scan: null, clips: [], selected: 0, phase: '', error: '', busy: false, exporting: false };
  const video = document.createElement('video');
  video.preload = 'metadata'; video.playsInline = true;
  const $ = (s) => mount.querySelector(s);
  const field = (key, label, values, forceMenu = false) => `<div class="field" data-long-field="${key}"${forceMenu ? ' data-dd-force' : ''}><span>${label}</span>${pick(key, values, o[key])}</div>`;
  sidebar.innerHTML = `<section class="panel">
    <div class="panel-h"><h3><span class="step">1</span> Clips</h3><div class="panel-actions"><button class="small" data-lv="file">Use a file…</button></div></div>
    <button class="find-btn" data-lv="find">Find clips <small>Videos, streamers, gaming</small><kbd>F</kbd></button>
  </section>
  <section class="panel">
    <div class="panel-h"><h3><span class="step">2</span> Highlight settings</h3></div>
    ${field('len', 'Length', [[15, '15s'], [30, '30s'], [45, '45s'], [60, '60s'], [90, '90s']])}
    ${field('layout', 'Layout', [['fit', 'Fit video'], ['full', 'Fill portrait'], ['stack', 'Cam on top']])}
    ${field('corner', 'Cam corner', [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']])}
    <div class="field"><span>Filter</span>${filterChips(o.filter, undefined, 'None')}</div>
    ${field('caps', 'Captions', [[true, 'On'], [false, 'Off']])}
    <div data-long-caption>${field('capStyle', 'Caption style', Object.entries(TOPIC_CAPTION_STYLES))}${captionSampleHtml()}</div>
    ${field('auto', 'Export', [[false, 'I’ll pick'], [true, 'Save all automatically']], true)}
  </section>`;
  function syncSidebar() {
    sidebar.querySelector('[data-long-field="corner"]').hidden = o.layout !== 'stack';
    sidebar.querySelector('[data-long-caption]').hidden = !o.caps;
    if (o.caps) paintCaptionSample(sidebar, { topic: o, vertical: true });
    for (const choice of sidebar.querySelectorAll('[data-k]')) choice.classList.toggle('on', String(o[choice.dataset.k]) === choice.dataset.v);
    for (const button of sidebar.querySelectorAll('button')) button.disabled = state.busy || state.exporting;
  }
  function openClipFinder() {
    if (state.busy || state.exporting) return;
    pause();
    openFinder(undefined, (item) => {
      if (!/^https?:\/\//i.test(item.url || '') || item.audio) throw new Error('Choose a video or photo.');
      state.url = '';
      void start(item);
    }, { returnLabel: 'Back to Long video', wholeVideo: true });
  }
  function pickFile() {
    if (state.busy || state.exporting) return;
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'video/*,.mkv,.mov,.flv,.ts,.m4v';
    file.onchange = () => { if (file.files[0]) start(file.files[0]); }; file.click();
  }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function api(url, init) {
    const response = await fetch(url, init), data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Cutsona could not finish that request.');
    return data;
  }
  const json = (url, data) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  function render() {
    syncSidebar();
    const clip = state.clips[state.selected];
    filter.reset();
    mount.innerHTML = `<section class="tv-main lv-work">
      <h2>Long video to clips</h2>
      <p class="tv-sub">Choose a video with Find Clips, use a file, or paste a link. Cutsona finds highlights in the first hour.</p>
      <div class="tv-in tv-in-row"><input id="lvUrl" type="text" aria-label="Video link" placeholder="Paste a YouTube, Twitch, Kick or video link" value="${esc(state.url)}" ${state.busy ? 'disabled' : ''}>
      <button class="small primary" data-lv="go" ${state.busy || state.exporting ? 'disabled' : ''}>Find highlights</button></div>
      <div class="lv-status" role="status">${esc(state.phase)}</div>${state.error ? `<p class="tv-err">${esc(state.error)}</p>` : ''}
      ${clip ? `<div class="lv-results">
        <div class="lv-screen"><canvas width="360" height="640" aria-label="Vertical highlight preview"></canvas>
          <div class="lv-control"><button class="small" data-lv="play">${video.paused ? 'Play' : 'Pause'}</button><input class="lv-seek" type="range" min="0" max="${clip.end - clip.start}" step=".01" aria-label="Highlight playhead"><output></output></div></div>
        <div><div class="lv-results-head"><h3>${state.clips.length} highlight${state.clips.length === 1 ? '' : 's'}</h3>
          <button class="small" data-lv="saveall" ${state.exporting ? 'disabled' : ''}>Export all</button></div>
          <ol class="lv-list">${state.clips.map((c, i) => `<li><button class="small ${i === state.selected ? ' on' : ''}" data-clip="${i}" aria-pressed="${i === state.selected}">
            <b>Highlight ${i + 1}</b><small>${fmtT(c.start)} – ${fmtT(c.end)}${c.score != null ? ' · ' + Math.round(c.score) + '/100' : ''}</small>
            ${c.why?.length ? `<span>${esc(c.why[0])}</span>` : ''}</button></li>`).join('')}</ol>
          <button class="small primary" data-lv="save" ${state.exporting ? 'disabled' : ''}>Export highlight ${state.selected + 1}</button>
          ${clip.result ? `<p><button class="small ghost" data-lv="show">Show saved clip</button></p>` : ''}
          ${o.caps && !state.scan.words?.length ? '<p class="tv-note">This source has no transcript. Set up Speech Tools in Settings to caption local videos.</p>' : ''}
        </div></div>` : ''}
    </section>`;
    drawFrame();
  }
  function select(i) {
    video.pause();
    state.selected = i;
    const clip = state.clips[i];
    if (clip && video.readyState) video.currentTime = clip.start;
    render();
  }
  function find() {
    const end = Math.min(3600, state.scan.duration);
    if (!(end > 0)) throw new Error('The video’s duration could not be read.');
    const length = Math.min(o.len, end);
    const scan = { ...state.scan, duration: end };
    state.clips = viralMoments(scan, { lengths: [length], max: 8 })
      .map((c) => ({ ...c, end: Math.min(end, c.end) })).filter((c) => c.end > c.start);
    if (!state.clips.length) state.clips = [{ start: 0, end: length, why: [] }];
    select(0);
  }
  function drawFrame() {
    const clip = state.clips[state.selected], canvas = $('canvas');
    if (!clip || !canvas) return;
    const t = Math.min(clip.end, Math.max(clip.start, video.currentTime || clip.start));
    const seek = $('.lv-seek');
    if (seek !== document.activeElement) seek.value = t - clip.start;
    $('output').textContent = `${fmtT(t - clip.start)} / ${fmtT(clip.end - clip.start)}`;
    if (video.currentTime >= clip.end && !video.paused) pause();
    if (!video.videoWidth || video.readyState < 2) return;
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, sw = video.videoWidth, sh = video.videoHeight;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const paint = (sx, sy, w, h, y, height, fit) => {
      const scale = (fit ? Math.min : Math.max)(W / w, height / h);
      g.save(); g.beginPath(); g.rect(0, y, W, height); g.clip();
      g.drawImage(video, sx, sy, w, h, (W - w * scale) / 2, y + (height - h * scale) / 2, w * scale, h * scale);
      g.restore();
    };
    if (o.layout === 'stack') {
      const cut = H * 704 / 1920, w = sw * 0.38, h = sh * 0.38;
      paint(o.corner.endsWith('right') ? sw - w : 0, o.corner.startsWith('bottom') ? sh - h : 0, w, h, 0, cut, false);
      paint(0, 0, sw, sh, cut, H - cut, true);
    } else paint(0, 0, sw, sh, 0, H, o.layout === 'fit');
    filter.draw(g, o.filter, t - clip.start);
    const word = o.caps && state.scan.words?.find((x) => x.start <= t && t < x.end);
    if (word) drawTopicCaption(g, W, H, word.text, o, true);
  }
  let raf;
  function tick() { drawFrame(); if (!video.paused) raf = requestAnimationFrame(tick); }
  function pause() { video.pause(); cancelAnimationFrame(raf); const button = $('[data-lv="play"]'); if (button) button.textContent = 'Play'; }
  video.addEventListener('loadeddata', () => { if (state.clips.length) video.currentTime = state.clips[state.selected].start; drawFrame(); });
  video.addEventListener('seeked', drawFrame);
  async function start(input) {
    if (state.busy || state.exporting) return;
    pause(); Object.assign(state, { busy: true, error: '', phase: 'Opening video…', clips: [], scan: null, media: null }); render();
    try {
      const source = typeof input === 'string' ? { url: input } : input instanceof File ? null : input;
      const transcript = source && o.caps && /(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(new URL(source.url).hostname)
        ? api('/api/transcript?' + new URLSearchParams({ url: source.url })).catch(() => null) : Promise.resolve(null);
      if (source) {
        let job = await json('/api/grab', { url: source.url, title: source.title, duration: source.duration, source: source.source,
          channel: source.channel, page: source.page, views: source.views, photo: !!source.photo, maxRes: source.maxRes,
          start: source.start, end: source.end, whole: source.start == null });
        while (!['done', 'error'].includes(job.status)) {
          await wait(800); job = await api('/api/grab/status?' + new URLSearchParams({ id: job.id }));
          state.phase = job.phase || 'Opening video…'; $('.lv-status').textContent = state.phase;
        }
        state.media = { url: job.url, name: job.name };
      } else {
        state.media = await api('/api/long/input?' + new URLSearchParams({ name: input.name }), { method: 'POST', body: input });
      }
      video.src = state.media.url;
      let scan = await api('/api/viral?' + new URLSearchParams({ cache: state.media.url, limit: '3600' }));
      while (scan.running) {
        state.phase = `${scan.phase || 'Analyzing'}… ${scan.pct || 0}%`; $('.lv-status').textContent = state.phase;
        await wait(800); scan = await api('/api/viral?' + new URLSearchParams({ key: scan.key }));
      }
      const online = await transcript;
      const offset = Number(source?.start) || 0;
      const onlineWords = (online?.words || []).filter((w) => w.end > offset && w.start < offset + scan.duration)
        .map((w) => ({ ...w, start: Math.max(0, w.start - offset), end: Math.min(scan.duration, w.end - offset) }));
      state.scan = onlineWords.length > (scan.words?.length || 0) ? { ...scan, words: onlineWords } : scan;
      state.phase = ''; find();
      if (o.auto) await save(state.clips);
    } catch (error) { state.error = error.message; state.phase = ''; }
    finally { state.busy = false; render(); }
  }
  async function save(clips) {
    if (state.exporting) return;
    state.exporting = true; state.error = ''; render();
    let saved = 0;
    try {
      for (const c of clips) {
        const i = state.clips.indexOf(c) + 1;
        state.phase = `Exporting highlight ${i}…`; $('.lv-status').textContent = state.phase;
        const cues = o.caps ? state.scan.words.filter((w) => w.end > c.start && w.start < c.end) : [];
        c.result = await json('/api/long/export', { url: state.media.url, start: c.start, end: c.end, layout: o.layout,
          corner: o.corner, filter: o.filter, capStyle: o.capStyle, cues, name: `${state.media.name.replace(/\.[^.]+$/, '')} - Highlight ${i}` });
        saved++;
      }
    } catch (error) { state.error = error.message; }
    finally { state.exporting = false; state.phase = ''; render(); }
    if (saved) toast(`Saved ${saved} highlight${saved === 1 ? '' : 's'} in Exports.`);
  }
  mount.addEventListener('input', (e) => {
    if (e.target.id === 'lvUrl') state.url = e.target.value;
    if (e.target.matches('.lv-seek') && video.readyState) video.currentTime = state.clips[state.selected].start + Number(e.target.value);
  });
  sidebar.addEventListener('click', (e) => {
    const action = e.target.closest('[data-lv]')?.dataset.lv;
    if (action === 'find') { openClipFinder(); return; }
    if (action === 'file') { pickFile(); return; }
    const option = e.target.closest('button[data-k]')?.dataset;
    if (option) {
      if (state.busy || state.exporting) return;
      const key = option.k, value = option.v;
      if (String(o[key]) === value) return;
      o[key] = key === 'len' ? Number(value) : key === 'auto' || key === 'caps' ? value === 'true' : value;
      LS('cutsona.lv' + key[0].toUpperCase() + key.slice(1), typeof o[key] === 'boolean' ? Number(o[key]) : o[key]);
      if (key === 'len' && state.scan) find(); else { if (key !== 'auto') for (const clip of state.clips) delete clip.result; render(); }
    }
  });
  mount.addEventListener('click', async (e) => {
    const choice = e.target.closest('[data-clip]')?.dataset.clip;
    if (choice != null) { select(Number(choice)); return; }
    const action = e.target.closest('[data-lv]')?.dataset.lv, clip = state.clips[state.selected];
    if (action === 'go') { if (/^https?:\/\//i.test(state.url.trim())) start(state.url.trim()); else { toast('Use Find Clips, choose a file, or paste a video link.', true); $('#lvUrl').focus(); } }
    else if (action === 'play') {
      if (!video.paused) { pause(); return; }
      if (video.currentTime < clip.start || video.currentTime >= clip.end - 0.04) video.currentTime = clip.start;
      try { await video.play(); $('[data-lv="play"]').textContent = 'Pause'; tick(); } catch (error) { toast(error.message, true); }
    } else if (action === 'save') save([clip]);
    else if (action === 'saveall') save(state.clips);
    else if (action === 'show') fetch('/api/open?' + new URLSearchParams({ name: clip.result.name }), { method: 'POST' });
  });
  mount.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'lvUrl') $('[data-lv="go"]').click(); e.stopPropagation(); });
  render();
  return { pause, openClipFinder };
}
