// Try the viral searcher on one video file: node tools/viral-try.mjs <file>
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const transcription = require(path.join(ROOT, 'transcription.js'))(ROOT, ROOT);
const scanner = require(path.join(ROOT, 'viralscan.js'))({ ffmpeg: () => path.join(ROOT, 'vendor', 'bin', 'ffmpeg.exe'), cacheDir: os.tmpdir(), transcription });
const { analyzeViral } = await import('../app/js/viral.js');
const file = process.argv[2];
const q = new URLSearchParams({ path: file });
let out = null;
const res = { writeHead() {}, end() {} };
const json = (_r, code, o) => { out = o; };
const t0 = Date.now();
await scanner.handle({ method: 'GET' }, res, q, { json });
while (out.running) { await new Promise((r) => setTimeout(r, 1000)); await scanner.handle({ method: 'GET' }, res, new URLSearchParams({ key: out.key }), { json }); }
if (out.error) { console.log('ERROR', out.error); process.exit(1); }
console.log(`scanned ${out.duration.toFixed(1)}s in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${out.words.length} words (${out.wordsFrom}), ${out.cuts.length} cuts`);
const A = analyzeViral(out);
console.log('clip score', A.score);
for (const m of A.moments) console.log(m.score, m.start.toFixed(1), m.end.toFixed(1), '|', m.why.join(' | '), '|', (m.hookText || m.text).slice(0, 80));
const lit = A.sents.flatMap((s) => s.words.filter((_, k) => s.wordViral[k] >= 0.55).map((w) => w.text));
console.log('lit words:', lit.slice(0, 40).join(', '));
