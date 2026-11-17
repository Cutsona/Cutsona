// Build stamps, so an installed Cutsona can tell that a newer build is ready and update itself with one button.
//
//   node desktop/stamp.js          before electron-builder: writes build.json (version + when it was built), packed into the app
//   node desktop/stamp.js --done   after it: writes dist/latest-build.json (that build, its installer, what's new from
//                                   WHATSNEW.md) and tells this computer's installed Cutsona where to look for new builds
//
// The installed app watches dist/latest-build.json: a newer build pops up "What's new … Update now", which runs the new
// installer quietly and opens Cutsona again. Only the computer that builds Cutsona has the pointer (it lives in that
// computer's Cutsona app-data folder, never in the installer), so installers shared with other people don't carry it.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const STAMP = path.join(ROOT, 'build.json');
const writeAtomic = (file, data) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); };

if (!process.argv.includes('--done')) {
  writeAtomic(STAMP, JSON.stringify({ version: pkg.version, built: Date.now() }, null, 2));
  console.log('build.json stamped');
  process.exit(0);
}

const stamp = JSON.parse(fs.readFileSync(STAMP, 'utf8'));
const dist = path.join(ROOT, pkg.build?.directories?.output || 'dist');
const installer = `${pkg.build?.productName || pkg.productName || 'Cutsona'}-Setup-${pkg.version}.exe`;
if (!fs.existsSync(path.join(dist, installer))) { console.error(`No ${installer} in ${dist}: nothing to announce`); process.exit(1); }
let notes = '';
try { notes = fs.readFileSync(path.join(ROOT, 'WHATSNEW.md'), 'utf8').replace(/^﻿/, '').trim(); } catch {}
writeAtomic(path.join(dist, 'latest-build.json'), JSON.stringify({ ...stamp, installer, notes }, null, 2));
// this computer's installed Cutsona: where new builds appear
if (process.platform === 'win32' && process.env.APPDATA) {
  const dir = path.join(process.env.APPDATA, pkg.build?.productName || 'Cutsona');
  try { fs.mkdirSync(dir, { recursive: true }); writeAtomic(path.join(dir, 'dev-source.json'), JSON.stringify({ root: ROOT })); } catch (e) { console.warn('Could not write dev-source.json:', e.message); }
}
console.log(`dist/latest-build.json: build ${new Date(stamp.built).toLocaleString()}`);
