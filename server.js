// Cutsona - local server (no dependencies, just Node + ffmpeg)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const ROOT = __dirname;
const transcription = require('./transcription.js')(ROOT);
const APP_DIR = path.join(ROOT, 'app');
const CACHE_DIR = path.join(ROOT, 'cache');
const DEFAULT_EXPORT_DIR = path.join(ROOT, 'exports');
const TMP_DIR = path.join(DEFAULT_EXPORT_DIR, '.tmp'); // export parts always land here; only the finished MP4 goes to your folder
const BIN_DIR = path.join(ROOT, 'bin');
const makePreview = require('./preview.js')(CACHE_DIR, runFfmpeg);
const YTDLP = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
for (const d of [CACHE_DIR, DEFAULT_EXPORT_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });
// updates from the GitHub repo in version.json (see updater.js)
const updater = require('./updater.js')({ root: ROOT, curl: (...a) => curl(...a), ua: 'Cutsona-updater' });

// App settings kept on this PC (cutsona-settings.json, never published): where finished videos are saved.
const SETTINGS_FILE = path.join(ROOT, 'cutsona-settings.json');
try { const was = path.join(ROOT, 'slax-settings.json'); if (!fs.existsSync(SETTINGS_FILE) && fs.existsSync(was)) fs.renameSync(was, SETTINGS_FILE); } catch {} // from before the rename
let appSettings = {};
try { appSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}; } catch {}
function usableDir(d) {
  try {
    if (!d || !path.isAbsolute(d)) return null;
    fs.mkdirSync(d, { recursive: true });
    fs.accessSync(d, fs.constants.W_OK);
    return fs.statSync(d).isDirectory() ? path.resolve(d) : null;
  } catch { return null; }
}
let EXPORT_DIR = usableDir(appSettings.exportDir) || DEFAULT_EXPORT_DIR;
function saveAppSettings() { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(appSettings, null, 2)); }
// The system's own "choose a folder" window (Windows / macOS). Resolves the folder, or null when cancelled.
function pickFolder(start) {
  return new Promise((resolve, reject) => {
    let cmd, args;
    if (process.platform === 'win32') {
      // the start folder comes in through an environment variable, never pasted into the script
      const ps = "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog;"
        + " $f.Description = 'Where should Cutsona save your finished videos?'; $f.ShowNewFolderButton = $true;"
        + " if ($env:CUTSONA_START -and (Test-Path -LiteralPath $env:CUTSONA_START)) { $f.SelectedPath = $env:CUTSONA_START };"
        + " $o = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false };"
        + " if ($f.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.SelectedPath) }";
      cmd = 'powershell.exe'; args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', ps];
    } else if (process.platform === 'darwin') {
      cmd = 'osascript'; args = ['-e', 'POSIX path of (choose folder with prompt "Where should Cutsona save your finished videos?")'];
    } else return reject(new Error('Type the folder path instead (no folder picker on this system).'));
    let out = '';
    const p = spawn(cmd, args, { windowsHide: false, env: { ...process.env, CUTSONA_START: start || '' } });
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', () => resolve(out.trim().replace(/[\\/]$/, '') || null));
  });
}

const NO_BROWSER = process.argv.includes('--no-browser');
const START_PORT = Number(process.env.CUTSONA_PORT || 4870);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.woff2': 'font/woff2',
};

// ---- auto-focus models (MediaPipe face + person detectors), downloaded once on first use ----
const VISION_DIR = path.join(__dirname, 'bin', 'vision');
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const VISION_FILES = [
  ['vision_bundle.mjs', `${MP}/vision_bundle.mjs`],
  ['wasm/vision_wasm_internal.js', `${MP}/wasm/vision_wasm_internal.js`],
  ['wasm/vision_wasm_internal.wasm', `${MP}/wasm/vision_wasm_internal.wasm`],
  ['face.tflite', 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'],
  ['person.tflite', 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite'],
];
let visionReady = null;
function curlFile(url, dest) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-sL', '--fail', '--max-time', '300', '-o', dest, url], { windowsHide: true });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('download failed (' + code + ')'))));
  });
}
function ensureVision() {
  if (!visionReady) {
    visionReady = (async () => {
      for (const [rel, url] of VISION_FILES) {
        const dest = path.join(VISION_DIR, rel);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await curlFile(url, dest + '.part');
        fs.renameSync(dest + '.part', dest);
      }
    })();
    visionReady.catch(() => { visionReady = null; });
  }
  return visionReady;
}

let FFMPEG = 'ffmpeg';
let ffmpegOk = false;
function checkFfmpeg() {
  return new Promise((res) => {
    execFile(FFMPEG, ['-hide_banner', '-version'], { windowsHide: true }, (err, out) => {
      ffmpegOk = !err;
      res(ffmpegOk ? String(out).split('\n')[0] : null);
    });
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed: ' + err.trim().slice(-1500)))));
  });
}

// Still-picture stretches in a video (title cards, posters, "rent on ..." end screens, frozen frames).
// The picture is split into a 3x3 grid and each cell is checked with ffmpeg's freezedetect: only when EVERY
// cell is frozen is it dead video. (A stream with a still game screen and a talking facecam in one corner
// is alive: the whole-frame check used to call it frozen.) Results are cached next to the file.
const stillsActive = new Map();
const GRID = 3;
function findStills(file) {
  const memo = file + '.stills2.json';
  try { return Promise.resolve(JSON.parse(fs.readFileSync(memo, 'utf8'))); } catch {}
  if (stillsActive.has(file)) return stillsActive.get(file);
  const task = new Promise((resolve, reject) => {
    const cw = 120, ch = 120, cells = [];
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) cells.push([c * cw, r * ch]);
    const graph = `[0:v:0]scale=${cw * GRID}:${ch * GRID},split=${cells.length}${cells.map((_, k) => `[i${k}]`).join('')};`
      + cells.map(([x, y], k) => `[i${k}]crop=${cw}:${ch}:${x}:${y},freezedetect@cell${k}=n=-50dB:d=0.6${k === cells.length - 1 ? '[out]' : ',nullsink'}`).join(';');
    const p = spawn(FFMPEG, ['-hide_banner', '-nostats', '-loglevel', 'info', '-i', file, '-an',
      '-filter_complex', graph, '-map', '[out]', '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 2000000) err = err.slice(-2000000); });
    p.on('error', reject);
    p.on('close', () => {
      let dur = 0;
      const dm = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
      if (dm) dur = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]);
      // frozen stretches per cell (the log line is tagged with the filter instance: cellN)
      const per = cells.map(() => []);
      for (const line of err.split(/\r?\n/)) {
        const m = /cell(\d+)\b.*freeze_(start|end): ([\d.]+)/.exec(line);
        if (!m) continue;
        const list = per[Number(m[1])];
        if (!list) continue;
        if (m[2] === 'start') list.push([Number(m[3]), null]);
        else if (list.length && list.at(-1)[1] == null) list.at(-1)[1] = Number(m[3]);
      }
      // a freeze that lasts to the end of the file never gets a freeze_end line
      for (const list of per) for (const st of list) if (st[1] == null) st[1] = dur || st[0] + 3600;
      // dead video = the times every cell is frozen at once
      let stills = per[0];
      for (const list of per.slice(1)) {
        const next = [];
        for (const [a, b] of stills) for (const [c, d] of list) { const s = Math.max(a, c), e = Math.min(b, d); if (e - s >= 0.6) next.push([s, e]); }
        stills = next;
      }
      const result = { stills: stills.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]), duration: dur, grid: GRID };
      fs.writeFile(memo, JSON.stringify(result), () => {});
      resolve(result);
    });
  });
  stillsActive.set(file, task);
  task.finally(() => stillsActive.delete(file)).catch(() => {});
  return task;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function safeName(s, fallback = 'file') {
  s = String(s || '').replace(/[^a-zA-Z0-9._ -]+/g, '').replace(/\s+/g, '_').slice(0, 80);
  return s || fallback;
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

const MAX_UPLOAD = 8 * 1024 ** 3; // 8 GB: bigger than any clip, but stops anything from filling the disk
function saveBody(req, dest) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > MAX_UPLOAD) return reject(new Error('That file is too big (over 8 GB).'));
    const ws = fs.createWriteStream(dest);
    let size = 0;
    req.on('data', (d) => { size += d.length; if (size > MAX_UPLOAD) { req.unpipe(ws); ws.destroy(); fs.unlink(dest, () => {}); req.destroy(); reject(new Error('That file is too big (over 8 GB).')); } });
    req.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    req.on('error', reject);
  });
}

// Static file server with HTTP Range support (needed for smooth video seeking)
function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (m && !m[1] && m[2]) { start = st.size - parseInt(m[2], 10); end = st.size - 1; }
      if (start >= st.size || end >= st.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    }
  });
}

function within(base, p) {
  const r = path.resolve(base, p);
  return r.startsWith(path.resolve(base) + path.sep) || r === path.resolve(base) ? r : null;
}


// ---------------- clip finder: yt-dlp, search, downloads ----------------
function download(url, dest, redirects = 8) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Cutsona' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects > 0) {
        r.resume(); return resolve(download(new URL(r.headers.location, url).href, dest, redirects - 1));
      }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('Download failed: HTTP ' + r.statusCode)); }
      const tmp = dest + '.part';
      const ws = fs.createWriteStream(tmp);
      r.pipe(ws);
      ws.on('finish', () => ws.close(() => {
        fs.renameSync(tmp, dest);
        if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
        resolve();
      }));
      ws.on('error', reject);
    }).on('error', reject);
  });
}

let ytdlpPromise = null;
function ensureYtdlp() {
  if (fs.existsSync(YTDLP)) return Promise.resolve();
  if (!ytdlpPromise) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const asset = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';
    console.log('Downloading yt-dlp…');
    ytdlpPromise = download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, YTDLP)
      .catch((e) => { ytdlpPromise = null; throw e; });
  }
  return ytdlpPromise;
}
function updateYtdlpIfOld() {
  try {
    const age = Date.now() - fs.statSync(YTDLP).mtimeMs;
    if (age > 5 * 864e5) {
      const p = spawn(YTDLP, ['-U'], { windowsHide: true, stdio: 'ignore' });
      p.on('close', () => { try { const now = new Date(); fs.utimesSync(YTDLP, now, now); } catch {} });
    }
  } catch {}
}

function runYtdlp(args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, ['--no-warnings', '--no-color', '--js-runtimes', `node:${process.execPath}`, ...args], { windowsHide: true });
    let out = '', err = '', buf = '';
    p.stdout.on('data', (d) => {
      const s = d.toString();
      if (onLine) { buf += s; const parts = buf.split(/\r?\n|\r/); buf = parts.pop(); parts.forEach((l) => l && onLine(l)); }
      else out += s;
    });
    p.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) return resolve(out);
      const lines = err.trim().split(/\r?\n/);
      const msg = (lines.filter((l) => /ERROR/.test(l)).pop() || lines.pop() || 'yt-dlp failed').replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '');
      reject(new Error(msg.slice(0, 300)));
    });
  });
}

function curl(url, { accept = 'text/html', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-L', '--compressed', '--max-time', '25', '-A', UA, '-H', `Accept: ${accept}`];
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    if (body != null) args.push('-X', 'POST', '--data-binary', '@-');
    args.push('-w', '\n%{http_code}', url);
    const p = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { windowsHide: true });
    const chunks = []; // joined as bytes first, so a letter split across two chunks stays whole
    p.stdout.on('data', (d) => { chunks.push(d); });
    p.on('error', reject);
    p.on('close', () => {
      const out = Buffer.concat(chunks).toString('utf8');
      const i = out.lastIndexOf('\n');
      const code = Number(out.slice(i + 1)), text = out.slice(0, i);
      code >= 200 && code < 300 ? resolve(text) : reject(new Error(`HTTP ${code || 'error'} from ${new URL(url).hostname}`));
    });
    if (body != null) p.stdin.end(body);
  });
}
const curlText = (url, accept) => curl(url, { accept });
const decodeHtml = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#32;/g, ' ').replace(/&amp;/g, '&');

// ---- errors people see: what happened and what to do, never a raw HTTP code or a yt-dlp trace ----
const SITE_NAMES = { 'www.youtube.com': 'YouTube', 'youtube.com': 'YouTube', 'gql.twitch.tv': 'Twitch', 'kick.com': 'Kick', 'medal.tv': 'Medal', 'api.dailymotion.com': 'Dailymotion',
  'getyarn.io': 'Yarn', 'mixkit.co': 'Mixkit', 'api.pexels.com': 'Pexels', 'pixabay.com': 'Pixabay', 'api.openverse.org': 'Openverse', 'commons.wikimedia.org': 'Wikimedia',
  'freesound.org': 'Freesound', 'freemusicarchive.org': 'Free Music Archive', 'ccmixter.org': 'ccMixter', 'archive.org': 'Internet Archive', 'www.thepartwhere.com': 'thepartwhere.com',
  'destockd.com': 'Destockd', 'archival-footage.com': 'Archival Footage', 'api.giphy.com': 'GIPHY', 'giphy.com': 'GIPHY' };
