// Clip Finder: movies/TV by mood or quote, exact moments (thepartwhere.com), streamer clips (by channel, game or trending), gaming, viral & news,
// free stock footage, or paste any link.
import { sentencesOf, searchSentences, smartStart, smartEnd, fmtT, markWords } from './words.js';
import { analyzeViral, viralMoments, scorePart, sentenceHtml, scoreColor } from './viral.js';
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
  ['youtube', 'YouTube'], ['MOVIECLIPS', 'Movieclips'], ['Netflix', 'Netflix'], ['PrimeVideo', 'Prime Video'],
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

export function initFinder({ grab, grabSong, toast, hasClip = () => true, addFile = null, explainViral = null, isStream = () => false, hasMusic = () => false, onRandom = null }) {
  let pickSession = null;
  let editing = null, openedForEdit = false; // a clip from the clip list being edited in the preview: { id, setPart, part, sound, close }
  // a download whose clip you've since removed from your list doesn't count as added anymore
  function liveJob(key) {
    if (pickSession) return null;
    const j = st.jobs.get(key);
    if (j && j.clipId && !j.audio && !hasClip(j.clipId)) {
      st.jobs.delete(key);
      if (j._counted) { st.added = Math.max(0, st.added - 1); updateFoot(); }
      return null;
    }
    return j;
  }
  const SAVE_KEYS = ['order', 'tab', 'kind', 'msrc', 'platform', 'range', 'short', 'smode', 'tsrc', 'csub', 'en', 'gsrc', 'vsrc', 'sub', 'rrange', 'when', 'chan', 'skind', 'vprov', 'pprov', 'orient', 'musrc', 'quality', 'shmood'];
  const st = { order: 'top', tab: 'movies', kind: 'all', msrc: 'youtube', platform: 'twitch', range: 'week', short: true, smode: 'streamer', tsrc: 'all', csub: 'LivestreamFail', en: true, musrc: 'ytsong', mumood: null, quality: 'any',
    gsrc: 'medal', vsrc: 'feeds', sub: 'LivestreamFail', rrange: 'week', when: 'week', chan: 'NBA', skind: 'video', vprov: 'mixkit', pprov: 'openverse', orient: 'vertical',
    mood: null, gmood: null, smood: null, ntopic: null, stmood: null, items: [], loading: false, jobs: new Map(), added: 0, keys: { pexels: false, pixabay: false } };
  try { const sv = JSON.parse(localStorage.getItem('cutsona.finder2') || '{}'); for (const k of SAVE_KEYS) if (k in sv) st[k] = sv[k]; } catch {}
  if (!TREND_SOURCES.some(([k]) => k === st.tsrc)) st.tsrc = 'all'; // older saved choices (the Reddit feeds are gone)
  if (st.vsrc === 'reddit') st.vsrc = 'feeds';
  if (!MUSIC_SOURCES.some(([k]) => k === st.musrc)) st.musrc = 'ytsong';
  try { if (!localStorage.getItem('cutsona.videos2')) { st.kind = 'all'; localStorage.setItem('cutsona.videos2', '1'); } } catch {}
  if (!(st.kind in MOVIE_KINDS)) st.kind = 'all';
  if (st.msrc === 'shorts') { st.msrc = 'youtube'; st.tab = 'shorts'; } // Shorts has its own tab now
  if (st.tab === 'parts') st.tab = 'movies'; // "Find a part" lives in every preview now
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
        <button class="fd-rand" title="Random: grab random footage and make an edit of it">🎲 Random</button>
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
  const CLIP_TABS = [['movies', 'YouTube'], ['shorts', 'Shorts'], ['moments', 'Exact moments'], ['streams', 'Streamers'], ['gaming', 'Gaming'], ['viral', 'Viral &amp; News'], ['stock', 'Free stock'], ['link', 'Paste link']];
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
  $('.fd-rand', root).onclick = () => randomEdit();
  window.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') { if (!preview.hidden) closePreview(true); else close(); e.stopPropagation(); }
  }, true);

  function open(tab, onPick = null, { returnLabel = 'Back to Quick project', wholeVideo = false } = {}) {
    pickSession = onPick ? { onPick, busy: false, wholeVideo, returnTo: document.activeElement } : null;
    $('.fd-rand', root).hidden = !!pickSession || tab === 'music';
    $('.fd-close', root).textContent = '← ' + (pickSession ? returnLabel : 'Back to editor');
    songs = tab === 'music';
    if (songs) st.tab = 'music'; else { if (tab) st.tab = tab; if (st.tab === 'music') st.tab = 'movies'; }
    if (root.dataset.was !== String(songs)) { st.items = []; st.error = null; }
    root.dataset.was = String(songs);
    renderTabs(); root.hidden = false; refreshKeys().then(() => { renderControls(); renderResults(); }); renderControls(); renderResults(); if (!st.items.length && !st.loading) autoSearch(); setTimeout(() => $('.fd-controls input[type=text], .fd-controls textarea', root)?.focus(), 30); }
  function close() {
    const returnTo = pickSession?.returnTo;
    pickSession = null; closePreview(); stopSong(); root.hidden = true;
    returnTo?.focus();
  }

  // ---------- small builders ----------
  const chips = (list, cur, attr, all = true) => `<div class="fd-chips">${all ? `<button class="chip all${cur == null ? ' on' : ''}" data-${attr}="">All</button>` : ''}${list.map((m) => `<button class="chip${cur === m.k ? ' on' : ''}" data-${attr}="${esc(m.k)}">${m.l}</button>`).join('')}</div>`;
  const seg = (name, opts, cur) => `<div class="seg fd-seg" data-name="${name}">${opts.map(([v, l]) => `<button data-v="${esc(v)}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const row = (label, html, extra = '') => `<div class="fd-row"${extra}>${label ? `<span class="fd-lbl">${label}</span>` : ''}${html}</div>`;
  const input = (cls, ph, val) => `<input type="text" class="fd-q ${cls || ''}" placeholder="${esc(ph)}" value="${esc(val || '')}">`;
  const shortBox = () => `<label class="fd-check"><input type="checkbox" class="fd-short" ${st.short ? 'checked' : ''}> Short videos only (under 4 min, no Shorts)</label>`;
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
    } else if (st.tab === 'shorts') {
      h += row('', input('', 'Search Shorts: e.g. funny animals, street interviews, edits, Kai Cenat', st.sq2) + `<button class="primary fd-go">Search</button>`);
      h += row('Mood', chips(MOVIE_MOODS, st.shmood, 'shmood'));
      h += `<div class="fd-row fd-sub"><span class="fd-tip">Vertical YouTube Shorts, ready for 9:16. Open one to find any part of it by what’s said.</span></div>`;
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
      h += row('Vibe', chips(STREAM_MOODS, st.smood, 'smood') + ``);
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
    if (showsSort()) {
      const includesTwitch = (st.tab === 'streams' && (st.smode === 'trending' ? ['twitch', 'all'].includes(st.tsrc) : st.platform === 'twitch'))
        || (st.tab === 'gaming' && st.gsrc === 'twitch') || (st.tab === 'viral' && st.vsrc === 'feeds' && st.sub === 'LivestreamFail');
      const hint = includesTwitch ? 'Twitch sorts its most-viewed clips by date in Cutsona.' : 'Latest clips and uploads first.';
      h += row('Show', seg('order', [['top', 'Most viewed'], ['new', 'Newest']], st.order) + `<span class="fd-tip">${st.order === 'new' ? hint : ''}</span>`);
    }
    if (showsQuality()) {
      h += row('Quality', seg('quality', [['any', 'Any'], ['hd', 'HD 1080p+'], ['4k', '4K only']], st.quality) +
        `<span class="fd-tip">${st.quality === '4k' ? 'Only videos available in 4K: they download in 4K for the sharpest crops and zooms.' : 'Badges on each video show its quality: <b class="fd-res q-4k">4K</b> ones download in 4K.'}</span>`);
    }
    controls.innerHTML = h;
    bindControls();
  }
  // sources that can list their newest clips / uploads first
  function showsSort() {
    if (st.tab === 'movies') return ['youtube', 'dailymotion'].includes(st.msrc);
    if (st.tab === 'shorts' || st.tab === 'streams') return !(st.tab === 'streams' && st.smode === 'trending' && st.tsrc === 'shorts');
    if (st.tab === 'gaming') return ['twitch', 'kick', 'youtube', 'shorts'].includes(st.gsrc);
    if (st.tab === 'viral') return ['shorts', 'news', 'feeds'].includes(st.vsrc);
    return false;
  }
  // sources that know (or can filter by) video quality
  function showsQuality() {
    if (st.tab === 'movies') return st.msrc === 'youtube';
    if (st.tab === 'shorts') return true;
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
      <small>No key? Pick Mixkit, Openverse or Wikimedia above: they work right away. All your keys: Settings → API keys.</small>
      <small>Saved only on this PC (Cutsona\\config.json).</small></div>`;
  }

  function bindControls() {
    controls.querySelectorAll('.fd-seg').forEach((sg) => sg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const name = sg.dataset.name;
      st[name] = b.dataset.v; save();
      if (['msrc', 'smode', 'platform', 'gsrc', 'vsrc', 'skind', 'vprov', 'pprov', 'tsrc', 'musrc', 'quality', 'order'].includes(name)) { st.items = []; st.error = null; st.showKeys = false; }
      if (name === 'musrc') st.mumood = null; // sound moods and music moods differ
      renderControls(); renderResults(); autoSearch();
    }));
    const pick = (attr, key, after) => controls.querySelectorAll(`[data-${attr}]`).forEach((b) => (b.onclick = () => {
      const v = b.dataset[attr] || null;
      st[key] = v === null ? null : st[key] === v && !['sub', 'chan', 'csub'].includes(key) ? null : v;
      save(); renderControls(); after();
    }));
    pick('mood', 'mood', search); pick('shmood', 'shmood', search); pick('gmood', 'gmood', () => (['youtube', 'shorts'].includes(st.gsrc) ? search() : renderResults()));
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
        if (st.tab === 'movies') st.q = v; else if (st.tab === 'shorts') st.sq2 = v; else if (st.tab === 'moments') st.mq = v; else if (st.tab === 'gaming') st.gq = v; else if (st.tab === 'streams') { if (st.smode === 'trending') st.ytq = v; else if (st.smode === 'game') st.sg = v; else st.ch = v; }
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
    const P = (o) => '/api/finder/search?' + new URLSearchParams({ n: '50', ...o, ...qual, ...(showsSort() && st.order === 'new' ? { newest: '1' } : {}) }).toString();
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
    if (st.tab === 'shorts') {
      const m = MOVIE_MOODS.find((x) => x.k === st.shmood), text = (st.sq2 || '').trim();
      if (/^https?:\/\//i.test(text)) return { link: text };
      return { url: P({ source: 'shorts', q: [text, m && m.l.toLowerCase()].filter(Boolean).join(' ') || 'viral' }) };
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
    stopSong();
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
      if (j.note) toast(j.note);
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
    // the YouTube tab never shows Shorts (they have their own tab)
    const noShorts = st.tab === 'movies' && st.msrc === 'youtube';
    return list.filter((x) => x && x.url && !(noShorts && (x.shorts || /#shorts?\b/i.test(x.title || ''))) && !seen.has(x.url) && seen.add(x.url));
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
    if (el.classList.contains('fd-song')) return bindSong(el);
    const th = el.querySelector('.fd-thumb');
    if (th?.dataset.bg) { if (thumbSeen) thumbSeen.observe(th); else th.style.backgroundImage = `url("${th.dataset.bg.replace(/"/g, '%22')}")`; }
    const it = st.items[Number(el.dataset.i)];
    // Add: a video opens its preview first (viral moments, Smart trim, the part or the whole clip); a song or a photo
    // is added right away. A clip already being added / added just shows that.
    el.querySelector('.fd-add').onclick = (e) => {
      e.stopPropagation();
      const job = liveJob(jobKey(it));
      if (playable(it) && !(job && job.status !== 'error')) openPreview(it); else addOne(it);
    };
    el.querySelector('.fd-thumb').onclick = () => openPreview(it);
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
      html += it.audio ? songRow(it, i) : card(it, i);
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
    if (st.loading) { results.innerHTML = songs
      ? `<div class="fd-grid songs">${Array.from({ length: 8 }, (_, k) => `<div class="fd-skel song" style="--d:${k * 60}ms"><i></i><b></b><span></span></div>`).join('')}</div>`
      : `<div class="fd-grid">${Array.from({ length: 12 }, (_, k) => `<div class="fd-skel" style="--d:${k * 45}ms"><i></i><b></b><span></span></div>`).join('')}</div>`; return; }
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
      `<div class="fd-grid${songs ? ' songs' : ''}">${v.list.map((it, k) => (it.audio ? songRow(it, st.items.indexOf(it), k) : card(it, st.items.indexOf(it), k))).join('')}</div><div class="fd-more"></div>`;
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
  // ---------- songs: a list of tracks with their sound wave (no videos), played right in the list ----------
  // The wave is the real one when the song's preview can be read here (free music sites); YouTube songs show
  // a wave shaped from the title until they're played.
  const songAudio = new Audio();
  songAudio.preload = 'none';
  let songNow = null; // { i, el }
  const peaksCache = new Map();
  const seeded = (str, n) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const out = []; for (let k = 0; k < n; k++) { h = Math.imul(h ^ (h >>> 13), 1274126177); const r = ((h >>> 0) % 1000) / 1000; out.push(0.25 + 0.55 * r * (0.6 + 0.4 * Math.sin(k / 5))); } return out; };
  const songPlayUrl = (it) => `/api/finder/stream?audio=1&url=${encodeURIComponent(pageOf(it))}`;
  function songSrc(it) { return it.preview || (st.musrc === 'ytsong' || it.source === 'youtube' ? songPlayUrl(it) : it.url); }
  function songRow(it, i, k = 0) {
    const job = liveJob(jobKey(it));
    const meta = [it.channel, it.license].filter(Boolean).map(esc).join(' · ');
    return `<div class="fd-card fd-song audio ${job ? 'job-' + job.status : ''}" data-i="${i}" style="--d:${Math.min(k, 24) * 18}ms">
      <button class="fd-sp" title="Play here" aria-label="Play ${esc(it.title)}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
      <i class="fd-sart" ${it.thumb ? `data-bg="${esc(it.thumb)}"` : ''}><b>♪</b></i>
      <div class="fd-sinfo"><b title="${esc(it.title)}">${esc(it.title)}</b><small>${meta || SRC_LABEL[it.source] || ''}</small></div>
      <canvas class="fd-swave" title="Click to play from there"></canvas>
      <span class="fd-sdur">${it.duration ? fmtDur(it.duration) : ''}</span>
      <button class="fd-add${job && job.status === 'done' ? ' done' : ''}">${esc(jobLabel(job) || 'Use as song')}</button>
    </div>`;
  }
  function drawSongWave(el) {
    const it = st.items[Number(el.dataset.i)], cv = el.querySelector('.fd-swave'); if (!it || !cv) return;
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (!r.width) return;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, n = Math.max(20, Math.floor(r.width / 3.2));
    const real = peaksCache.get(it.url), isReal = Array.isArray(real), pk = isReal ? resample(real, n) : seeded(it.title + it.url, n);
    const playing = songNow && songNow.el === el, p = playing && songAudio.duration ? songAudio.currentTime / songAudio.duration : -1;
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--tape').trim() || '#ffc933';
    g.clearRect(0, 0, W, H);
    const bw = W / n;
    for (let k = 0; k < n; k++) {
      const h = Math.max(2 * dpr, pk[k] * H * 0.92), x = k * bw;
      g.fillStyle = p >= 0 && k / n <= p ? acc : isReal ? 'rgba(242,240,234,0.55)' : 'rgba(242,240,234,0.22)';
      g.fillRect(x + bw * 0.18, (H - h) / 2, Math.max(1, bw * 0.64), h);
    }
  }
  function resample(a, n) { const out = []; for (let k = 0; k < n; k++) { const s = Math.floor((k / n) * a.length), e = Math.max(s + 1, Math.floor(((k + 1) / n) * a.length)); let m = 0; for (let j = s; j < e; j++) m = Math.max(m, a[j]); out.push(m); } return out; }
  // read a song preview's real wave (two at a time, only for songs on screen)
  let peakBusy = 0; const peakQ = [];
  function wantPeaks(el) {
    const it = st.items[Number(el.dataset.i)];
    if (!it || !it.preview || !/^https:|^\/api\/audio/.test(it.preview) || peaksCache.has(it.url)) return;
    peaksCache.set(it.url, 'busy'); peakQ.push(el); pumpPeaks();
  }
  async function pumpPeaks() {
    while (peakBusy < 2 && peakQ.length) {
      const el = peakQ.shift(), it = st.items[Number(el.dataset.i)];
      if (!it) continue;
      peakBusy++;
      (async () => {
        try {
          const src = it.preview.startsWith('/api/audio?u=') ? decodeURIComponent(it.preview.slice(13)) : it.preview;
          const r = await fetch('/api/peaks?u=' + encodeURIComponent(src)), j = await r.json();
          if (!r.ok || !Array.isArray(j.peaks)) throw new Error(j.error || 'no wave');
          peaksCache.set(it.url, j.peaks);
        } catch { peaksCache.set(it.url, 'fail'); }
        peakBusy--; if (el.isConnected) drawSongWave(el); pumpPeaks();
      })();
    }
  }
  const songSeen = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting) { songSeen.unobserve(en.target); const art = en.target.querySelector('.fd-sart'); if (art?.dataset.bg) art.style.backgroundImage = `url("${art.dataset.bg.replace(/"/g, '%22')}")`; drawSongWave(en.target); wantPeaks(en.target); }
  }, { root: results, rootMargin: '300px 0px' }) : null;
  function bindSong(el) {
    const it = st.items[Number(el.dataset.i)];
    if (songSeen) songSeen.observe(el); else requestAnimationFrame(() => drawSongWave(el));
    el.querySelector('.fd-add').onclick = (e) => { e.stopPropagation(); addOne(it); };
    el.querySelector('.fd-sp').onclick = () => playSong(el);
    el.querySelector('.fd-swave').addEventListener('pointerdown', (e) => {
      const r = e.currentTarget.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (!songNow || songNow.el !== el) playSong(el, f); else if (songAudio.duration) songAudio.currentTime = f * songAudio.duration;
    });
  }
  function stopSong() {
    if (!songNow) return;
    const was = songNow.el; clearTimeout(songNow.timer); songNow = null;
    try { songAudio.pause(); } catch {}
    was.classList.remove('playing', 'loading');
    was.querySelector('.fd-sp').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    drawSongWave(was);
  }
  function playSong(el, at = 0) {
    const it = st.items[Number(el.dataset.i)]; if (!it) return;
    if (songNow && songNow.el === el) { if (songAudio.paused) songAudio.play().catch(() => {}); else songAudio.pause(); return; }
    stopSong();
    songNow = { el };
    el.classList.add('playing', 'loading');
    songAudio.src = songSrc(it);
    songAudio.volume = Number(localStorage.getItem('cutsona.pvVol') || 0.8);
    songAudio.onloadedmetadata = () => { if (at > 0 && songAudio.duration) songAudio.currentTime = at * songAudio.duration; };
    el.querySelector('.fd-serr')?.remove();
    songAudio.onplaying = () => { el.classList.remove('loading'); clearTimeout(songNow?.timer); };
    const fail = async (why) => {
      if (songNow?.el !== el) return;
      stopSong();
      // ask Cutsona why (deleted, private, age-restricted, blocked…)
      if (!why && !it.preview) { try { const r = await fetch(songPlayUrl(it) + '&check=1'), j = await r.json(); if (!r.ok) why = j.error; } catch {} }
      why = why || 'The site didn’t send it (it may be deleted or moved).';
      el.classList.add('cant');
      el.querySelector('.fd-sinfo').insertAdjacentHTML('beforeend', `<em class="fd-serr" title="${esc(why)}">Can’t play: ${esc(why)}</em>`);
      toast(`“${it.title}” can’t play: ${why}`, true);
    };
    songAudio.onerror = () => fail('');
    songNow.timer = setTimeout(() => { if (songNow?.el === el && songAudio.paused && songAudio.readyState < 3) fail('It took too long to start: the site may be slow or blocking it.'); }, 25000);
    songAudio.play().catch(() => {});
  }
  songAudio.addEventListener('play', () => { if (songNow) songNow.el.querySelector('.fd-sp').innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'; });
  songAudio.addEventListener('pause', () => { if (songNow) songNow.el.querySelector('.fd-sp').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; });
  songAudio.addEventListener('timeupdate', () => { if (songNow && songNow.el.isConnected) drawSongWave(songNow.el); });
  songAudio.addEventListener('ended', stopSong);

  function card(it, i, k = 0) {
    const job = liveJob(jobKey(it));
    const long = it.source === 'youtube' && it.duration > 600;
    const meta = [it.license || it.channel, it.moment ? 'at ' + fmtDur(it.start) : '', it.views != null ? fmtViews(it.views) : '', it.game, it.via ? 'via ' + it.via : ''].filter(Boolean).map(esc).join(', ');
    return `<div class="fd-card ${job ? 'job-' + job.status : ''} ${it.audio ? 'audio' : ''}" data-i="${i}" style="--d:${Math.min(k, 24) * 22}ms">
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
      <div class="fd-actions"><button class="fd-add${job && job.status === 'done' ? ' done' : ''}">${esc(jobLabel(job) || (it.audio ? 'Use as song' : 'Add'))}</button></div>
    </div>`;
  }

  async function addOne(item, extra = {}) {
    const whole = item.moment && extra.start == null; // a moment card: just its exact seconds
    if (whole) extra = { ...extra, start: item.start, end: item.end };
    const picker = pickSession;
    if (picker) {
      if (picker.busy) return;
      picker.busy = true;
      try {
        const maxRes = item.res === '4K' || (st.quality === '4k' && showsQuality()) ? 2160 : undefined;
        await picker.onPick({ ...item, ...extra, audio: songs || !!item.audio, maxRes });
        if (pickSession === picker) close();
      } catch (e) { toast(e.message, true); }
      finally { picker.busy = false; }
      return;
    }
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
        await grabSong({ url: item.url, title: item.title || null, duration: item.duration, source: item.source, channel: item.channel, license: item.license, page: item.page, ...extra }, (upd) => { Object.assign(job, upd, { audio: true }); rerender(); });
        job.status = 'done'; rerender();
      } catch (e) { job.status = 'error'; job.phase = e.message; job.error = e.message; rerender(); toast(e.message, true); }
      return;
    }
    try {
      // 4K videos (or anything picked while "4K only" is on) download in 4K
      const maxRes = item.res === '4K' || (st.quality === '4k' && showsQuality()) ? 2160 : undefined;
      await grab({ url: item.url, photo: !!item.photo, title: item.title ? (item.moment && item.channel ? `${item.channel}: ${item.title.length > 60 ? item.title.slice(0, 60).replace(/\s+\S*$/, '') + '…' : item.title}` : `${item.title}${item.source === 'yarn' && item.channel ? ': ' + item.channel : ''}`) : null, duration: item.duration, maxRes,
        source: item.source, channel: item.channel, page: item.page, views: item.views, license: item.license, moment: !!item.moment, ...extra }, (upd) => {
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
        const jobCls = () => [...el.classList].filter((c) => c.startsWith('job-')).forEach((c) => el.classList.remove(c));
        if (job) { b.textContent = jobLabel(job); b.classList.toggle('done', job.status === 'done'); jobCls(); el.classList.add('job-' + job.status); }
        else if (it && b.classList.contains('done')) { b.textContent = it.audio ? 'Use as song' : 'Add'; b.classList.remove('done'); jobCls(); }
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

  // ---------- preview: Cutsona's own player, search inside the video, pick any part of any length ----------
  // Lengths you can pick with one click. Click a length to use it, "+ Save" keeps the length you typed,
  // right-click (or ×) removes one. Kept on this PC.
  const LEN_KEY = 'cutsona.partLens';
  let partLens = [5, 10, 15, 30, 60];
  try { const v = JSON.parse(localStorage.getItem(LEN_KEY) || 'null'); if (Array.isArray(v) && v.every((x) => x > 0)) partLens = v; } catch {}
  // 30 seconds is always a choice (the most-used length for Shorts / Reels / TikTok)
  const KEEP_LENS = [30];
  for (const k of KEEP_LENS) if (!partLens.includes(k)) partLens = [...partLens, k].sort((x, y) => x - y);
  const saveLens = () => { try { localStorage.setItem(LEN_KEY, JSON.stringify(partLens)); } catch {} };
  const lenName = (s) => (s >= 60 && s % 60 === 0 ? `${s / 60}m` : s >= 60 ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s` : `${+s.toFixed(1)}s`);
  let pv = null; // the open preview: { it, video, words, sents, a, b, len, smart, hits }
  // the page a video lives on (what yt-dlp and the caption reader understand)
  const pageOf = (it) => (it.source === 'youtube' && it.id ? `https://www.youtube.com/watch?v=${it.id}` : /^https?:\/\//i.test(it.page || '') ? it.page : it.url);
  const playable = (it) => !it.audio && !it.photo;
  function playUrl(it) {
    if (it.source === 'twitch' || it.source === 'kick') return `/api/finder/hover?url=${encodeURIComponent(it.url)}&full=1`;
    if (it.direct) return it.preview || it.url;
    return `/api/finder/stream?url=${encodeURIComponent(pageOf(it))}`;
  }

  async function openPreview(it) {
    closePreview(false, !!(it.edit && editing?.id === it.edit));
    preview.hidden = false;
    const long = it.source === 'youtube' && it.duration > 600;
    if (!playable(it)) return openSimplePreview(it);
    const words = true; // every video gets "Find a part": captions when it has them, otherwise Cutsona listens to it
    const len0 = Math.min(partLens.includes(15) ? 15 : partLens[0] || 15, it.duration || 15);
    pv = { it, words: null, sents: [], a: it.moment ? it.start : 0, b: it.moment ? it.end : len0, len: it.moment ? it.end - it.start : len0, smart: true, hits: [], q: '', pick: it.moment ? null : len0 };
    // a clip from your clip list: its own part, and nothing is picked for you
    if (it.edit) { pv.a = it.part[0]; pv.b = it.part[1]; pv.len = pv.b - pv.a; pv.touched = true; pv.pick = null; }
    preview.innerHTML = `<div class="fd-pv big ${words ? 'with-side' : ''}">
      ${fileTabs.length ? tabsHtml() : ''}
      <div class="fd-pv-h"><span class="fd-src ${it.edit ? 'clip' : it.shorts ? 'shorts' : it.moment ? 'moment' : esc(it.source)}">${it.edit ? 'Your clip' : it.shorts ? 'Shorts' : it.moment ? 'Moment' : SRC_LABEL[it.source] || esc(it.source)}</span>
        <b title="${esc(it.title)}">${esc(it.title)}</b><span class="fd-pv-dur">${it.duration ? fmtDur(it.duration) : ''}</span><button class="small fd-pv-x">Close</button></div>
      <div class="fd-pv-body">
        <div class="fd-pv-main">
          <div class="fd-pv-video">
            <video class="fd-v" playsinline preload="auto" poster="${esc(it.thumb || '')}"></video>
            <div class="fd-pv-load"><div class="spinner"></div><span>Opening in the Cutsona player…</span><small>The first time, Cutsona gets a copy of the video: a few seconds</small></div>
            <button class="fd-bigplay" aria-label="Play" hidden><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
          </div>
          <div class="fd-pv-bar">
            <button class="fd-ctl fd-c-play" title="Play / pause (Space)" aria-label="Play or pause"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
            <span class="fd-c-time">0:00.0</span>
            <div class="fd-scrub" title="Click or drag to move around the video">
              <canvas class="fd-s-heat" aria-hidden="true"></canvas><div class="fd-s-vm"></div>
              <div class="fd-s-buf"></div><div class="fd-s-range"><i class="fd-h a" title="Drag to move the start"></i><i class="fd-h b" title="Drag to move the end"></i></div><div class="fd-s-marks"></div><div class="fd-s-played"></div><div class="fd-s-head"></div>
              <div class="fd-s-tip" hidden></div>
            </div>
            <span class="fd-c-dur">${it.duration ? fmtDur(it.duration) : ''}</span>
            <button class="fd-ctl fd-c-back" title="Back 5 seconds (←)" aria-label="Back 5 seconds"><svg viewBox="0 0 24 24"><path d="M11 6 5 12l6 6M19 6l-6 6 6 6"/></svg></button>
            <button class="fd-ctl fd-c-fwd" title="Forward 5 seconds (→)" aria-label="Forward 5 seconds"><svg viewBox="0 0 24 24"><path d="m13 6 6 6-6 6M5 6l6 6-6 6"/></svg></button>
            <select class="fd-c-rate" title="Speed" aria-label="Playback speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
            <button class="fd-ctl fd-c-mute" title="Sound on / off (M)" aria-label="Mute"><svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path class="w" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg></button>
            <input class="fd-c-vol" type="range" min="0" max="1" step="0.05" value="${localStorage.getItem('cutsona.pvVol') || 0.8}" aria-label="Volume">
          </div>
          ${it.audio ? '' : `<div class="fd-part">
            <div class="fd-fine" title="Fine trim: a close-up of the part. Drag its edges or the part itself to the exact frame">
              <button class="fd-ctl fd-fine-play" title="Play just the part (P)" aria-label="Play the part"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
              <span class="fd-fine-t0">0:00.0</span>
              <div class="fd-fine-bar"><canvas class="fd-fine-heat" aria-hidden="true"></canvas><div class="fd-fine-ticks"></div>
                <div class="fd-fine-part"><i class="fd-fh a" title="Drag: the exact start"></i><span class="fd-fine-len"></span><i class="fd-fh b" title="Drag: the exact end"></i></div><div class="fd-fine-head"></div></div>
              <span class="fd-fine-t1">0:00.0</span>
              <label class="fd-check fd-loop" title="While the part plays, it starts over at its end, so you can watch it again and again while you trim"><input type="checkbox" checked> Loop part</label>
            </div>
            <div class="fd-part-row">
              <button class="fd-mark fd-m-in" title="Start the part here (I)"><small>Start</small><b class="fd-in">0:00.0</b></button>
              <button class="fd-mark fd-m-out" title="End the part here (O)"><small>End</small><b class="fd-out">0:00.0</b></button>
              <label class="fd-lenin"><small>Length</small><span><input type="number" class="fd-len" min="0.5" step="0.5" value="${pv.len.toFixed(1)}">s</span></label>
              <div class="fd-lens" title="Click a length to use it. Right-click to remove one."></div>
              <label class="fd-check fd-smart" title="Start at the beginning of a sentence and end where a sentence ends, close to your length (needs the video's captions)"><input type="checkbox" checked> Smart edges</label>
            </div>
            <div class="fd-part-row fd-trimrow">
              <button class="small fd-smarttrim" title="Smart trim: the most viral part of this length (a hook at the start, a payoff at the end, whole sentences). Press again for the next best"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 7.9 20 18M8.1 16.1 20 6"/></svg>Smart trim</button>
              <span class="fd-pscore" hidden></span>
              <span class="fd-pwhy"></span>
            </div>
            <div class="fd-part-row">
              <button class="primary fd-pv-addpart">+ Add this part</button>
              <button class="small fd-pv-add">${it.edit ? 'Use the whole clip' : it.file ? '+ Add the whole video' : it.moment ? `+ Add this moment (${it.duration.toFixed(1)}s)` : pickSession?.wholeVideo ? 'Use whole video' : long ? '+ Add best 90s' : '+ Add whole clip'}</button>
              <button class="small fd-revert" title="${it.edit ? 'Back to the original video: the whole clip, nothing trimmed or cut out, its sound back to normal' : 'Back to the original video: the whole thing, nothing trimmed, normal speed'}">↺ Revert to original</button>
              <span class="fd-part-note"></span>
              ${/^https?:\/\//i.test(it.page || '') ? `<a class="small fd-open" href="${esc(it.page)}" target="_blank" rel="noopener noreferrer">Open on ${SRC_LABEL[it.source] || 'site'}</a>` : ''}
            </div>
          </div>`}
        </div>
        ${words ? `<aside class="fd-pv-side${it.edit ? ' tabbed' : ''}">
          ${it.edit ? '<div class="fd-stabs" role="tablist"><button role="tab" class="on" data-stab="find">Viral &amp; words</button><button role="tab" data-stab="sound">Sound</button></div><div class="fd-sound" hidden></div>' : ''}
          <div class="fd-vr">
            <div class="fd-vr-h"><b>Viral moments <button class="fd-vr-q" title="What the fire and the number mean">?</button></b><span class="fd-vr-st"><i class="spin"></i>Watching the whole video…</span></div>
            <div class="fd-vr-list"></div>
          </div>
          <div class="fd-ps-h"><b>Find a part</b><small>search what’s said · <span class="vw2">lit words</span> are the likeliest to go viral</small></div>
          <div class="fd-ps-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input type="text" class="fd-ps-q" placeholder="A word or a line: e.g. “never give up”" spellcheck="false"><span class="fd-ps-n"></span></div>
          <div class="fd-ps-list"><div class="fd-empty small"><div class="spinner"></div>Reading what’s said…<small>No captions? Cutsona listens to it instead: that takes about a minute.</small></div></div>
        </aside>` : ''}
      </div></div>`;
    bindPreview();
    // nothing can be touched until the video is there (its length decides the part, the bar, the lengths)
    const pvBox = $('.fd-pv', preview); pvBox.classList.add('pv-wait');
    const ready = () => pvBox.classList.remove('pv-wait');
    const v = pv.video = $('.fd-v', preview);
    // the preview playing: the takes behind it stop (one sound at a time, and the computer's power for this one)
    v.addEventListener('play', () => window.dispatchEvent(new CustomEvent('cutsona:preview-play')));
    v.volume = Number(localStorage.getItem('cutsona.pvVol') || 0.8);
    let triedFallback = false;
    v.addEventListener('error', async () => {
      if (!pv || triedFallback) return;
      triedFallback = true;
      let why = '';
      try { const r = await fetch(`/api/finder/stream?check=1&url=${encodeURIComponent(pageOf(it))}`), j = await r.json(); if (!r.ok) why = j.error || ''; } catch {}
      if (!pv || pv.it !== it) return;
      // no direct stream: YouTube's own player, zoomed so its logo, title and buttons sit outside the picture
      if (it.source === 'youtube' && it.id) {
        const box = $('.fd-pv-video', preview);
        box.classList.add('yt-fallback');
        box.insertAdjacentHTML('beforeend', `<div class="fd-yt-crop"><iframe referrerpolicy="strict-origin-when-cross-origin" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(it.id)}?autoplay=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&modestbranding=1&playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}&start=${Math.floor(pv.a)}" allow="autoplay; encrypted-media"></iframe></div>`);
        $('.fd-pv-load', preview).hidden = true; ready();
        $('.fd-part-note', preview).textContent = `Couldn’t open it in the Cutsona player${why ? ` (${why})` : ''}: showing YouTube’s. Pick the part with Start, End and Length.`;
      } else {
        $('.fd-pv-load', preview).innerHTML = `<span>This video can’t play here.${why ? ` ${esc(why)}` : ''}</span>${/^https?:\/\//i.test(it.page || '') ? `<a class="small" href="${esc(it.page)}" target="_blank" rel="noopener noreferrer">Watch on ${SRC_LABEL[it.source] || 'site'}</a>` : ''}`;
      }
    });
    v.addEventListener('loadedmetadata', () => {
      if (!pv) return;
      $('.fd-pv-load', preview).hidden = true; ready();
      if (Number.isFinite(v.duration)) {
        // a video that's still arriving (Kick / Twitch clips stream in pieces) first says it's only a few seconds
        // long: the length the site gave counts until the video itself knows better
        const D = Math.max(v.duration, it.duration || 0);
        $('.fd-c-dur', preview).textContent = fmtDur(D); pv.dur = D;
        // a part can't run past the end of the video
        if (pv.b > D) { pv.b = D; pv.a = Math.min(pv.a, Math.max(0, pv.b - 0.5)); pv.len = pv.b - pv.a; }
        drawMarks();
      }
      if (pv.a > 0) v.currentTime = pv.a;
      v.play().catch(() => { $('.fd-bigplay', preview).hidden = false; });
      drawPart();
    });
    // the real length, once more of it has arrived
    v.addEventListener('durationchange', () => {
      if (!pv || !Number.isFinite(v.duration) || v.duration <= (pv.dur || 0) + 0.05) return;
      pv.dur = v.duration; $('.fd-c-dur', preview).textContent = fmtDur(v.duration);
      drawMarks(); drawPart(); if (pv.va) renderViral();
    });
    v.src = playUrl(it);
    if (it.edit) {
      // your clip: its words and its viral scan are already known; its sound settings are right here
      if (it.words?.length) { pv.words = it.words; pv.sents = sentencesOf(it.words); pv.from = 'speech'; renderHits(); }
      else if (/^https:\/\//i.test(it.page || '')) loadWords(it);
      editing?.sound?.($('.fd-sound', preview));
      if (it.scan) scans.set(`e:${it.edit}`, it.scan);
    } else if (words && !it.file) loadWords(it);
    startScan(it);
  }
  // songs and photos: the simple window
  function openSimplePreview(it) {
    preview.innerHTML = `<div class="fd-pv">
      <div class="fd-pv-h"><b>${esc(it.title)}</b><button class="small fd-pv-x">Close</button></div>
      <div class="fd-pv-video">${it.audio
        ? `<div class="fd-pv-audio" style="background-image:url('${esc(it.thumb || '')}')"><div class="fd-pv-note">♪</div><audio src="${esc(it.preview || it.url)}" controls autoplay preload="auto"></audio></div>`
        : `<img class="fd-pv-img" src="${esc(it.url)}" alt="">`}</div>
      <div class="fd-pv-actions">
        ${/^https?:\/\//i.test(it.page || '') ? `<a class="small" href="${esc(it.page)}" target="_blank" rel="noopener noreferrer">Open on ${SRC_LABEL[it.source] || 'site'}</a>` : ''}
        <button class="primary fd-pv-add">${it.audio ? '♪ Use as song' : '+ Add photo as clip'}</button>
      </div></div>`;
    $('.fd-pv-x', preview).onclick = closePreview;
    preview.onclick = (e) => { if (e.target === preview) closePreview(); };
    $('.fd-pv-add', preview).onclick = () => { addOne(it); closePreview(); };
  }

  async function loadWords(it) {
    const list = () => $('.fd-ps-list', preview);
    try {
      const r = await fetch('/api/transcript?url=' + encodeURIComponent(pageOf(it)));
      const j = await r.json();
      if (!pv || pv.it !== it) return;
      if (!r.ok) throw new Error(j.error || 'No captions');
      // a moment cut from a longer video: the times are already the video's own
      pv.words = j.words || []; pv.sents = sentencesOf(pv.words); pv.from = j.source;
      if (!pv.sents.length) throw new Error('This video has no captions to read.');
      renderHits();
      if (pv.smart) { applySmart(); drawPart(); }
    } catch (e) {
      if (!pv || pv.it !== it) return;
      pv.words = []; pv.sents = [];
      list().innerHTML = `<div class="fd-empty small">${esc(e.message)}<br><small>You can still pick a part by its time.</small></div>`;
      $('.fd-ps-q', preview).disabled = true;
    }
  }
  // the transcript, with the lines that match the search marked (or just the matches, when searching)
  function renderHits() {
    const box = $('.fd-ps-list', preview); if (!box || !pv) return;
    const q = pv.q.trim();
    pv.hits = q ? searchSentences(pv.sents, q) : [];
    const n = $('.fd-ps-n', preview);
    n.textContent = q ? (pv.hits.length ? `${pv.hits.length} found` : 'not said') : `${pv.sents.length} lines${pv.from === 'speech' ? ', heard' : ''}`;
    const rows = q ? pv.hits.map((h) => h.s) : pv.sents;
    const vs = pv.va?.sents, vOf = (s) => vs?.find((x) => Math.abs(x.start - s.start) < 0.01);
    box.innerHTML = rows.length ? rows.map((s) => { const x = !q && vOf(s); return `<button class="fd-line${x && x.viral >= 0.6 ? ' hot' : ''}" data-t="${s.start}" data-e="${s.end}"${x ? ` title="Viral: ${Math.round(x.viral * 100)}/100${x.kinds.filter((k) => k !== 'you').length ? ` (${x.kinds.filter((k) => k !== 'you').join(', ')})` : ''}"` : ''}><span class="fd-lt">${fmtT(s.start)}</span><span class="fd-lx">${x ? sentenceHtml(x, esc) : markWords(s.text, q)}</span><span class="fd-luse" data-use title="Make this line the part">Use</span></button>`; }).join('')
      : `<div class="fd-empty small">Nobody says “${esc(q)}” in this video.</div>`;
    drawMarks();
  }
  function drawMarks() {
    const m = $('.fd-s-marks', preview); if (!m || !pv) return;
    const D = pv.dur || pv.it.duration || 0;
    m.innerHTML = D ? pv.hits.map((h) => `<i style="left:${(h.at / D) * 100}%"></i>`).join('') : '';
  }
  function applySmart() {
    if (!pv.smart || !pv.sents.length) return;
    pv.a = smartStart(pv.sents, pv.a);
    pv.b = smartEnd(pv.sents, pv.a, pv.len);
  }
  // a part of about L seconds from the start you have; when it would run past the end of the video, it slides back
  // so it still gets its whole length (never longer than the video)
  function fitPart(L) {
    const D = pv.dur || pv.it.duration || Infinity, sm = pv.smart && pv.sents.length;
    L = Math.max(0.5, Math.min(L, D));
    pv.len = L;
    let b = sm ? smartEnd(pv.sents, pv.a, L) : pv.a + L;
    if (b > D) {
      pv.a = Math.max(0, D - L);
      if (sm) { const a2 = smartStart(pv.sents, pv.a); if (a2 <= pv.a + 0.5) pv.a = a2; }
      b = sm ? Math.min(D, smartEnd(pv.sents, pv.a, L)) : Math.min(D, pv.a + L);
    }
    pv.b = Math.max(pv.a + 0.5, Math.min(D, b));
  }
  // with no words to follow, a part's edges land on a shot change when one is close (a clean cut, not mid-shot)
  const snapCut = (t) => { const cs = pv?.scan?.cuts; if (!pv.smart || pv.sents.length || !cs?.length) return t; let b = t, bd = 0.6; for (const c of cs) { const d = Math.abs(c - t); if (d < bd) { bd = d; b = c; } } return b; };
  function setStart(t, keepLen = true) {
    const D = pv.dur || pv.it.duration || Infinity;
    pv.touched = true;
    pv.a = Math.max(0, Math.min(D - 0.5, snapCut(t)));
    if (pv.smart && pv.sents.length) { const a2 = smartStart(pv.sents, pv.a); if (Math.abs(a2 - pv.a) < 3 && a2 < D - 0.5) pv.a = a2; }
    pv.b = keepLen ? (pv.smart && pv.sents.length ? smartEnd(pv.sents, pv.a, pv.len) : pv.a + pv.len) : Math.max(pv.b, pv.a + 0.5);
    if (pv.b > D) { pv.b = D; pv.pick = null; } // (too close to the end for the whole length: the part ends with the video)
    drawPart();
  }
  function setEnd(t) {
    const D = pv.dur || pv.it.duration || Infinity;
    pv.touched = true;
    pv.b = Math.max(pv.a + 0.5, Math.min(D, snapCut(t)));
    if (pv.smart && pv.sents.length) {
      // end after the word being said (not in the middle of it)
      const w = pv.words.find((x) => x.start <= pv.b && x.end >= pv.b - 0.05);
      if (w) pv.b = Math.min(D, w.end + 0.2);
    }
    pv.len = pv.b - pv.a; pv.pick = null;
    drawPart();
  }
  function drawPart() {
    if (!pv || !preview.querySelector('.fd-part')) return;
    const L = pv.b - pv.a;
    $('.fd-in', preview).textContent = fmtT(pv.a);
    $('.fd-out', preview).textContent = fmtT(pv.b);
    const li = $('.fd-len', preview); if (document.activeElement !== li) li.value = (+L.toFixed(1)).toString();
    const job = pv.jobKey && st.jobs.get(pv.jobKey);
    if (pv.it.edit) {
      const [ca, cb] = editing?.part?.() || [NaN, NaN], same = Math.abs(ca - pv.a) < 0.06 && Math.abs(cb - pv.b) < 0.06;
      $('.fd-pv-addpart', preview).textContent = same ? `✓ The clip plays ${fmtT(pv.a)}–${fmtT(pv.b)}` : `Use ${fmtT(pv.a)}–${fmtT(pv.b)} (${lenName(L)})`;
    } else $('.fd-pv-addpart', preview).textContent = job && job.status !== 'error'
      ? (job.status === 'done' ? `✓ Added ${fmtT(pv.ja)}–${fmtT(pv.jb)}` : `${job.pct > 0 ? `Downloading ${Math.round(job.pct)}%` : `${job.phase || 'Starting'}…`}`)
      : `+ Add ${fmtT(pv.a)}–${fmtT(pv.b)} (${lenName(L)})`;
    // every length: how viral its best part is (the best length is marked), and the whole clip
    const D0 = pv.dur || pv.it.duration || 0, LB = pv.lenBest || {}, bestL = pv.bestLen;
    const isWhole = D0 && pv.a < 0.15 && pv.b > D0 - 0.15;
    $('.fd-lens', preview).innerHTML = partLens.filter((s) => !D0 || s < D0 - 0.5).map((s) => `<button class="chip${KEEP_LENS.includes(s) ? ' keep' : ''}${!isWhole && (pv.pick != null ? pv.pick === s : Math.abs(s - (pv.b - pv.a)) < 0.05) ? ' on' : ''}${s === bestL ? ' best' : ''}" data-len="${s}" title="${LB[s] ? `The most viral ${lenName(s)} part scores ${LB[s].score}${s === bestL ? ': the best length for this video' : ''}. Smart trim jumps to it` : ''}">${lenName(s)}${LB[s] ? `<small class="${scoreColor(LB[s].score)}">${LB[s].score}</small>` : ''}<i data-rmlen="${s}" title="Remove">×</i></button>`).join('')
      + (D0 ? `<button class="chip${isWhole ? ' on' : ''}" data-len="whole" title="The whole video, start to end">Whole clip ${fmtDur(D0)}${pv.wholeScore != null ? `<small class="${scoreColor(pv.wholeScore)}">${pv.wholeScore}</small>` : ''}</button>` : '')
      + `<button class="chip ghosty fd-savelen" title="Keep the length you typed as a button">+ Save ${lenName(L)}</button>`;
    const D = pv.dur || pv.it.duration || 0;
    const rg = $('.fd-s-range', preview);
    if (D) { const x0 = Math.min(1, pv.a / D), x1 = Math.min(1, pv.b / D); Object.assign(rg.style, { left: `${x0 * 100}%`, width: `${Math.max(0, x1 - x0) * 100}%` }); }
    if (pv.va) {
      const r = scorePart(pv.va.analysis, pv.a, pv.b), ps = $('.fd-pscore', preview);
      ps.hidden = false; ps.className = `fd-pscore ${scoreColor(r.score)}`; ps.innerHTML = `${FLAME}${r.score}<small>viral</small>`;
      ps.title = `How likely this part is to go viral: ${r.score}/100`;
      $('.fd-pwhy', preview).textContent = r.why.join(' · ');
    }
    const sm = $('.fd-smart', preview);
    sm.classList.toggle('dim', !pv.sents.length);
    sm.title = pv.sents.length ? 'Start at the beginning of a sentence and end where a sentence ends, close to your length'
      : 'Needs the video’s captions: this one has none, so parts start and end exactly where you put them';
    const rv = $('.fd-revert', preview);
    if (rv) rv.disabled = !!isWhole && (!pv.it.edit || !editing?.changed?.()) && (!pv.video || pv.video.playbackRate === 1);
    drawFine();
  }
  // ---- fine trim: a close-up bar around the part (the part plus some time on each side) for exact edges ----
  // It stays where it is (so the part doesn't jump around under your mouse) while the part fits in it nicely;
  // only a part that left it, or got much shorter / longer, gets a new close-up centred on it.
  function fineWindow() {
    if (pv.fineLock) return pv.fineLock; // (while you drag in it: fixed, it only scrolls at its ends)
    const D = pv.dur || pv.it.duration || Math.max(pv.b, 1), L = pv.b - pv.a, w = pv.fineWin;
    if (w && w[1] <= D + 0.01 && pv.a >= w[0] - 0.01 && pv.b <= w[1] + 0.01 && L >= (w[1] - w[0]) * 0.15 && L <= (w[1] - w[0]) * 0.82) return w;
    const W = Math.min(D, Math.max(6, L * 2.2)), c = (pv.a + pv.b) / 2;
    const w0 = Math.max(0, Math.min(D - W, c - W / 2));
    return (pv.fineWin = [w0, w0 + W]);
  }
  function drawFine() {
    const box = $('.fd-fine', preview); if (!box || !pv) return;
    const [w0, w1] = fineWindow(), W = Math.max(1e-6, w1 - w0), pc = (t) => `${((t - w0) / W) * 100}%`;
    $('.fd-fine-t0', preview).textContent = fmtT(w0); $('.fd-fine-t1', preview).textContent = fmtT(w1);
    // (the part is drawn only inside the bar: a side past the bar's end shows as an open end, no handle)
    const part = $('.fd-fine-part', preview), l = Math.max(0, (pv.a - w0) / W), r = Math.min(1, (pv.b - w0) / W);
    part.hidden = r <= 0 || l >= 1;
    part.style.left = `${l * 100}%`; part.style.width = `${Math.max(0, r - l) * 100}%`;
    part.classList.toggle('open-l', pv.a < w0 - 0.01); part.classList.toggle('open-r', pv.b > w1 + 0.01);
    $('.fd-fine-len', preview).textContent = `${(pv.b - pv.a).toFixed(1)}s`;
    const key = `${w0.toFixed(2)}|${w1.toFixed(2)}|${pv.va ? 1 : 0}|${pv.sents.length}|${pv.scan?.cuts?.length || 0}`;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    // what's around the part: how viral each moment is (heat), where lines start (white ticks), shot changes (blue)
    const cv = $('.fd-fine-heat', preview), A = pv.va;
    const w = cv.clientWidth || 500, dpr = devicePixelRatio || 1; cv.width = Math.round(w * dpr); cv.height = Math.round(22 * dpr);
    const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
    if (A?.curve?.length) {
      for (let x = 0; x < cv.width; x++) {
        const t = w0 + (x / cv.width) * W, v = A.curve[Math.min(A.curve.length - 1, Math.max(0, Math.floor(t / A.step)))] || 0;
        g.fillStyle = v > 0.7 ? `rgba(255,77,77,${0.25 + v * 0.35})` : v > 0.5 ? `rgba(255,150,60,${0.18 + v * 0.3})` : v > 0.32 ? `rgba(255,214,90,${0.1 + v * 0.25})` : `rgba(255,255,255,${0.03 + v * 0.08})`;
        const hgt = Math.max(2, v * cv.height); g.fillRect(x, cv.height - hgt, 1, hgt);
      }
    }
    const ticks = [];
    for (const s of pv.sents) if (s.start >= w0 && s.start <= w1) ticks.push(`<i class="ln" style="left:${pc(s.start)}" title="A line starts: “${esc(s.text.slice(0, 60))}”"></i>`);
    for (const c of pv.scan?.cuts || []) if (c >= w0 && c <= w1) ticks.push(`<i class="cut" style="left:${pc(c)}" title="Shot change at ${fmtT(c)}"></i>`);
    $('.fd-fine-ticks', preview).innerHTML = ticks.join('');
  }
  function fineHead() {
    const h = $('.fd-fine-head', preview); if (!h || !pv?.video) return;
    const [w0, w1] = fineWindow(), t = pv.video.currentTime || 0;
    h.hidden = t < w0 || t > w1; h.style.left = `${((t - w0) / Math.max(1e-6, w1 - w0)) * 100}%`;
  }
  function bindPreview() {
    const it = pv.it;
    $('.fd-pv-x', preview).onclick = () => closePreview(true);
    preview.onclick = (e) => { if (e.target === preview) closePreview(true); };
    const add = $('.fd-pv-add', preview); if (add) add.onclick = () => { if (it.edit) { const D = pv.dur || it.duration || 0; pv.a = 0; pv.b = D; pv.len = D; editing?.setPart(0, D); drawPart(); return; } if (it.file) return fileAdd(it, null); addOne(it); closePreview(); };
    const v = () => pv?.video;
    const toggle = () => { const el = v(); if (!el) return; if (el.paused) el.play().catch(() => {}); else el.pause(); };
    $('.fd-c-play', preview).onclick = toggle;
    $('.fd-bigplay', preview).onclick = () => { $('.fd-bigplay', preview).hidden = true; v()?.play().catch(() => {}); };
    $('.fd-pv-video', preview).addEventListener('click', (e) => { if (e.target.matches('video')) toggle(); });
    $('.fd-c-back', preview).onclick = () => { if (v()) v().currentTime = Math.max(0, v().currentTime - 5); };
    $('.fd-c-fwd', preview).onclick = () => { if (v()) v().currentTime = v().currentTime + 5; };
    $('.fd-c-rate', preview).onchange = (e) => { if (v()) v().playbackRate = Number(e.target.value); drawPart(); };
    const vol = $('.fd-c-vol', preview);
    vol.oninput = () => { if (!v()) return; v().volume = Number(vol.value); v().muted = false; try { localStorage.setItem('cutsona.pvVol', vol.value); } catch {} };
    $('.fd-c-mute', preview).onclick = () => { if (v()) v().muted = !v().muted; };
    // scrubber: click or drag to move; the time under the pointer shows above it
    const sc = $('.fd-scrub', preview), tip = $('.fd-s-tip', preview);
    const tAt = (e) => { const r = sc.getBoundingClientRect(), D = pv.dur || it.duration || 0; return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * D; };
    let dragging = false;
    sc.addEventListener('pointerdown', (e) => { dragging = true; sc.setPointerCapture(e.pointerId); if (v()) v().currentTime = tAt(e); });
    sc.addEventListener('pointermove', (e) => {
      const t = tAt(e), r = sc.getBoundingClientRect();
      tip.hidden = false; tip.textContent = fmtT(t); tip.style.left = `${e.clientX - r.left}px`;
      if (dragging && !(e.buttons & 1)) dragging = false; // the button was let go somewhere we didn't hear about
      if (dragging && v()) v().currentTime = t;
    });
    sc.addEventListener('pointerleave', () => { tip.hidden = true; });
    const stop = () => { dragging = false; };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) sc.addEventListener(ev, stop);
    window.addEventListener('pointerup', stop);
    if (preview.querySelector('.fd-part')) {
      $('.fd-m-in', preview).onclick = () => setStart(v() ? v().currentTime : pv.a);
      $('.fd-m-out', preview).onclick = () => setEnd(v() ? v().currentTime : pv.b);
      const lenIn = $('.fd-len', preview);
      lenIn.addEventListener('change', () => { const L = Number(lenIn.value); if (L > 0) { pv.touched = true; pv.pick = L; fitPart(L); drawPart(); } });
      lenIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') lenIn.blur(); });
      const lens = $('.fd-lens', preview);
      lens.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rmlen]');
        if (rm) { e.stopPropagation(); if (KEEP_LENS.includes(Number(rm.dataset.rmlen))) return; partLens = partLens.filter((x) => String(x) !== rm.dataset.rmlen); saveLens(); drawPart(); return; }
        if (e.target.closest('.fd-savelen')) {
          const L = +(pv.b - pv.a).toFixed(1);
          if (!partLens.some((x) => Math.abs(x - L) < 0.05)) { partLens = [...partLens, L].sort((x, y) => x - y).slice(-12); saveLens(); toast(`${lenName(L)} saved as a length button`); }
          drawPart(); return;
        }
        const b = e.target.closest('[data-len]'); if (!b) return;
        pv.touched = true;
        if (b.dataset.len === 'whole') { const D = pv.dur || it.duration || 0; pv.a = 0; pv.b = D; pv.len = D; pv.pick = 'whole'; drawPart(); return; }
        pv.pick = Number(b.dataset.len);
        fitPart(pv.pick);
        if (pv.video && (pv.video.currentTime < pv.a || pv.video.currentTime > pv.b)) pv.video.currentTime = pv.a;
        drawPart();
      });
      lens.addEventListener('contextmenu', (e) => {
        const b = e.target.closest('[data-len]'); if (!b) return;
        e.preventDefault(); if (KEEP_LENS.includes(Number(b.dataset.len))) return; partLens = partLens.filter((x) => String(x) !== b.dataset.len); saveLens(); drawPart();
      });
      // Smart trim: the most viral part of the length you picked; again: the next best one
      $('.fd-smarttrim', preview).onclick = () => {
        if (!pv.va) { toast(pv.scanErr ? `Smart trim needs the viral scan: ${pv.scanErr}` : 'Still watching the video: Smart trim is ready in a moment'); return; }
        // (the part is the whole video: trim it to the best length for this video, else 15 s)
        const Dw = pv.dur || it.duration || 0, L0 = Math.max(3, typeof pv.pick === 'number' ? pv.pick : pv.len || 15), L = Dw && L0 >= Dw - 0.5 ? pv.bestLen || Math.min(15, Dw * 0.5) : L0;
        const list = viralMoments(pv.scan, { lengths: [L], max: 5, analysis: pv.va.analysis });
        if (!list.length) { toast('Nothing that long in this video'); return; }
        const again = pv.trimL === L;
        pv.trimK = again ? (pv.trimK + 1) % list.length : 0; pv.trimL = L;
        if (again && list.length === 1) { toast(`That's the only ${lenName(L)} part that stands out in this video: try another length`); return; }
        const m = list[pv.trimK];
        pv.touched = true; pv.a = m.start; pv.b = m.end; pv.len = m.end - m.start; pv.pick = L;
        if (pv.video) { pv.video.currentTime = m.start; pv.video.play().catch(() => {}); }
        drawPart();
        toast(`Smart trim${list.length > 1 ? ` (${pv.trimK + 1} of ${list.length})` : ''}: ${fmtT(m.start)}–${fmtT(m.end)}, viral ${m.score}. ${m.why[0] || ''}`);
      };
      // drag the part's edges right on the bar: cut the video from here
      for (const h of preview.querySelectorAll('.fd-h')) {
        h.addEventListener('pointerdown', (e) => {
          e.stopPropagation(); e.preventDefault(); h.setPointerCapture(e.pointerId);
          const sc = $('.fd-scrub', preview), D = pv.dur || it.duration || 0, isA = h.classList.contains('a');
          const mv = (ev) => {
            const r = sc.getBoundingClientRect(), t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * D;
            if (isA) pv.a = Math.max(0, Math.min(pv.b - 0.5, t)); else pv.b = Math.min(D, Math.max(pv.a + 0.5, t));
            pv.len = pv.b - pv.a;
            if (pv.video) pv.video.currentTime = isA ? pv.a : Math.max(pv.a, pv.b - 1.5);
            drawPart();
          };
          const up = () => {
            h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up);
            pv.touched = true;
            if (!pv.sents.length) { if (isA) pv.a = Math.min(pv.b - 0.5, snapCut(pv.a)); else pv.b = Math.max(pv.a + 0.5, snapCut(pv.b)); pv.len = pv.b - pv.a; drawPart(); }
            // smart edges: the start on a sentence's start, the end after the word being said
            if (pv.smart && pv.sents.length) { if (isA) { const a2 = smartStart(pv.sents, pv.a); if (a2 < pv.b - 0.5 && Math.abs(a2 - pv.a) < 3) pv.a = a2; } else setEnd(pv.b); pv.len = pv.b - pv.a; drawPart(); }
            pv.pick = null;
          };
          h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
        });
      }
      // drag the part itself: slide the whole cut along the video, same length (a plain click still seeks)
      const rgEl = $('.fd-s-range', preview);
      rgEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.fd-h') || e.button !== 0) return;
        e.stopPropagation(); e.preventDefault(); rgEl.setPointerCapture(e.pointerId);
        const sc = $('.fd-scrub', preview), D = pv.dur || it.duration || 0, r = sc.getBoundingClientRect();
        const x0 = e.clientX, a0 = pv.a, L = pv.b - pv.a;
        let moved = false;
        const mv = (ev) => {
          if (!moved && Math.abs(ev.clientX - x0) < 4) return;
          moved = true; rgEl.classList.add('moving');
          const dt = ((ev.clientX - x0) / r.width) * D;
          pv.a = Math.max(0, Math.min(D - L, a0 + dt)); pv.b = pv.a + L;
          if (pv.video) pv.video.currentTime = pv.a;
          drawPart();
        };
        const up = (ev) => {
          rgEl.removeEventListener('pointermove', mv); rgEl.removeEventListener('pointerup', up); rgEl.removeEventListener('pointercancel', up);
          rgEl.classList.remove('moving');
          if (!moved) { if (pv.video && D) pv.video.currentTime = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * D; return; }
          pv.touched = true;
          // land on a sentence start when Smart edges is on, else on a scene cut close by
          if (pv.smart && pv.sents.length) { pv.a = smartStart(pv.sents, pv.a); pv.b = Math.min(D, pv.a + L); }
          else if (!pv.sents.length) { pv.a = Math.max(0, Math.min(D - L, snapCut(pv.a))); pv.b = pv.a + L; }
          pv.len = pv.b - pv.a;
          if (pv.video) { pv.video.currentTime = pv.a; pv.video.play().catch(() => {}); }
          drawPart();
        };
        rgEl.addEventListener('pointermove', mv); rgEl.addEventListener('pointerup', up); rgEl.addEventListener('pointercancel', up);
      });
      // fine trim: exact edges (no snapping), drag the part, click to move the playhead
      const fb = $('.fd-fine-bar', preview);
      const fineT = (x) => { const r = fb.getBoundingClientRect(), [w0, w1] = fineWindow(); return w0 + Math.max(0, Math.min(1, (x - r.left) / r.width)) * (w1 - w0); };
      fb.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); fb.setPointerCapture(e.pointerId);
        const D = pv.dur || it.duration || Infinity, h = e.target.closest('.fd-fh'), onPart = e.target.closest('.fd-fine-part');
        const kind = h ? (h.classList.contains('a') ? 'a' : 'b') : onPart ? 'move' : 'seek';
        pv.fineLock = [...fineWindow()];
        const t0 = fineT(e.clientX), a0 = pv.a, b0 = pv.b, x0 = e.clientX;
        let moved = false, lastX = e.clientX, scrollT = 0;
        // holding the mouse at (or past) an end of the bar scrolls the close-up that way, so the part can keep going
        const edgeScroll = () => {
          if (scrollT === -1) return;
          const r = fb.getBoundingClientRect(), dir = lastX < r.left + 14 ? -1 : lastX > r.right - 14 ? 1 : 0;
          if (!dir || kind === 'seek') { scrollT = 0; return; }
          const [w0, w1] = pv.fineLock, W = w1 - w0, step = W * 0.035;
          const n0 = Math.max(0, Math.min(D - W, w0 + dir * step));
          if (Math.abs(n0 - w0) < 1e-4) { scrollT = 0; return; }
          pv.fineLock = [n0, n0 + W];
          pv.fineWin = pv.fineLock;
          mv({ clientX: lastX }, true);
          scrollT = setTimeout(edgeScroll, 30);
        };
        if (kind === 'seek' && pv.video) pv.video.currentTime = t0;
        fb.classList.add('dragging');
        const mv = (ev, fromScroll) => {
          if (!moved && Math.abs(ev.clientX - x0) < 3) return;
          moved = true; lastX = ev.clientX;
          if (!fromScroll && !scrollT) scrollT = setTimeout(edgeScroll, 60);
          const t = fineT(ev.clientX), d = t - t0;
          if (kind === 'a') { pv.a = Math.max(0, Math.min(b0 - 0.3, a0 + d)); if (pv.video) pv.video.currentTime = pv.a; }
          else if (kind === 'b') { pv.b = Math.min(D, Math.max(a0 + 0.3, b0 + d)); if (pv.video) pv.video.currentTime = Math.max(pv.a, pv.b - 1); }
          else if (kind === 'move') { const L = b0 - a0; pv.a = Math.max(0, Math.min(D - L, a0 + d)); pv.b = pv.a + L; if (pv.video) pv.video.currentTime = pv.a; }
          else if (pv.video) pv.video.currentTime = t;
          if (kind !== 'seek') { pv.touched = true; pv.len = pv.b - pv.a; if (kind !== 'move') pv.pick = null; drawPart(); }
          fineHead();
        };
        const up = () => {
          fb.removeEventListener('pointermove', mv); fb.removeEventListener('pointerup', up); fb.removeEventListener('pointercancel', up);
          fb.classList.remove('dragging'); clearTimeout(scrollT); scrollT = -1;
          pv.fineWin = pv.fineLock; pv.fineLock = null;
          if (kind === 'move' && !moved && pv.video) pv.video.currentTime = t0; // a click on the part: play from there
          if (moved && kind !== 'seek' && pv.video) pv.video.play().catch(() => {});
          drawPart();
        };
        fb.addEventListener('pointermove', mv); fb.addEventListener('pointerup', up); fb.addEventListener('pointercancel', up);
      });
      $('.fd-revert', preview).onclick = () => {
        const D = pv.dur || it.duration || 0; if (!D) return;
        pv.touched = true; pv.a = 0; pv.b = D; pv.len = D; pv.pick = 'whole'; pv.fineWin = null; pv.trimL = null;
        if (pv.video) { pv.video.playbackRate = 1; const rate = $('.fd-c-rate', preview); if (rate) rate.value = '1'; pv.video.currentTime = 0; }
        if (it.edit) editing?.revert?.();
        drawPart();
        toast(it.edit ? 'Back to the original: the whole clip, nothing cut out, normal sound' : 'Back to the original: the whole video');
      };
      $('.fd-fine-play', preview).onclick = () => { if (!pv.video) return; pv.video.currentTime = pv.a; pv.video.play().catch(() => {}); };
      const lp = $('.fd-loop input', preview);
      lp.checked = pv.loop !== false; lp.onchange = () => { pv.loop = lp.checked; };
      const sm = $('.fd-smart input', preview);
      sm.onchange = () => { pv.smart = sm.checked; if (pv.smart) { applySmart(); } fitPart(pv.len); drawPart(); };
      $('.fd-pv-addpart', preview).onclick = () => {
        const a = +pv.a.toFixed(2), b = +pv.b.toFixed(2);
        if (it.edit) { editing?.setPart(a, b); drawPart(); return; }
        if (it.file) return fileAdd(it, { start: a, end: b });
        pv.jobKey = jobKey(it) + '@' + a; pv.ja = a; pv.jb = b;
        addOne({ ...it, moment: false, title: `${it.title} @${fmtDur(a)}` }, { start: a, end: b });
        if (!pickSession) toast(`Grabbing ${fmtT(a)}–${fmtT(b)}: it goes into your clip list`);
        drawPart();
      };
    }
    const q = $('.fd-ps-q', preview);
    if (q) {
      q.addEventListener('input', () => { pv.q = q.value; renderHits(); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && pv.hits[0]) jumpTo(pv.hits[0].s, true); });
      $('.fd-ps-list', preview).addEventListener('click', (e) => {
        const b = e.target.closest('.fd-line'); if (!b) return;
        const s = pv.sents.find((x) => x.start === Number(b.dataset.t));
        if (s) jumpTo(s, !!e.target.closest('[data-use]'));
      });
    }
    // live: the play button, the time, the playhead, the line being said
    clearInterval(pvTick);
    let lastLine = -1;
    pvTick = setInterval(() => {
      const el = v();
      if (!el || preview.hidden) { clearInterval(pvTick); return; }
      const D = pv.dur || it.duration || 0, t = el.currentTime || 0;
      $('.fd-c-time', preview).textContent = fmtT(t);
      $('.fd-c-play', preview).innerHTML = el.paused ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
      $('.fd-c-mute', preview).classList.toggle('off', el.muted || el.volume === 0);
      if (D) {
        const pc = (x) => `${Math.min(100, Math.max(0, (x / D) * 100))}%`; // (never past the end of the bar)
        $('.fd-s-played', preview).style.width = pc(t);
        $('.fd-s-head', preview).style.left = pc(t);
        try { const bf = el.buffered; if (bf.length) $('.fd-s-buf', preview).style.width = pc(bf.end(bf.length - 1)); } catch {}
      }
      if (pv.jobKey) drawPart();
      fineHead();
      // Loop part: playing across the part's end starts it over (seeking past it on purpose doesn't)
      // (only when it played inside the part up to its end: jumping past the end on purpose doesn't)
      const inPart = t >= pv.a - 0.05 && t < pv.b;
      if (pv.loop !== false && pv.wasIn && !el.paused && preview.querySelector('.fd-part') && t >= pv.b && t < pv.b + 0.6 && pv.b - pv.a >= 0.5) { el.currentTime = pv.a; pv.wasIn = true; }
      else pv.wasIn = inPart;
      // follow along in the transcript (when not searching)
      if (pv.sents.length && !pv.q.trim()) {
        const k = pv.sents.findIndex((s) => t >= s.start && t < s.end + 0.3);
        if (k !== lastLine) {
          lastLine = k;
          const list = $('.fd-ps-list', preview);
          list?.querySelectorAll('.fd-line.now').forEach((x) => x.classList.remove('now'));
          const row = k >= 0 ? list?.children[k] : null;
          if (row) { row.classList.add('now'); if (!list.matches(':hover')) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        }
      }
    }, 120);
  }
  // a line from the transcript: play from it; "Use" makes it (and the lines after it, up to your length) the part
  function jumpTo(s, use) {
    if (!pv) return;
    if (pv.video) { pv.video.currentTime = Math.max(0, s.start - 0.3); pv.video.play().catch(() => {}); }
    if (use && preview.querySelector('.fd-part')) {
      pv.touched = true;
      const D = pv.dur || pv.it.duration || Infinity;
      pv.a = Math.max(0, s.start - 0.15);
      pv.b = Math.min(D, pv.smart ? Math.max(s.end + 0.25, smartEnd(pv.sents, pv.a, pv.len)) : Math.max(s.end + 0.25, pv.a + pv.len));
      pv.len = pv.b - pv.a; pv.pick = null;
      drawPart();
    }
  }
  // keys inside the preview: Space play / pause, I / O start / end, ← → 5 seconds, M sound, Enter adds the part
  window.addEventListener('keydown', (e) => {
    if (root.hidden || preview.hidden || !pv?.video) return;
    if (e.target.matches?.('input[type=text], input[type=number], textarea, select')) return;
    const v = pv.video, k = e.key.toLowerCase();
    if (e.code === 'Space') { e.preventDefault(); if (v.paused) v.play().catch(() => {}); else v.pause(); }
    else if (k === 'i' && preview.querySelector('.fd-part')) setStart(v.currentTime);
    else if (k === 'o' && preview.querySelector('.fd-part')) setEnd(v.currentTime);
    else if (k === 'm') v.muted = !v.muted;
    else if (k === 'p' && preview.querySelector('.fd-part')) { v.currentTime = pv.a; v.play().catch(() => {}); }
    else if (e.key === 'ArrowLeft') v.currentTime = Math.max(0, v.currentTime - 5);
    else if (e.key === 'ArrowRight') v.currentTime += 5;
    else if (e.key === 'Enter' && preview.querySelector('.fd-part')) $('.fd-pv-addpart', preview).click();
    else return;
    e.stopPropagation();
  }, true);
  // ---- hover a result's picture: a small muted preview plays right there ----
  function hoverEmbed(it) {
    // Twitch and Kick clips play as plain muted video, through Cutsona (their embeds won't autoplay muted)
    if (it.source === 'twitch' || it.source === 'kick') return `<video src="/api/finder/hover?url=${encodeURIComponent(it.url)}" muted autoplay loop playsinline></video>`;
    const host = encodeURIComponent(location.hostname);
    const start = it.moment ? Math.floor(it.start) : it.duration ? Math.floor(Math.min(it.duration * 0.3, Math.max(0, it.duration - 8))) : 0;
    const end = it.moment ? `&end=${Math.ceil(it.end) + 1}` : '';
    // YouTube: its player at first (drawn big and scaled down, shown only once it really plays), then Cutsona's own
    // copy of those seconds as soon as it's fetched (no YouTube play / pause icons at all), see below
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
        setTimeout(() => window.removeEventListener('message', onMsg), 8000);
        // Cutsona's own copy of these seconds (cached, so the next hover is instant): it takes over when it plays
        if (it.source === 'youtube') {
          const st0 = it.moment ? Math.floor(it.start) : it.duration ? Math.floor(Math.min(it.duration * 0.3, Math.max(0, it.duration - 8))) : 0;
          const own = document.createElement('video');
          own.muted = true; own.loop = true; own.playsInline = true; own.autoplay = true; own.className = 'own';
          own.src = `/api/finder/hoverclip?url=${encodeURIComponent(it.url.replace(/&t=\d+s?/, ''))}&start=${st0}&len=${it.moment ? Math.max(2, Math.ceil(it.end - it.start) + 1) : 6}`;
          own.addEventListener('playing', () => { if (!div.isConnected) return; fr.remove(); own.classList.add('on'); show(); }, { once: true });
          own.addEventListener('error', () => own.remove(), { once: true });
          div.appendChild(own);
        }
      } else show();
    }, 350);
  });
  results.addEventListener('mouseout', (e) => {
    if (!hoverCard) return;
    const to = e.relatedTarget;
    if (to && hoverCard.querySelector('.fd-thumb').contains(to)) return;
    stopHover();
  });

  // ---------- the viral scan of the video in the preview ----------
  const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3.5 5 6 5 11a5 5 0 0 1-10 0c0-2.2 1-3.8 2.3-5 .2 1.6 1 2.7 2.2 3.2C11 8 12.3 5.2 12 2z"/></svg>';
  const scans = new Map(); // finished scans, so a preview opened again is instant
  async function startScan(it) {
    const id = it.edit ? `e:${it.edit}` : it.file ? `f:${it.file.name}:${it.file.size}:${it.file.lastModified}` : `u:${pageOf(it)}`;
    const st0 = () => $('.fd-vr-st', preview);
    try {
      let j = scans.get(id);
      if (!j) {
        let r;
        if (it.edit && it.cache) r = await fetch('/api/viral?cache=' + encodeURIComponent(it.cache));
        else if (it.file) {
          const path = window.cutsonaDesktop?.pathOf ? window.cutsonaDesktop.pathOf(it.file) : '';
          r = path ? await fetch('/api/viral?path=' + encodeURIComponent(path))
            : await fetch(`/api/viral?name=${encodeURIComponent(it.file.name)}&size=${it.file.size}&mtime=${it.file.lastModified || 0}`, { method: 'POST', body: it.file });
        } else r = await fetch('/api/viral?url=' + encodeURIComponent(it.source === 'twitch' || it.source === 'kick' ? it.url : pageOf(it)));
        j = await r.json();
        while (j.running) {
          if (!pv || pv.it !== it) return;
          const s = st0(); if (s) s.innerHTML = `<i class="spin"></i>${esc(j.phase || 'Watching')}… ${j.pct ? `${j.pct}%` : ''}`;
          await new Promise((res) => setTimeout(res, 800));
          j = await (await fetch('/api/viral?key=' + j.key)).json();
        }
        if (j.error) throw new Error(j.error);
        scans.set(id, j);
      }
      if (!pv || pv.it !== it) return;
      it.scan = j;
      // a file has no captions: the words the scan heard are its transcript
      if (!pv.sents.length && j.words?.length) { pv.words = j.words; pv.sents = sentencesOf(j.words); pv.from = j.wordsFrom; $('.fd-ps-q', preview) && ($('.fd-ps-q', preview).disabled = false); }
      pv.scan = { ...j, words: pv.words?.length ? pv.words : j.words || [] };
      pv.va = analyzeViral(pv.scan, { lengths: [...new Set([15, 30, 45, 60, Math.round(pv.len || 15)])] });
      // how viral the best part of every length button is, and which length is best for this video
      const D = pv.dur || j.duration || it.duration || 0;
      pv.lenBest = {}; let bestS = -1;
      for (const L of partLens) {
        if (D && L >= D - 0.5) continue;
        const m = viralMoments(pv.scan, { lengths: [L], max: 1, analysis: pv.va.analysis })[0];
        if (m) { pv.lenBest[L] = m; if (m.score > bestS + 1 || (Math.abs(m.score - bestS) <= 1 && L >= 7 && L <= 35)) { bestS = Math.max(bestS, m.score); pv.bestLen = L; } }
      }
      if (D) pv.wholeScore = scorePart(pv.va.analysis, 0, D).score;
      // nothing picked yet: start on the most viral part of the chosen length (a clip that came as a moment keeps it)
      if (!pv.touched && !it.moment && preview.querySelector('.fd-part')) {
        const L = Math.round(pv.len || 15), m = pv.lenBest[L] || viralMoments(pv.scan, { lengths: [L], max: 1, analysis: pv.va.analysis })[0];
        if (m && (!D || m.end - m.start < D - 0.5)) {
          pv.a = m.start; pv.b = m.end; pv.len = m.end - m.start; pv.trimL = L; pv.trimK = 0; pv.pick = L;
          if (pv.video && pv.video.currentTime < 0.5) { pv.video.currentTime = m.start; }
          toast(`Picked the most viral ${lenName(L)} part (${fmtT(m.start)}–${fmtT(m.end)}, viral ${m.score}). Smart trim: the next best; or pick your own`);
        }
      }
      renderViral(); renderHits(); drawPart();
      if (it.file && !pv.sents.length) $('.fd-ps-list', preview).innerHTML = `<div class="fd-empty small fd-nowords"><span>${j.wordsFrom === 'none' ? 'No words heard. To read what’s said, set up the speech tools in Settings → Captions and speech.' : 'Nobody speaks in this video.'}</span><small>The viral moments use what happens in the picture and the sound.</small></div>`;
    } catch (e) {
      if (!pv || pv.it !== it) return;
      pv.scanErr = e.message;
      const s = st0(); if (s) s.innerHTML = `<span class="err">Couldn’t watch it: ${esc(e.message)}</span>`;
      if (it.file && !pv.sents.length) $('.fd-ps-list', preview).innerHTML = '<div class="fd-empty small">No transcript for this file.</div>';
    }
  }
  function renderViral() {
    if (!pv?.va) return;
    const A = pv.va, D = pv.dur || pv.scan.duration || pv.it.duration || 0;
    const st = $('.fd-vr-st', preview);
    if (st) st.innerHTML = `<span class="vscore ${scoreColor(A.score)}" title="How likely this video is to have a viral part: ${A.score}/100">${FLAME}${A.score}</span>${A.moments.length} found`;
    const list = $('.fd-vr-list', preview);
    if (list) list.innerHTML = A.moments.length ? A.moments.map((m, k) => `<div class="fd-vm" data-a="${m.start}" data-b="${m.end}" role="button" tabindex="0">
        <span class="vs ${scoreColor(m.score)}">${m.score}</span>
        <span class="vbody"><span class="vt">#${k + 1} · ${fmtT(m.start)}–${fmtT(m.end)} · ${Math.round(m.end - m.start)}s</span>
          ${m.hookText || m.text ? `<span class="vq">“${esc((m.hookText || m.text).slice(0, 90))}${(m.hookText || m.text).length > 90 ? '…' : ''}”</span>` : ''}
          <span class="vw">${esc(m.why.join(' · '))}</span></span>
        <button class="small vuse" data-vuse title="Make this the part">Use</button></div>`).join('')
      : '<div class="fd-empty small">No part stands out: try a longer video.</div>';
    // the bar: a heat strip (the hotter, the likelier to go viral) and the best parts marked with their rank
    const cv = $('.fd-s-heat', preview);
    if (cv && D) {
      const w = cv.clientWidth || 600, dpr = devicePixelRatio || 1; cv.width = Math.round(w * dpr); cv.height = Math.round(6 * dpr);
      const g = cv.getContext('2d'), n = A.curve.length;
      for (let x = 0; x < cv.width; x++) {
        const t = (x / cv.width) * D, v = A.curve[Math.min(n - 1, Math.floor(t / A.step))] || 0;
        g.fillStyle = v > 0.7 ? `rgba(255,77,77,${0.5 + v * 0.5})` : v > 0.5 ? `rgba(255,150,60,${0.35 + v * 0.5})` : v > 0.32 ? `rgba(255,214,90,${0.2 + v * 0.4})` : `rgba(255,255,255,${0.04 + v * 0.15})`;
        g.fillRect(x, 0, 1, cv.height);
      }
    }
    const vm = $('.fd-s-vm', preview);
    if (vm && D) vm.innerHTML = A.moments.slice(0, 5).map((m, k) => `<i class="${scoreColor(m.score)}" style="left:${(m.start / D) * 100}%;width:${((m.end - m.start) / D) * 100}%" title="#${k + 1}: viral ${m.score} (${fmtT(m.start)}–${fmtT(m.end)})"><b>${k + 1}</b></i>`).join('');
  }
  preview.addEventListener('click', (e) => {
    const stab = e.target.closest('[data-stab]');
    if (stab) {
      const side = stab.closest('.fd-pv-side'), snd = stab.dataset.stab === 'sound';
      side.querySelectorAll('[data-stab]').forEach((b) => b.classList.toggle('on', b === stab));
      side.classList.toggle('show-sound', snd); side.querySelector('.fd-sound').hidden = !snd;
      if (snd) requestAnimationFrame(() => editing?.refresh?.()); // (the fade wave needs to be on screen to be drawn)
      return;
    }
    if (e.target.closest('.fd-vr-q, .fd-pscore, .vscore')) { explainViral?.(e); return; }
    const card = e.target.closest('.fd-vm'); if (!card || !pv) return;
    const a = Number(card.dataset.a), b = Number(card.dataset.b);
    if (pv.video) { pv.video.currentTime = a; pv.video.play().catch(() => {}); }
    if (e.target.closest('[data-vuse]') && preview.querySelector('.fd-part')) { pv.touched = true; pv.a = a; pv.b = b; pv.len = b - a; pv.pick = null; drawPart(); toast(`The part is ${fmtT(a)}–${fmtT(b)}: + Add it, or drag its edges on the bar`); }
  });

  // ---------- your own videos: a preview tab for each before it's added (viral scan, smart trim) ----------
  let fileTabs = [], fileTab = 0, fileDone = null, openedForFiles = false;
  const tabsHtml = () => `<div class="fd-ftabs" role="tablist">${fileTabs.map((t, k) => `<button role="tab" class="fd-ftab${k === fileTab ? ' on' : ''}${t.added ? ' added' : ''}" data-ftab="${k}" title="${esc(t.it.title)}">${t.added ? '✓ ' : ''}${esc(t.it.title.replace(/\.[a-z0-9]{2,4}$/i, ''))}${t.added && t.part ? ` <small>${fmtT(t.part.start)}–${fmtT(t.part.end)}</small>` : ''}</button>`).join('')}
    <span class="fd-ftabs-sp"></span><button class="small fd-ftabs-all" title="Add every video not added yet, whole">Add all${fileTabs.some((t) => t.added) ? ' the rest' : ''} (${fileTabs.filter((t) => !t.added).length})</button></div>`;
  function previewFiles(files, done) {
    const vids = files.filter((f) => /^video\//.test(f.type) || /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|mpg|mpeg|ts|mts|3gp|ogv)$/i.test(f.name));
    if (!vids.length) return false;
    fileTabs = vids.map((f) => ({ f, it: { title: f.name, file: f, direct: true, url: URL.createObjectURL(f), source: 'file', duration: 0 }, added: false, part: null }));
    fileTab = 0; fileDone = done;
    openedForFiles = root.hidden; root.hidden = false;
    openPreview(fileTabs[0].it);
    return true;
  }
  function fileAdd(it, part) {
    const k = fileTabs.findIndex((t) => t.it === it); if (k < 0) return;
    const t = fileTabs[k]; t.added = true; t.part = part;
    addFile?.(t.f, part, it.scan || null);
    toast(`${t.f.name}: added${part ? ` (${fmtT(part.start)}–${fmtT(part.end)})` : ''}`);
    const next = fileTabs.findIndex((x) => !x.added);
    if (next < 0) return finishFiles();
    fileTab = next; openPreview(fileTabs[next].it);
  }
  function finishFiles() {
    const left = fileTabs.filter((t) => !t.added);
    for (const t of left) addFile?.(t.f, null, t.it.scan || null);
    for (const t of fileTabs) URL.revokeObjectURL(t.it.url);
    fileTabs = []; const done = fileDone; fileDone = null;
    closePreview();
    if (openedForFiles) { openedForFiles = false; close(); }
    done?.();
  }
  preview.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-ftab]');
    if (tb) { const k = Number(tb.dataset.ftab); if (k !== fileTab && fileTabs[k]) { fileTab = k; openPreview(fileTabs[k].it); } return; }
    if (e.target.closest('.fd-ftabs-all')) finishFiles();
  });

  let pvTick = 0;
  function closePreview(byYou = false, keepEdit = false) {
    if (editing && !keepEdit) {
      const e = editing; editing = null; e.close?.();
      if (byYou && openedForEdit) { openedForEdit = false; root.hidden = true; }
    }
    // closing the preview of your own videos: the ones not added yet aren't added
    if (byYou && fileTabs.length) {
      const left = fileTabs.filter((t) => !t.added).length;
      for (const t of fileTabs) URL.revokeObjectURL(t.it.url);
      fileTabs = []; fileDone = null;
      if (left) toast(`${left} video${left === 1 ? '' : 's'} not added`);
      if (openedForFiles) { openedForFiles = false; root.hidden = true; }
    }
    clearInterval(pvTick);
    if (pv?.video) { try { pv.video.pause(); pv.video.removeAttribute('src'); pv.video.load(); } catch {} }
    pv = null;
    preview.hidden = true; preview.innerHTML = '';
  }

  // a clip from the clip list, edited in the preview: which part plays (with its viral moments, Smart trim and
  // the transcript), and its sound. opts: { setPart(a, b), part() -> [a, b], sound(host), close() }
  function editClip(c, opts) {
    const it = { title: c.name, edit: c.id, direct: true, url: c.previewUrl || c.url, source: 'file', duration: c.duration || 0,
      part: opts.part(), words: c.words?.length ? c.words : c.ytWords || [], scan: c.viralScan || null,
      cache: c.previewUrl?.startsWith('/cache/') ? c.previewUrl : c.url?.startsWith('/cache/') ? c.url : '', file: c.file && !c.url?.startsWith('/cache/') ? c.file : null,
      page: c.origin?.url || c.origin?.page || '' };
    if (editing) closePreview();
    openedForEdit = root.hidden; root.hidden = false;
    editing = { ...opts, id: c.id };
    openPreview(it);
  }
  // ---------- 🎲 Random: completely random footage made into an edit ----------
  // Edit Mode: random movies, shows, anime, Shorts, viral videos or news (and a random song if there's none).
  // Clipper Mode: random stream clips only, from Twitch and Kick (trending, a popular channel or a game).
  let randBusy = false;
  async function randomEdit() {
    if (randBusy) return; randBusy = true;
    const btn = $('.fd-rand', root); btn.disabled = true; btn.textContent = '🎲 Rolling…';
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const get = async (o) => { const r = await fetch('/api/finder/search?' + new URLSearchParams({ n: '50', ...o }).toString()); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'search failed'); return (j.items || []).filter((x) => x && x.url); };
    const range = () => pick(['day', 'week', 'week', 'month']);
    const stream = isStream();
    const plans = stream ? [
      () => ({ source: 'twitchtop', range: range(), en: '1', n: '40' }),
      () => ({ source: 'kicktrend', range: range(), n: '40' }),
      () => ({ source: 'twitch', channel: pick(POPULAR.twitch), range: range(), n: '40' }),
      () => ({ source: 'kick', channel: pick(POPULAR.kick), range: range(), n: '40' }),
      () => ({ source: 'twitchgame', q: pick(POPULAR_GAMES), range: range(), en: '1', n: '40' }),
    ] : [
      () => ({ source: 'youtube', q: `${pick(MOVIE_MOODS).top} movie scenes`, short: '1' }),
      () => ({ source: 'youtube', q: `${pick(MOVIE_MOODS).top} tv show scenes`, short: '1' }),
      () => ({ source: 'youtube', q: `${pick(MOVIE_MOODS).top} anime scenes`, short: '1' }),
      () => ({ source: 'shorts', q: pick(['viral', 'satisfying', 'funny animals', 'street interview', 'fails', 'insane skill', 'nature', 'travel', 'skate', 'parkour']) }),
      () => { const f = pick(VIRAL_FEEDS.filter((x) => x[2])); return { source: 'youtube', q: f[2], short: '1' }; },
      () => ({ source: 'youtube', q: pick(NEWS_TOPICS).q, when: pick(['day', 'week', 'month']), short: '1' }),
    ];
    try {
      const pool = [];
      for (const pl of shuffle(plans).slice(0, stream ? 2 : 3)) {
        try { pool.push(...(await get(pl())).filter((x) => !x.photo && !x.audio && (!x.duration || (x.duration >= 3 && x.duration <= (stream ? 120 : 240))))); } catch {}
        if (pool.length > 40) break;
      }
      if (!pool.length) throw new Error('Nothing came up this time: roll again');
      const picks = shuffle(pool).filter((x, i, a) => a.findIndex((y) => y.url === x.url) === i).slice(0, stream ? 1 : 3 + Math.floor(Math.random() * 3));
      toast(stream ? `Random stream clip: ${picks[0].channel || picks[0].title || 'clip'}` : `Random edit: ${picks.length} random clips${hasMusic() ? '' : ' and a random song'}`);
      if (!stream && !hasMusic()) {
        try { const songsList = (await get({ source: 'ytsong', q: pick(MUSIC_MOODS).q })).filter((x) => !x.duration || (x.duration >= 60 && x.duration <= 360)); const sg = pick(songsList.slice(0, 15)); if (sg) addOne({ ...sg, audio: true }); } catch {}
      }
      close();
      await Promise.allSettled(picks.map((it) => addOne(it)));
      onRandom?.();
    } catch (e) { toast(e.message, true); }
    finally { randBusy = false; btn.disabled = false; btn.textContent = '🎲 Random'; }
  }
  // straight to a source (GIPHY reactions for "+ Own clip")
  const openSource = (tab, msrc) => { if (msrc) { st.msrc = msrc; st.items = []; } open(tab); };
  return { open, openSource, close, randomEdit, addLink: (url) => addOne({ url }), isOpen: () => !root.hidden, previewFiles, editClip };
}
