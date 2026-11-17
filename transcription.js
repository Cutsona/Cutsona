'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createInterface } = require('readline');

module.exports = function createTranscription(root, data = root) {
  let config = {};
  const readConfig = () => { try { config = JSON.parse(fs.readFileSync(path.join(data, 'transcription.config.json'), 'utf8')) || {}; } catch { config = {}; } };
  readConfig();
  let worker = null, seq = 0;
  const pending = new Map(), inFlight = new Map();
  const folder = path.join(data, 'cache', 'transcripts');
  fs.mkdirSync(folder, { recursive: true });

  function start() {
    if (worker) return worker;
    const python = process.env.CUTSONA_PYTHON || config.python || 'python';
    const proc = spawn(python, ['-u', path.join(root, 'transcribe.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CUTSONA_WHISPER_DIR: path.join(data, 'bin', 'whisper') } });
    worker = proc;
    let stderr = '';
    proc.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
    createInterface({ input: proc.stdout }).on('line', line => {
      let data; try { data = JSON.parse(line); } catch { return; }
      const job = pending.get(data.id);
      if (!job) return;
      clearTimeout(job.timer); pending.delete(data.id);
      if (data.error) job.reject(new Error('Speech analysis failed: ' + data.error));
      else job.resolve({ words: data.words, language: data.language, languageProb: data.languageProb, speech: data.speech || [] });
    });
    const fail = error => {
      if (worker !== proc) return;
      worker = null;
      for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); }
      pending.clear();
    };
    proc.on('error', error => fail(new Error('Local speech runtime could not start: ' + error.message)));
    proc.on('exit', code => fail(new Error('Local speech runtime stopped (' + code + '). ' + stderr.slice(-500))));
    proc.stdin.on('error', error => fail(error));
    return proc;
  }
  process.once('exit', () => { worker?.kill(); });

  // lang: 'auto' (detect it) or a language code (en, es, ja…)
  async function transcribe(audio, lang = 'auto') {
    lang = /^[a-z]{2,3}$/.test(String(lang)) ? String(lang) : 'auto';
    const key = crypto.createHash('sha256').update(audio).update(String(process.env.CUTSONA_WHISPER_MODEL || config.model || 'small.en')).update('|v2|' + lang).digest('hex');
    const output = path.join(folder, key + '.json');
    if (fs.existsSync(output)) return JSON.parse(await fs.promises.readFile(output, 'utf8'));
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      const input = path.join(folder, key + '.wav');
      await fs.promises.writeFile(input, audio);
      try {
        const proc = start(), id = ++seq;
        const result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { proc.kill(); reject(new Error('Speech analysis timed out. Try a shorter source clip.')); }, 10 * 60000);
          pending.set(id, { resolve, reject, timer });
          proc.stdin.write(JSON.stringify({ id, audio: input, model: process.env.CUTSONA_WHISPER_MODEL || config.model, lang }) + '\n');
        });
        await fs.promises.writeFile(output + '.part', JSON.stringify(result));
        await fs.promises.rename(output + '.part', output);
        return result;
      } finally { await fs.promises.unlink(input).catch(() => {}); }
    })();
    inFlight.set(key, task);
    try { return await task; } finally { inFlight.delete(key); }
  }
  // ---- caption translation (translate.py, Argos Translate models) ----
  let tw = null, tseq = 0, tstatus = '';
  const tpending = new Map();
  function startTranslator() {
    if (tw) return tw;
    const python = process.env.CUTSONA_PYTHON || config.python || 'python';
    const proc = spawn(python, ['-u', path.join(root, 'translate.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CUTSONA_TRANSLATE_DIR: path.join(data, 'bin', 'translate') } });
    tw = proc;
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-3000); });
    createInterface({ input: proc.stdout }).on('line', (line) => {
      let d; try { d = JSON.parse(line); } catch { return; }
      if (d.log) { tstatus = d.log; return; }
      const job = tpending.get(d.id); if (!job) return;
      tpending.delete(d.id); clearTimeout(job.timer); tstatus = '';
      d.error || !Array.isArray(d.texts) ? job.reject(new Error(d.error || 'no translation came back')) : job.resolve(d.texts);
    });
    const fail = (e) => { if (tw !== proc) return; tw = null; for (const j of tpending.values()) { clearTimeout(j.timer); j.reject(e); } tpending.clear(); };
    proc.on('error', (e) => fail(new Error('Translation could not start: ' + e.message)));
    proc.on('exit', (code) => fail(new Error('Translation stopped (' + code + '). ' + stderr.slice(-400))));
    return proc;
  }
  const tcache = path.join(folder, 'translations');
  fs.mkdirSync(tcache, { recursive: true });
  async function translate(texts, from, to) {
    if (!texts.length || from === to) return texts;
    const key = crypto.createHash('sha256').update(JSON.stringify([texts, from, to])).digest('hex');
    const out = path.join(tcache, key + '.json');
    if (fs.existsSync(out)) return JSON.parse(await fs.promises.readFile(out, 'utf8'));
    const once = () => new Promise((resolve, reject) => {
      const proc = startTranslator(), id = ++tseq;
      const timer = setTimeout(() => { reject(new Error('Translation timed out.')); }, 15 * 60000);
      tpending.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ id, texts, from, to }) + '\n');
    });
    let res;
    try { res = await once(); }
    catch (e) {
      // the speech tools didn't have the translation part yet: add it (small), then try again
      if (!/sentencepiece|ctranslate2|sacremoses|subword_nmt/i.test(e.message)) throw e;
      tstatus = 'Adding translation to the speech tools';
      const python = process.env.CUTSONA_PYTHON || config.python || 'python';
      await new Promise((ok, no) => { const p = spawn(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'sentencepiece', 'ctranslate2', 'sacremoses', 'subword-nmt'], { windowsHide: true }); p.on('error', no); p.on('close', (c) => (c === 0 ? ok() : no(new Error('Could not add translation to the speech tools.')))); });
      if (tw) { tw.kill(); tw = null; }
      res = await once();
    }
    await fs.promises.writeFile(out, JSON.stringify(res));
    return res;
  }
  // Settings → Set up speech tools wrote a new config: use it from the next clip on
  function reload() { readConfig(); if (worker) { const w = worker; worker = null; w.kill(); } }
  const configured = () => !!(process.env.CUTSONA_PYTHON || (config.python && fs.existsSync(config.python)));
  return { transcribe, translate, translateStatus: () => tstatus, reload, configured, python: () => process.env.CUTSONA_PYTHON || config.python || '' };
};
