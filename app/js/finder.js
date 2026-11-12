// Clip Finder: movies/TV by mood or quote, exact moments (thepartwhere.com), streamer clips (by channel, game or trending), gaming, viral & news,
// free stock footage, or paste any link.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDur = (s) => { if (!s && s !== 0) return ''; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtViews = (n) => (n == null ? '' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M views' : n >= 1e3 ? Math.round(n / 1e3) + 'K views' : n + ' views');

const MOVIE_MOODS = [
  { k: 'sad', l: 'Sad', scene: 'sad scene', top: 'saddest', say: 'I’m sorry' },
  { k: 'happy', l: 'Happy', scene: 'happy heartwarming scene', top: 'most heartwarming', say: 'we did it' },
  { k: 'epic', l: 'Epic', scene: 'epic scene', top: 'most epic', say: 'let’s go' },
  { k: 'romantic', l: 'Romantic', scene: 'romantic scene', top: 'most romantic', say: 'I love you' },
  { k: 'funny', l: 'Funny', scene: 'funny scene', top: 'funniest', say: 'what the hell' },
  { k: 'scary', l: 'Scary', scene: 'scary scene', top: 'scariest', say: 'run' },
  { k: 'motivational', l: 'Motivational', scene: 'motivational speech scene', top: 'most motivational', say: 'never give up' },
  { k: 'iconic', l: 'Iconic', scene: 'iconic scene', top: 'most iconic', say: 'I’ll be back' },
  { k: 'twist', l: 'Plot twist', scene: 'plot twist scene', top: 'best plot twist', say: 'it was you' },
  { k: 'fight', l: 'Fight', scene: 'fight scene', top: 'best fight', say: 'come on' },
  { k: 'villain', l: 'Villain', scene: 'villain scene', top: 'best villain', say: 'you fool' },
  { k: 'goodbye', l: 'Goodbye', scene: 'emotional goodbye scene', top: 'most emotional goodbye', say: 'goodbye' },
];
const MOVIE_SOURCES = [
  ['youtube', 'YouTube'], ['shorts', 'Shorts'], ['MOVIECLIPS', 'Movieclips'], ['Netflix', 'Netflix'], ['PrimeVideo', 'Prime Video'],
  ['Crunchyroll', 'Crunchyroll'], ['dailymotion', 'Dailymotion'], ['yarn', 'Quotes (Yarn)'], ['giphy', 'GIPHY reactions'],
];
const GAME_MOODS = [
  { k: 'clutch', l: 'Clutch', q: 'clutch moments', words: ['clutch', 'ace', '1v', 'insane', 'crazy', 'clean'] },
  { k: 'funny', l: 'Funny', q: 'funny moments', words: ['lol', 'lmao', 'funny', 'kek', '😂', '💀', 'bro', 'wtf'] },
  { k: 'rage', l: 'Rage', q: 'rage moments', words: ['rage', 'mad', 'angry', 'tilt', 'scream', 'smash', 'quit'] },
  { k: 'insane', l: 'Insane plays', q: 'insane plays', words: ['insane', 'crazy', 'cracked', 'goat', 'huge', 'clean', '🔥'] },
  { k: 'fails', l: 'Fails', q: 'fails', words: ['fail', 'bruh', 'how', 'why', 'throw', 'oops', '💀'] },
  { k: 'wholesome', l: 'Wholesome', q: 'wholesome moments', words: ['wholesome', 'cute', 'love', 'sweet', '❤', '🥹'] },
  { k: 'sad', l: 'Sad', q: 'sad moments', words: ['sad', 'cry', 'rip', '😭', '💔'] },
  { k: 'scary', l: 'Scary', q: 'scary moments', words: ['scary', 'scared', 'jumpscare', 'scream', 'horror'] },
];
const STREAM_MOODS = [
  { k: 'funny', l: 'Funny', words: ['lol', 'lmao', 'funny', 'kek', 'omegalul', 'laugh', '😂', '💀', 'bro', 'wtf', 'dead'] },
  { k: 'hype', l: 'Hype', words: ['insane', 'crazy', 'clutch', 'ace', 'w ', 'win', 'hype', 'goat', 'cracked', '1v', 'clean', 'huge', '🔥'] },
  { k: 'rage', l: 'Rage', words: ['rage', 'mad', 'angry', 'tilt', 'scream', 'yell', 'smash', 'quit', 'malding'] },
  { k: 'sad', l: 'Sad', words: ['sad', 'cry', 'crying', 'tears', 'rip', 'emotional', 'miss', '😭', '💔'] },
  { k: 'wholesome', l: 'Wholesome', words: ['wholesome', 'cute', 'love', 'sweet', 'mom', 'dad', 'family', '❤', '🥹'] },
];
const POPULAR = {
  twitch: ['kaicenat', 'xqc', 'jynxzi', 'caseoh_', 'hasanabi', 'tarik', 'shroud', 'pokimane'],
  kick: ['adinross', 'xqc', 'amouranth', 'trainwreckstv', 'iceposeidon', 'suspendas'],
};
const POPULAR_GAMES = ['Just Chatting', 'GTA V', 'Fortnite', 'Valorant', 'Minecraft', 'Call of Duty', 'League of Legends', 'Counter-Strike', 'Apex Legends', 'Rocket League'];
// Streamers → Trending: where the day's best stream clips get posted
const TREND_SOURCES = [['all', 'All top clips'], ['twitch', 'Twitch trending'], ['kick', 'Kick trending'], ['shorts', 'YouTube clip Shorts']];
const YT_STREAMERS = ['Kai Cenat', 'IShowSpeed', 'xQc', 'Adin Ross', 'Jynxzi', 'CaseOh', 'Duke Dennis', 'Sketch', 'Asmongold', 'Agent 00'];
// Viral feeds: the kinds of videos that go viral, found on YouTube (short videos, newest first by the time range);
// "Streamer moments" are the most-viewed Twitch + Kick clips. (Reddit blocks apps from reading it, so it isn't used.)
const VIRAL_FEEDS = [
  ['LivestreamFail', 'Streamer moments', null], ['nextfuckinglevel', 'Next level', 'next level insane skill'], ['BeAmazed', 'Amazing', 'amazing moment caught on camera'],
  ['MadeMeSmile', 'Wholesome', 'wholesome moment'], ['HumansBeingBros', 'Kindness', 'act of kindness caught on camera'], ['Unexpected', 'Unexpected', 'unexpected ending'],
  ['funnyvideos', 'Funny', 'funny video'], ['AnimalsBeingDerps', 'Animals', 'funny animals'], ['oddlysatisfying', 'Satisfying', 'oddly satisfying'],
  ['NatureIsFuckingLit', 'Nature', 'incredible nature footage'], ['sports', 'Sports', 'best sports moments'], ['gaming', 'Gaming', 'insane gaming moment'],
];
const NEWS_TOPICS = [
  { k: 'breaking', l: 'Breaking', q: 'breaking news' }, { k: 'viral', l: 'Viral', q: 'viral news video' },
  { k: 'good', l: 'Good news', q: 'good news heartwarming story' }, { k: 'funny', l: 'Funny', q: 'funny news moment' },
  { k: 'sports', l: 'Sports', q: 'sports highlights' }, { k: 'tech', l: 'Tech', q: 'tech news' },
  { k: 'weather', l: 'Weather', q: 'extreme weather caught on camera' }, { k: 'world', l: 'World', q: 'world news' },
  { k: 'celebrity', l: 'Celebrity', q: 'celebrity news' },
];
const CHANNELS = {
  News: [['BBCNews', 'BBC News'], ['NBCNews', 'NBC News'], ['ABCNews', 'ABC News'], ['CNN', 'CNN'], ['FoxNews', 'Fox News'], ['Reuters', 'Reuters'], ['SkyNews', 'Sky News']],
  Sports: [['NBA', 'NBA'], ['NFL', 'NFL'], ['ESPN', 'ESPN'], ['HouseofHighlights', 'House of Highlights']],
};
const STOCK_MOODS = [
  { k: 'sad', l: 'Sad', q: 'sad lonely rain' }, { k: 'happy', l: 'Happy', q: 'happy friends laughing' },
  { k: 'epic', l: 'Epic', q: 'epic aerial mountains' }, { k: 'romantic', l: 'Romantic', q: 'couple sunset romantic' },
  { k: 'city', l: 'City night', q: 'city night lights' }, { k: 'nature', l: 'Nature', q: 'nature forest' },
  { k: 'ocean', l: 'Ocean', q: 'ocean waves' }, { k: 'party', l: 'Party', q: 'party concert crowd' },
  { k: 'workout', l: 'Workout', q: 'workout gym motivation' }, { k: 'space', l: 'Space', q: 'space stars galaxy' },
  { k: 'cars', l: 'Cars', q: 'sports car driving night' }, { k: 'dark', l: 'Dark', q: 'dark moody smoke' },
];
const SRC_LABEL = { youtube: 'YouTube', twitch: 'Twitch', kick: 'Kick', dailymotion: 'Dailymotion', yarn: 'Yarn', reddit: 'Reddit', pexels: 'Pexels', pixabay: 'Pixabay',
  mixkit: 'Mixkit', openverse: 'Openverse', commons: 'Wikimedia', medal: 'Medal', giphy: 'GIPHY', destockd: 'Destockd', archival: 'Archival',
  freesound: 'Freesound', fma: 'FMA', ccmixter: 'ccMixter', iaaudio: 'Internet Archive' };