function friendlySearchError(msg) {
  const m = String(msg || '');
  const http = /HTTP (\d{3}|error) from ([\w.-]+)/.exec(m);
  if (http) {
    const site = SITE_NAMES[http[2]] || http[2].replace(/^(www|api)\./, '');
    if (http[1] === '429') return `${site} is getting a lot of searches right now. Wait a minute and try again, or pick another source.`;
    if (http[1] === '403' || http[1] === '401') return `${site} isn’t letting Cutsona search it right now. Pick another source.`;
    if (/^5/.test(http[1]) || http[1] === 'error') return `${site} isn’t answering right now. Try again in a moment, or pick another source.`;
    return `${site} didn’t give any results for that. Try other words, or another source.`;
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timed? ?out/i.test(m)) return 'Couldn’t reach the site. Check your internet connection and try again.';
  if (/Unexpected token|JSON/i.test(m)) return 'That site sent back something Cutsona couldn’t read. Try again, or pick another source.';
  return m.length < 160 && !/\bat \w+ \(|ERROR:|Traceback/.test(m) ? m : 'That search didn’t work. Try again, or pick another source.';
}
function friendlyGrabError(msg, url = '') {
  const m = String(msg || '');
  if (/sign in to confirm|not a bot/i.test(m)) return 'YouTube is asking for a sign-in check right now. Try again in a few minutes, or pick a different video.';
  if (/private video/i.test(m)) return 'That video is private.';
  if (/age[- ]restricted|confirm your age|inappropriate for some users/i.test(m)) return 'That video is age-restricted, so it can’t be downloaded without signing in. Pick a different one.';
  if (/members[- ]only|join this channel/i.test(m)) return 'That video is for channel members only.';
  if (/video unavailable|has been removed|does not exist|no longer available|404/i.test(m)) return 'Couldn’t find a video at that link: it may have been deleted, or the page has no video.';
  if (/not available in your country|geo.?restrict/i.test(m)) return 'That video isn’t available in your country.';
  if (/live event|is live|premieres? in/i.test(m)) return 'That’s a live stream or an upcoming premiere: it can’t be downloaded yet.';
  if (/unsupported url/i.test(m)) return 'Cutsona can’t download from that site. Try a YouTube, Twitch, Kick, TikTok, Instagram, X or Streamable link.';
  if (/HTTP (\d{3}|error) from/.test(m) || /ENOTFOUND|ECONNRESET|ETIMEDOUT|timed? ?out/i.test(m)) return 'Couldn’t download it: the site didn’t answer. Try again in a moment.';
  if (/ffmpeg|Invalid data|moov atom|conversion failed/i.test(m)) return 'The download finished but the video file is damaged. Try again, or pick a different video.';
  return m.length < 160 && !/ERROR:|Traceback|\bat \w+ \(/.test(m) ? m : 'That download didn’t work. Try again, or pick a different video.';
}
const REDDIT_LINK = /^https?:\/\/(?:[\w-]+\.)?(?:reddit\.com|redd\.it)\//i;
const REDDIT_MSG = 'Reddit blocks apps from downloading its videos. Open the post: if the video is from YouTube, Twitch, Kick, Streamable or another site, paste that link instead.';

// ---- config (API keys for optional sources) ----
const CONFIG_FILE = path.join(ROOT, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
function saveConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); }

// ---- Twitch (public GraphQL, same as the website uses) ----
const TW_CLIENT = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const TW_PERIOD = { day: 'LAST_DAY', week: 'LAST_WEEK', month: 'LAST_MONTH', all: 'ALL_TIME' };
const TW_FIELDS = 'slug title viewCount durationSeconds thumbnailURL createdAt broadcaster{login displayName} game{displayName}';
async function twitchGql(query, variables) {
  const text = await curl('https://gql.twitch.tv/gql', { accept: 'application/json', headers: { 'Client-Id': TW_CLIENT, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = JSON.parse(text);
  if (j.errors && !j.data) throw new Error('Twitch: ' + j.errors[0].message);
  return j.data || {};
}
const mapTwitch = (n) => ({ id: n.slug, source: 'twitch', url: `https://clips.twitch.tv/${n.slug}`, title: n.title, channel: (n.broadcaster && (n.broadcaster.displayName || n.broadcaster.login)) || '',
  duration: n.durationSeconds, views: n.viewCount, thumb: n.thumbnailURL, game: n.game && n.game.displayName });
const twGameNames = new Map();
async function twitchGameName(q) {
  const k = q.toLowerCase();
  if (twGameNames.has(k)) return twGameNames.get(k);
  const d = await twitchGql('query($q:String!){searchCategories(query:$q, first:1){edges{node{name}}}}', { q });
  const name = d.searchCategories && d.searchCategories.edges[0] && d.searchCategories.edges[0].node.name;
  if (!name) throw new Error(`No Twitch category found for “${q}”.`);
  twGameNames.set(k, name);
  return name;
}

// a Twitch clip's own MP4 (a signed link, good for a while): the small one for hover previews
const clipLinks = new Map();
async function twitchClipMp4(slug, big) {
  const key = slug + (big ? ':big' : ':small'), c = clipLinks.get(key);
  if (c && Date.now() - c.t < 10 * 60e3) return c.u;
  const d = await twitchGql(`query { clip(slug: ${JSON.stringify(slug)}) { videoQualities { quality sourceURL } playbackAccessToken(params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { signature value } } }`);
  const cl = d.clip, qs = (cl?.videoQualities || []).filter((x) => /^https:\/\//.test(x.sourceURL || '')).sort((a, b) => Number(a.quality) - Number(b.quality));
  if (!qs.length) throw new Error('That clip can’t be played here.');
  const pick = big ? qs.filter((x) => Number(x.quality) <= 720).pop() || qs[0] : qs[0];
  const tok = cl.playbackAccessToken;
  const u = tok ? `${pick.sourceURL}?sig=${encodeURIComponent(tok.signature)}&token=${encodeURIComponent(tok.value)}` : pick.sourceURL;
  if (clipLinks.size > 300) clipLinks.clear();
  clipLinks.set(key, { t: Date.now(), u });
  return u;
}
// a Kick clip is an HLS / MPEG-TS stream browsers can't play: ffmpeg repackages it as MP4 on the fly (no re-encode)
function kickClipMp4(u, full, req, res) {
  const args = ['-v', 'error', '-user_agent', UA, '-i', u, ...(full ? [] : ['-t', '8']), '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1'];
  const p = spawn(FFMPEG, args, { windowsHide: true });
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
  p.stdout.pipe(res);
  p.on('error', () => res.end());
  req.on('close', () => { try { p.kill(); } catch {} });
}

// ---- Kick ----
const mapKick = (c, ch) => {
  const chan = (c.channel && (c.channel.username || c.channel.slug)) || ch || '';
  return { id: c.id, source: 'kick', url: c.video_url || c.clip_url, page: `https://kick.com/${(c.channel && c.channel.slug) || chan}/clips/${c.id}`,
    title: c.title, channel: chan, duration: c.duration, views: c.view_count ?? c.views, thumb: c.thumbnail_url, game: c.category && c.category.name };
};
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
let kickCats = null, kickCatsAt = 0;
const KICK_ALIASES = { gta: 'grand theft auto v', 'gta v': 'grand theft auto v', 'gta 5': 'grand theft auto v', gta5: 'grand theft auto v', cod: 'call of duty',
  warzone: 'call of duty warzone', lol: 'league of legends', cs: 'counter-strike', cs2: 'counter-strike 2', csgo: 'counter-strike', valo: 'valorant',
  fn: 'fortnite', apex: 'apex legends', mc: 'minecraft', rl: 'rocket league', irl: 'just chatting', chatting: 'just chatting' };
async function kickCategorySlug(q) {
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let want = norm(q);
  want = KICK_ALIASES[want] || want;
  if (!kickCats || Date.now() - kickCatsAt > 6 * 3600e3) {
    const all = [];
    for (let page = 1; page <= 4; page++) {
      try {
        const j = JSON.parse(await curl(`https://kick.com/api/v1/subcategories?limit=100&page=${page}`, { accept: 'application/json' }));
        all.push(...(j.data || []).map((c) => ({ slug: c.slug, name: norm(c.name), viewers: c.viewers || 0 })));
        if (!j.next_page_url) break;
      } catch { break; }
    }
    if (all.length) { kickCats = all; kickCatsAt = Date.now(); }
  }
  const list = kickCats || [];
  const hit = list.find((c) => c.name === want) || list.find((c) => c.name.startsWith(want)) || list.filter((c) => c.name.includes(want)).sort((a, b) => b.viewers - a.viewers)[0];
  if (hit) return hit.slug;
  return slugify(want);
}

// ---- Reddit (public RSS feeds) ----
const VIDEO_HOSTS = /(clips\.twitch\.tv|twitch\.tv\/[^/]+\/clip\/|kick\.com\/[^/]+\/clips?\/|youtube\.com\/(watch|shorts)|youtu\.be\/|streamable\.com\/|medal\.tv\/|allstar\.gg\/)/i;
async function redditTop(sub, range, n) {
  const t = { day: 'day', week: 'week', month: 'month', year: 'year', all: 'all' }[range] || 'week';
  let xml;
  try { xml = await curl(`https://www.reddit.com/r/${sub}/top/.rss?t=${t}&limit=100`, { accept: 'application/atom+xml' }); }
  catch (e) {
    if (/429/.test(e.message)) throw new Error('Reddit only allows about one feed per minute without an account — wait a minute and try again (feeds you already opened stay loaded).');
    throw e;
  }
  const out = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const title = decodeHtml((/<title>([\s\S]*?)<\/title>/.exec(e) || [])[1]);
    const post = (/<link href="([^"]+)"/.exec(e) || [])[1];
    const content = decodeHtml((/<content type="html">([\s\S]*?)<\/content>/.exec(e) || [])[1]);
    const thumb = decodeHtml((/<media:thumbnail url="([^"]+)"/.exec(e) || [])[1]);
    const link = (/<a href="([^"]+)">\[link\]<\/a>/.exec(content) || [])[1];
    if (!link) continue;
    let url = null;
    const vr = /^https?:\/\/v\.redd\.it\/([A-Za-z0-9]+)/.exec(link);
    if (vr) url = `https://v.redd.it/${vr[1]}/HLSPlaylist.m3u8`;
    else if (VIDEO_HOSTS.test(link)) url = link;
    if (!url) continue;
    out.push({ id: (/<id>([^<]+)<\/id>/.exec(e) || [])[1] || url, source: 'reddit', url, page: post, title, channel: 'r/' + sub, thumb,
      via: vr ? null : new URL(link).hostname.replace(/^www\./, '') });
    if (out.length >= n) break;
  }
  return out;
}

// ---- Yarn (movie & TV quote clips) ----
async function yarnSearch(q, pg = 1) {
  const out = [], seen = new Set();
  for (const page of [pg * 2 - 1, pg * 2]) {
    if (!q && page > 1) break;
    const html = await curl(q ? `https://getyarn.io/yarn-find?text=${encodeURIComponent(q)}${page > 1 ? '&p=' + page : ''}` : 'https://getyarn.io/');
    const re = /href="\/yarn-clip\/([0-9a-f-]{36})" class="p"[\s\S]*?alt="([^"]*?) thumbnail \|[\s\S]*?play-time[^>]*>(?:<i[^>]*><\/i>)?\s*([\d.]+)s[\s\S]*?class="transcript[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
    let m;
    while ((m = re.exec(html))) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const quote = decodeHtml(m[4].replace(/<[^>]+>/g, '')).trim();
      out.push({ id: m[1], source: 'yarn', url: `https://y.yarn.co/${m[1]}.mp4`, page: `https://getyarn.io/yarn-clip/${m[1]}`, title: `“${quote}”`,
        channel: decodeHtml(m[2]), duration: Number(m[3]), thumb: `https://y.yarn.co/${m[1]}_thumb.jpg`, direct: true });
    }
  }
  return out;
}

