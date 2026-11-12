// Cutsona updates: checks the GitHub repo in version.json for newer releases, shows what changed, and installs them.
//
// For the person who publishes Cutsona: bump "version" in version.json, write the notes in CHANGELOG.md, push,
// then publish a GitHub Release whose tag is that version (e.g. v1.1.0) with the notes as its description.
// Everyone running an older Cutsona gets "Cutsona 1.1.0 is out" with those notes and an Update button.
//
// A private repo (invite-only) is shared with git: people download Cutsona with GitHub Desktop or `git clone`,
// signed in to their own GitHub account. Those copies look for new versions with git (new version tags, like
// v1.1.0) and read the notes from CHANGELOG.md at that tag, so a private repo needs no GitHub Releases at all:
// tools/Release.cmd publishes a version. Copies downloaded as a zip (public repos only) use GitHub Releases.
//
// Installing: a git copy moves to the new version's tag (fast-forward only); a downloaded copy gets the release's source zip,
// unpacked over the Cutsona folder. Your own files are never touched (keys, settings, downloads, exports, tools),
// and the files an update replaces are kept in .update-backup/<old version>/ first.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// never overwritten or removed by an update: these are the person's own
const KEEP = new Set(['config.json', 'transcription.config.json', 'cutsona-settings.json', 'cutsona.log', 'cache', 'exports', 'bin', '.git', '.update-backup', 'node_modules']);