const VIDEO_PROVIDERS = [['mixkit', 'Mixkit (no key)'], ['destockd', 'Destockd (no key)'], ['archival', 'Archival Footage (no key)'],
  ['commons', 'Wikimedia (no key)'], ['pexels', 'Pexels'], ['pixabay', 'Pixabay']];
const PHOTO_PROVIDERS = [['openverse', 'Openverse (no key)'], ['commons', 'Wikimedia (no key)'], ['pexels', 'Pexels'], ['pixabay', 'Pixabay']];
const NEEDS_KEY = { pexels: true, pixabay: true };
// ---- music & sounds: every result becomes the edit's song (as an MP3) ----
const MUSIC_SOURCES = [['ytsong', 'YouTube → MP3'], ['fma', 'Free Music Archive'], ['ccmixter', 'ccMixter'], ['iaaudio', 'Internet Archive'],
  ['freesound', 'Freesound (sounds & loops)']];
const MUSIC_MOODS = [
  { k: 'phonk', l: 'Phonk', q: 'phonk' }, { k: 'hype', l: 'Hype / trap', q: 'hype trap beat' }, { k: 'sad', l: 'Sad', q: 'sad emotional' },
  { k: 'chill', l: 'Chill / lofi', q: 'lofi chill' }, { k: 'epic', l: 'Cinematic', q: 'epic cinematic' }, { k: 'piano', l: 'Emotional piano', q: 'emotional piano' },
  { k: 'gym', l: 'Gym', q: 'gym workout motivation' }, { k: 'love', l: 'Romantic', q: 'romantic love' }, { k: 'edm', l: 'EDM', q: 'edm electronic' },
  { k: 'slowed', l: 'Slowed + reverb', q: 'slowed reverb' }, { k: 'drill', l: 'Drill', q: 'drill beat' }, { k: 'funny', l: 'Funny', q: 'funny meme' },
];
const SFX_MOODS = [
  { k: 'whoosh', l: 'Whoosh', q: 'whoosh' }, { k: 'impact', l: 'Impact', q: 'cinematic impact' }, { k: 'riser', l: 'Riser', q: 'riser' },
  { k: 'bass', l: 'Bass drop', q: 'bass drop' }, { k: 'glitch', l: 'Glitch', q: 'glitch' }, { k: 'transition', l: 'Transition', q: 'transition' },
  { k: 'shutter', l: 'Camera', q: 'camera shutter' }, { k: 'boom', l: 'Boom', q: 'boom' }, { k: 'loop', l: 'Drum loop', q: 'drum loop' },
];
const MUSIC_TIPS = {
  ytsong: 'Any song on YouTube: it’s downloaded and turned into an MP3, then every cut lands on its beat. Popular songs can get copyright-claimed when you post.',
  fma: 'Full songs from independent artists, Creative Commons: check each song’s license before posting.',
  ccmixter: 'Remixes, instrumentals and a cappellas, Creative Commons (license shown on each card).',
  iaaudio: 'Huge library of recordings, albums and live sets: rights vary by recording.',
  freesound: 'Sound effects, samples and loops (high-quality previews, no account needed): check the license on each sound’s page.',
};
const MOMENT_PICKS = ['Joker', 'The Matrix', 'Interstellar', 'Breaking Bad', 'Fight Club', 'The Dark Knight', 'Spider-Man', 'Harry Potter', 'John Wick', 'Peaky Blinders', 'The Wolf of Wall Street', 'Dune', 'Avengers', 'Demon Slayer'];
const MOVIE_KINDS = { all: '', movies: 'movie', tv: 'tv show', anime: 'anime' };