// ---- Free stock footage & photos ----
const orientOk = (o, w, h) => (o === 'vertical' ? h > w : o === 'horizontal' ? w >= h : true);
async function pexelsSearch(q, orient, n, kind, pg = 1, quality = 'any') {
  if (!config.pexelsKey) throw new Error('Add your free Pexels key first.');
  const H = { accept: 'application/json', headers: { Authorization: config.pexelsKey } };
  const o = orient === 'vertical' ? '&orientation=portrait' : orient === 'horizontal' ? '&orientation=landscape' : '';
  if (kind === 'photo') {
    const url = q ? `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=80&page=${pg}${o}` : `https://api.pexels.com/v1/curated?per_page=80&page=${pg}`;
    const j = JSON.parse(await curl(url, H));
    return (j.photos || []).filter((ph) => q || orientOk(orient, ph.width, ph.height)).map((ph) => ({ id: 'pxp' + ph.id, source: 'pexels', photo: true, url: ph.src.large2x || ph.src.original,
      page: ph.url, title: ph.alt || q || 'Photo', channel: ph.photographer, thumb: ph.src.medium, w: ph.width, h: ph.height }));
  }
  // Pexels' own size filter: large = 4K, medium = Full HD
  const sz = quality === '4k' ? '&size=large' : quality === 'hd' ? '&size=medium' : '';
  const url = q ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=80&page=${pg}${o}${sz}` : `https://api.pexels.com/videos/popular?per_page=80&page=${pg}${sz ? '&min_width=' + (quality === '4k' ? 3840 : 1920) : ''}`;
  const j = JSON.parse(await curl(url, H));
  return (j.videos || []).map((v) => {
    // the best file up to 4K (the badge on the card is the quality you actually get)
    const files = (v.video_files || []).filter((f) => /mp4/.test(f.file_type || '') && Math.max(f.width || 0, f.height || 0) <= 4096).sort((a, b) => b.width * b.height - a.width * a.height);
    const f = files[0] || (v.video_files || [])[0];
    const name = (/video\/([a-z0-9-]+?)-\d+\/?$/.exec(v.url || '') || [])[1];
    return f && { id: 'px' + v.id, source: 'pexels', url: f.link, page: v.url, title: name ? name.replace(/-/g, ' ') : (q || 'Stock video'), channel: v.user && v.user.name,
      duration: v.duration, thumb: v.image, direct: true, w: f.width, h: f.height };
  }).filter((x) => x && (q || orientOk(orient, x.w, x.h)));
}
async function pixabaySearch(q, orient, n, kind, pg = 1) {
  if (!config.pixabayKey) throw new Error('Add your free Pixabay key first.');
  const base = `key=${encodeURIComponent(config.pixabayKey)}&q=${encodeURIComponent((q || '').slice(0, 95))}&per_page=100&page=${pg}&safesearch=true${q ? '' : '&order=popular&editors_choice=true'}`;
  if (kind === 'photo') {
    const o = orient === 'vertical' ? '&orientation=vertical' : orient === 'horizontal' ? '&orientation=horizontal' : '';
    const j = JSON.parse(await curl(`https://pixabay.com/api/?${base}&image_type=photo${o}`, { accept: 'application/json' }));
    return (j.hits || []).map((h) => ({ id: 'pbp' + h.id, source: 'pixabay', photo: true, url: h.largeImageURL, page: h.pageURL, title: h.tags, channel: h.user,
      thumb: h.webformatURL, w: h.imageWidth, h: h.imageHeight }));
  }
  const j = JSON.parse(await curl(`https://pixabay.com/api/videos/?${base}`, { accept: 'application/json' }));
  return (j.hits || []).map((h) => {
    const v = (h.videos.large && h.videos.large.url) ? h.videos.large : h.videos.medium;
    return { id: 'pb' + h.id, source: 'pixabay', url: v.url, page: h.pageURL, title: h.tags, channel: h.user, duration: h.duration,
      thumb: (h.videos.medium && h.videos.medium.thumbnail) || v.thumbnail, direct: true, w: v.width, h: v.height };
  }).filter((x) => orientOk(orient, x.w, x.h));
}
// Mixkit: free stock videos, no key needed
async function mixkitSearch(q, n, pg = 1) {
  if (q) {
    // Mixkit only understands simple tags: try the whole phrase, then each word
    const tries = [q, ...q.split(/\s+/)].map(slugify).filter((x, i, a) => x && a.indexOf(x) === i);
    for (const t of tries) { const r = await mixkitPage(t, n, pg); if (r.length >= 4 || pg > 1) return r; }
    return [];
  }
  return mixkitPage('', n, pg);
}
async function mixkitPage(slug, n, pg = 1) {
  const base = slug ? `https://mixkit.co/free-stock-video/discover/${slug}/` : 'https://mixkit.co/free-stock-video/';
  const out = [], seen = new Set();
  if (!slug && pg > 1) return [];
  for (const page of [pg]) {
    let html;
    try { html = await curl(page > 1 ? `${base}?page=${page}` : base); } catch (e) { if (page === 1) throw e; break; }
    const re = /<img src="([^"]+)" class="item-grid-video-player__thumb" alt="([^"]*)"[\s\S]*?<video src="([^"]+-360\.mp4)"/g;
    let m;
    while ((m = re.exec(html))) {
      if (seen.has(m[3])) continue;
      seen.add(m[3]);
      out.push({ id: 'mk' + out.length + '_' + m[3].split('/').pop(), source: 'mixkit', url: m[3].replace(/-360\.mp4$/, '-720.mp4'), preview: m[3],
        title: decodeHtml(m[2]).replace(/\.$/, ''), channel: 'Mixkit (free license)', thumb: m[1], direct: true });
    }
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}
// Openverse: millions of openly licensed photos, no key needed
async function openverseSearch(q, orient, n, pg = 1) {
  q = q || 'scenery'; // "All": a nice default instead of random uploads
  const ar = orient === 'vertical' ? '&aspect_ratio=tall' : orient === 'horizontal' ? '&aspect_ratio=wide' : '';
  const j = JSON.parse(await curl(`https://api.openverse.org/v1/images/?${q ? 'q=' + encodeURIComponent(q) + '&' : ''}page_size=20&page=${pg}&license_type=commercial,modification&size=large${ar}`, { accept: 'application/json' }));
  return (j.results || []).filter((r) => r.url && !/\.svg$/i.test(r.url)).map((r) => ({ id: 'ov' + r.id, source: 'openverse', photo: true, url: r.url, page: r.foreign_landing_url,
    title: decodeHtml(String(r.title || q || 'Photo').replace(/<[^>]+>/g, '')).trim() || 'Photo', channel: r.creator || r.provider, thumb: r.url, license: `CC ${String(r.license || '').toUpperCase()} — credit ${r.creator || r.provider}`, w: r.width, h: r.height }));
}
// Wikimedia Commons: free videos and photos, no key needed
async function commonsSearch(q, n, kind, orient, pg = 1) {
  const term = kind === 'photo' ? `filetype:bitmap ${q || 'incategory:"Featured_pictures_on_Wikimedia_Commons"'}` : `filetype:video ${q || 'nature'}`;
  const j = JSON.parse(await curl(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=50&gsroffset=${(pg - 1) * 50}&gsrsearch=${encodeURIComponent(term)}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=480&iiextmetadatafilter=LicenseShortName|Artist`, { accept: 'application/json' }));
  const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages.map((pg) => {
    const ii = (pg.imageinfo || [])[0];
    if (!ii) return null;
    const md = ii.extmetadata || {};
    const artist = md.Artist ? String(md.Artist.value).replace(/<[^>]+>/g, '').trim().slice(0, 40) : 'Wikimedia Commons';
    const lic = md.LicenseShortName ? md.LicenseShortName.value : 'free license';
    return { id: 'wc' + pg.pageid, source: 'commons', photo: kind === 'photo', direct: kind !== 'photo', url: ii.url.split('?')[0], page: ii.descriptionurl,
      title: pg.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '), channel: artist, thumb: ii.thumburl, license: `${lic} — credit ${artist}`,
      duration: kind === 'photo' ? null : undefined, w: ii.width, h: ii.height };
  }).filter((x) => x && (kind !== 'photo' || orientOk(orient, x.w, x.h)));
}

function probeCodec(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], { windowsHide: true },
      (err, out) => resolve(err ? null : String(out).trim()));
  });
}

const searchCache = new Map();
const searching = new Map(); // the same search asked twice at once shares one run
async function cached(key, fn) {
  const c = searchCache.get(key);
  if (c && Date.now() - c.t < (/source=(mixkit|destockd|archival|moments)/.test(key) ? 60 : 10) * 60e3) return c.v;
  if (searching.has(key)) return searching.get(key);
  const run = (async () => {
    let v = await fn();
    if (Array.isArray(v) && !v.length) v = await fn(); // sites are sometimes flaky: retry once
    if (!Array.isArray(v) || v.length) searchCache.set(key, { t: Date.now(), v });
    if (searchCache.size > 300) searchCache.delete(searchCache.keys().next().value);
    return v;
  })();
  searching.set(key, run);
  try { return await run; } finally { searching.delete(key); }
}

// ---- Medal.tv: the biggest gaming-clip site ----
const MEDAL_GAMES = ['fortnite', 'valorant', 'minecraft', 'roblox', 'call-of-duty-warzone', 'counter-strike-2', 'apex-legends', 'rocket-league',
  'grand-theft-auto-v', 'league-of-legends', 'overwatch-2', 'marvel-rivals'];
const MEDAL_ALIASES = { cs: 'counter-strike-2', cs2: 'counter-strike-2', csgo: 'counter-strike-2', 'counter strike': 'counter-strike-2', 'counter-strike': 'counter-strike-2',
  gta: 'grand-theft-auto-v', 'gta v': 'grand-theft-auto-v', 'gta 5': 'grand-theft-auto-v', warzone: 'call-of-duty-warzone', cod: 'call-of-duty-warzone',
  'call of duty': 'call-of-duty-warzone', overwatch: 'overwatch-2', ow: 'overwatch-2', lol: 'league-of-legends', apex: 'apex-legends', rl: 'rocket-league' };
const numViews = (s) => { const m = /([\d.,]+)\s*([KMB]?)/i.exec(s || ''); if (!m) return null; return Math.round(parseFloat(m[1].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] || 1)); };
async function medalGame(slug) {
  const html = await curl(`https://medal.tv/games/${slug}`);
  const re = /<a href="\/games\/([a-z0-9-]+)\/clips\/([A-Za-z0-9_-]+)"[^>]*>[\s\S]*?<img alt="([^"]*)"[^>]*?src="([^"]+)"[\s\S]*?<span class="w-full truncate[^"]*">[^<]*<\/span><div[^>]*><span>([^<]*)<\/span>[\s\S]*?<span>([\d.,]+[KMB]?) views<\/span>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    out.push({ id: 'md' + m[2], source: 'medal', url: `https://medal.tv/games/${m[1]}/clips/${m[2]}`, page: `https://medal.tv/games/${m[1]}/clips/${m[2]}`,
      title: decodeHtml(m[3]), thumb: decodeHtml(m[4]), channel: decodeHtml(m[5]), views: numViews(m[6]), game: m[1].replace(/-/g, ' ') });
  }
  return out;
}
// ---- Destockd: free archival / public-domain film shots, one clip per shot ----
async function destockdSearch(q, pg = 1) {
  const j = JSON.parse(await curl(`https://destockd.com/api/search?q=${encodeURIComponent(q || 'people')}&page=${pg}`, { accept: 'application/json' }));
  return (j.results || []).filter((r) => r.clip).map((r) => ({
    id: 'ds' + r.film + '/' + r.shot, source: 'destockd', url: r.clip, preview: r.preview,
    thumb: r.keyframe ? 'https://destockd.com' + r.keyframe : '', title: `${r.film} — ${String(r.shot).replace('shot_', 'shot ')}`,
    channel: r.color_type === 'bw' ? 'Destockd · B&W archival · public domain' : 'Destockd · archival · public domain', direct: true }));
}
// ---- Archival Footage (A/V Geeks): vintage stock clips with direct previews ----
async function archivalSearch(q, pg = 1) {
  const j = JSON.parse(await curl(`https://archival-footage.com/search.php?q=${encodeURIComponent(q || '')}&page=${pg}`, { accept: 'application/json' }));
  return (j.docs || []).filter((d) => d.video_url).map((d) => ({
    id: 'af' + d.identifier, source: 'archival', url: d.video_url, thumb: d.thumbnail || '', title: d.title || d.description || 'Archival clip',
    channel: `Archival Footage${d.year ? ' · ' + d.year : ''}`, direct: true }));
}
// ================= music & sounds (every item has audio: true and becomes the edit's song) =================
const mmss = (s) => { const p = String(s || '').split(':').map(Number); return p.some((x) => !isFinite(x)) ? null : p.reduce((a, b) => a * 60 + b, 0); };
// ---- YouTube songs: downloaded and turned into an MP3 ----
const YT_SONG_VARIANTS = ['official audio', 'lyrics', 'remix', 'slowed', 'sped up', 'instrumental', 'extended', 'bass boosted', 'phonk', 'edit audio'];
async function ytSongSearch(q, pg = 1) {
  await ensureYtdlp();
  const qq = pg === 1 ? `${q} audio` : `${q} ${YT_SONG_VARIANTS[(pg - 2) % YT_SONG_VARIANTS.length]}`;
  const list = await ytList(`ytsearch60:${qq}`, 60);
  // songs, not compilations or hour-long mixes
  return list.filter((x) => !x.duration || (x.duration >= 20 && x.duration <= 600)).map((x) => ({ ...x, audio: true }));
}
// ---- Freesound: sound effects, samples, loops (high-quality previews, no account) ----
async function freesoundSearch(q, pg = 1) {
  const html = await curl(`https://freesound.org/search/?q=${encodeURIComponent(q || 'whoosh')}&page=${pg}`);
  const out = [];
  const re = /<div\s+class="bw-player"([^>]+)>/g;
  let m;
  while ((m = re.exec(html))) {
    const a = {};
    for (const [, k, v] of m[1].matchAll(/data-([a-z0-9-]+)="([^"]*)"/g)) a[k] = decodeHtml(v);
    if (!a['mp3'] || !a['sound-id']) continue;
    const mp3 = a['mp3'].replace(/-lq\.mp3$/, '-hq.mp3');
    out.push({ id: 'fs' + a['sound-id'], source: 'freesound', url: mp3, preview: mp3, title: (a.title || 'Sound').replace(/\.(wav|aiff?|flac|mp3|ogg)$/i, ''),
      channel: `${a.username || 'Freesound'} · ${Number(a['num-downloads'] || 0).toLocaleString('en-US')} downloads`, duration: Number(a.duration) || null,
      thumb: '', page: `https://freesound.org/people/${a.username}/sounds/${a['sound-id']}/`, audio: true });
  }
  return out;
}
// ---- Free Music Archive: full independent songs (Creative Commons) ----
async function fmaSearch(q, pg = 1) {
  const html = await curl(`https://freemusicarchive.org/search?quicksearch=${encodeURIComponent(q || 'chill')}&page=${pg}`);
  const out = [];
  const re = /data-track-info='([^']+)'/g;
  let m;
  while ((m = re.exec(html))) {
    let t; try { t = JSON.parse(decodeHtml(m[1])); } catch { continue; }
    if (!t.playbackUrl) continue;
    const around = html.slice(m.index, m.index + 4000), dur = /\b(\d{1,2}:\d{2})\b/.exec(around);
    out.push({ id: 'fma' + t.id, source: 'fma', url: t.playbackUrl, preview: t.playbackUrl, title: t.title, channel: `${t.artistName} · Creative Commons`,
      duration: dur ? mmss(dur[1]) : null, page: t.url, audio: true });
  }
  return out;
}
// ---- ccMixter: remixes, instrumentals, a cappellas ----
async function ccmixterSearch(q, pg = 1) {
  // ccMixter's API returns nothing for big pages, so ask for 4 small pages at once (one bad page just drops out)
  const chunks = await Promise.all([0, 1, 2, 3].map((k) => curl(`https://ccmixter.org/api/query?${q ? 'search=' + encodeURIComponent(q) + '&' : ''}f=json&limit=10&offset=${(pg - 1) * 40 + k * 10}&sort=rank`, { accept: 'application/json' })
    .then((t) => { const a = JSON.parse(t); return Array.isArray(a) ? a : []; }).catch(() => [])));
  return chunks.flat().map((u) => {
    const f = (u.files || []).find((x) => /\.mp3$/i.test(x.download_url || '')) || (u.files || [])[0];
    if (!f || !f.download_url) return null;
    return { id: 'cc' + u.upload_id, source: 'ccmixter', url: f.download_url, preview: '/api/audio?u=' + encodeURIComponent(f.download_url), title: u.upload_name,
      channel: `${u.user_real_name || u.user_name} · ${u.license_name || 'CC'}`, duration: mmss(f.file_format_info && f.file_format_info.ps), page: u.file_page_url, audio: true };
  }).filter(Boolean);
}
// ---- Internet Archive: albums and recordings, listed track by track ----
async function iaAudioSearch(q, pg = 1) {
  // music collections only (netlabel releases, community audio, live concerts) — not podcasts or recitations
  const query = `${q ? `(${q}) AND ` : ''}mediatype:audio AND format:"VBR MP3" AND collection:(netlabels OR opensource_audio OR etree OR audio_music)${q ? '' : ' AND subject:(music)'}`;
  const j = JSON.parse(await curl(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&sort[]=downloads+desc&rows=12&page=${pg}&output=json`, { accept: 'application/json' }));
  const docs = (j.response && j.response.docs) || [];
  const lists = await Promise.all(docs.map(async (d) => {
    try {
      const md = JSON.parse(await curl(`https://archive.org/metadata/${encodeURIComponent(d.identifier)}`, { accept: 'application/json' }));
      const creator = Array.isArray(d.creator) ? d.creator[0] : d.creator;
      return (md.files || []).filter((f) => /\.mp3$/i.test(f.name) && (!f.format || /mp3/i.test(f.format))).slice(0, 6).map((f) => {
        const url = `https://archive.org/download/${encodeURIComponent(d.identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`;
        return { id: 'ia' + d.identifier + '/' + f.name, source: 'iaaudio', url, preview: url, title: (f.title || f.name.replace(/\.mp3$/i, '').replace(/_/g, ' ')),
          channel: `${creator || d.title} · Internet Archive`, duration: f.length ? (String(f.length).includes(':') ? mmss(f.length) : Number(f.length)) : null,
          thumb: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`, page: `https://archive.org/details/${encodeURIComponent(d.identifier)}`, audio: true };
      });
    } catch { return []; }
  }));
  // single tracks, not hour-long mixes
  return lists.flat().filter((x) => !x.duration || x.duration <= 1200);
}