module.exports = function updater({ root, curl, ua }) {
  const VERSION_FILE = path.join(root, 'version.json');
  // (Notepad and PowerShell can save it with an invisible BOM at the start: ignore that)
  const readInfo = () => { try { return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8').replace(/^\uFEFF/, '')); } catch { return {}; } };
  const info = readInfo();
  const current = String(info.version || '0.0.0');
  const repo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(info.repo || '') ? info.repo : '';

  // "v1.2.3", "1.2" -> [1, 2, 3]; compare piece by piece
  const parts = (v) => String(v || '').trim().replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  const API = process.env.CUTSONA_UPDATE_API || 'https://api.github.com'; // a stand-in GitHub, for testing updates
  const method = () => (fs.existsSync(path.join(root, '.git')) ? 'git' : 'zip');

  let cache = null, checking = null, state = { busy: false, phase: '', error: '' };

  // git, without ever popping up a sign-in window in the background (the person signs in with GitHub Desktop / Git)
  const gitEnv = (interactive) => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', ...(interactive ? {} : { GCM_INTERACTIVE: 'never' }) });
  const git = (args, interactive = false) => run('git', args, { cwd: root, env: gitEnv(interactive) });
  // "## 1.1.0 - Title" sections of CHANGELOG.md
  function changelog(text) {
    const out = [], re = /^##\s+v?(\d+(?:\.\d+){0,2})\b(.*)$/gm, heads = [];
    let m;
    while ((m = re.exec(text))) heads.push({ at: m.index, end: re.lastIndex, version: m[1], name: m[2].replace(/^\s*[-:–—]\s*/, '').trim() });
    heads.forEach((h, i) => out.push({ version: h.version, name: h.name, body: text.slice(h.end, i + 1 < heads.length ? heads[i + 1].at : undefined).trim() }));
    return out;
  }
  async function gitCheck() {
    try { await git(['fetch', '--tags', '--force', '--quiet', 'origin']); }
    catch (e) {
      const m = String(e.message || '');
      return { current, repo, available: false, method: 'git', error: e.code === 'ENOENT' || /ENOENT|not recognized/i.test(m)
        ? 'Couldn’t check for updates: install Git for Windows (git-scm.com), then open Cutsona again.'
        : /auth|credential|could not read|403|denied|not found|repository/i.test(m)
        ? 'Couldn’t check for updates: sign in to GitHub on this PC with the account that was invited (run git fetch in the Cutsona folder once).'
        : 'Couldn’t reach GitHub to check for updates.' };
    }
    const tags = (await git(['tag', '-l', 'v*'])).split(/\r?\n/).map((t) => t.trim()).filter((t) => /^v\d+(\.\d+){0,2}$/.test(t))
      .sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0));
    const latest = tags[0];
    const available = !!latest && newer(latest, current);
    let notes = [];
    if (available) {
      const text = await git(['show', `${latest}:CHANGELOG.md`]).catch(() => '');
      const date = (await git(['log', '-1', '--format=%cI', latest]).catch(() => '')).trim();
      let web = (await git(['remote', 'get-url', 'origin']).catch(() => '')).trim().replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
      if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(web)) web = '';
      notes = changelog(text).filter((n) => newer(n.version, current)).slice(0, 15)
        .map((n) => ({ ...n, date: n.version === latest.replace(/^v/i, '') ? date : '', url: web ? `${web}/blob/${latest}/CHANGELOG.md` : '' }));
      if (!notes.length) notes = [{ version: latest.replace(/^v/i, ''), name: '', date, body: '', url: '' }];
    }
    return { current, repo, latest: latest ? latest.replace(/^v/i, '') : current, tag: latest || '', available, notes, method: 'git', checkedAt: Date.now() };
  }

  async function check(force = false) {
    if (!force && cache && Date.now() - cache.t < 30 * 60e3) return cache.v;
    if (checking) return checking;
    if (method() === 'git') {
      checking = gitCheck().then((v) => { if (!v.error) cache = { t: Date.now(), v }; return v; }).finally(() => { checking = null; });
      return checking;
    }
    if (!repo) return { current, repo: '', available: false, reason: 'not-set-up' };
    checking = (async () => {
      try {
        const list = JSON.parse(await curl(`${API}/repos/${repo}/releases?per_page=30`, {
          accept: 'application/vnd.github+json', headers: { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': ua },
        }));
        const rel = (Array.isArray(list) ? list : []).filter((r) => r && !r.draft && !r.prerelease && r.tag_name)
          .sort((a, b) => (newer(a.tag_name, b.tag_name) ? -1 : newer(b.tag_name, a.tag_name) ? 1 : 0));
        const latest = rel[0];
        // every release newer than this copy, newest first: the changelog shown before updating
        const notes = rel.filter((r) => newer(r.tag_name, current)).slice(0, 15).map((r) => ({
          version: String(r.tag_name).replace(/^v/i, ''), name: String(r.name || '').slice(0, 120), date: r.published_at || r.created_at || '',
          body: String(r.body || '').slice(0, 20000), url: /^https:\/\/github\.com\//.test(r.html_url || '') ? r.html_url : '',
        }));
        const v = { current, repo, latest: latest ? String(latest.tag_name).replace(/^v/i, '') : current, tag: latest ? latest.tag_name : '',
          available: !!latest && newer(latest.tag_name, current), notes, method: method(), checkedAt: Date.now() };
        cache = { t: Date.now(), v };
        return v;
      } catch (e) {
        const m = String(e.message || '');
        const reason = /404/.test(m) ? 'Couldn’t find the Cutsona repo on GitHub (is it public?).' : /403|429/.test(m) ? 'GitHub is limiting checks right now: try again in a while.' : 'Couldn’t reach GitHub to check for updates.';
        return { current, repo, available: false, error: reason };
      } finally { checking = null; }
    })();
    return checking;
  }

  const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = '';
    p.stdout && p.stdout.on('data', (d) => { out += d; });
    p.stderr && p.stderr.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(out.trim().split('\n').pop() || `${cmd} failed (${code})`))));
  });

  // copy the new version's files over this folder (never the person's own files); back up what gets replaced
  function install(src, backup) {
    let n = 0;
    const walk = (rel) => {
      for (const name of fs.readdirSync(path.join(src, rel))) {
        if (!rel && KEEP.has(name)) continue;
        const r = rel ? path.join(rel, name) : name, from = path.join(src, r), to = path.join(root, r);
        if (!path.resolve(to).startsWith(path.resolve(root) + path.sep)) continue; // stays inside the Cutsona folder
        const st = fs.lstatSync(from);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) { fs.mkdirSync(to, { recursive: true }); walk(r); continue; }
        if (fs.existsSync(to)) { fs.mkdirSync(path.dirname(path.join(backup, r)), { recursive: true }); fs.copyFileSync(to, path.join(backup, r)); }
        fs.copyFileSync(from, to); n++;
      }
    };
    walk('');
    return n;
  }

  async function apply() {
    if (state.busy) return state;
    const c = await check(true);
    if (!c.available) throw new Error(c.error || 'You already have the newest Cutsona.');
    state = { busy: true, phase: 'Downloading', error: '' };
    try {
      if (c.method === 'git') {
        // move to exactly the released version (only forward: never over changes made in this folder)
        state.phase = 'Updating';
        await git(['fetch', '--tags', '--force', 'origin'], true);
        await git(['merge', '--ff-only', c.tag], true);
      } else {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutsona-update-'));
        const zip = path.join(tmp, 'cutsona.zip'), out = path.join(tmp, 'x');
        fs.mkdirSync(out);
        await run(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-sL', '--fail', '--max-time', '300', '-A', ua, '-o', zip,
          `${API}/repos/${repo}/zipball/${encodeURIComponent(c.tag)}`]);
        state.phase = 'Unpacking';
        await run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', zip, '-C', out]);
        // GitHub's zip has one folder at the top (owner-repo-commit)
        const tops = fs.readdirSync(out), base = tops.length === 1 && fs.statSync(path.join(out, tops[0])).isDirectory() ? path.join(out, tops[0]) : out;
        for (const must of ['server.js', 'version.json', path.join('app', 'index.html')]) {
          if (!fs.existsSync(path.join(base, must))) throw new Error('The downloaded update looks incomplete, so nothing was changed.');
        }
        state.phase = 'Installing';
        install(base, path.join(root, '.update-backup', current));
        fs.rm(tmp, { recursive: true, force: true }, () => {});
      }
      state = { busy: true, phase: 'Restarting', error: '', version: c.latest };
      return state;
    } catch (e) {
      const m = String(e.message || '');
      state = { busy: false, phase: '', error: /local changes|would be overwritten|not possible to fast-forward|diverge/i.test(m)
        ? 'This Cutsona folder has changes of its own, so git can’t update it automatically. Run “git pull” in the folder yourself.'
        : /git/i.test(m) && /not recognized|ENOENT/i.test(m) ? 'Git isn’t installed, so this git copy of Cutsona can’t update itself. Install Git, or download the latest release.'
          : m.length < 200 ? m : 'The update didn’t finish. Nothing important was changed: try again later.' };
      throw new Error(state.error);
    }
  }

  // start the new version in the background, then quit this one (the open window reconnects by itself)
  function restart() {
    const env = { ...process.env, CUTSONA_NO_WINDOW: '1' }, log = path.join(root, 'cutsona.log');
    const node = JSON.stringify(process.execPath), server = JSON.stringify(path.join(root, 'server.js'));
    const p = process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', `ping -n 3 127.0.0.1 >nul & ${node} ${server} > ${JSON.stringify(log)} 2>&1`], { cwd: root, env, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
      : spawn('sh', ['-c', `sleep 2; ${node} ${server} > ${JSON.stringify(log)} 2>&1`], { cwd: root, env, detached: true, stdio: 'ignore' });
    p.unref();
    setTimeout(() => process.exit(0), 300);
  }

  return { current, repo, check, apply, restart, status: () => state };
};
