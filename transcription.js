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
      else job.resolve({ words: data.words, language: data.language });
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

  async function transcribe(audio) {
    const key = crypto.createHash('sha256').update(audio).update(String(process.env.CUTSONA_WHISPER_MODEL || config.model || 'base.en')).digest('hex');
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
          proc.stdin.write(JSON.stringify({ id, audio: input, model: process.env.CUTSONA_WHISPER_MODEL || config.model }) + '\n');
        });
        await fs.promises.writeFile(output + '.part', JSON.stringify(result));
        await fs.promises.rename(output + '.part', output);
        return result;
      } finally { await fs.promises.unlink(input).catch(() => {}); }
    })();
    inFlight.set(key, task);
    try { return await task; } finally { inFlight.delete(key); }
  }
  // Settings → Set up speech tools wrote a new config: use it from the next clip on
  function reload() { readConfig(); if (worker) { const w = worker; worker = null; w.kill(); } }
  const configured = () => !!(process.env.CUTSONA_PYTHON || (config.python && fs.existsSync(config.python)));
  return { transcribe, reload, configured, python: () => process.env.CUTSONA_PYTHON || config.python || '' };
};
