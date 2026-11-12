// Cutsona desktop app.
// One window, one engine. The engine (server.js) runs as an Electron utility process: a normal part of the app,
// with no console window and no separate launcher script. When the window closes, the engine stops with it.
// Updates come from GitHub Releases (electron-updater); their notes come from CHANGELOG.md at that version.
'use strict';
const { app, BrowserWindow, utilityProcess, shell, dialog, ipcMain, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PACKAGED = app.isPackaged;
const REPO = 'Cutsona/Cutsona';

app.setAppUserModelId('app.cutsona.desktop');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

// what Cutsona makes and downloads: the app-data folder (installed app), or the code folder (run from source)
const DATA = process.env.CUTSONA_DATA || (PACKAGED ? app.getPath('userData') : ROOT);
const EXPORTS = process.env.CUTSONA_EXPORTS || (PACKAGED ? path.join(app.getPath('videos'), 'Cutsona') : '');
// FFmpeg, FFprobe and yt-dlp ship with the installer (fetched by desktop/fetch-tools.js before building)
const TOOLS = PACKAGED ? path.join(process.resourcesPath, 'bin') : path.join(ROOT, 'vendor', 'bin');
const exe = (n) => path.join(TOOLS, process.platform === 'win32' ? `${n}.exe` : n);

let win = null, engine = null, engineUrl = '', quitting = false, logStream = null;

function startEngine() {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(DATA, { recursive: true });
    try { logStream = fs.createWriteStream(path.join(DATA, 'cutsona.log'), { flags: 'w' }); } catch {}
    const env = { ...process.env, CUTSONA_DATA: DATA, CUTSONA_HOSTED: '1', CUTSONA_NO_WINDOW: '1' };
    if (EXPORTS) env.CUTSONA_EXPORTS = EXPORTS;
    if (PACKAGED) env.CUTSONA_DESKTOP_UPDATES = '1';
    if (fs.existsSync(exe('ffmpeg'))) env.CUTSONA_FFMPEG = exe('ffmpeg');
    if (fs.existsSync(exe('yt-dlp'))) env.CUTSONA_YTDLP_SEED = exe('yt-dlp');
    engine = utilityProcess.fork(path.join(ROOT, 'server.js'), ['--no-browser'], { env, stdio: 'pipe', serviceName: 'Cutsona engine' });
    const log = (d) => { try { logStream?.write(d); } catch {} };
    engine.stdout?.on('data', log); engine.stderr?.on('data', log);
    const timer = setTimeout(() => reject(new Error('Cutsona’s engine didn’t start within 30 seconds.')), 30000);
    engine.on('message', (m) => { if (m && m.ready) { clearTimeout(timer); engineUrl = m.ready; resolve(m.ready); } });
    engine.on('exit', (code) => {
      clearTimeout(timer);
      engine = null;
      if (quitting) return;
      reject(new Error(`Cutsona’s engine stopped (${code}).`));
      if (win) {
        dialog.showMessageBox(win, { type: 'error', title: 'Cutsona', message: 'Cutsona’s engine stopped.',
          detail: `Open Cutsona again to keep going. If it keeps happening, the details are in:\n${path.join(DATA, 'cutsona.log')}`, buttons: ['Close Cutsona'] })
          .then(() => app.quit());
      }
    });
  });
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 700, show: false, backgroundColor: '#262628', title: 'Cutsona',
    icon: path.join(ROOT, process.platform === 'win32' ? 'Cutsona.ico' : 'app/brand/icon-512.png'),
    autoHideMenuBar: true,
    // backgroundThrottling off: exports keep full speed while Cutsona is minimized or behind other windows
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  if (!process.env.CUTSONA_HIDE_WINDOW) win.once('ready-to-show', () => win.show()); // hidden only for automated tests
  // links (Credits, GitHub, sources) open in the person's own browser, never inside Cutsona
  win.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:\/\//i.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(engineUrl)) { e.preventDefault(); if (/^https?:\/\//i.test(u)) shell.openExternal(u); } });
  // F5 / Ctrl+R reload, F12 / Ctrl+Shift+I the developer tools (handy when reporting a bug)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r' && !input.shift)) { win.webContents.reload(); e.preventDefault(); }
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.on('closed', () => { win = null; });
  win.loadURL(url);
}