// ---- GIPHY: reaction clips (silent loops) ----
async function giphySearch(q) {
  const html = await curl(`https://giphy.com/search/${slugify(q || 'reaction')}`);
  const un = html.replace(/\\"/g, '"').replace(/\\\//g, '/');
  const re = /"original_mp4":\{[^}]*?"mp4":"(https:\/\/media[0-9]?\.giphy\.com\/media\/[^"]+?\/giphy\.mp4)"/g;
  const out = [], seen = new Set();
  let m;
  while ((m = re.exec(un))) {
    const url = m[1], id = url.split('/').slice(-2)[0];
    if (seen.has(id)) continue;
    seen.add(id);
    const t = un.lastIndexOf('"title":"', m.index);
    const title = t > m.index - 8000 && t >= 0 ? un.slice(t + 9, un.indexOf('"', t + 9)) : '';
    out.push({ id: 'gy' + id, source: 'giphy', url, thumb: url.replace(/giphy\.mp4$/, 'giphy_s.gif'), title: decodeHtml(title).replace(/ GIF$/, '') || 'GIPHY clip',
      channel: 'GIPHY · no sound', direct: true });
  }
  return out;
}
// ---- Kick paging (cursor based) ----
const kickCursors = new Map();
async function kickPage(base, p) {
  let cursor = null, data = null;
  for (let i = 1; i <= p; i++) {
    const key = base + '#' + i;
    if (i < p && kickCursors.has(key)) { cursor = kickCursors.get(key); if (!cursor) return []; continue; }
    data = JSON.parse(await curl(cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base, { accept: 'application/json' }));
    cursor = data.nextCursor || data.next_cursor || null;
    kickCursors.set(key, cursor);
    if (!cursor && i < p) return [];
  }
  return (data && data.clips) || [];
}
async function kickTwoPages(base, pg) {
  const a = await kickPage(base, pg * 2 - 1);
  const b = a.length ? await kickPage(base, pg * 2).catch(() => []) : [];
  return a.concat(b);
}
const YT_VARIANTS = ['moments', 'compilation', 'best', 'clip', 'part 2', 'edit', 'top 10', 'full scene', 'viral', 'reaction', 'hd', '2026', 'scene', 'shorts'];
const dedupeById = (list) => { const seen = new Set(); return list.filter((x) => (seen.has(x.id) ? false : seen.add(x.id))); };

const GAMING_LIST = ['Fortnite', 'VALORANT', 'Grand Theft Auto V', 'Minecraft', 'Call of Duty: Warzone', 'League of Legends', 'Counter-Strike', 'Apex Legends', 'Marvel Rivals', 'Rocket League'];
const NON_GAMING = /chatting|irl|slots|casino|pools|music|podcast|gambl|asmr|talk shows|art|travel|sleeping/i;
// the biggest game categories on Kick (their clip lists are where gaming clips are)
const KICK_GAMES = ['grand-theft-auto-v', 'fortnite', 'valorant', 'counter-strike-2', 'call-of-duty-warzone', 'minecraft', 'rust', 'league-of-legends'];
const kickNorm = (x) => String(x || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const YT_SP = {
  // YouTube search filters: upload date (+ under 4 minutes)
  short: 'EgIYAQ%3D%3D', day: 'EgIIAg%3D%3D', week: 'EgIIAw%3D%3D', month: 'EgIIBA%3D%3D',
  'day+short': 'EgQIAhgB', 'week+short': 'EgQIAxgB', 'month+short': 'EgQIBBgB',
};
// YouTube search filter ("sp") for any mix of upload date, type (9 = Shorts), under-4-min, HD and 4K
function ytSp({ when, type, short, hd, k4 } = {}) {
  const b = [];
  const date = { hour: 1, day: 2, week: 3, month: 4, year: 5 }[when];
  if (date) b.push(0x08, date);
  if (type) b.push(0x10, type);
  if (short) b.push(0x18, 1);
  if (hd) b.push(0x20, 1);
  if (k4) b.push(0x70, 1);
  return b.length ? encodeURIComponent(Buffer.from([0x12, b.length, ...b]).toString('base64')) : '';
}
const ytResults = (query, sp) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${sp ? '&sp=' + sp : ''}`;
// Mark which results are available in 4K: YouTube's own 4K-filtered search for the same words,
// started alongside the normal search (k4search) and matched up afterwards (tag4k)
const k4search = (query, opts) => ytList(ytResults(query, ytSp({ ...opts, k4: true })), 60).catch(() => []);
async function tag4k(list, k4) {
  const ids = new Set((await k4).map((x) => x.id));
  return list.map((m) => (ids.has(m.id) ? { ...m, res: '4K' } : m));
}
// video size class from width × height (vertical videos count by their long side too)
function resClass(w, h) {
  if (!w || !h) return null;
  const L = Math.max(w, h), S = Math.min(w, h);
  return L >= 3800 || S >= 2100 ? '4K' : L >= 2500 || S >= 1400 ? '2K' : L >= 1900 || S >= 1060 ? '1080p' : L >= 1260 || S >= 700 ? '720p' : 'SD';
}
const RES_RANK = { SD: 0, '720p': 1, HD: 1, '1080p': 2, '2K': 3, '4K': 4 };

async function ytList(target, count, start = 1) {
  const d = JSON.parse(await runYtdlp(['--flat-playlist', '-J', '--playlist-start', String(start), '--playlist-end', String(start + count - 1), '--', target]));
  return (d.entries || []).filter((e) => e && e.id && (e.ie_key === 'Youtube' || /watch|shorts/.test(e.url || '')) && e.duration !== 0)
    .map((e) => ({ id: e.id, source: 'youtube', url: `https://www.youtube.com/watch?v=${e.id}`, title: e.title, channel: e.channel || e.uploader,
      duration: e.duration, views: e.view_count, thumb: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg` }));
}

// The quick first answer for YouTube searches: one request for the results page itself (under a second),
// read straight from the page's own data. yt-dlp's 100-result list (5+ seconds) follows behind it.
const ytText = (t) => (t ? t.simpleText || (t.runs || []).map((r) => r.text).join('') || t.content || '' : '');
const ytSecs = (s) => { if (!s) return null; const p = String(s).split(':').map(Number); return p.some(isNaN) ? null : p.reduce((a, b) => a * 60 + b, 0); };
function ytWalk(o, out, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 40) return;
  if (Array.isArray(o)) { for (const x of o) ytWalk(x, out, depth + 1); return; }
  if (o.videoRenderer?.videoId) {
    const v = o.videoRenderer;
    out.push({ id: v.videoId, title: ytText(v.title), channel: ytText(v.ownerText), duration: ytSecs(ytText(v.lengthText)), views: numViews(ytText(v.viewCountText)) });
    return;
  }
  if (o.lockupViewModel?.contentId && /VIDEO/.test(o.lockupViewModel.contentType || '')) {
    const v = o.lockupViewModel, s = JSON.stringify(v.contentImage || {});
    const parts = (v.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [])
      .flatMap((r) => (r.metadataParts || []).map((p) => ytText(p.text)));
    out.push({ id: v.contentId, title: ytText(v.metadata?.lockupMetadataViewModel?.title), channel: '',
      duration: ytSecs((/"thumbnailBadgeViewModel":\{"text":"([\d:]+)"/.exec(s) || [])[1]), views: numViews(parts.find((p) => /views?$/i.test(p))) });
    return;
  }
  if (o.shortsLockupViewModel) {
    const v = o.shortsLockupViewModel, id = v.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
    if (id) out.push({ id, title: ytText(v.overlayMetadata?.primaryText), views: numViews(ytText(v.overlayMetadata?.secondaryText)), shorts: true });
    return;
  }
  for (const k in o) ytWalk(o[k], out, depth + 1);
}
async function ytQuick(target) {
  const html = await curl(target, { headers: { 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' } });
  const m = /var ytInitialData = (\{[\s\S]*?\});<\/script>/.exec(html);
  if (!m) throw new Error('YouTube page changed');
  const out = [];
  ytWalk(JSON.parse(m[1]), out);
  return dedupeById(out).map((e) => ({ ...e, source: 'youtube', url: `https://www.youtube.com/watch?v=${e.id}`, thumb: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg` }));
}
// the first-page YouTube answer, while the full search runs on into the cache
async function ytFast(q) {
  const source = q.get('source') || 'youtube';
  const full = new URLSearchParams(q); full.delete('fast');
  const rest = finderSearch(full); rest.catch(() => {}); // fills the cache for the follow-up request
  const query = (q.get('q') || '').trim().slice(0, 200);
  const quality = ['hd', '4k'].includes(q.get('quality')) ? q.get('quality') : '';
  const short = q.get('short') === '1';
  const when = ['day', 'week', 'month'].includes(q.get('when')) ? q.get('when') : '';
  let target;
  if (source === 'ytchannel') {
    const handle = (q.get('handle') || '').replace(/[^A-Za-z0-9_.-]/g, '');
    target = query ? `https://www.youtube.com/@${handle}/search?query=${encodeURIComponent(query)}` : `https://www.youtube.com/@${handle}/videos`;
  } else if (source === 'shorts') target = ytResults(`${query} #shorts`, ytSp({ hd: quality === 'hd', k4: quality === '4k' }));
  // type 1 = videos only, so the first page isn't mostly a Shorts shelf
  else target = ytResults(query, ytSp({ when, short, type: short ? 0 : 1, hd: quality === 'hd', k4: quality === '4k' }));
  try {
    let list = await ytQuick(target);
    if (source === 'ytchannel') list = list.map((m) => ({ ...m, channel: m.channel || q.get('handle') }));
    if (source === 'shorts') list = list.filter((m) => !m.duration || m.duration <= 180).map((m) => ({ ...m, shorts: true }));
    else if (source === 'youtube') list = list.filter((m) => (short ? m.shorts || (m.duration && m.duration <= 240) : !m.shorts && m.duration !== 0));
    if (quality === '4k') list = list.map((m) => ({ ...m, res: '4K' }));
    else if (quality === 'hd') list = list.map((m) => ({ ...m, res: 'HD' }));
    if (list.length) return list;
  } catch { /* fall through to the full search */ }
  return rest;
}

