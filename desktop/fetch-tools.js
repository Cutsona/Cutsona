// Gets the tools the Cutsona installer ships with into vendor/bin: FFmpeg (the gyan.dev "release essentials"
// build) and yt-dlp. Run before building the installer: `npm run dist` does it for you.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'vendor', 'bin');
const WIN = process.platform === 'win32';
const FFMPEG_ZIP = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const YTDLP = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

async function download(url, file) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Cutsona-build' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; } else if (e.name.toLowerCase() === name) return p;
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fresh = (f) => fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 7 * 864e5;
  if (!fresh(path.join(OUT, 'yt-dlp.exe'))) { console.log('Getting yt-dlp…'); await download(YTDLP, path.join(OUT, 'yt-dlp.exe')); }
  if (!fresh(path.join(OUT, 'ffmpeg.exe'))) {
    console.log('Getting FFmpeg…');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutsona-ffmpeg-')), zip = path.join(tmp, 'ffmpeg.zip');
    await download(FFMPEG_ZIP, zip);
    if (WIN) execFileSync('tar', ['-xf', zip, '-C', tmp]); else execFileSync('unzip', ['-q', zip, '-d', tmp]);
    fs.copyFileSync(findFile(tmp, 'ffmpeg.exe'), path.join(OUT, 'ffmpeg.exe'));
    const lic = findFile(tmp, 'license.txt') || findFile(tmp, 'license');
    if (lic) fs.copyFileSync(lic, path.join(OUT, 'FFmpeg-LICENSE.txt'));
    fs.writeFileSync(path.join(OUT, 'FFmpeg-SOURCE.txt'), 'This FFmpeg build is from https://www.gyan.dev/ffmpeg/builds/ (release essentials, GPL v3).\nIts source code: https://github.com/FFmpeg/FFmpeg and the build scripts linked on that page.\n');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('Tools ready in', OUT);
})().catch((e) => { console.error('Couldn’t get the tools:', e.message); process.exit(1); });
