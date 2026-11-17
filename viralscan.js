// Viral scan: Cutsona "watches" a whole video with FFmpeg and hands the page what happens second by second,
// so it can find the parts most likely to go viral (app/js/viral.js does the judging):
//   loud    how loud it is (the voice / the crowd / the game), 0..1, every 0.25 s
//   burst   sudden jumps in loudness (a laugh, a scream, a hit), 0..1
//   bright  how "sharp" the sound is (yelling, laughing, cheering vs. music and hum), 0..1
//   motion  how much the picture moves, 0..1
//   cuts    the moments the shot changes (seconds)
//   dark    black / blank stretches (seconds, start-end)
//   words   what's said, with times (the video's captions, else the speech tools on this PC listen to it)
//   heatmap YouTube's "Most replayed" (when the video has one), views and likes
// Sources: a link (the copy Cutsona already downloads to preview it), a file on this computer (the desktop app
// gives its path), or a file the page uploads. Results are kept in the cache, so a second look is instant.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const VERSION = 4;
const STEP = 0.25;
const MEDIA = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|mpg|mpeg|ts|mts|m2ts|3gp|ogv|mp3|wav|m4a|aac|flac|ogg|opus)$/i;

module.exports = function viralScanner({ ffmpeg, cacheDir, previewJob, twitchClip, linkTranscript, transcription, ytInfo }) {
  const jobs = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const keyOf = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

  // run ffmpeg, give its stdout to onData as it comes; resolves with the stderr text
  function ff(args, onData) {
    return new Promise((resolve, reject) => {
      const p = spawn(ffmpeg(), ['-hide_banner', '-nostats', ...args], { windowsHide: true });
      let err = '';
      p.stdout.on('data', onData);
      p.stderr.on('data', (d) => { err = (err + d).slice(-20000); });
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error((err.trim().split(/\r?\n/).pop() || `ffmpeg stopped (${code})`).slice(0, 200)))));
    });
  }
  const durationIn = (txt) => { const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(txt); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; };
  async function probe(src) {
    let d = 0;
    try { await ff(['-i', src, '-t', '0.01', '-f', 'null', '-'], () => {}).then((e) => { d = durationIn(e); }); } catch (e) { d = durationIn(String(e.message)); }
    return d;
  }

  // the picture: tiny grey frames, compared one after another
  async function scanPicture(src, dur, job) {
    const W = 32, H = 18, N = W * H;
    const fps = dur > 3600 ? 1 : dur > 1200 ? 2 : 4;
    const cap = Math.min(dur || 7200, 7200);
    const motion = [], bright = [], hists = [];
    let buf = Buffer.alloc(0), prev = null;
    await ff(['-v', 'error', '-i', src, '-t', String(cap), '-an', '-sn', '-vf', `fps=${fps},scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'], (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      while (buf.length >= N) {
        const f = buf.subarray(0, N); buf = buf.subarray(N);
        let s = 0, s2 = 0, m = 0; const h = new Float32Array(8);
        for (let k = 0; k < N; k++) { const v = f[k]; s += v; s2 += v * v; h[v >> 5]++; if (prev) m += Math.abs(v - prev[k]); }
        const mean = s / N, sd = Math.sqrt(Math.max(0, s2 / N - mean * mean));
        motion.push(prev ? m / N / 255 : 0); bright.push([mean / 255, sd / 255]); hists.push(h);
        prev = Buffer.from(f);
        if (dur) job.pct = Math.min(99, Math.round(20 + 60 * (motion.length / fps) / cap));
      }
    });
    if (motion.length > 1) motion[0] = motion[1];
    // a new shot: a big change in the picture and in its mix of light and dark
    const cuts = [];
    for (let i = 1; i < hists.length; i++) {
      let hd = 0; for (let b = 0; b < 8; b++) hd += Math.abs(hists[i][b] - hists[i - 1][b]);
      if (motion[i] > 0.12 && hd / N > 0.45 && (!cuts.length || i / fps - cuts.at(-1) > 0.4)) cuts.push(+(i / fps).toFixed(2));
    }
    // black or blank: nothing to watch
    const dark = []; let d0 = -1;
    bright.forEach(([mean, sd], i) => {
      // (a dark scene is still a scene: only real black, or one flat colour with nothing in it, counts as blank)
      const blank = (mean < 0.035 && sd < 0.03) || sd < 0.012;
      if (blank && d0 < 0) d0 = i; if (!blank && d0 >= 0) { if (i - d0 >= fps * 0.5) dark.push([+(d0 / fps).toFixed(2), +(i / fps).toFixed(2)]); d0 = -1; }
    });
    if (d0 >= 0 && bright.length - d0 >= fps * 0.5) dark.push([+(d0 / fps).toFixed(2), +(bright.length / fps).toFixed(2)]);
    return { fps, motion, cuts, dark };
  }

  // the sound: loudness, sudden jumps, and how sharp it is, every 0.25 s
  async function scanSound(src, dur) {
    const R = 8000, per = R * STEP, sub = R * 0.05;
    const loudDb = [], burstRaw = [], zcr = [];
    let buf = Buffer.alloc(0);
    try {
      await ff(['-v', 'error', '-i', src, '-t', String(Math.min(dur || 7200, 7200)), '-vn', '-sn', '-ac', '1', '-ar', String(R), '-f', 's16le', 'pipe:1'], (d) => {
        buf = buf.length ? Buffer.concat([buf, d]) : d;
        while (buf.length >= per * 2) {
          const blk = buf.subarray(0, per * 2); buf = buf.subarray(per * 2);
          let s2 = 0, z = 0, last = 0; const subs = [];
          let ss = 0;
          for (let k = 0; k < per; k++) {
            const v = blk.readInt16LE(k * 2) / 32768;
            s2 += v * v; ss += v * v;
            if ((v >= 0) !== (last >= 0)) z++; last = v;
            if ((k + 1) % sub === 0) { subs.push(Math.sqrt(ss / sub)); ss = 0; }
          }
          const rms = Math.sqrt(s2 / per);
          loudDb.push(20 * Math.log10(rms + 1e-6));
          const mu = subs.reduce((a, b) => a + b, 0) / subs.length;
          burstRaw.push(mu > 1e-4 ? Math.sqrt(subs.reduce((a, b) => a + (b - mu) ** 2, 0) / subs.length) / mu : 0);
          zcr.push(z / per);
        }
      });
    } catch { return null; } // no sound track
    if (!loudDb.length) return null;
    const sorted = [...loudDb].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.1)], hi = sorted[Math.floor(sorted.length * 0.985)];
    const loud = loudDb.map((x) => +Math.max(0, Math.min(1, (x - lo) / Math.max(6, hi - lo))).toFixed(3));
    // a jump: louder than the 2 seconds before it
    const burst = loud.map((x, i) => {
      // (the first second has nothing before it to jump from: a video starting is not a reaction)
      let m = 0, c = 0; for (let j = Math.max(0, i - 8); j < i; j++) { m += loud[j]; c++; }
      const jump = c >= 4 ? x - m / c : 0;
      return +Math.max(0, Math.min(1, jump * 1.8 + Math.min(1, burstRaw[i]) * 0.35 * x)).toFixed(3);
    });
    const zs = [...zcr].sort((a, b) => a - b), z90 = zs[Math.floor(zs.length * 0.95)] || 0.1;
    const bright = zcr.map((z, i) => +Math.min(1, (z / Math.max(0.02, z90)) * loud[i]).toFixed(3));
    return { loud, burst, bright };
  }

  // words for a file: the speech tools listen to it (when they're set up)
  async function wordsOfFile(src, dur, limit = 1800) {
    if (!transcription?.configured?.()) return { words: [], wordsFrom: 'none' };
    const chunks = [];
    await ff(['-v', 'error', '-i', src, '-t', String(Math.min(dur || limit, limit)), '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'], (d) => chunks.push(d));
    const wav = Buffer.concat(chunks);
    if (wav.length < 2000) return { words: [], wordsFrom: 'none' };
    wav.writeUInt32LE(wav.length - 8, 4); const di = wav.indexOf('data'); if (di > 0) wav.writeUInt32LE(wav.length - di - 8, di + 4);
    const r = await transcription.transcribe(wav);
    return { words: (r.words || []).map((w) => ({ start: w.start, end: w.end, text: w.text })), wordsFrom: 'speech' };
  }

  async function run(job, src) {
    const file = path.join(cacheDir, `viral_${job.key}.json`);
    try {
      job.phase = 'Getting the video';
      let media = src.file;
      if (src.url) {
        const tw = /^https:\/\/(?:clips\.twitch\.tv\/|(?:www\.)?twitch\.tv\/[A-Za-z0-9_]+\/clip\/)([A-Za-z0-9_-]{3,120})/.exec(src.url);
        if (tw) media = await twitchClip(tw[1]);
        // a stream playlist (Kick clips) or a plain video link: FFmpeg reads it straight from the site
        else if (/\.(m3u8|mp4|webm|mov)(\?|$)/i.test(src.url)) media = src.url;
        else {
          const pj = previewJob(src.url, false);
          while (!pj.done && !pj.error) { await sleep(300); job.pct = Math.min(19, pj.total ? 19 * ((fs.existsSync(pj.file) ? fs.statSync(pj.file).size : 0) / pj.total) : 2); }
          if (pj.error) throw new Error(pj.error);
          media = pj.file;
        }
      }
      // words and fan data run alongside the watching
      const wordsTask = src.url
        ? linkTranscript(src.url).then((t) => ({ words: t.words || [], wordsFrom: t.source || 'captions' })).catch(() => ({ words: [], wordsFrom: 'none' }))
        : wordsOfFile(media, 0, src.limit).catch(() => ({ words: [], wordsFrom: 'none' }));
      const infoTask = src.url && ytInfo ? ytInfo(src.url).catch(() => null) : Promise.resolve(null);
      job.phase = 'Watching the whole video';
      const probedDuration = await probe(media);
      const duration = src.limit ? Math.min(src.limit, probedDuration || src.limit) : probedDuration;
      const [pic, snd] = await Promise.all([scanPicture(media, duration, job), scanSound(media, duration)]);
      job.phase = 'Reading what’s said'; job.pct = Math.max(job.pct, 85);
      const { words, wordsFrom } = await wordsTask;
      const info = await infoTask;
      const n = Math.ceil((duration || pic.motion.length / pic.fps) / STEP);
      // the picture's motion on the same 0.25 s grid as the sound
      const motion = Array.from({ length: n }, (_, i) => {
        const a = Math.floor(i * STEP * pic.fps), b = Math.max(a + 1, Math.floor((i + 1) * STEP * pic.fps));
        let m = 0, c = 0; for (let k = a; k < b && k < pic.motion.length; k++) { m += pic.motion[k]; c++; }
        return c ? m / c : 0;
      });
      const ms = [...motion].sort((x, y) => x - y), mHi = Math.max(0.02, ms[Math.floor(ms.length * 0.97)] || 0.02);
      const result = {
        v: VERSION, step: STEP, duration: duration || n * STEP,
        loud: snd?.loud || [], burst: snd?.burst || [], bright: snd?.bright || [],
        motion: motion.map((x) => +Math.min(1, x / mHi).toFixed(3)), cuts: pic.cuts, dark: pic.dark,
        words, wordsFrom,
        heatmap: (info?.heatmap || []).map((h) => [h.start_time, h.end_time, h.value]),
        views: info?.view_count || 0, likes: info?.like_count || 0, comments: info?.comment_count || 0, title: info?.title || src.name || '',
      };
      try { fs.writeFileSync(file, JSON.stringify(result)); } catch {}
      job.result = result; job.pct = 100; job.phase = 'Done';
    } catch (e) {
      job.error = String(e.message || e).slice(0, 240);
    } finally { job.done = true; setTimeout(() => { if (jobs.get(job.key) === job && job.error) jobs.delete(job.key); }, 30000); }
  }

  function start(id, src) {
    const key = keyOf(`${VERSION}:${id}`);
    let job = jobs.get(key);
    if (job) return job;
    job = { key, pct: 0, phase: 'Starting', done: false, error: '', result: null };
    const file = path.join(cacheDir, `viral_${key}.json`);
    try { const r = JSON.parse(fs.readFileSync(file, 'utf8')); if (r.v === VERSION) { job.result = r; job.done = true; job.pct = 100; jobs.set(key, job); return job; } } catch {}
    jobs.set(key, job);
    run(job, src);
    return job;
  }
  const view = (job) => (job.done ? (job.error ? { error: job.error } : { done: true, key: job.key, ...job.result }) : { running: true, key: job.key, pct: Math.round(job.pct), phase: job.phase });

  return {
    // GET /api/viral?url=… | ?path=… | ?key=…   (POST /api/viral?name=… with the file as the body)
    async handle(req, res, q, { json, saveBody }) {
      if (req.method === 'POST') {
        const name = path.basename(String(q.get('name') || 'clip.mp4')).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
        if (!MEDIA.test(name)) return json(res, 400, { error: 'Not a video or sound file.' });
        const id = `up:${name}:${q.get('size') || ''}:${q.get('mtime') || ''}`, key = keyOf(`${VERSION}:${id}`);
        if (jobs.has(key) || fs.existsSync(path.join(cacheDir, `viral_${key}.json`))) { req.resume(); return json(res, 200, view(start(id, {}))); }
        const dst = path.join(cacheDir, `vup_${key}${path.extname(name)}`);
        await saveBody(req, dst);
        return json(res, 200, view(start(id, { file: dst, name })));
      }
      const k = q.get('key');
      if (k) { const job = jobs.get(k); return job ? json(res, 200, view(job)) : json(res, 404, { error: 'No scan with that key.' }); }
      const u = String(q.get('url') || ''), p = String(q.get('path') || '');
      if (u) {
        if (!/^https:\/\//i.test(u)) return json(res, 400, { error: 'Not a link.' });
        return json(res, 200, view(start(`url:${u}`, { url: u })));
      }
      if (p) {
        // a file on this computer (from the desktop app's own file picker / drop): a real video or sound file only
        let st = null; try { st = fs.statSync(p); } catch {}
        if (!st || !st.isFile() || !MEDIA.test(p)) return json(res, 400, { error: 'Not a video file on this computer.' });
        return json(res, 200, view(start(`file:${p}:${st.size}:${st.mtimeMs}`, { file: p, name: path.basename(p) })));
      }
      // a clip Cutsona downloaded into its cache (/cache/…)
      const c = String(q.get('cache') || '');
      if (c.startsWith('/cache/')) {
        const f = path.join(cacheDir, path.basename(c));
        let st = null; try { st = fs.statSync(f); } catch {}
        if (!st || !MEDIA.test(f)) return json(res, 404, { error: 'clip not found' });
        const limit = q.get('limit') === '3600' ? 3600 : undefined;
        return json(res, 200, view(start(`file:${f}:${st.size}:${st.mtimeMs}${limit ? ':' + limit : ''}`, { file: f, limit, name: path.basename(f) })));
      }
      return json(res, 400, { error: 'url, path or cache needed' });
    },
  };
};