export function initFinder({ grab, grabSong, toast, hasClip = () => true }) {
  // a download whose clip you've since removed from your list doesn't count as added anymore
  function liveJob(key) {
    const j = st.jobs.get(key);
    if (j && j.clipId && !j.audio && !hasClip(j.clipId)) {
      st.jobs.delete(key);
      if (j._counted) { st.added = Math.max(0, st.added - 1); updateFoot(); }
      return null;
    }
    return j;
  }
  const SAVE_KEYS = ['tab', 'kind', 'msrc', 'platform', 'range', 'short', 'smode', 'tsrc', 'csub', 'en', 'gsrc', 'vsrc', 'sub', 'rrange', 'when', 'chan', 'skind', 'vprov', 'pprov', 'orient', 'musrc', 'quality'];
  const st = { tab: 'movies', kind: 'all', msrc: 'youtube', platform: 'twitch', range: 'week', short: true, smode: 'streamer', tsrc: 'all', csub: 'LivestreamFail', en: true, musrc: 'ytsong', mumood: null, quality: 'any',
    gsrc: 'medal', vsrc: 'feeds', sub: 'LivestreamFail', rrange: 'week', when: 'week', chan: 'NBA', skind: 'video', vprov: 'mixkit', pprov: 'openverse', orient: 'vertical',
    mood: null, gmood: null, smood: null, ntopic: null, stmood: null, items: [], loading: false, jobs: new Map(), added: 0, keys: { pexels: false, pixabay: false } };
  try { const sv = JSON.parse(localStorage.getItem('cutsona.finder2') || '{}'); for (const k of SAVE_KEYS) if (k in sv) st[k] = sv[k]; } catch {}
  if (!TREND_SOURCES.some(([k]) => k === st.tsrc)) st.tsrc = 'all'; // older saved choices (the Reddit feeds are gone)
  if (st.vsrc === 'reddit') st.vsrc = 'feeds';
  if (!MUSIC_SOURCES.some(([k]) => k === st.musrc)) st.musrc = 'ytsong';
  try { if (!localStorage.getItem('cutsona.videos2')) { st.kind = 'all'; localStorage.setItem('cutsona.videos2', '1'); } } catch {}
  if (!(st.kind in MOVIE_KINDS)) st.kind = 'all';
  if (!VIRAL_FEEDS.some(([k]) => k === st.sub)) st.sub = 'LivestreamFail';
  if (!['day', 'week', 'month', 'year', 'all'].includes(st.rrange)) st.rrange = 'week';
  st.ytq = YT_STREAMERS[0];
  const save = () => { try { const o = {}; for (const k of SAVE_KEYS) o[k] = st[k]; localStorage.setItem('cutsona.finder2', JSON.stringify(o)); } catch {} };
  const refreshKeys = () => fetch('/api/finder/status').then((r) => r.json()).then((j) => { st.keys = { pexels: !!j.pexels, pixabay: !!j.pixabay }; }).catch(() => {});
  refreshKeys();

  const root = document.createElement('div');
  root.className = 'finder'; root.hidden = true;
  root.innerHTML = `
    <div class="fd-panel">
      <div class="fd-head">
        <div class="fd-title">Find clips</div>
        <div class="fd-tabs"></div>
        <button class="fd-close" title="Back to editor (Esc)">Back to editor</button>
      </div>
      <div class="fd-controls"></div>
      <div class="fd-results"></div>
      <div class="fd-foot"><span class="fd-count"></span><span class="fd-added"></span><span class="fd-legal"></span></div>
    </div>
    <div class="fd-preview" hidden></div>`;
  document.body.appendChild(root);
  const controls = $('.fd-controls', root), results = $('.fd-results', root), preview = $('.fd-preview', root);

  // Two windows: "Find clips" (video tabs) and "Find songs" (music sources as its tabs)
  const CLIP_TABS = [['movies', 'Videos'], ['moments', 'Exact moments'], ['streams', 'Streamers'], ['gaming', 'Gaming'], ['viral', 'Viral &amp; News'], ['stock', 'Free stock'], ['link', 'Paste link']];
  let songs = false;
  function renderTabs() {
    $('.fd-title', root).textContent = songs ? 'Find songs' : 'Find clips';
    root.classList.toggle('songs', songs);
    $('.fd-tabs', root).innerHTML = songs
      ? MUSIC_SOURCES.map(([k, l]) => `<button data-musrc-tab="${k}" class="${st.musrc === k ? 'on' : ''}">${l}</button>`).join('')
      : CLIP_TABS.map(([k, l]) => `<button data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('');
    $('.fd-legal', root).textContent = songs
      ? 'Songs belong to their owners: popular songs can get copyright-claimed when you post. Free music sources show each license.'
      : 'Clips belong to their owners: posting movie/TV/news footage can get copyright-claimed. Free stock clips are safe to post.';
  }
  $('.fd-tabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.musrcTab) { st.musrc = b.dataset.musrcTab; st.mumood = null; }
    else if (b.dataset.tab) st.tab = b.dataset.tab;
    else return;
    st.items = []; st.error = null; st.showKeys = false; save(); renderTabs(); renderControls(); renderResults(); autoSearch();
  });
  $('.fd-close', root).onclick = close;
  window.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') { if (!preview.hidden) closePreview(); else close(); e.stopPropagation(); }
  }, true);

  function open(tab) {
    songs = tab === 'music';
    if (songs) st.tab = 'music'; else { if (tab) st.tab = tab; if (st.tab === 'music') st.tab = 'movies'; }
    if (root.dataset.was !== String(songs)) { st.items = []; st.error = null; }
    root.dataset.was = String(songs);
    renderTabs(); root.hidden = false; refreshKeys().then(() => { renderControls(); renderResults(); }); renderControls(); renderResults(); if (!st.items.length && !st.loading) autoSearch(); setTimeout(() => $('.fd-controls input[type=text], .fd-controls textarea', root)?.focus(), 30); }
  function close() { closePreview(); root.hidden = true; }

  // ---------- small builders ----------
  const chips = (list, cur, attr, all = true) => `<div class="fd-chips">${all ? `<button class="chip all${cur == null ? ' on' : ''}" data-${attr}="">All</button>` : ''}${list.map((m) => `<button class="chip${cur === m.k ? ' on' : ''}" data-${attr}="${esc(m.k)}">${m.l}</button>`).join('')}</div>`;
  const seg = (name, opts, cur) => `<div class="seg fd-seg" data-name="${name}">${opts.map(([v, l]) => `<button data-v="${esc(v)}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const row = (label, html, extra = '') => `<div class="fd-row"${extra}>${label ? `<span class="fd-lbl">${label}</span>` : ''}${html}</div>`;
  const input = (cls, ph, val) => `<input type="text" class="fd-q ${cls || ''}" placeholder="${esc(ph)}" value="${esc(val || '')}">`;
  const shortBox = () => `<label class="fd-check"><input type="checkbox" class="fd-short" ${st.short ? 'checked' : ''}> Short clips only (under 4 min)</label>`;
  const RANGES = [['day', '24h'], ['week', '7 days'], ['month', '30 days'], ['all', 'All time']];

  function renderControls() {
    root.querySelectorAll('.fd-tabs button').forEach((b) => b.classList.toggle('on', songs ? b.dataset.musrcTab === st.musrc : b.dataset.tab === st.tab));
    let h = '';
    if (st.tab === 'movies') {
      const yarn = st.msrc === 'yarn';
      h += row('From', seg('msrc', MOVIE_SOURCES, st.msrc));
      const kinds = ['youtube', 'shorts', 'dailymotion'].includes(st.msrc);
      const ph = yarn ? 'What do they say? e.g. “I love you”, “goodbye”, “we did it”'
        : st.kind === 'all' || !kinds ? 'Search any video: e.g. skate tricks, Interstellar, “the part where he says goodbye”' : 'Movie, show or moment: e.g. Interstellar, “the part where he says goodbye”';
      h += row('', (kinds ? seg('kind', [['all', 'All videos'], ['movies', 'Movies'], ['tv', 'TV shows'], ['anime', 'Anime']], st.kind) : '') +
        input('', ph, st.q) + `<button class="primary fd-go">Search</button>`);
      if (!yarn) h += row('Mood', chips(MOVIE_MOODS, st.mood, 'mood'));
      h += `<div class="fd-row fd-sub">${['youtube', 'dailymotion'].includes(st.msrc) ? shortBox() : `<span class="fd-tip">${yarn ? 'Yarn finds the exact second a line is said in thousands of movies & shows: great for quote edits.' : st.msrc === 'giphy' ? 'Short looping reactions.' : st.msrc === 'shorts' ? 'Vertical YouTube Shorts: ready for 9:16 edits.' : 'Official channel: clean, labeled scenes.'}</span>`}</div>`;
    } else if (st.tab === 'moments') {
      if (!st.mtitles && !st.mtLoading) loadMomentTitles();
      const T = st.mtitles || { titles: [], memes: [], sports: [] };
      const have = (list) => list.filter((t) => T.titles.includes(t) || T.memes.includes(t) || T.sports.includes(t));
      h += row('', input('', 'Describe the moment: e.g. Joker dances down the stairs, Neo stops the bullets', st.mq) + `<button class="primary fd-go">Search</button>`);
      h += row('Title', `<input type="text" class="fd-mtitle" list="fdMomentTitles" placeholder="Any movie, show, meme or athlete${T.titles.length ? ` (${T.titles.length + T.memes.length + T.sports.length} titles)` : ''}" value="${esc(st.mtitle || '')}">` +
        `<datalist id="fdMomentTitles">${[...T.titles, ...T.memes, ...T.sports].map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>` +
        (st.mtitle ? '<button class="small fd-mclear">Any title</button>' : ''));
      const pop = have(MOMENT_PICKS);
      if (pop.length) h += row('Popular', `<div class="fd-chips">${pop.map((t) => `<button class="chip ghosty${st.mtitle === t ? ' on' : ''}" data-mtitle="${esc(t)}">${esc(t)}</button>`).join('')}</div>`);
      if (T.memes.length || T.sports.length) h += row('Memes & sports', `<div class="fd-chips">${[...T.memes, ...T.sports.slice(0, 14)].map((t) => `<button class="chip ghosty${st.mtitle === t ? ' on' : ''}" data-mtitle="${esc(t)}">${esc(t)}</button>`).join('')}</div>`);
      h += `<div class="fd-row fd-sub"><span class="fd-tip">Each result is one exact shot (a second or a few), cut from the original YouTube upload: hover to watch it. Moments from <a href="https://www.thepartwhere.com/" target="_blank" rel="noopener noreferrer">thepartwhere.com</a>.</span></div>`;
    } else if (st.tab === 'streams') {
      h += row('Find', seg('smode', [['streamer', 'By streamer'], ['game', 'By game / category'], ['trending', 'Trending']], st.smode));
      if (st.smode === 'trending') {
        h += row('From', seg('tsrc', TREND_SOURCES, st.tsrc));
        if (false) {
          h += row('Top of', seg('range', RANGES, st.range) + `<button class="primary fd-go">Show clips</button>` +
            `<span class="fd-tip">Clips people post on Reddit (Twitch, Kick, YouTube, Streamable). Reddit allows about 1 new feed per minute.</span>`);
        } else if (st.tsrc === 'shorts') {
          h += row('', input('', 'Streamer: e.g. Kai Cenat, IShowSpeed, xQc', st.ytq) + `<button class="primary fd-go">Search</button>`);
          h += row('Popular', `<div class="fd-chips">${YT_STREAMERS.map((c) => `<button class="chip ghosty${(st.ytq || '').toLowerCase() === c.toLowerCase() ? ' on' : ''}" data-ytq="${esc(c)}">${esc(c)}</button>`).join('')}</div>` +
            `<span class="fd-tip">Clips of that streamer people posted as Shorts, most watched first.</span>`);
        } else {
          h += row('', seg('range', RANGES, st.range) + `<button class="primary fd-go">Show clips</button>` +
            `<span class="fd-tip">${st.tsrc === 'all' ? 'The most-viewed clips on Twitch and Kick, mixed together.' : 'The most-viewed clips across the whole site.'}</span>`);
        }
      } else {
        const game = st.smode === 'game';
        h += row('', seg('platform', [['twitch', 'Twitch'], ['kick', 'Kick']], st.platform) +
          input('', game ? 'Game or category: e.g. Just Chatting, GTA V, Valorant' : `Streamer channel name: e.g. ${POPULAR[st.platform][0]}`, game ? st.sg : st.ch) +
          seg('range', RANGES, st.range) + `<button class="primary fd-go">Top clips</button>`);
        h += row('Popular', `<div class="fd-chips">${(game ? POPULAR_GAMES : POPULAR[st.platform]).map((c) => `<button class="chip ghosty" data-pick="${esc(c)}">${esc(c)}</button>`).join('')}</div>` +
          (game && st.platform === 'twitch' ? `<label class="fd-check"><input type="checkbox" class="fd-en" ${st.en ? 'checked' : ''}> English only</label>` : ''));
      }
      h += row('Vibe', chips(STREAM_MOODS, st.smood, 'smood') + `<span class="fd-tip">Filters by clip title, sorted by most viewed</span>`);
    } else if (st.tab === 'gaming') {
      h += row('From', seg('gsrc', [['medal', 'Medal.tv'], ['twitch', 'Twitch clips'], ['kick', 'Kick clips'], ['youtube', 'YouTube'], ['shorts', 'Shorts']], st.gsrc));
      h += row('', input('', 'Game: e.g. Fortnite, Valorant, Minecraft, GTA V, Fall Guys', st.gq) +
        (['twitch', 'kick'].includes(st.gsrc) ? seg('range', RANGES, st.range) : '') + `<button class="primary fd-go">Search</button>`);
      h += row('Mood', chips(GAME_MOODS, st.gmood, 'gmood'));
      h += `<div class="fd-row fd-sub">${st.gsrc === 'youtube' ? shortBox() : `<span class="fd-tip">${st.gsrc === 'medal' ? 'Medal.tv: the biggest gaming-clip site. ' : st.gsrc === 'shorts' ? 'Vertical YouTube Shorts: perfect for 9:16 edits. ' : 'Most-viewed stream clips for that game. '}${st.gsrc === 'shorts' ? '' : 'Mood filters by clip title.'}</span>`}</div>`;
    } else if (st.tab === 'viral') {
      h += row('From', seg('vsrc', [['feeds', 'Viral feeds'], ['shorts', 'Viral Shorts'], ['news', 'News (YouTube)'], ['channels', 'News & sports channels']], st.vsrc));
      if (st.vsrc === 'feeds') {
        const streamer = st.sub === 'LivestreamFail';
        h += row('Feed', chips(VIRAL_FEEDS.map(([k, l]) => ({ k, l })), st.sub, 'sub', false));
        h += streamer
          ? row('From the', seg('rrange', [['day', 'Last 24h'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['all', 'All time']], st.rrange === 'year' ? 'all' : st.rrange) +
            '<span class="fd-tip">The most-viewed Twitch and Kick clips.</span>')
          : `<div class="fd-row fd-sub"><span class="fd-tip">Short viral videos (under 4 minutes) of that kind, from YouTube.</span></div>`;
      } else if (st.vsrc === 'shorts') {
        h += row('', input('', 'Anything: e.g. crazy fails, street interviews, animals, satisfying', st.nq) + `<button class="primary fd-go">Search</button>`);
        h += row('Topic', chips(NEWS_TOPICS, st.ntopic, 'ntopic'));
      } else if (st.vsrc === 'news') {
        h += row('', input('', 'Topic: e.g. hurricane, election night, SpaceX launch, funny reporter', st.nq) +
          seg('when', [['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['any', 'Any time']], st.when) + `<button class="primary fd-go">Search</button>`);
        h += row('Topic', chips(NEWS_TOPICS, st.ntopic, 'ntopic'));
        h += `<div class="fd-row fd-sub">${shortBox()}</div>`;
      } else {
        for (const [grp, list] of Object.entries(CHANNELS)) h += row(grp, chips(list.map(([k, l]) => ({ k, l })), st.chan, 'chan', false));
        h += row('', input('', 'Search this channel: e.g. game winner, interview, highlights (leave empty for top results)', st.cq) + `<button class="primary fd-go">Search</button>`);
      }
    } else if (st.tab === 'stock') {
      const photo = st.skind === 'photo';
      const prov = photo ? st.pprov : st.vprov;
      const have = !NEEDS_KEY[prov] || st.keys[prov];
      h += row('Type', seg('skind', [['video', 'Videos'], ['photo', 'Photos']], st.skind) + seg(photo ? 'pprov' : 'vprov', photo ? PHOTO_PROVIDERS : VIDEO_PROVIDERS, prov) +
        seg('orient', [['vertical', 'Vertical'], ['horizontal', 'Horizontal'], ['any', 'Any']], st.orient));
      if (!have || st.showKeys) h += keyForm(prov);
      else {
        h += row('', input('', photo ? 'Search photos: e.g. sunset, city skyline, sad girl rain, galaxy' : 'Search footage: e.g. rain window, city drive night, crowd cheering', st.sq) + `<button class="primary fd-go">Search</button>`);
        h += row('Mood', chips(STOCK_MOODS, st.stmood, 'stmood'));
        h += `<div class="fd-row fd-sub"><span class="fd-tip">${photo ? 'Photos become 8-second clips with a slow push-in, so they cut like video. ' : ''}${prov === 'openverse' || prov === 'commons' ? 'Openly licensed: credit the author (shown on each card).' : prov === 'destockd' ? 'Old public-domain films split into single shots: great for vintage / archival edits.' : prov === 'archival' ? 'Vintage stock footage from A/V Geeks: free previews; check the site for license terms before posting.' : 'Free to use in your edits.'}</span>
          ${NEEDS_KEY[prov] ? '<a href="#" class="fd-keys fd-tip">Change key</a>' : ''}</div>`;
      }
    } else if (st.tab === 'music') {
      const sfx = st.musrc === 'freesound';
      {
        h += row('', input('', sfx ? 'Search sounds: e.g. whoosh, bass drop, riser, glitch, crowd cheer' : st.musrc === 'ytsong' ? 'Song or artist: e.g. Metro Boomin Superhero, sad phonk, NCS' : 'Search music: e.g. chill, phonk, cinematic, piano, hip hop', st.muq) + `<button class="primary fd-go">Search</button>`);
        h += row(sfx ? 'Sounds' : 'Vibe', chips(sfx ? SFX_MOODS : MUSIC_MOODS, st.mumood, 'mumood'));
        h += `<div class="fd-row fd-sub"><span class="fd-tip">${MUSIC_TIPS[st.musrc] || ''}</span></div>`;
      }
      h += row('Link', `<input type="text" class="fd-songlink" placeholder="Or paste any song link: YouTube, SoundCloud, Bandcamp, TikTok sound… → MP3">` +
        `<button class="small fd-songgo">♪ Use as song</button>`);
    } else {
      h += `<div class="fd-row fd-linkrow">
          <textarea class="fd-links" rows="4" placeholder="Paste one or more links (one per line)&#10;YouTube, Twitch, Kick, TikTok, Instagram, X, Streamable, Medal, Allstar, Dailymotion, thepartwhere.com moments">${esc(st.links || '')}</textarea>
          <div class="fd-range">
            <label>From <input type="text" class="fd-from" placeholder="0:00"></label>
            <label>To <input type="text" class="fd-to" placeholder="end"></label>
            <button class="primary fd-go">Add clips</button>
            <small>Leave times empty for the whole clip. Long YouTube videos (10+ min) grab the most-replayed 90 seconds.</small>
          </div>
        </div>
        <div class="fd-row fd-sub"><span class="fd-tip">Tip: press <kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere in the editor to grab a copied link.</span></div>`;
    }
    if (showsQuality()) {
      h += row('Quality', seg('quality', [['any', 'Any'], ['hd', 'HD 1080p+'], ['4k', '4K only']], st.quality) +
        `<span class="fd-tip">${st.quality === '4k' ? 'Only videos available in 4K: they download in 4K for the sharpest crops and zooms.' : 'Badges on each video show its quality: <b class="fd-res q-4k">4K</b> ones download in 4K.'}</span>`);
    }
    controls.innerHTML = h;
    bindControls();
  }
  // sources that know (or can filter by) video quality
  function showsQuality() {
    if (st.tab === 'movies') return ['youtube', 'shorts'].includes(st.msrc);
    if (st.tab === 'gaming') return ['youtube', 'shorts'].includes(st.gsrc);
    if (st.tab === 'viral') return ['shorts', 'news'].includes(st.vsrc) || (st.vsrc === 'feeds' && st.sub !== 'LivestreamFail');
    if (st.tab === 'stock') return st.skind !== 'photo' && ['pexels', 'pixabay', 'commons'].includes(st.vprov) && (!NEEDS_KEY[st.vprov] || st.keys[st.vprov]);
    return false;
  }

  function keyForm(prov) {
    const isPx = prov === 'pexels';
    return `<div class="fd-keyform">
      <b>Free ${isPx ? 'Pexels' : 'Pixabay'} key needed (takes 1 minute)</b>
      <ol><li>Open <a href="${isPx ? 'https://www.pexels.com/api/' : 'https://pixabay.com/api/docs/'}" target="_blank">${isPx ? 'pexels.com/api' : 'pixabay.com/api/docs'}</a> and sign up (free).</li>
      <li>Copy your API key and paste it here.</li></ol>
      <div class="fd-row"><input type="text" class="fd-keyin" placeholder="Paste your ${isPx ? 'Pexels' : 'Pixabay'} API key"><button class="primary fd-savekey">Save key</button>
      ${st.keys[prov] ? '<button class="small fd-cancelkey">Cancel</button>' : ''}</div>
      <small>No key? Pick Mixkit, Openverse or Wikimedia above: they work right away.</small>
      <small>Saved only on this PC (Cutsona\\config.json).</small></div>`;
  }

  function bindControls() {
    controls.querySelectorAll('.fd-seg').forEach((sg) => sg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const name = sg.dataset.name;
      st[name] = b.dataset.v; save();
      if (['msrc', 'smode', 'platform', 'gsrc', 'vsrc', 'skind', 'vprov', 'pprov', 'tsrc', 'musrc', 'quality'].includes(name)) { st.items = []; st.error = null; st.showKeys = false; }
      if (name === 'musrc') st.mumood = null; // sound moods and music moods differ
      renderControls(); renderResults(); autoSearch();
    }));
    const pick = (attr, key, after) => controls.querySelectorAll(`[data-${attr}]`).forEach((b) => (b.onclick = () => {
      const v = b.dataset[attr] || null;
      st[key] = v === null ? null : st[key] === v && !['sub', 'chan', 'csub'].includes(key) ? null : v;
      save(); renderControls(); after();
    }));
    pick('mood', 'mood', search); pick('gmood', 'gmood', () => (['youtube', 'shorts'].includes(st.gsrc) ? search() : renderResults()));
    pick('smood', 'smood', renderResults); pick('ntopic', 'ntopic', search); pick('stmood', 'stmood', search);
    pick('sub', 'sub', search); pick('csub', 'csub', search); pick('chan', 'chan', search); pick('mumood', 'mumood', search);
    const songGo = $('.fd-songgo', controls);
    if (songGo) {
      const sl = $('.fd-songlink', controls);
      const goSong = () => { const u = sl.value.trim(); if (!/^https?:\/\//i.test(u)) return toast('Paste a link to a song first'); addOne({ url: u, title: null, audio: true }); sl.value = ''; };
      songGo.onclick = goSong;
      sl.addEventListener('keydown', (e) => { if (e.key === 'Enter') goSong(); });
    }
    controls.querySelectorAll('[data-ytq]').forEach((b) => (b.onclick = () => { st.ytq = b.dataset.ytq; renderControls(); search(); }));
    controls.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { if (st.smode === 'game') st.sg = b.dataset.pick; else st.ch = b.dataset.pick; renderControls(); search(); }));
    const q = $('.fd-q', controls);
    if (q) {
      q.addEventListener('input', () => {
        const v = q.value;
        if (st.tab === 'movies') st.q = v; else if (st.tab === 'moments') st.mq = v; else if (st.tab === 'gaming') st.gq = v; else if (st.tab === 'streams') { if (st.smode === 'trending') st.ytq = v; else if (st.smode === 'game') st.sg = v; else st.ch = v; }
        else if (st.tab === 'viral') { if (st.vsrc === 'news' || st.vsrc === 'shorts') st.nq = v; else st.cq = v; } else if (st.tab === 'stock') st.sq = v;
        else if (st.tab === 'music') st.muq = v;
      });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    }
    const sh = $('.fd-short', controls); if (sh) sh.onchange = () => { st.short = sh.checked; save(); search(); };
    const en = $('.fd-en', controls); if (en) en.onchange = () => { st.en = en.checked; save(); search(); };
    const mt = $('.fd-mtitle', controls);
    if (mt) {
      mt.addEventListener('input', () => { st.mtitle = mt.value; });
      mt.addEventListener('change', () => { st.mtitle = mt.value.trim(); search(); });
      mt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { st.mtitle = mt.value.trim(); search(); } });
    }
    controls.querySelectorAll('[data-mtitle]').forEach((b) => (b.onclick = () => { st.mtitle = st.mtitle === b.dataset.mtitle ? '' : b.dataset.mtitle; renderControls(); search(); }));
    const mclr = $('.fd-mclear', controls); if (mclr) mclr.onclick = () => { st.mtitle = ''; renderControls(); search(); };
    const keys = $('.fd-keys', controls); if (keys) keys.onclick = (e) => { e.preventDefault(); st.showKeys = true; renderControls(); };
    const ck = $('.fd-cancelkey', controls); if (ck) ck.onclick = () => { st.showKeys = false; renderControls(); };
    const sk = $('.fd-savekey', controls);
    if (sk) sk.onclick = async () => {
      const v = $('.fd-keyin', controls).value.trim();
      if (!v) return toast('Paste the key first');
      const prov = st.skind === 'photo' ? st.pprov : st.vprov;
      const r = await fetch('/api/finder/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [prov + 'Key']: v }) });
      const j = await r.json(); st.keys = { pexels: j.pexels, pixabay: j.pixabay }; st.showKeys = false;
      toast('Key saved'); renderControls(); search();
    };
    const links = $('.fd-links', controls); if (links) links.addEventListener('input', () => (st.links = links.value));
    const go = $('.fd-go', controls); if (go) go.onclick = () => (st.tab === 'link' ? addLinks() : search());
  }

  async function loadMomentTitles() {
    st.mtLoading = true;
    try { const r = await fetch('/api/finder/moment-titles'); if (r.ok) st.mtitles = await r.json(); } catch {}
    st.mtLoading = false;
    if (st.mtitles && st.tab === 'moments' && !root.hidden && !controls.contains(document.activeElement)) renderControls();
  }
  // Every tab shows clips right away — moods and search words only narrow it down
  function autoSearch() {
    if (st.tab === 'link') return;
    if (st.tab === 'stock') { const prov = st.skind === 'photo' ? st.pprov : st.vprov; if (NEEDS_KEY[prov] && !st.keys[prov]) return; }
    search();
  }

  function buildRequest() {
    const qual = showsQuality() && st.quality !== 'any' ? { quality: st.quality } : {};
    const P = (o) => '/api/finder/search?' + new URLSearchParams({ n: '50', ...o, ...qual }).toString();
    if (st.tab === 'movies') {
      const m = MOVIE_MOODS.find((x) => x.k === st.mood);
      const text = (st.q || '').trim();
      if (/^https?:\/\//i.test(text)) return { link: text };
      if (st.msrc === 'yarn') return { url: P({ source: 'yarn', q: text || (m ? m.say : '') }) };
      const kind = MOVIE_KINDS[st.kind] ?? '';
      let q;
      if (!kind) {
        // All videos: your words as typed; a mood adds its feel ("funny", "sad"); nothing typed = what's popular
        q = text && m ? `${text} ${m.l.toLowerCase()}` : text || (m ? `${m.top} videos` : 'viral videos');
        if (st.msrc === 'youtube') return { url: P({ source: 'youtube', q, short: st.short ? '1' : '0' }) };
        if (st.msrc === 'shorts') return { url: P({ source: 'shorts', q }) };
        if (st.msrc === 'giphy') return { url: P({ source: 'giphy', q: text || (m ? m.k : 'reaction') }) };
        if (st.msrc === 'dailymotion') return { url: P({ source: 'dailymotion', q, short: st.short ? '1' : '0' }) };
        return { url: P({ source: 'ytchannel', handle: st.msrc, q: [text, m && m.k].filter(Boolean).join(' ') }) };
      }
      // don't say "scene" twice ("docking scene scene" finds nothing on YouTube)
      const said = /\b(scene|scenes|clip|moment)\b/i.test(text), add = (x) => (said ? x.replace(/\s*\bscenes?\b/i, '') : x);
      if (text && m) q = `${text} ${add(m.scene)}`.trim();
      else if (text) q = `${text} ${add(st.kind === 'movies' ? 'scene' : kind + ' scene')}`.trim();
      else if (m) q = `${m.top} ${kind} scenes`;
      else q = `best ${kind} scenes`;
      if (st.msrc === 'youtube') return { url: P({ source: 'youtube', q, short: st.short ? '1' : '0' }) };
      if (st.msrc === 'shorts') return { url: P({ source: 'shorts', q: text || m ? q : `${kind} scene` }) };
      if (st.msrc === 'giphy') return { url: P({ source: 'giphy', q: text || (m ? m.k : `${kind} reaction`) }) };
      if (st.msrc === 'dailymotion') return { url: P({ source: 'dailymotion', q: text || m ? q : `${kind} clip`, short: st.short ? '1' : '0' }) };
      return { url: P({ source: 'ytchannel', handle: st.msrc, q: [text, m && m.k].filter(Boolean).join(' ') }) };
    }
    if (st.tab === 'moments') return { url: P({ source: 'moments', q: (st.mq || '').trim(), title: (st.mtitle || '').trim() }) };
    if (st.tab === 'streams') {
      if (st.smode === 'trending') {
        if (st.tsrc === 'shorts') { const who = (st.ytq || '').trim() || YT_STREAMERS[0]; return { url: P({ source: 'shorts', q: `${who} stream moment`, sort: 'views' }) }; }
        if (st.tsrc === 'twitch') return { url: P({ source: 'twitchtop', range: st.range, en: '1', n: '40' }) };
        if (st.tsrc === 'kick') return { url: P({ source: 'kicktrend', range: st.range, n: '40' }) };
        return { url: P({ source: 'streamtrend', range: st.range, en: '1', n: '30' }) };
      }
      const top = () => (st.platform === 'kick' ? { url: P({ source: 'kicktrend', range: st.range, n: '40' }) } : { url: P({ source: 'twitchtop', range: st.range, en: st.en ? '1' : '0', n: '40' }) });
      if (st.smode === 'game') {
        const g = (st.sg || '').trim();
        if (!g) return top();
        return { url: P({ source: st.platform === 'kick' ? 'kickgame' : 'twitchgame', q: g, range: st.range, en: st.en ? '1' : '0', n: '40' }) };
      }
      const ch = (st.ch || '').trim();
      if (!ch) return top();
      return { url: P({ source: st.platform, channel: ch, range: st.range, n: '40' }) };
    }
    if (st.tab === 'gaming') {
      const g = (st.gq || '').trim();
      const m = GAME_MOODS.find((x) => x.k === st.gmood);
      if (st.gsrc === 'youtube') return { url: P({ source: 'youtube', q: `${g || 'gaming'} ${m ? m.q : 'best moments'}`, short: st.short ? '1' : '0' }) };
      if (st.gsrc === 'shorts') return { url: P({ source: 'shorts', q: `${g || 'gaming'} ${m ? m.q : 'moments'}` }) };
      if (st.gsrc === 'medal') return { url: P({ source: 'medal', q: g }) };
      if (!g) return st.gsrc === 'kick' ? { url: P({ source: 'kicktrend', range: st.range, gaming: '1', n: '40' }) } : { url: P({ source: 'twitchtop', range: st.range, gaming: '1', n: '40' }) };
      return { url: P({ source: st.gsrc === 'kick' ? 'kickgame' : 'twitchgame', q: g, range: st.range, en: '1', n: '40' }) };
    }
    if (st.tab === 'viral') {
      if (st.vsrc === 'feeds') {
        const fd = VIRAL_FEEDS.find(([k]) => k === st.sub) || VIRAL_FEEDS[0], r = st.rrange === 'year' ? 'all' : st.rrange;
        if (!fd[2]) return { url: P({ source: 'streamtrend', range: r, en: '1', n: '30' }) };
        return { url: P({ source: 'youtube', q: fd[2], short: '1' }) };
      }
      if (st.vsrc === 'shorts') {
        const t = NEWS_TOPICS.find((x) => x.k === st.ntopic);
        return { url: P({ source: 'shorts', q: [(st.nq || '').trim(), t && t.q].filter(Boolean).join(' ') || 'viral' }) };
      }
      if (st.vsrc === 'news') {
        const t = NEWS_TOPICS.find((x) => x.k === st.ntopic);
        const q = [(st.nq || '').trim(), t && t.q].filter(Boolean).join(' ') || 'news';
        return { url: P({ source: 'youtube', q, when: st.when === 'any' ? '' : st.when, short: st.short ? '1' : '0' }) };
      }
      return { url: P({ source: 'ytchannel', handle: st.chan || 'NBA', q: (st.cq || '').trim() }) };
    }
    if (st.tab === 'stock') {
      const photo = st.skind === 'photo';
      const prov = photo ? st.pprov : st.vprov;
      if (NEEDS_KEY[prov] && !st.keys[prov]) return { err: 'Add your free key first: or pick a “no key” source' };
      const m = STOCK_MOODS.find((x) => x.k === st.stmood);
      const q = (st.sq || '').trim() || (m ? m.q : '');
      return { url: P({ source: prov, q, orient: st.orient, kind: photo ? 'photo' : 'video' }) };
    }
    if (st.tab === 'music') {
      const text = (st.muq || '').trim();
      if (/^https?:\/\//i.test(text)) return { song: text };
      const sfx = st.musrc === 'freesound';
      const m = (sfx ? SFX_MOODS : MUSIC_MOODS).find((x) => x.k === st.mumood);
      const q = [text, m && m.q].filter(Boolean).join(' ') || (st.musrc === 'ytsong' ? 'trending songs official' : sfx ? 'whoosh' : '');
      return { url: P({ source: st.musrc, q }) };
    }
    return { err: 'Nothing to search' };
  }

  let searchSeq = 0;
  async function search() {
    const b = buildRequest();
    if (b.err) { toast(b.err); return; }
    if (b.link) { addOne({ url: b.link }); return; }
    if (b.song) { addOne({ url: b.song, title: null, audio: true }); return; }
    const seq = ++searchSeq;
    st.loading = true; st.loadingMore = false; st.error = null; st.page = 1; st.more = false; st.reqUrl = b.url; renderResults();
    results.scrollTop = 0;
    // YouTube: show the first page of results straight away (under a second), then the full list behind it
    const yt = /[?&]source=(youtube|shorts|ytchannel)(&|$)/.test(b.url);
    if (yt) {
      try {
        const r = await fetch(b.url + '&fast=1');
        const j = await r.json();
        if (seq !== searchSeq) return;
        if (r.ok && j.items?.length) {
          st.items = dedupe(j.items); st.loading = false; st.loadingMore = true; renderResults(); renderMore();
        }
      } catch { /* the full search below still runs */ }
    }
    try {
      const r = await fetch(b.url);
      const j = await r.json();
      if (seq !== searchSeq) return;
      if (!r.ok) { if (yt && st.items.length && !st.loading) { st.loadingMore = false; renderMore(); return; } throw new Error(j.error || 'Search failed'); }
      if (yt && st.items.length && !st.loading) {
        // keep what's on screen, add the rest underneath
        const fresh = dedupe(j.items || [], st.items);
        st.items = st.items.concat(fresh); st.more = !!j.more; st.loadingMore = false;
        if (fresh.length) appendCards(); else renderMore();
        if (st.more && seq === searchSeq && results.scrollHeight <= results.clientHeight + 200) loadMore();
        return;
      }
      st.items = dedupe(j.items || []);
      st.more = !!j.more;
      if (!st.items.length) st.error = showsQuality() && st.quality !== 'any'
        ? `No ${st.quality === '4k' ? '4K' : 'HD'} videos found for that: try other words, or set Quality to Any.`
        : 'Nothing found: try other words or a longer time range.';
    } catch (e) {
      if (seq !== searchSeq) return;
      st.items = []; st.error = e.message;
    }
    st.loading = false; renderResults();
    if (st.more && seq === searchSeq) loadMore(); // fill the screen right away
  }
  function dedupe(list, have = []) {
    const seen = new Set(have.map((x) => x.url));
    return list.filter((x) => x && x.url && !seen.has(x.url) && seen.add(x.url));
  }
  async function loadMore() {
    if (!st.more || st.loadingMore || st.loading || !st.reqUrl) return;
    const seq = searchSeq;
    st.loadingMore = true; renderMore();
    let added = 0, tries = 0;
    try {
      while (!added && st.more && tries < 3 && seq === searchSeq) {
        tries++;
        const next = st.page + 1;
        const r = await fetch(st.reqUrl + '&page=' + next);
        const j = await r.json();
        if (seq !== searchSeq) return;
        if (!r.ok) { st.more = false; break; }
        const fresh = dedupe(j.items || [], st.items);
        st.page = next;
        st.more = !!j.more && (j.items || []).length > 0;
        if (fresh.length) { st.items = st.items.concat(fresh); added = fresh.length; }
      }
      if (!added) st.more = false; // the site only gave back clips already shown: that's all of them
    } catch { st.more = false; }
    if (seq !== searchSeq) return;
    st.loadingMore = false;
    if (added) appendCards(added); else renderMore();
  }
  results.addEventListener('scroll', () => {
    if (results.scrollTop + results.clientHeight > results.scrollHeight - 900) loadMore();
  });
  function moreHtml() {
    if (st.loadingMore) return '<div class="spinner"></div> Loading more clips…';
    if (st.more) return '<button class="small fd-loadmore">Load more</button>';
    return st.items.length ? `That’s everything: ${st.items.length} ${st.tab === 'music' ? 'tracks' : 'clips'}.` : '';
  }
  function renderMore() {
    const el = $('.fd-more', results);
    if (!el) return;
    el.innerHTML = moreHtml();
    const btn = $('.fd-loadmore', el); if (btn) btn.onclick = loadMore;
    $('.fd-count', root) && ($('.fd-count', root).textContent = st.items.length ? `${st.items.length} ${st.tab === 'music' ? 'tracks' : 'clips'}` : '');
  }
  // thumbnails load as their cards scroll near the screen, not all 100 at once
  const thumbSeen = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      const th = en.target; thumbSeen.unobserve(th);
      if (th.dataset.bg) th.style.backgroundImage = `url("${th.dataset.bg.replace(/"/g, '%22')}")`;
    }
  }, { root: results, rootMargin: '600px 0px' }) : null;
  function bindCard(el) {
    const th = el.querySelector('.fd-thumb');
    if (th?.dataset.bg) { if (thumbSeen) thumbSeen.observe(th); else th.style.backgroundImage = `url("${th.dataset.bg.replace(/"/g, '%22')}")`; }
    const it = st.items[Number(el.dataset.i)];
    el.querySelector('.fd-add').onclick = (e) => { e.stopPropagation(); addOne(it); };
    el.querySelector('.fd-thumb').onclick = () => openPreview(it);
    el.querySelector('.fd-prev').onclick = () => openPreview(it);
  }
  function appendCards() {
    const grid = $('.fd-grid', results);
    if (!grid) { renderResults(); return; }
    const words = filterWords();
    const shown = new Set([...grid.querySelectorAll('.fd-card')].map((c) => Number(c.dataset.i)));
    let html = '';
    st.items.forEach((it, i) => {
      if (shown.has(i)) return;
      if (words) { const t = ' ' + (it.title || '').toLowerCase() + ' '; if (!words.some((w) => t.includes(w))) return; }
      html += card(it, i);
    });
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    [...tmp.children].forEach((c) => { grid.appendChild(c); bindCard(c); });
    renderMore();
    if (results.scrollHeight <= results.clientHeight + 200) loadMore();
  }

  function filterWords() {
    if (st.tab === 'streams' && st.smood) return STREAM_MOODS.find((x) => x.k === st.smood).words;
    if (st.tab === 'gaming' && ['twitch', 'kick', 'medal'].includes(st.gsrc) && st.gmood) return GAME_MOODS.find((x) => x.k === st.gmood).words;
    return null;
  }
  function visibleItems() {
    const words = filterWords();
    if (!words) return { list: st.items };
    const list = st.items.filter((it) => { const t = ' ' + (it.title || '').toLowerCase() + ' '; return words.some((w) => t.includes(w)); });
    return list.length ? { list } : { list: st.items, none: true };
  }

  function renderResults() {
    const cnt = $('.fd-count', root); if (cnt && (st.loading || st.error || !st.items.length)) cnt.textContent = '';
    if (st.tab === 'link') { results.innerHTML = renderLinkJobs(); bindJobButtons(); return; }
    if (st.loading) { results.innerHTML = `<div class="fd-empty"><div class="spinner"></div>Searching…</div>`; return; }
    if (st.error) { results.innerHTML = `<div class="fd-empty err">${esc(st.error)}</div>`; return; }
    if (!st.items.length) {
      const hints = {
        movies: st.msrc === 'yarn' ? 'Type a line from a movie or show: every clip is the exact moment it’s said.' : 'Pick a mood like Sad, or type anything you want to find.',
        gaming: 'Type a game and pick a mood.',
        streams: st.smode === 'game' ? 'Pick a game to see the most-viewed stream clips in it.' : 'Pick a popular streamer or type a channel name.',
        viral: 'Pick a feed, topic or channel.',
        stock: '',
      };
      results.innerHTML = `<div class="fd-empty">${hints[st.tab] || ''}</div>`; return;
    }
    const v = visibleItems();
    results.innerHTML = (v.none ? `<div class="fd-note">No titles matched that vibe: showing all clips.</div>` : '') +
      `<div class="fd-grid">${v.list.map((it) => card(it, st.items.indexOf(it))).join('')}</div><div class="fd-more"></div>`;
    results.querySelectorAll('.fd-card').forEach(bindCard);
    renderMore();
  }

  function jobLabel(job) {
    if (!job) return null;
    if (job.status === 'done') return job.audio ? '✓ Song set' : '✓ Added';
    if (job.status === 'error') return 'Failed: retry';
    return job.pct > 0 ? `${Math.round(job.pct)}%` : (job.phase || 'Starting') + '…';
  }
  // songs and clips are tracked separately (the same YouTube link can be both)
  function jobKey(it) { return (it.audio ? 'song:' : '') + it.url; }
  function card(it, i) {
    const job = liveJob(jobKey(it));
    const long = it.source === 'youtube' && it.duration > 600;
    const meta = [it.license || it.channel, it.moment ? 'at ' + fmtDur(it.start) : '', it.views != null ? fmtViews(it.views) : '', it.game, it.via ? 'via ' + it.via : ''].filter(Boolean).map(esc).join(', ');
    return `<div class="fd-card ${job ? 'job-' + job.status : ''} ${it.audio ? 'audio' : ''}" data-i="${i}">
      <div class="fd-thumb ${it.audio && !it.thumb ? 'note' : ''}" data-bg="${esc(it.thumb || '')}">
        <span class="fd-src ${it.shorts ? 'shorts' : it.moment ? 'moment' : it.source}">${it.shorts ? 'Shorts' : it.moment ? 'Moment' : SRC_LABEL[it.source] || it.source}</span>
        ${it.res && !it.audio ? `<span class="fd-res q-${it.res.toLowerCase()}" title="${it.res === '4K' ? 'Available in 4K: downloads in 4K' : it.res === 'HD' ? 'Available in HD' : it.res + ' video'}">${it.res}</span>` : ''}
        ${it.photo ? '<span class="fd-dur">Photo</span>' : it.duration ? `<span class="fd-dur">${it.duration < 10 ? it.duration.toFixed(1) + 's' : fmtDur(it.duration)}</span>` : ''}
        <span class="fd-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
      </div>
      <div class="fd-info">
        <div class="fd-name" title="${esc(it.title)}">${esc(it.title)}</div>
        <div class="fd-meta">${meta}${long ? ', <b>grabs best 90s</b>' : ''}</div>
      </div>
      <div class="fd-actions"><button class="small fd-prev">Preview</button><button class="fd-add${job && job.status === 'done' ? ' done' : ''}">${esc(jobLabel(job) || (it.audio ? 'Use as song' : 'Add'))}</button></div>
    </div>`;
  }

  async function addOne(item, extra = {}) {
    const whole = item.moment && extra.start == null; // a moment card: just its exact seconds
    if (whole) extra = { ...extra, start: item.start, end: item.end };
    const base = jobKey(item), key = base + (extra.start != null && !whole ? '@' + extra.start : '');
    const existing = liveJob(key);
    // a song can be picked again any time (e.g. to switch back to it); clips are only added once
    if (existing && existing.status !== 'error' && !(item.audio && existing.status === 'done')) { toast(item.audio ? 'Already getting that song' : 'Already added'); return; }
    const job = { status: 'queued', pct: 0, phase: 'Starting', title: item.title || item.url, audio: !!item.audio };
    st.jobs.set(key, job); // a part of a video ("30s from here") doesn't count as adding the whole video
    rerender();
    if (item.audio) {
      // a song or sound: becomes the edit's music (MP3), not a clip
      toast(`Getting “${item.title || 'song'}” as MP3…`);
      try {
        await grabSong({ url: item.url, title: item.title || null, duration: item.duration, ...extra }, (upd) => { Object.assign(job, upd, { audio: true }); rerender(); });
        job.status = 'done'; rerender();
      } catch (e) { job.status = 'error'; job.phase = e.message; job.error = e.message; rerender(); toast(e.message, true); }
      return;
    }
    try {
      // 4K videos (or anything picked while "4K only" is on) download in 4K
      const maxRes = item.res === '4K' || (st.quality === '4k' && showsQuality()) ? 2160 : undefined;
      await grab({ url: item.url, photo: !!item.photo, title: item.title ? (item.moment && item.channel ? `${item.channel}: ${item.title.length > 60 ? item.title.slice(0, 60).replace(/\s+\S*$/, '') + '…' : item.title}` : `${item.title}${item.source === 'yarn' && item.channel ? ': ' + item.channel : ''}`) : null, duration: item.duration, maxRes,
        source: item.source, channel: item.channel, page: item.page, views: item.views, ...extra }, (upd) => {
        Object.assign(job, upd);
        if (upd.status === 'done' && !job._counted) { job._counted = true; st.added++; updateFoot(); }
        rerender();
      });
    } catch (e) { job.status = 'error'; job.phase = e.message; rerender(); toast(e.message, true); }
  }
  let rr = 0;
  function rerender() {
    if (rr) return;
    rr = requestAnimationFrame(() => {
      rr = 0;
      if (root.hidden) return;
      if (st.tab === 'link') { results.innerHTML = renderLinkJobs(); bindJobButtons(); return; }
      results.querySelectorAll('.fd-card').forEach((el) => {
        const it = st.items[Number(el.dataset.i)], job = it && liveJob(jobKey(it));
        const b = el.querySelector('.fd-add');
        if (job) { b.textContent = jobLabel(job); b.classList.toggle('done', job.status === 'done'); el.className = 'fd-card job-' + job.status + (it.audio ? ' audio' : ''); }
        else if (it && b.classList.contains('done')) { b.textContent = it.audio ? 'Use as song' : 'Add'; b.classList.remove('done'); el.className = 'fd-card' + (it.audio ? ' audio' : ''); }
      });
    });
  }
  function updateFoot() { $('.fd-added', root).innerHTML = st.added ? `<b>${st.added}</b> clip${st.added === 1 ? '' : 's'} added: they’re in your clip list.` : ''; }

  function renderLinkJobs() {
    const rows = [...st.jobs.entries()].filter(([k, j], idx, arr) => arr.findIndex((x) => x[1] === j) === idx);
    if (!rows.length) return `<div class="fd-empty">Paste links above and press “Add clips”.</div>`;
    return `<div class="fd-joblist">${rows.reverse().map(([k, j]) => `<div class="fd-job ${j.status}"><span class="fd-jt">${esc(j.name || j.title || k)}</span>
      <span class="fd-js">${j.status === 'error' ? esc(j.error || j.phase) : esc(jobLabel(j))}${j.note ? ', ' + esc(j.note) : ''}</span>
      ${j.status === 'error' ? `<button class="small fd-retry" data-k="${esc(k)}">Retry</button>` : ''}</div>`).join('')}</div>`;
  }
  function bindJobButtons() {
    results.querySelectorAll('.fd-retry').forEach((b) => (b.onclick = () => { const k = b.dataset.k; st.jobs.delete(k); addOne({ url: k.split('@')[0] }); }));
  }

  function addLinks() {
    const lines = (st.links || '').split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
    if (!lines.length) { toast('Paste at least one link'); return; }
    const from = $('.fd-from', controls).value.trim(), to = $('.fd-to', controls).value.trim();
    for (const u of lines) addOne({ url: u, title: null }, from ? { start: from, end: to || null } : {});
    st.links = ''; renderControls(); renderResults();
  }

  // ---------- preview ----------
  let ytPlayer = null;
  function loadYT() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    return new Promise((res) => {
      window.onYouTubeIframeAPIReady = res;
      const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
      setTimeout(res, 6000);
    });
  }
  async function openPreview(it) {
    preview.hidden = false;
    const isYT = it.source === 'youtube';
    const long = isYT && it.duration > 600;
    preview.innerHTML = `<div class="fd-pv">
      <div class="fd-pv-h"><b>${esc(it.title)}</b><button class="small fd-pv-x">Close</button></div>
      <div class="fd-pv-video" style="${it.thumb ? `background-image:url('${esc(it.thumb)}')` : ''}"><div id="fdPlayer"></div></div>
      <div class="fd-pv-actions">
        ${/^https?:\/\//i.test(it.page || '') ? `<a class="small" href="${esc(it.page)}" target="_blank" rel="noopener noreferrer">Open on ${SRC_LABEL[it.source] || 'site'}</a>` : ''}
        ${isYT && !it.audio ? `<button class="small fd-pv-cut" data-len="15">+ Add 15s from here</button><button class="small fd-pv-cut" data-len="30">+ Add 30s from here</button><button class="small fd-pv-cut" data-len="60">+ Add 60s from here</button>` : ''}
        <button class="primary fd-pv-add">${it.audio ? '♪ Use as song' : it.photo ? '+ Add photo as clip' : it.moment ? `+ Add this moment (${it.duration.toFixed(1)}s at ${fmtDur(it.start)})` : long ? '+ Add best 90s' : '+ Add whole clip'}</button>
      </div></div>`;
    $('.fd-pv-x', preview).onclick = closePreview;
    preview.onclick = (e) => { if (e.target === preview) closePreview(); };
    $('.fd-pv-add', preview).onclick = () => { addOne(it); closePreview(); };
    const box = $('#fdPlayer', preview);
    if (isYT) {
      // "+ Add 15/30/60s from here": the buttons show the exact time they will grab from (live), and
      // after a click they show the download's progress until the clip is in your clip list
      const cuts = [...preview.querySelectorAll('.fd-pv-cut')];
      const nowT = () => { try { return (ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getCurrentTime()) || 0; } catch { return 0; } };
      cuts.forEach((b) => (b.onclick = () => {
        const t = nowT(), len = Number(b.dataset.len), start = Math.max(0, t - 0.5), end = t + len;
        const key = jobKey(it) + '@' + start;
        b.dataset.job = key; b.dataset.range = `${fmtDur(start)}–${fmtDur(end)}`; b.classList.add('busy');
        b.textContent = `Getting ${b.dataset.range}…`;
        addOne({ ...it, title: `${it.title} @${fmtDur(t)}` }, { start, end });
        toast(`Grabbing ${len}s from ${fmtDur(t)}: it goes into your clip list`);
      }));
      clearInterval(pvTick);
      pvTick = setInterval(() => {
        if (preview.hidden) { clearInterval(pvTick); return; }
        const t = nowT();
        for (const b of cuts) {
          const job = b.dataset.job && st.jobs.get(b.dataset.job);
          if (job) {
            b.textContent = job.status === 'done' ? `✓ Added ${b.dataset.range}` : job.status === 'error' ? `Failed: ${job.error || job.phase || 'try again'}` : `${job.pct > 0 ? `Downloading ${Math.round(job.pct)}%` : `${job.phase || 'Starting'}…`} ${b.dataset.range}`;
            if (job.status === 'done' || job.status === 'error') {
              if (!b.dataset.doneAt) b.dataset.doneAt = Date.now();
              else if (Date.now() - b.dataset.doneAt > 4000) { delete b.dataset.job; delete b.dataset.doneAt; b.classList.remove('busy'); }
            }
          } else b.textContent = `+ Add ${b.dataset.len}s from ${fmtDur(t)}`;
        }
      }, 250);
      await loadYT();
      if (preview.hidden) return;
      try {
        ytPlayer = new window.YT.Player(box, { videoId: it.id, width: '100%', height: '100%', playerVars: { autoplay: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, ...(it.moment ? { start: Math.max(0, Math.floor(it.start) - 1) } : {}) } });
      } catch { box.outerHTML = `<iframe src="https://www.youtube.com/embed/${esc(it.id)}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`; }
    } else if (it.source === 'twitch' || it.source === 'kick') {
      box.outerHTML = `<video src="/api/finder/hover?url=${encodeURIComponent(it.url)}&full=1" controls autoplay playsinline></video>`;
      // can't play it here (clip deleted, site busy): show its picture and a link instead of a broken player
      $('.fd-pv-video video', preview)?.addEventListener('error', (e) => {
        e.target.outerHTML = `<div class="fd-pv-fallback" style="background-image:url('${esc(it.thumb || '')}')"><a href="${esc(it.page || it.url)}" target="_blank" rel="noopener noreferrer" class="small">Watch on ${SRC_LABEL[it.source] || 'site'}</a></div>`;
      }, { once: true });
    } else if (it.source === 'twitch-embed') {
      const slug = (/clip\/([^/?#]+)/.exec(it.url) || /clips\.twitch\.tv\/([^/?#]+)/.exec(it.url) || [])[1];
      box.outerHTML = `<iframe src="https://clips.twitch.tv/embed?clip=${encodeURIComponent(slug || '')}&parent=localhost&autoplay=true" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
    } else if (it.source === 'dailymotion') {
      box.outerHTML = `<iframe src="https://www.dailymotion.com/embed/video/${encodeURIComponent(it.id)}?autoplay=1" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
    } else if (it.audio) {
      box.outerHTML = `<div class="fd-pv-audio" style="background-image:url('${esc(it.thumb || '')}')"><div class="fd-pv-note">♪</div>
        <audio src="${esc(it.preview || it.url)}" controls autoplay preload="auto"></audio></div>`;
    } else if (it.photo) {
      box.outerHTML = `<img class="fd-pv-img" src="${esc(it.url)}" alt="">`;
    } else if (it.direct) {
      box.outerHTML = `<video src="${esc(it.preview || it.url)}" controls autoplay loop playsinline></video>`;
    } else {
      box.outerHTML = `<div class="fd-pv-fallback" style="background-image:url('${esc(it.thumb)}')"><a href="${esc(it.page || it.url)}" target="_blank" class="small">Watch on ${SRC_LABEL[it.source] || 'site'}</a></div>`;
    }
  }
  // ---- hover a result's picture: a small muted preview plays right there ----
  function hoverEmbed(it) {
    // Twitch and Kick clips play as plain muted video, through Cutsona (their embeds won't autoplay muted)
    if (it.source === 'twitch' || it.source === 'kick') return `<video src="/api/finder/hover?url=${encodeURIComponent(it.url)}" muted autoplay loop playsinline></video>`;
    const host = encodeURIComponent(location.hostname);
    const start = it.moment ? Math.floor(it.start) : it.duration ? Math.floor(Math.min(it.duration * 0.3, Math.max(0, it.duration - 8))) : 0;
    const end = it.moment ? `&end=${Math.ceil(it.end) + 1}` : '';
    // YouTube: drawn big and scaled down (its title bar and logo end up outside the picture), shown once it plays
    if (it.source === 'youtube' && it.id) return `<iframe class="yt" referrerpolicy="strict-origin-when-cross-origin" src="https://www.youtube.com/embed/${encodeURIComponent(it.id)}?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&modestbranding=1&playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}&start=${start}${end}" allow="autoplay; encrypted-media" tabindex="-1"></iframe>`;
    if (it.source === 'twitch') {
      const slug = (/clip\/([^/?#]+)/.exec(it.url) || /clips\.twitch\.tv\/([^/?#]+)/.exec(it.url) || [])[1];
      if (slug) return `<iframe src="https://clips.twitch.tv/embed?clip=${encodeURIComponent(slug)}&parent=${host}&autoplay=true&muted=true&controls=false" allow="autoplay"></iframe>`;
    }
    if (it.source === 'dailymotion' && it.id) return `<iframe src="https://www.dailymotion.com/embed/video/${encodeURIComponent(it.id)}?autoplay=1&mute=1&controls=0" allow="autoplay"></iframe>`;
    if (it.direct && !it.audio && !it.photo) return `<video src="${esc(it.preview || it.url)}" muted autoplay loop playsinline></video>`;
    return '';
  }
  let hoverTimer = 0, hoverCard = null;
  function stopHover() {
    clearTimeout(hoverTimer);
    if (hoverCard) { hoverCard.querySelector('.fd-hover')?.remove(); hoverCard.classList.remove('hovering'); hoverCard = null; }
  }
  results.addEventListener('mouseover', (e) => {
    const th = e.target.closest('.fd-thumb'), card = th && th.closest('.fd-card');
    if (!card || card === hoverCard) return;
    stopHover();
    const it = st.items?.[Number(card.dataset.i)];
    if (!it) return;
    const html = hoverEmbed(it);
    if (!html) return;
    hoverCard = card;
    // a short wait, so sweeping the mouse across results doesn't start ten videos
    hoverTimer = setTimeout(() => {
      if (hoverCard !== card) return;
      const div = document.createElement('div');
      div.className = 'fd-hover'; div.innerHTML = html;
      th.appendChild(div); card.classList.add('hovering');
      const show = () => div.classList.add('on');
      const vid = div.querySelector('video'), fr = div.querySelector('iframe.yt');
      if (vid) { vid.addEventListener('playing', show, { once: true }); vid.addEventListener('error', () => div.remove(), { once: true }); }
      else if (fr) {
        // ask the YouTube player to report its state; show it when it says "playing"
        fr.addEventListener('load', () => { try { fr.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch {} });
        const onMsg = (m) => {
          if (m.source !== fr.contentWindow) return;
          let d = m.data; try { d = typeof d === 'string' ? JSON.parse(d) : d; } catch { return; }
          if (d?.info?.playerState === 1 || d?.event === 'onStateChange' && d.info === 1) { show(); window.removeEventListener('message', onMsg); }
        };
        window.addEventListener('message', onMsg);
        setTimeout(() => { window.removeEventListener('message', onMsg); show(); }, 3500);
      } else show();
    }, 450);
  });
  results.addEventListener('mouseout', (e) => {
    if (!hoverCard) return;
    const to = e.relatedTarget;
    if (to && hoverCard.querySelector('.fd-thumb').contains(to)) return;
    stopHover();
  });

  let pvTick = 0;
  function closePreview() {
    clearInterval(pvTick);
    if (ytPlayer && ytPlayer.destroy) { try { ytPlayer.destroy(); } catch {} }
    ytPlayer = null;
    preview.hidden = true; preview.innerHTML = '';
  }

  return { open, close, addLink: (url) => addOne({ url }), isOpen: () => !root.hidden };
}