// ---- the bridge the page uses (desktop/preload.js) ----
ipcMain.on('app:info', (e) => { e.returnValue = { version: app.getVersion(), packaged: PACKAGED, platform: process.platform }; });
ipcMain.handle('dialog:folder', async (_e, start) => {
  const r = await dialog.showOpenDialog(win, { title: 'Where should Cutsona save your finished videos?', defaultPath: start || undefined, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ---- updates (installed app only) ----
let updater = null, lastCheck = null;
const newer = (a, b) => { const p = (v) => String(v).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0); const x = p(a), y = p(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function changelogNotes(latest, current) {
  // the "## 1.2.0 - Title" sections of CHANGELOG.md at that version, newest first, only the ones you're missing
  try {
    const r = await net.fetch(`https://raw.githubusercontent.com/${REPO}/v${latest}/CHANGELOG.md`);
    if (!r.ok) return [];
    const text = await r.text(), heads = [], re = /^##\s+v?(\d+(?:\.\d+){0,2})\b(.*)$/gm;
    let m;
    while ((m = re.exec(text))) heads.push({ at: m.index, end: re.lastIndex, version: m[1], name: m[2].replace(/^\s*[-:–—]\s*/, '').trim() });
    return heads.map((h, i) => ({ version: h.version, name: h.name, body: text.slice(h.end, i + 1 < heads.length ? heads[i + 1].at : undefined).trim(), url: `https://github.com/${REPO}/releases/tag/v${h.version}` }))
      .filter((n) => newer(n.version, current) && !newer(n.version, latest));
  } catch { return []; }
}
function getUpdater() {
  if (updater || !PACKAGED) return updater;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.logger = null;
  } catch { updater = null; }
  return updater;
}
ipcMain.handle('update:check', async () => {
  const current = app.getVersion();
  const u = getUpdater();
  if (!u) return { current, available: false, reason: 'not-set-up' };
  try {
    const r = await u.checkForUpdates();
    const latest = r?.updateInfo?.version || current;
    const available = newer(latest, current);
    let notes = available ? await changelogNotes(latest, current) : [];
    if (available && !notes.length) notes = [{ version: latest, name: r.updateInfo.releaseName || '', body: String(r.updateInfo.releaseNotes || '').replace(/<[^>]+>/g, ''), date: r.updateInfo.releaseDate }];
    lastCheck = { current, latest, available, notes, checkedAt: Date.now() };
    return lastCheck;
  } catch (e) {
    return { current, available: false, checkedAt: Date.now(), error: /net::|ENOTFOUND|ETIMEDOUT|ECONN/i.test(String(e?.message)) ? 'Couldn’t reach GitHub to check for updates.' : 'Couldn’t check for updates right now.' };
  }
});
ipcMain.handle('update:install', async (e) => {
  const u = getUpdater();
  if (!u) throw new Error('Updates aren’t set up in this copy of Cutsona.');
  const send = (s) => { try { e.sender.send('update:state', s); } catch {} };
  u.removeAllListeners('download-progress'); u.removeAllListeners('update-downloaded');
  u.on('download-progress', (p) => send({ percent: p.percent }));
  await new Promise((resolve, reject) => {
    u.once('update-downloaded', resolve);
    u.downloadUpdate().catch(reject);
  });
  send({ ready: true });
  quitting = true;
  setTimeout(() => u.quitAndInstall(true, true), 600); // installs quietly, then opens the new Cutsona
  return true;
});

// ---- life of the app ----
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  try { createWindow(await startEngine()); }
  catch (e) {
    await dialog.showMessageBox({ type: 'error', title: 'Cutsona', message: 'Cutsona couldn’t start.', detail: `${e.message}\n\nThe details are in:\n${path.join(DATA, 'cutsona.log')}`, buttons: ['Close'] });
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; try { engine?.kill(); } catch {} });