// ---- Exact moments, from thepartwhere.com: single shots of movies, shows, memes and sports, each one
// a YouTube upload plus the exact seconds. Its describe-a-moment search is sometimes down, so when it is,
// the moments of the title you named are fetched and ranked by your words here instead.
const TPW = 'https://www.thepartwhere.com';
let tpwInfo = null;
async function tpwTitles() {
  if (tpwInfo && Date.now() - tpwInfo.t < 3600e3) return tpwInfo;
  const j = JSON.parse(await curl(`${TPW}/api/featured`, { accept: 'application/json' }));
  const pick = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 1000) : []);
  tpwInfo = { t: Date.now(), titles: pick(j.fandoms), memes: pick(j.meme_fandoms), sports: pick(j.sport_fandoms),
    showcase: Array.isArray(j.showcase) ? j.showcase : [], count: Number(j.shot_count) || null };
  return tpwInfo;
}
const tpwApi = async (params) => JSON.parse(await curl(`${TPW}/api/search?${new URLSearchParams({ ...params, nolog: '1' })}`, { accept: 'application/json' }));
function mapMoment(r) {
  const yt = String(r.yt_video_id || (/thumbs\/([A-Za-z0-9_-]{11})\//.exec(r.thumb_url || '') || [])[1] || '');
  const a = Number(r.t_start_s), b = Number(r.t_end_s);
  if (!/^[A-Za-z0-9_-]{11}$/.test(yt) || !Number.isFinite(a)) return null;
  const end = Number.isFinite(b) && b > a ? b : a + 2;
  const what = String(r.scene_name || r.caption || 'Moment').trim();
  return { id: yt, source: 'youtube', moment: true, url: `https://www.youtube.com/watch?v=${yt}&t=${Math.floor(a)}s`, start: a, end,
    duration: Math.round((end - a) * 100) / 100, title: what.length > 140 ? what.slice(0, 137) + '…' : what, channel: String(r.fandom || ''),
    caption: String(r.caption || '').slice(0, 400), tags: Array.isArray(r.tags) ? r.tags.slice(0, 12).map(String) : [],
    thumb: /^https:\/\//.test(r.thumb_url || '') ? r.thumb_url : `https://i.ytimg.com/vi/${yt}/mqdefault.jpg`,
    page: r.shot_id && /^[\w-]{8,64}$/.test(r.shot_id) ? `${TPW}/m/${r.shot_id}` : TPW };
}
// a title's moments come back in a fresh random order each time: a few asks at once give a full page
async function tpwBrowse(title, asks = 5) {
  const all = await Promise.allSettled(Array.from({ length: asks }, () => tpwApi({ browse: title })));
  const seen = new Set(), out = [];
  for (const r of all) for (const x of r.status === 'fulfilled' ? r.value.results || [] : []) {
    const m = mapMoment(x); if (m && !seen.has(m.url)) { seen.add(m.url); out.push(m); }
  }
  return out;
}
const STOP = new Set('the a an of in on at to and or is are he she it they his her their its with from where part when that this for by as up out into over then him them who what'.split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
async function momentsSearch(q, pg) {
  const query = (q.get('q') || '').trim().slice(0, 200);
  let title = (q.get('title') || '').trim().slice(0, 120);
  const info = await tpwTitles().catch(() => ({ titles: [], memes: [], sports: [], showcase: [] }));
  const known = [...info.titles, ...info.memes, ...info.sports];
  // a title named inside the words ("joker stairs") counts as picking it
  if (!title && query) {
    const low = ' ' + query.toLowerCase() + ' ';
    title = known.filter((t) => t.length > 2 && low.includes(' ' + t.toLowerCase().replace(/\s*\(\d{4}\)$/, '') + ' ')).sort((x, y) => y.length - x.length)[0] || '';
  }
  if (!query && !title) {
    // nothing typed yet: the site's showcase, then moments from a few titles picked at random (taking turns)
    const pick = [...info.titles].sort(() => Math.random() - 0.5).slice(0, 4);
    const lists = await Promise.all(pick.map((t) => tpwBrowse(t, 1).catch(() => [])));
    const mixed = pg > 1 ? [] : info.showcase.map(mapMoment).filter(Boolean);
    for (let i = 0; i < 12; i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
    return mixed;
  }
  if (!query) return tpwBrowse(title, pg > 1 ? 4 : 5);
  if (pg === 1) {
    try {
      const j = await tpwApi(title ? { q: query, fandom: title } : { q: query });
      const list = (j.results || []).map(mapMoment).filter(Boolean);
      if (list.length) return list;
    } catch { /* their search is down: rank this title's moments here */ }
  }
  if (!title) {
    if (pg > 1) return [];
    throw new Error('The describe-a-moment search on thepartwhere.com isn’t answering right now. Add the movie or show too (e.g. “Joker stairs”) or pick a title below.');
  }
  const want = words(query.toLowerCase().replace(title.toLowerCase().replace(/\s*\(\d{4}\)$/, ''), ' '));
  const list = await tpwBrowse(title, pg > 1 ? 6 : 8);
  if (!want.length) return list;
  const score = (m) => { const have = new Set(words(`${m.title} ${m.caption} ${m.tags.join(' ')}`)); return want.reduce((s, w) => s + (have.has(w) ? 2 : [...have].some((h) => h.startsWith(w.slice(0, 4))) ? 1 : 0), 0); };
  return list.map((m) => ({ m, s: score(m) })).sort((x, y) => y.s - x.s).map((x) => x.m);
}

async function finderSearch(q) {
  const source = q.get('source') || 'youtube';
  if (q.get('fast') === '1' && ['youtube', 'shorts', 'ytchannel'].includes(source) && (Number(q.get('page')) || 1) === 1 && (source === 'ytchannel' ? q.get('handle') : q.get('q'))) return ytFast(q);
  const n = Math.max(1, Math.min(50, Number(q.get('n')) || 24));
  const range = q.get('range') || 'week';
  const pg = Math.max(1, Math.min(30, Number(q.get('page')) || 1));
  const query = (q.get('q') || '').trim().slice(0, 200);
  const quality = ['hd', '4k'].includes(q.get('quality')) ? q.get('quality') : 'any';
  const need = (what) => { if (!query) throw new Error(what || 'Type something to search for.'); };
  const key = [...q.entries()].map(([k, v]) => `${k}=${v}`).join('&');

  return cached(key, async () => {
    switch (source) {
      case 'youtube': {
        need();
        await ensureYtdlp();
        const short = q.get('short') === '1';
        const when = ['day', 'week', 'month'].includes(q.get('when')) ? q.get('when') : '';
        const okLen = (m) => !short || (m.duration && m.duration <= 240);
        const qq = pg === 1 ? query : `${query} ${YT_VARIANTS[(pg - 2) % YT_VARIANTS.length]}`;
        // Quality filter: YouTube's own HD / 4K search filter (only videos available in that quality)
        if (quality === '4k' || quality === 'hd') {
          const list = await ytList(ytResults(qq, ytSp({ when, short, hd: quality === 'hd', k4: quality === '4k' })), 100);
          const tagged = quality === '4k' ? list.map((m) => ({ ...m, res: '4K' })) : await tag4k(list.map((m) => ({ ...m, res: 'HD' })), k4search(qq, { when, short }));
          return tagged.filter(okLen);
        }
        const k4 = k4search(qq, { when, short });
        let list;
        if (when && pg === 1) {
          const [a1, b1] = await Promise.all([
            ytList(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${YT_SP[short ? when + '+short' : when]}`, 100).catch(() => []),
            ytList(`ytsearch100:${query} ${when === 'day' ? 'today' : 'this ' + when}`, 100),
          ]);
          list = dedupeById(a1.concat(b1.filter(okLen)));
        } else if (!short) list = await ytList(`ytsearch100:${qq}`, 100);
        else {
          const [a2, b2] = await Promise.all([ytList(`ytsearch100:${qq}`, 100), ytList(`ytsearch100:${qq} #shorts`, 100).catch(() => [])]);
          list = dedupeById(a2.filter(okLen).concat(b2.filter(okLen)));
        }
        return tag4k(list, k4);
      }
      case 'shorts': {
        need();
        await ensureYtdlp();
        const qq = pg === 1 ? query : `${query} ${YT_VARIANTS[(pg - 2) % YT_VARIANTS.length]}`;
        // YouTube can't combine its Shorts and 4K filters: search "#shorts" with the quality filter instead
        if (quality === '4k' || quality === 'hd') {
          const list = await ytList(ytResults(`${qq} #shorts`, ytSp({ hd: quality === 'hd', k4: quality === '4k' })), 100);
          return list.filter((m) => !m.duration || m.duration <= 180).map((m) => ({ ...m, shorts: true, res: quality === '4k' ? '4K' : 'HD' }));
        }
        const k4 = k4search(`${qq} #shorts`, {});
        const [a1, b1] = await Promise.all([
          ytList(`ytsearch100:${qq} #shorts`, 100),
          pg === 1 ? ytList(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQCQ%3D%3D`, 60).catch(() => []) : Promise.resolve([]),
        ]);
        let list = dedupeById(b1.concat(a1)).filter((m) => !m.duration || m.duration <= 180).map((m) => ({ ...m, shorts: true }));
        // stream clip Shorts: the most-watched first, and no "how to clip your stream" tutorials
        if (q.get('sort') === 'views') list = list.filter((m) => !/\b(how to|tutorial|clipping tool|auto.?clip|multistream|obs|setup|guide)\b/i.test(m.title || ''))
          .sort((x, y) => (y.views || 0) - (x.views || 0));
        return tag4k(list, k4);
      }
      case 'ytchannel': {
        const handle = (q.get('handle') || '').replace(/[^A-Za-z0-9_.-]/g, '');
        if (!handle) throw new Error('Pick a channel.');
        await ensureYtdlp();
        const per = 60;
        return ytList(query ? `https://www.youtube.com/@${handle}/search?query=${encodeURIComponent(query)}` : `https://www.youtube.com/@${handle}/videos`, per, (pg - 1) * per + 1);
      }
      case 'dailymotion': {
        need();
        const lim = q.get('short') === '1' ? '&shorter_than=4' : '';
        const j = JSON.parse(await curl(`https://api.dailymotion.com/videos?search=${encodeURIComponent(query)}&fields=id,title,duration,thumbnail_360_url,owner.screenname,views_total&sort=relevance&limit=100&page=${pg}${lim}`, { accept: 'application/json' }));
        return (j.list || []).map((v) => ({ id: v.id, source: 'dailymotion', url: `https://www.dailymotion.com/video/${v.id}`, title: v.title,
          channel: v['owner.screenname'] || '', duration: v.duration, views: v.views_total, thumb: v.thumbnail_360_url }));
      }
      case 'yarn': return yarnSearch(query, pg);
      case 'moments': return momentsSearch(q, pg);
      case 'medal': {
        if (pg > 1) return [];
        if (query) {
          const k = query.toLowerCase().trim();
          return medalGame(MEDAL_ALIASES[k] || slugify(k));
        }
        const all = await Promise.allSettled(MEDAL_GAMES.map(medalGame));
        return all.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).sort((x, y) => (y.views || 0) - (x.views || 0));
      }
      case 'giphy': return pg > 1 ? [] : giphySearch(query);
      case 'twitch': case 'kick': {
        const ch = (q.get('channel') || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(twitch\.tv|kick\.com)\//i, '').split(/[/?#]/)[0];
        if (!/^[A-Za-z0-9_-]{2,40}$/.test(ch)) throw new Error('Type a streamer’s channel name.');
        if (source === 'kick') {
          const t = { day: 'day', week: 'week', month: 'month', all: 'all' }[range] || 'week';
          return (await kickTwoPages(`https://kick.com/api/v2/channels/${ch.toLowerCase()}/clips?sort=view&time=${t}`, pg)).map((c) => mapKick(c, ch));
        }
        const first = Math.min(100, n * pg);
        try {
          const d = await twitchGql(`query($login:String!,$p:ClipsPeriod){user(login:$login){clips(first:${first}, criteria:{period:$p, sort:VIEWS_DESC}){edges{node{${TW_FIELDS}}}}}}`,
            { login: ch.toLowerCase(), p: TW_PERIOD[range] || 'LAST_WEEK' });
          if (!d.user) throw new Error(`No Twitch channel called “${ch}”.`);
          return d.user.clips.edges.map((e) => mapTwitch(e.node)).slice((pg - 1) * n);
        } catch (e) {
          if (/No Twitch channel/.test(e.message) || pg > 1) throw e;
          await ensureYtdlp(); // fallback
          const r = { day: '24hr', week: '7d', month: '30d', all: 'all' }[range] || '7d';
          const d = JSON.parse(await runYtdlp(['--flat-playlist', '-J', '--playlist-end', String(n), '--', `https://www.twitch.tv/${ch}/clips?filter=clips&range=${r}`]));
          return (d.entries || []).filter((x) => x && x.url).map((x) => ({ id: x.id, source: 'twitch', url: x.url, title: x.title, channel: ch, duration: x.duration, views: x.view_count, thumb: x.thumbnail }));
        }
      }
      case 'twitchgame': {
        need('Type a game or category, e.g. Valorant or Just Chatting.');
        const name = await twitchGameName(query);
        const langs = q.get('en') === '1' ? ', languages:[EN]' : '';
        const first = Math.min(100, n * pg);
        const d = await twitchGql(`query($name:String!,$p:ClipsPeriod){game(name:$name){displayName clips(first:${first}, criteria:{period:$p, sort:VIEWS_DESC${langs}}){edges{node{${TW_FIELDS}}}}}}`,
          { name, p: TW_PERIOD[range] || 'LAST_WEEK' });
        if (!d.game) throw new Error(`No Twitch category “${query}”.`);
        return d.game.clips.edges.map((e) => mapTwitch(e.node)).slice((pg - 1) * n);
      }
      case 'kickgame': {
        need('Type a game or category, e.g. GTA V or Just Chatting.');
        const slug = await kickCategorySlug(query);
        const t = { day: 'day', week: 'week', month: 'month', all: 'all' }[range] || 'week';
        // Kick's list for a category also holds clips of other categories: three pages, then keep that game's own clips
        const base = `https://kick.com/api/v2/categories/${slug}/clips?sort=view&time=${t}`, all = [];
        for (let p = pg * 3 - 2; p <= pg * 3; p++) { const c = await kickPage(base, p).catch(() => []); if (!c.length) break; all.push(...c); }
        const list = dedupeById(all.map((c) => mapKick(c))), want = kickNorm(slug.replace(/-/g, ' '));
        const own = list.filter((c) => { const g = kickNorm(c.game); return g && (g.includes(want) || want.includes(g)); });
        return (own.length >= 8 ? own : list).sort((x, y) => (y.views || 0) - (x.views || 0));
      }
      case 'kicktrend': {
        const t = { day: 'day', week: 'week', month: 'month', all: 'all' }[range] || 'day';
        if (q.get('gaming') === '1') {
          // gaming only: the top clips of each big game category, mixed and sorted by views
          const lists = await Promise.allSettled(KICK_GAMES.map((g) => kickPage(`https://kick.com/api/v2/categories/${g}/clips?sort=view&time=${t}`, pg)));
          const all = lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).map((c) => mapKick(c)).filter((c) => c.game && !NON_GAMING.test(c.game));
          if (!all.length && lists.every((r) => r.status === 'rejected')) throw lists[0].reason;
          return dedupeById(all).sort((x, y) => (y.views || 0) - (x.views || 0));
        }
        return (await kickTwoPages(`https://kick.com/api/v2/clips?sort=view&time=${t}`, pg)).map((c) => mapKick(c));
      }
      case 'twitchtop': {
        // top clips across the biggest categories (optionally games only)
        const games = q.get('gaming') === '1' ? GAMING_LIST : ['Just Chatting', ...GAMING_LIST.slice(0, 7)];
        const per = Math.min(100, (Math.ceil(n / games.length) + 4) * pg);
        const langs = q.get('en') === '0' ? '' : ', languages:[EN]';
        const parts = games.map((g, i) => `g${i}: game(name:${JSON.stringify(g)}){clips(first:${per}, criteria:{period:$p, sort:VIEWS_DESC${langs}}){edges{node{${TW_FIELDS}}}}}`).join(' ');
        const d = await twitchGql(`query($p:ClipsPeriod){ ${parts} }`, { p: TW_PERIOD[range] || 'LAST_WEEK' });
        return Object.values(d).filter((g) => g && g.clips).flatMap((g) => g.clips.edges.map((e) => mapTwitch(e.node)))
          .sort((x, y) => (y.views || 0) - (x.views || 0)).slice((pg - 1) * n, pg * n);
      }
      case 'streamtrend': {
        // the most-viewed clips right now on Twitch AND Kick, taking turns so both show up
        const sub = (src) => finderSearch(new URLSearchParams({ source: src, range, n: String(n), page: String(pg), en: q.get('en') || '1' }));
        const [tw, ki] = await Promise.allSettled([sub('twitchtop'), sub('kicktrend')]);
        const A = tw.status === 'fulfilled' ? tw.value : [], B = ki.status === 'fulfilled' ? ki.value : [];
        if (!A.length && !B.length) throw new Error((tw.reason || ki.reason || {}).message || 'No clips found right now.');
        const out = [];
        for (let i = 0; i < Math.max(A.length, B.length); i++) { if (A[i]) out.push(A[i]); if (B[i]) out.push(B[i]); }
        return out;
      }
      case 'reddit': throw new Error('Reddit blocks apps from reading it now: use Viral feeds or Streamers → Trending instead.');
      case 'reddit-old': {
        const sub = (q.get('sub') || '').replace(/[^A-Za-z0-9_]/g, '');
        if (!sub) throw new Error('Pick a feed.');
        return redditTop(sub, range, n);
      }
      case 'pexels': return pexelsSearch(query, q.get('orient'), n, q.get('kind'), pg, quality);
      case 'pixabay': return pixabaySearch(query, q.get('orient'), n, q.get('kind'), pg);
      case 'mixkit': return mixkitSearch(query, n, pg);
      case 'destockd': return destockdSearch(query, pg);
      case 'archival': return archivalSearch(query, pg);
      case 'ytsong': need('Type a song or artist.'); return ytSongSearch(query, pg);
      case 'freesound': return freesoundSearch(query, pg);
      case 'fma': return fmaSearch(query, pg);
      case 'ccmixter': return ccmixterSearch(query, pg);
      case 'iaaudio': return iaAudioSearch(query, pg);
      case 'openverse': return openverseSearch(query, q.get('orient'), n, pg);
      case 'commons': return commonsSearch(query, n, q.get('kind'), q.get('orient'), pg);
      default: throw new Error('Unknown source');
    }
  });
}

// ---------------- crowd ratings: what people rewatch, quote and rate ----------------
// For each clip: YouTube's "Most replayed" graph and the top comments (the lines fans quote, the timestamps
// they point at, with like counts), plus the memorable quotes Wikiquote lists for that movie / show.
// Saved next to the clip (<file>.crowd.json) so each clip is looked up only once.
const crowdJobs = new Map();
const sidecar = (file, kind) => `${file}.${kind}.json`;
function writeSrc(file, info) { try { fs.writeFileSync(sidecar(file, 'src'), JSON.stringify(info)); } catch {} }
const normWords = (s) => String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[’']/g, '').replace(/[^a-z0-9&]+/g, ' ').trim();
function cleanTitle(t) {
  return String(t || '').replace(/\.(mp4|mov|mkv|webm|avi|m4v)$/i, '').replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .replace(/\b(official|full|hd|4k|1080p|720p|60fps|uhd|clip|clips|scene|scenes|movieclips|trailer|teaser|edit|tiktok|shorts?|best|moments?|funniest|compilation|reaction|season \d+|episode \d+|s\d+\s*e\d+|ep\.? ?\d+)\b/gi, ' ')
    .replace(/[|•–—_:"“”#!?]/g, ' ').replace(/\s-\s/g, ' ').replace(/\s+/g, ' ').trim();
}
// Wikiquote lines -> plain quotes (speaker names, links and markup removed)
function quoteLines(wt) {
  const out = [];
  for (let line of String(wt).split('\n')) {
    if (!/^[*:]/.test(line)) continue;
    line = line.replace(/^[*:#]+\s*/, '').replace(/^'''[^']{1,40}'''\s*:\s*/, '').replace(/^\[\[[^\]]{1,40}\]\]\s*:\s*/, '')
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/'''|''/g, '').replace(/\[[^\]]*\]/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const n = line.split(' ').length;
    if (n >= 4 && n <= 220 && !/^(season|episode|source|see also|external links)\b/i.test(line)) out.push(line);
  }
  return out;
}
// Wikimedia asks API users to say who they are (a browser-like agent gets rate limited); back off on 429
// (one request at a time, ~0.8s apart, so a batch of clips never trips the rate limit)
let wikiChain = Promise.resolve();
function wikiApi(url) {
  const run = async () => {
    for (let i = 0; i < 5; i++) {
      try { return JSON.parse(await curl(url, { accept: 'application/json', headers: { 'User-Agent': 'Cutsona/1.0 (personal video edit maker; runs locally)', 'Api-User-Agent': 'Cutsona/1.0' } })); }
      catch (e) { if (!/429|503/.test(e.message) || i === 4) throw e; await new Promise((r) => setTimeout(r, 2500 * 2 ** i)); }
    }
  };
  const p = wikiChain.then(run);
  wikiChain = p.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 800)));
  return p;
}
async function wikiquotes(title) {
  const q = cleanTitle(title);
  if (q.length < 3) return null;
  const api = 'https://en.wikiquote.org/w/api.php?format=json&maxlag=5&';
  const hay = ' ' + normWords(q) + ' ';
  // the whole title first, then each part of it ("Breaking Bad - I Am the One Who Knocks | Rotten Tomatoes TV")
  const parts = String(title).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/\s[|•–—-]\s|\s*\|\s*|:\s/).map(cleanTitle).filter((s) => s.length >= 3);
  let hits = [];
  for (const query of [...new Set([q, ...parts])].slice(0, 4)) {
    const s = await wikiApi(api + 'action=query&list=search&srlimit=10&srsearch=' + encodeURIComponent(query));
    // only pages whose name is in the video's title (a "Breaking Bad" clip -> "Breaking Bad", "Breaking Bad (season 4)")
    hits = (s.query?.search || []).map((r) => r.title).filter((t) => {
      const base = normWords(t.replace(/\s*\([^)]*\)\s*$/, ''));
      return base.length >= 3 && base.split(' ').length <= 8 && hay.includes(' ' + base + ' ');
    });
    if (hits.length) break;
  }
  if (!hits.length) return null;
  const bestBase = hits.map((t) => normWords(t.replace(/\s*\([^)]*\)\s*$/, ''))).sort((a, b) => b.length - a.length)[0];
  const pages = hits.filter((t) => normWords(t.replace(/\s*\([^)]*\)\s*$/, '')) === bestBase).slice(0, 4);
  const quotes = [];
  let failed = 0;
  for (const page of pages) {
    try {
      const j = await wikiApi(api + 'action=parse&prop=wikitext&redirects=1&page=' + encodeURIComponent(page));
      quotes.push(...quoteLines(j.parse?.wikitext?.['*'] || ''));
    } catch { failed++; }
  }
  if (failed) throw new Error(`${failed} page(s) could not be read`);
  return quotes.length ? { pages, quotes: [...new Set(quotes)].slice(0, 4000) } : null;
}
// ---------------- the clip brain (Twitch / Kick) ----------------
// A channel's most-viewed viewer clips = proof of what works on that channel: their titles (what they're
// about), their length, and — when they come from the same stream as your clip — exactly where they were cut.
function streamSource(src) {
  const u = String(src.url || ''), pg = String(src.page || '');
  let m;
  if ((m = /clips\.twitch\.tv\/(?:embed\?clip=)?([\w-]+)/i.exec(u) || /twitch\.tv\/[^/]+\/clip\/([\w-]+)/i.exec(u))) return { platform: 'twitch', clip: m[1] };
  if ((m = /twitch\.tv\/videos\/(\d+)/i.exec(u))) return { platform: 'twitch', vod: m[1] };
  if ((m = /twitch\.tv\/([a-z0-9_]{3,25})\/?$/i.exec(u))) return { platform: 'twitch', channel: m[1].toLowerCase() };
  if ((m = /kick\.com\/([\w-]+)\/clips\/(clip_\w+)/i.exec(pg) || /kick\.com\/([\w-]+)\/clips\/(clip_\w+)/i.exec(u))) return { platform: 'kick', channel: m[1].toLowerCase(), clip: m[2] };
  if ((m = /clips\.kick\.com\/clips\/\w+\/(clip_\w+)/i.exec(u))) return { platform: 'kick', clip: m[1], channel: String(src.channel || '').toLowerCase() || null };
  if ((m = /kick\.com\/([\w-]+)\/videos\/([\w-]+)/i.exec(u))) return { platform: 'kick', channel: m[1].toLowerCase(), vod: m[2] };
  if ((m = /kick\.com\/([\w-]+)\/?$/i.exec(u))) return { platform: 'kick', channel: m[1].toLowerCase() };
  if (src.source === 'twitch' || src.source === 'kick') return { platform: src.source, channel: String(src.channel || '').toLowerCase() || null };
  return null;
}
async function channelClips(platform, channel) {
  const file = path.join(CACHE_DIR, `brain_${platform}_${channel.replace(/[^\w-]/g, '')}.json`);
  try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); if (Date.now() - c.at < 864e5) return c; } catch {}
  let clips = [], name = channel;
  if (platform === 'twitch') {
    const d = await twitchGql(`query($login:String!){ user(login:$login){ displayName clips(first:100, criteria:{period:ALL_TIME, sort:VIEWS_DESC}){ edges{ node{ slug title viewCount durationSeconds videoOffsetSeconds video{ id } } } } } }`, { login: channel });
    name = d.user?.displayName || channel;
    clips = (d.user?.clips?.edges || []).map(({ node: n }) => ({ id: n.slug, title: n.title, views: n.viewCount, duration: n.durationSeconds, offset: n.videoOffsetSeconds, vod: n.video?.id || null }));
  } else {
    const list = await kickTwoPages(`https://kick.com/api/v2/channels/${channel}/clips?sort=view&time=all`, 1).catch(() => []);
    name = list[0]?.channel?.username || channel;
    clips = list.map((c) => ({ id: c.id, title: c.title, views: c.view_count ?? c.views ?? 0, duration: c.duration, offset: c.vod_starts_at || null, vod: c.livestream_id || null }));
  }
  // how long this channel's best clips run (weighted by views, top 30)
  const top = clips.slice(0, 30).filter((c) => c.duration > 0).sort((a, b) => a.duration - b.duration);
  const tot = top.reduce((s, c) => s + Math.log10(c.views + 10), 0);
  let acc = 0, typicalLength = null;
  for (const c of top) { acc += Math.log10(c.views + 10); if (acc >= tot / 2) { typicalLength = c.duration; break; } }
  const out = { at: Date.now(), platform, channel, name, clips, typicalLength };
  try { fs.writeFileSync(file, JSON.stringify(out)); } catch {}
  return out;
}
async function brainFor(src) {
  const s = streamSource(src);
  if (!s) return null;
  let self = null, vod = s.vod || null, channel = s.channel || null;
  if (s.platform === 'twitch' && s.clip) {
    const d = await twitchGql(`query($slug:ID!){ clip(slug:$slug){ title viewCount durationSeconds videoOffsetSeconds video{ id } broadcaster{ login } } }`, { slug: s.clip });
    if (d.clip) { self = { title: d.clip.title, views: d.clip.viewCount, duration: d.clip.durationSeconds }; channel = d.clip.broadcaster?.login || channel; }
  } else if (s.platform === 'twitch' && s.vod) {
    const d = await twitchGql(`query($id:ID!){ video(id:$id){ title owner{ login } } }`, { id: s.vod });
    channel = d.video?.owner?.login || channel;
  }
  if (!channel) return null;
  const b = await channelClips(s.platform, channel);
  if (s.platform === 'kick' && s.clip) { const c = b.clips.find((x) => x.id === s.clip); if (c) self = { title: c.title, views: c.views, duration: c.duration }; }
  if (!self && src.views && src.title) self = { title: src.title, views: Number(src.views) || 0 };
  // viewer clips cut from this same stream -> exact moments (in this clip's time)
  const off = src.start || 0;
  const matches = vod ? b.clips.filter((c) => String(c.vod) === String(vod) && c.offset != null)
    .map((c) => ({ t0: c.offset - off, t1: c.offset - off + (c.duration || 20), views: c.views, title: c.title })) : [];
  return { platform: s.platform, channel: b.channel, name: b.name, clips: b.clips.slice(0, 100).map(({ title, views, duration }) => ({ title, views, duration })),
    typicalLength: b.typicalLength, self, matches };
}
async function crowdFor(file, name) {
  const out = sidecar(file, 'crowd');
  try { const c = JSON.parse(fs.readFileSync(out, 'utf8')); if (c.v === 3) return c; } catch {}
  let src = {};
  try { src = JSON.parse(fs.readFileSync(sidecar(file, 'src'), 'utf8')); } catch {}
  const data = { v: 3, title: src.title || name || '', offset: src.start || 0, heatmap: [], comments: [], marks: [], quotes: [], sources: [], errors: [] };
  if (src.url && /youtube\.com|youtu\.be/i.test(src.url)) {
    try {
      const info = JSON.parse(await runYtdlp(['-J', '--skip-download', '--no-playlist', '--get-comments',
        '--extractor-args', 'youtube:max_comments=150,150,0,0;comment_sort=top', '--', src.url]));
      data.title = info.title || data.title;
      data.views = info.view_count || 0;
      data.heatmap = (info.heatmap || []).map((h) => [h.start_time - data.offset, h.end_time - data.offset, h.value]).filter((h) => h[1] > 0);
      for (const c of info.comments || []) {
        const text = String(c.text || '').slice(0, 500), likes = Number(c.like_count) || 0;
        data.comments.push({ text, likes });
        // "2:31 when he ..." = people pointing at their favorite moment
        for (const m of text.matchAll(/(?:^|[\s(])(\d{1,2}):([0-5]\d)(?::([0-5]\d))?(?=$|[\s),.!?])/g)) {
          const t = m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
          data.marks.push({ t: t - data.offset, likes });
        }
      }
      if (data.heatmap.length) data.sources.push('YouTube "Most replayed"');
      if (data.comments.length) data.sources.push(`${data.comments.length} top YouTube comments`);
    } catch (e) { data.errors.push('YouTube: ' + String(e.message).slice(0, 160)); }
  }
  // Twitch / Kick: the clip brain for this channel
  try {
    const b = await brainFor(src);
    if (b) {
      data.brain = b;
      data.sources.push(`${b.platform === 'kick' ? 'Kick' : 'Twitch'}: ${b.clips.length} most-viewed clips of ${b.name}` + (b.matches.length ? ` (${b.matches.length} cut from this stream)` : ''));
    }
  } catch (e) { data.errors.push('Clip brain: ' + String(e.message).slice(0, 160)); }
  try {
    const w = /twitch|kick/i.test(String(src.url)) ? null : await wikiquotes(data.title);
    if (w) { data.quotes = w.quotes; data.wiki = w.pages; data.sources.push(`Wikiquote (${w.pages.join(', ')})`); }
  } catch (e) { data.errors.push('Wikiquote: ' + String(e.message).slice(0, 160)); }
  // keep it for next time only when everything came through (otherwise try again on the next load)
  if (!data.errors.length) try { fs.writeFileSync(out, JSON.stringify(data)); } catch {}
  return data;
}

// ---- download jobs ----
const grabs = new Map();
const grabQueue = [];
let grabActive = 0;
function pumpGrabs() {
  while (grabActive < 3 && grabQueue.length) {
    const job = grabQueue.shift();
    grabActive++;
    runGrab(job).catch((e) => { job.status = 'error'; job.error = friendlyGrabError(e.message, job.req && job.req.url); job.phase = job.error; console.error('grab failed', e.message); })
      .finally(() => { grabActive--; pumpGrabs(); });
  }
}
function parseTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const parts = String(v).trim().split(':').map(Number);
  if (parts.some((x) => !isFinite(x))) return null;
  return parts.reduce((a, b) => a * 60 + b, 0);
}
async function runGrab(job) {
  job.status = 'running'; job.phase = 'Starting';
  await ensureYtdlp();
  let { url, title } = job.req;
  let start = parseTime(job.req.start), end = parseTime(job.req.end);
  let duration = Number(job.req.duration) || 0;
  if (job.req.audio) return grabSong(job, url, title, start, end);

  // thepartwhere.com moment links -> the YouTube upload + timestamp
  if (/thepartwhere\.com\/m\//i.test(url)) {
    job.phase = 'Finding the moment';
    const html = await curlText(url);
    const vid = /youtu(?:\.be\/|be\.com\/watch\?v=|be\.com\/embed\/)([A-Za-z0-9_-]{11})/.exec(html);
    if (!vid) throw new Error('Could not find the video for that moment.');
    const so = /startOffset\\?"\s*:\s*([\d.]+)/.exec(html), eo = /endOffset\\?"\s*:\s*([\d.]+)/.exec(html);
    const tq = Number(new URL(url).searchParams.get('t'));
    const s = so ? Number(so[1]) : (isFinite(tq) && tq > 0 ? tq : null);
    if (start == null && s != null) {
      const e = eo ? Number(eo[1]) : s + 3;
      start = Math.max(0, s - 3); end = Math.max(e + 8, s + 18);
    }
    const tt = /<title>([^<]+)<\/title>/i.exec(html);
    if (!title && tt) title = tt[1].split(/\s+[—–|]\s+/)[0].replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').trim();
    url = `https://www.youtube.com/watch?v=${vid[1]}`;
  }

  // long YouTube videos: grab the most-replayed part instead of the whole thing
  if (start == null && /youtube\.com|youtu\.be/i.test(url) && (!duration || duration > 600)) {
    job.phase = 'Checking video';
    const info = JSON.parse(await runYtdlp(['-J', '--no-playlist', '--', url]));
    duration = info.duration || 0;
    title = title || info.title;
    if (duration > 600) {
      const h = info.heatmap;
      if (h && h.length) {
        const pk = h.reduce((a, b) => (b.value > a.value ? b : a));
        const mid = (pk.start_time + pk.end_time) / 2;
        start = Math.max(0, mid - 45); end = Math.min(duration, start + 90);
        job.note = 'most-replayed 90s';
      } else { start = 0; end = 180; job.note = 'first 3 min'; }
    }
  }
  if (start != null && (end == null || end <= start)) end = start + 30;

  // direct mp4 files on hosts yt-dlp can't read (GIPHY)
  if (/^https:\/\/(media[0-9]?\.giphy\.com|clips\.destockd\.com|f00\d\.backblazeb2\.com)\/.+\.mp4$/i.test(url)) {
    job.phase = 'Downloading';
    const out = path.join(CACHE_DIR, `grab_${job.id}.mp4`);
    await new Promise((resolve, reject) => {
      const p = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-s', '-L', '--max-time', '90', '-A', UA, '-o', out, '-w', '%{http_code}', url], { windowsHide: true });
      let code = '';
      p.stdout.on('data', (d) => { code += d; });
      p.on('error', reject);
      p.on('close', () => (/^2/.test(code) ? resolve() : reject(new Error('Download failed (HTTP ' + code + ')'))));
    });
    job.status = 'done'; job.pct = 100; job.phase = 'Done';
    job.url = `/cache/${path.basename(out)}`;
    job.name = (title || 'GIPHY clip').slice(0, 90);
    return;
  }

  if (job.req.photo) {
    job.phase = 'Downloading photo';
    const src = path.join(CACHE_DIR, `grab_${job.id}_photo`);
    await new Promise((resolve, reject) => {
      const p = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-s', '-L', '--max-time', '60', '-A', UA, '-o', src, '-w', '%{http_code}', url], { windowsHide: true });
      let code = '';
      p.stdout.on('data', (d) => { code += d; });
      p.on('error', reject);
      p.on('close', () => (/^2/.test(code) ? resolve() : reject(new Error('Photo download failed (HTTP ' + code + ')'))));
    });
    job.phase = 'Making clip'; job.pct = 60;
    const out = path.join(CACHE_DIR, `grab_${job.id}.mp4`);
    try { await photoToClip(src, out); } finally { fs.unlink(src, () => {}); }
    job.status = 'done'; job.pct = 100; job.phase = 'Done';
    job.url = `/cache/${path.basename(out)}`;
    job.name = (title || 'Photo').slice(0, 90);
    return;
  }

  job.phase = 'Downloading';
  const base = path.join(CACHE_DIR, `grab_${job.id}`);
  // 4K picks get the 4K stream (YouTube only has 4K as VP9/AV1, which plays fine); everything else stays 1080p H.264
  const sort = Number(job.req.maxRes) >= 2160 ? 'res:2160,vcodec:h264,acodec:aac' : 'vcodec:h264,res:1080,acodec:aac';
  const args = ['--no-playlist', '-S', sort, '-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '--remux-video', 'mp4',
    '-o', `${base}.%(ext)s`, '--newline', '--progress-template', 'download:[PROG] %(progress._percent_str)s'];
  if (start != null) args.push('--download-sections', `*${start.toFixed(2)}-${end.toFixed(2)}`);
  args.push('--retries', '5', '--fragment-retries', '10', '--extractor-retries', '3');
  const onLine = (line) => {
    const m = /\[PROG\]\s*([\d.]+)%/.exec(line);
    if (m) job.pct = Math.max(job.pct || 0, Math.min(99, Number(m[1])));
  };
  // YouTube sometimes refuses one download link (HTTP 403) and a fresh one works: try once more before giving up
  try { await runYtdlp([...args, '--', url], onLine); }
  catch (e) {
    if (!/403|forbidden|timed out|connection reset|incomplete/i.test(e.message)) throw e;
    job.phase = 'Retrying'; job.pct = 0;
    for (const f of fs.readdirSync(CACHE_DIR)) if (f.startsWith(`grab_${job.id}.`)) fs.unlink(path.join(CACHE_DIR, f), () => {});
    await new Promise((r) => setTimeout(r, 1500));
    job.phase = 'Downloading';
    await runYtdlp([...args, '--', url], onLine);
  }
  let file = fs.readdirSync(CACHE_DIR).filter((f) => f.startsWith(`grab_${job.id}.`) && !/\.(part|ytdl|temp)/.test(f))
    .map((f) => path.join(CACHE_DIR, f)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  if (!file) throw new Error('Download finished but no video file was found.');
  const codec = await probeCodec(file);
  if (!codec) throw new Error('That link did not contain a video.');
  if (!['h264', 'vp8', 'vp9', 'av1'].includes(codec) || !file.endsWith('.mp4')) {
    job.phase = 'Converting'; job.pct = 99;
    const out = `${base}_h264.mp4`;
    await runFfmpeg(['-i', file, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
    fs.unlink(file, () => {});
    file = out;
  }
  // remember where this clip came from (and where in the source it starts), for the crowd ratings
  writeSrc(file, { url, title: title || '', start: start || 0, source: job.req.source || '', channel: job.req.channel || '', page: job.req.page || '', views: job.req.views || 0 });
  job.status = 'done'; job.pct = 100; job.phase = 'Done';
  job.url = `/cache/${path.basename(file)}`;
  job.name = (title || path.basename(file)).slice(0, 90);
}

// A song or sound for the edit's music: always ends up as an MP3 in the cache.
// Direct audio files (Freesound, FMA, ccMixter, Internet Archive) are downloaded; anything else
// (YouTube and every other site yt-dlp knows) has its audio extracted and converted to MP3.
async function grabSong(job, url, title, start, end) {
  const base = path.join(CACHE_DIR, `song_${job.id}`), out = `${base}.mp3`;
  const direct = /\.(mp3|ogg|oga|wav|flac|m4a|aac|opus)(\?|$)/i.test(url) || /freemusicarchive\.org\/track\/[^/]+\/stream/i.test(url);
  if (direct) {
    job.phase = 'Downloading';
    const src = `${base}_src`;
    await new Promise((resolve, reject) => {
      // some hosts (ccMixter) only serve files to visitors coming from their own pages
      const referer = `${new URL(url).origin}/`;
      const p = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-s', '-L', '--max-time', '240', '-A', UA, '-e', referer, '-o', src, '-w', '%{http_code}', url], { windowsHide: true });
      let code = '';
      p.stdout.on('data', (d) => { code += d; });
      p.on('error', reject);
      p.on('close', () => (/^2/.test(code) ? resolve() : reject(new Error('Download failed (HTTP ' + code + ')'))));
    });
    job.phase = 'Making MP3'; job.pct = 80;
    const cut = start != null ? ['-ss', String(start), '-to', String(end)] : [];
    try {
      // MP3 already: keep the audio as it is (just drop cover art); anything else: encode to MP3
      try { await runFfmpeg([...cut, '-i', src, '-vn', '-map', '0:a:0', '-c:a', 'copy', '-f', 'mp3', out]); }
      catch { await runFfmpeg([...cut, '-i', src, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-q:a', '2', out]); }
    } finally { fs.unlink(src, () => {}); }
  } else {
    job.phase = 'Downloading audio';
    const args = ['--no-playlist', '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '-o', `${base}.%(ext)s`, '--newline', '--progress-template', 'download:[PROG] %(progress._percent_str)s'];
    if (start != null) args.push('--download-sections', `*${start.toFixed(2)}-${end.toFixed(2)}`);
    await runYtdlp([...args, '--', url], (line) => {
      const m = /\[PROG\]\s*([\d.]+)%/.exec(line);
      if (m) job.pct = Math.max(job.pct || 0, Math.min(95, Number(m[1])));
      if (/ExtractAudio/.test(line)) job.phase = 'Making MP3';
    });
    if (!fs.existsSync(out)) throw new Error('Could not turn that link into an MP3.');
  }
  if (!fs.existsSync(out) || fs.statSync(out).size < 1000) throw new Error('That download had no usable audio.');
  job.status = 'done'; job.pct = 100; job.phase = 'Done';
  job.url = `/cache/${path.basename(out)}`;
  job.name = (title || 'Song').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 90);
}

// Turn a still photo into an 8s clip with a slow push-in, so it can be cut like video
function probeSize(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { windowsHide: true },
      (err, out) => { const [w, h] = String(out || '').trim().split(',').map(Number); resolve(err || !w ? null : { w, h }); });
  });
}
async function photoToClip(src, out, seconds = 8) {
  const sz = await probeSize(src);
  if (!sz) throw new Error('That photo could not be read.');
  const sc = 1920 / Math.max(sz.w, sz.h);
  const W = Math.max(2, Math.round((sz.w * sc) / 2) * 2), H = Math.max(2, Math.round((sz.h * sc) / 2) * 2);
  const frames = seconds * 30;
  await runFfmpeg(['-loop', '1', '-framerate', '30', '-i', src, '-vf',
    `scale=${W * 2}:${H * 2}:flags=lanczos,zoompan=z='min(1+0.15*on/${frames},1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=30,format=yuv420p`,
    '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-movflags', '+faststart', out]);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

let lastPing = 0, lastBye = 0;

// Only the Cutsona window may use this server. Any website open in your browser can send requests to
// 127.0.0.1, so: the Host must be this machine (blocks DNS-rebinding, where an attacker's domain points at
// 127.0.0.1), and a request from another site (Origin / Sec-Fetch-Site) is refused (blocks CSRF).
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;
function allowed(req) {
  const host = String(req.headers.host || '');
  if (!LOCAL_HOST.test(host)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let o; try { o = new URL(origin); } catch { return false; }
    if (o.protocol !== 'http:' || o.host.toLowerCase() !== host.toLowerCase()) return false;
  } else if (origin === 'null') return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return true;
}
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' };

async function handle(req, res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (!allowed(req)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('Forbidden'); }
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  const q = url.searchParams;

  try {
    if (p === '/api/ping') { lastPing = Date.now(); return json(res, 200, { ok: true, app: 'cutsona' }); }
    // the window is closing (or reloading: then a new ping follows within a second)
    if (p === '/api/bye' && req.method === 'POST') { lastBye = Date.now(); req.resume(); res.writeHead(204); return res.end(); }

    if (p === '/api/transcribe' && req.method === 'POST') {
      // Receive mono PCM audio only; never fetch arbitrary URLs supplied by a client.
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) { req.resume(); return json(res, 413, { error: 'Speech analysis supports up to 64 MB of audio per clip.' }); }
        chunks.push(chunk);
      }
      const audio = Buffer.concat(chunks);
      if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return json(res, 400, { error: 'Expected WAV audio.' });
      try { return json(res, 200, await transcription.transcribe(audio)); }
      catch (error) { return json(res, 503, { error: error.message }); }
    }

    // hover / preview playback of a Twitch or Kick clip as plain video (their embeds won't autoplay muted)
    if (p === '/api/finder/hover') {
      const u = String(q.get('url') || ''), full = q.get('full') === '1';
      try {
        const tw = /^https:\/\/(?:clips\.twitch\.tv\/|(?:www\.)?twitch\.tv\/[A-Za-z0-9_]+\/clip\/)([A-Za-z0-9_-]{3,120})(?:[?#].*)?$/.exec(u);
        if (tw) { res.writeHead(302, { Location: await twitchClipMp4(tw[1], full), 'Cache-Control': 'no-store' }); return res.end(); }
        if (/^https:\/\/clips\.kick\.com\/clips\/[A-Za-z0-9_/-]+\/playlist\.m3u8$/.test(u)) return kickClipMp4(u, full, req, res);
        return json(res, 400, { error: 'Only Twitch and Kick clips play here.' });
      } catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (p === '/api/finder/moment-titles') {
      try { const i = await tpwTitles(); return json(res, 200, { titles: i.titles, memes: i.memes, sports: i.sports, count: i.count }); }
      catch (e) { return json(res, 502, { error: 'thepartwhere.com isn’t answering right now.' }); }
    }
    if (p === '/api/finder/status') {
      return json(res, 200, { ytdlp: fs.existsSync(YTDLP), pexels: !!config.pexelsKey, pixabay: !!config.pixabayKey });
    }
    if (p === '/api/finder/keys' && req.method === 'POST') {
      const body = await readJson(req);
      for (const k of ['pexelsKey', 'pixabayKey']) if (typeof body[k] === 'string') config[k] = body[k].trim().slice(0, 200) || undefined;
      saveConfig(); searchCache.clear();
      return json(res, 200, { pexels: !!config.pexelsKey, pixabay: !!config.pixabayKey });
    }
    if (p === '/api/finder/search') {
      try {
        let items = await finderSearch(q);
        const src = q.get('source');
        // quality badge for every result whose size is known, and the HD / 4K filter on top
        items = items.map((x) => (x && !x.res && !x.photo && x.w && x.h ? { ...x, res: resClass(x.w, x.h) } : x));
        const want = { hd: 1, '4k': 4 }[q.get('quality')];
        if (want) items = items.filter((x) => !x || x.photo || !x.res || RES_RANK[x.res] >= want);
        const noPaging = ['reddit', 'medal', 'giphy'].includes(src) || (src === 'yarn' && !q.get('q'));
        return json(res, 200, { items, more: items.length > 0 && !noPaging });
      }
      catch (e) { console.error('search failed', q.get('source'), e.message); return json(res, 400, { error: friendlySearchError(e.message) }); }
    }
    if (p === '/api/grab' && req.method === 'POST') {
      const body = await readJson(req);
      const u = String(body.url || '').trim();
      if (!/^https?:\/\//i.test(u)) return json(res, 400, { error: 'That doesn’t look like a link.' });
      if (REDDIT_LINK.test(u)) return json(res, 400, { error: REDDIT_MSG });
      const job = { id: uid(), status: 'queued', pct: 0, phase: 'Waiting', req: { ...body, url: u } };
      grabs.set(job.id, job);
      grabQueue.push(job); pumpGrabs();
      return json(res, 200, { id: job.id });
    }
    // crowd ratings for a clip: ?source=/cache/<file> (downloaded clips) and/or ?name=<title> (your own files)
    if (p === '/api/crowd') {
      const s = q.get('source') || '', name = String(q.get('name') || '').slice(0, 200);
      let file;
      if (s.startsWith('/cache/')) {
        file = path.join(CACHE_DIR, path.basename(s));
        if (!fs.existsSync(file)) return json(res, 404, { error: 'clip not found' });
      } else if (name) file = path.join(CACHE_DIR, 'crowd_' + crypto.createHash('sha1').update(normWords(cleanTitle(name))).digest('hex').slice(0, 16));
      else return json(res, 400, { error: 'source or name needed' });
      if (!crowdJobs.has(file)) crowdJobs.set(file, crowdFor(file, name).finally(() => setTimeout(() => crowdJobs.delete(file), 60000)));
      try { return json(res, 200, await crowdJobs.get(file)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === '/api/grab/status') {
      const job = grabs.get(q.get('id'));
      if (!job) return json(res, 404, { error: 'unknown job' });
      const { req: _r, ...pub } = job;
      return json(res, 200, pub);
    }

    // Settings: where finished videos are saved
    if (p === '/api/settings') return json(res, 200, { exportDir: EXPORT_DIR, defaultExportDir: DEFAULT_EXPORT_DIR, canPick: process.platform === 'win32' || process.platform === 'darwin' });
    if (p === '/api/settings/export-dir' && req.method === 'POST') {
      let dir;
      if (q.get('reset')) dir = DEFAULT_EXPORT_DIR;
      else if (q.get('pick')) {
        try { dir = await pickFolder(EXPORT_DIR); } catch (e) { return json(res, 400, { error: e.message }); }
        if (!dir) return json(res, 200, { cancelled: true, exportDir: EXPORT_DIR });
      } else dir = String(q.get('dir') || '').trim().replace(/^"|"$/g, '');
      const ok = usableDir(dir);
      if (!ok) return json(res, 400, { error: 'Cutsona can’t save there. Pick a folder you can write to (a full path like C:\\Users\\you\\Videos).' });
      EXPORT_DIR = ok;
      if (ok === DEFAULT_EXPORT_DIR) delete appSettings.exportDir; else appSettings.exportDir = ok;
      saveAppSettings();
      return json(res, 200, { exportDir: EXPORT_DIR });
    }

    // Updates: what's new on GitHub, and installing it
    if (p === '/api/update' && req.method === 'GET') return json(res, 200, { ...(await updater.check(q.get('force') === '1')), job: updater.status() });
    if (p === '/api/update/apply' && req.method === 'POST') {
      try {
        const st = await updater.apply();
        json(res, 200, { ok: true, version: st.version });
        console.log(`Updated to Cutsona ${st.version} - restarting.`);
        setTimeout(() => updater.restart(), 400);
        return;
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === '/api/status') {
      return json(res, 200, { ffmpeg: ffmpegOk, ytdlp: fs.existsSync(YTDLP), exportsDir: EXPORT_DIR, platform: process.platform, version: updater.current });
    }

    if (p === '/api/preview' && req.method === 'POST') {
      if (!ffmpegOk) return json(res, 400, { error: 'ffmpeg is needed for optimized previews.' });
      const cached = q.get('source');
      let source, temporary = false;
      if (cached) {
        if (!cached.startsWith('/cache/')) return json(res, 400, { error: 'Expected a cached video.' });
        source = within(CACHE_DIR, cached.slice(7));
        if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) return json(res, 400, { error: 'Cached video not found.' });
      } else {
        source = path.join(CACHE_DIR, `preview_upload_${uid()}.bin`); temporary = true;
      }
      try {
        if (temporary) await saveBody(req, source);
        return json(res, 200, await makePreview(source));
      } finally { if (temporary) fs.unlink(source, () => {}); }
    }

    // Song previews from hosts that refuse browsers coming from other sites (ccMixter): passed through here
    if (p === '/api/audio') {
      const u = q.get('u') || '';
      if (!/^https:\/\/ccmixter\.org\/content\/[^?#]+\.mp3$/i.test(u)) return json(res, 400, { error: 'Not a song preview this app knows.' });
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
      const pr = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-s', '-L', '--max-time', '300', '-A', UA, '-e', 'https://ccmixter.org/', u], { windowsHide: true });
      pr.stdout.pipe(res);
      pr.on('error', () => res.end());
      res.on('close', () => pr.kill());
      return;
    }

    // Where a cached video sits on a still picture (so edits can skip it)
    if (p === '/api/stills') {
      if (!ffmpegOk) return json(res, 200, { stills: [] });
      const src = q.get('source') || '';
      if (!src.startsWith('/cache/')) return json(res, 400, { error: 'Expected a cached video.' });
      const file = within(CACHE_DIR, src.slice(7));
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 400, { error: 'Cached video not found.' });
      try { return json(res, 200, await findStills(file)); }
      catch (error) { return json(res, 200, { stills: [], error: error.message }); }
    }

    // Convert a clip the browser can't play into a browser-friendly proxy
    if (p === '/api/convert' && req.method === 'POST') {
      if (!ffmpegOk) return json(res, 400, { error: 'ffmpeg is not installed, so this file type cannot be converted.' });
      const id = uid();
      const ext = path.extname(safeName(q.get('name'), 'clip.bin')) || '.bin';
      const src = path.join(CACHE_DIR, `src_${id}${ext}`);
      await saveBody(req, src);
      const vp9 = q.get('codec') === 'vp9';
      const out = path.join(CACHE_DIR, `${id}.${vp9 ? 'webm' : 'mp4'}`);
      const scale = "scale='min(1920,iw)':-2";
      const args = vp9
        ? ['-i', src, '-vf', scale, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '6M', '-g', '30', '-c:a', 'libopus', '-b:a', '160k', out]
        : ['-i', src, '-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out];
      try { await runFfmpeg(args); } finally { fs.unlink(src, () => {}); }
      return json(res, 200, { url: `/cache/${path.basename(out)}` });
    }

    // Upload one part of an export (video mp4 or wav audio)
    // A photo dropped into the app -> moving clip
    if (p === '/api/photo' && req.method === 'POST') {
      if (!ffmpegOk) return json(res, 400, { error: 'ffmpeg is needed to use photos.' });
      const id = uid();
      const src = path.join(CACHE_DIR, `photo_${id}${path.extname(safeName(q.get('name'), 'p.jpg')) || '.jpg'}`);
      await saveBody(req, src);
      const out = path.join(CACHE_DIR, `photo_${id}.mp4`);
      try { await photoToClip(src, out, Math.max(3, Math.min(20, Number(q.get('seconds')) || 8))); } finally { fs.unlink(src, () => {}); }
      return json(res, 200, { url: `/cache/${path.basename(out)}` });
    }

    if (p === '/api/export/part' && req.method === 'POST') {
      const id = safeName(q.get('id'));
      const kind = q.get('kind') === 'audio' ? 'wav' : 'video.mp4';
      await saveBody(req, path.join(TMP_DIR, `${id}.${kind}`));
      return json(res, 200, { ok: true });
    }

    // Mux the parts into the final MP4
    if (p === '/api/export/finish' && req.method === 'POST') {
      if (!ffmpegOk) return json(res, 400, { error: 'ffmpeg not found' });
      const id = safeName(q.get('id'));
      const base = safeName(q.get('name'), 'edit');
      let outName = `${base}.mp4`;
      for (let i = 2; fs.existsSync(path.join(EXPORT_DIR, outName)); i++) outName = `${base}_${i}.mp4`;
      const out = path.join(EXPORT_DIR, outName);
      const vid = path.join(TMP_DIR, `${id}.video.mp4`);
      const wav = path.join(TMP_DIR, `${id}.wav`);
      if (!fs.existsSync(vid)) return json(res, 400, { error: 'video part missing' });
      const hasAudio = fs.existsSync(wav);
      const args = ['-i', vid];
      if (hasAudio) args.push('-i', wav);
      args.push('-map', '0:v:0');
      if (hasAudio) args.push('-map', '1:a:0');
      if (q.get('vcodec') === 'h264') args.push('-c:v', 'copy');
      else args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p');
      if (hasAudio) args.push('-c:a', 'aac', '-b:a', '256k', '-shortest');
      args.push('-movflags', '+faststart', out);
      try { await runFfmpeg(args); }
      finally { if (!process.env.CUTSONA_KEEP) for (const f of [vid, wav]) fs.unlink(f, () => {}); }
      return json(res, 200, { file: out, name: outName, url: `/exports/${encodeURIComponent(outName)}` });
    }

    if (p === '/api/exports') {
      const list = fs.readdirSync(EXPORT_DIR).filter((f) => f.endsWith('.mp4')).map((f) => {
        const st = fs.statSync(path.join(EXPORT_DIR, f));
        return { name: f, size: st.size, time: st.mtimeMs, url: `/exports/${encodeURIComponent(f)}`, file: path.join(EXPORT_DIR, f) };
      }).sort((a, b) => b.time - a.time).slice(0, 50);
      return json(res, 200, { list, dir: EXPORT_DIR });
    }

    if (p === '/api/open' && req.method === 'POST') {
      const name = q.get('name');
      const target = name ? within(EXPORT_DIR, name) : EXPORT_DIR;
      if (!target) return json(res, 400, { error: 'bad path' });
      if (process.platform === 'win32') {
        spawn('explorer.exe', name ? ['/select,', target] : [target], { detached: true, stdio: 'ignore' }).unref();
      } else if (process.platform === 'darwin') {
        spawn('open', name ? ['-R', target] : [target], { detached: true, stdio: 'ignore' }).unref();
      }
      return json(res, 200, { ok: true });
    }

    if (p === '/api/vision' && req.method === 'POST') {
      try { await ensureVision(); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, 500, { error: 'Could not download the face detector: ' + e.message }); }
    }
    if (p.startsWith('/vision/')) {
      const f = within(VISION_DIR, p.slice(8));
      return f ? serveFile(req, res, f) : json(res, 400, { error: 'bad path' });
    }
    if (p.startsWith('/cache/')) {
      const f = within(CACHE_DIR, p.slice(7));
      return f ? serveFile(req, res, f) : json(res, 400, { error: 'bad path' });
    }
    if (p.startsWith('/exports/')) {
      const f = within(EXPORT_DIR, p.slice(9));
      return f ? serveFile(req, res, f) : json(res, 400, { error: 'bad path' });
    }
    const f = within(APP_DIR, p === '/' ? 'index.html' : p.slice(1));
    return f ? serveFile(req, res, f) : json(res, 400, { error: 'bad path' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: String(e.message || e) });
  }
}

function findBrowser() {
  const env = process.env;
  const c = [];
  if (process.platform === 'win32') {
    for (const base of [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA']]) {
      if (!base) continue;
      c.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    for (const base of [env['ProgramFiles(x86)'], env['ProgramFiles']]) {
      if (base) c.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    c.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  return c.find((x) => { try { return fs.statSync(x).isFile(); } catch { return false; } });
}

function openApp(url) {
  const browser = findBrowser();
  if (browser) {
    const base = process.env.LOCALAPPDATA || os.homedir();
    const profile = path.join(base, 'Cutsona', 'browser-profile');
    // keep the window's saved settings from when it was called EditMachine or SLAX
    const old = ['EditMachine', 'SLAX'].map((d) => path.join(base, d, 'browser-profile')).find((d) => fs.existsSync(d));
    if (!fs.existsSync(profile) && old) { try { fs.mkdirSync(path.dirname(profile), { recursive: true }); fs.renameSync(old, profile); fs.rmdirSync(path.dirname(old)); } catch {} }
    fs.mkdirSync(profile, { recursive: true });
    spawn(browser, [`--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1600,960', '--no-first-run',
      '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required'], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function listen(port) {
  const server = http.createServer(handle);
  server.requestTimeout = 0;
  server.on('error', (e) => {
    if (e.code !== 'EADDRINUSE' || port >= START_PORT + 20) { console.error(e); process.exit(1); }
    // Cutsona is already running there: open its window instead of starting a second copy
    const probe = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 2500 }, (r) => {
      let body = ''; r.on('data', (d) => { body += d; });
      r.on('end', () => {
        let mine = false; try { mine = JSON.parse(body).app === 'cutsona'; } catch {}
        if (mine) { if (!NO_BROWSER && !process.env.CUTSONA_NO_WINDOW) openApp(`http://localhost:${port}/`); console.log(`Cutsona is already running at http://localhost:${port}/ - opened its window.`); setTimeout(() => process.exit(0), 500); }
        else listen(port + 1);
      });
    });
    probe.on('timeout', () => probe.destroy());
    probe.on('error', () => listen(port + 1));
  });
  server.listen(port, '127.0.0.1', async () => {
    const url = `http://localhost:${port}/`;
    const v = await checkFfmpeg();
    console.log(`Cutsona ${updater.current} running at ${url}`);
    setTimeout(() => updater.check().catch(() => {}), 4000); // ready for the window's first look
    console.log(v ? `ffmpeg: ${v}` : 'WARNING: ffmpeg not found on PATH - exporting needs it.');
    if (!NO_BROWSER && !process.env.CUTSONA_NO_WINDOW) openApp(url); // CUTSONA_NO_WINDOW: tests of the auto-shutdown
    // Shut down after the app window is closed: a few seconds after it says goodbye (unless it was only a reload),
    // or when it hasn't been heard from in 2.5 minutes (a minimized window still checks in about once a minute)
    setInterval(() => {
      if (NO_BROWSER || !lastPing) return;
      const now = Date.now();
      if ((lastBye > lastPing && now - lastBye > 8000) || now - lastPing > 150000) {
        console.log('App window closed - shutting down.');
        process.exit(0);
      }
    }, 2000);
  });
}

// clean stale temp files + old downloads (older than 4 days)
try { for (const f of fs.readdirSync(TMP_DIR)) fs.unlinkSync(path.join(TMP_DIR, f)); } catch {}
try {
  for (const f of fs.readdirSync(CACHE_DIR)) {
    const fp = path.join(CACHE_DIR, f);
    if (Date.now() - fs.statSync(fp).mtimeMs > 4 * 864e5) fs.unlinkSync(fp);
  }
} catch {}
ensureYtdlp().then(updateYtdlpIfOld).catch((e) => console.log('yt-dlp not available yet:', e.message));
listen(START_PORT);
