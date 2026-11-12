// Frame-accurate offline export: renders every frame with the same renderer as the preview,
// encodes with WebCodecs, mixes audio offline, and lets the local server (ffmpeg) mux the MP4.
import { Renderer, drawTextCanvas } from './renderer.js';
import { frameAt, srcOffset, makeCtx } from './edit.js';
import { encodeWav } from './audio.js';
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';

const H264 = ['avc1.640034', 'avc1.640033', 'avc1.64002A', 'avc1.640028', 'avc1.4D0034', 'avc1.4D002A', 'avc1.42E034', 'avc1.42E02A'];

async function pickEncoder(w, h, fps, bitrate) {
  if (!('VideoEncoder' in window)) throw new Error('This browser has no WebCodecs encoder. Please use Chrome or Edge.');
  for (const accel of ['prefer-hardware', 'no-preference']) {
    for (const codec of H264) {
      const cfg = { codec, width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' }, hardwareAcceleration: accel, latencyMode: 'quality', bitrateMode: 'variable' };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { cfg: r.config, kind: 'h264' }; } catch {}
    }
  }
  for (const codec of ['vp09.00.41.08', 'vp09.00.40.08']) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality' };
    try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { cfg: r.config, kind: 'vp9' }; } catch {}
  }
  throw new Error('No supported video encoder found.');
}

function waitEvent(el, name, ms = 4000) {
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (done) return; done = true; el.removeEventListener(name, fin); res(); };
    el.addEventListener(name, fin);
    setTimeout(fin, ms);
  });
}

async function seekTo(el, t) {
  if (Math.abs(el.currentTime - t) < 0.0005 && el.readyState >= 2 && !el.seeking) return;
  const p = waitEvent(el, 'seeked');
  el.currentTime = t;
  await p;
}

// WSOLA time-stretch: follows the shot's speed curve (srcOffset) but keeps the original pitch,
// so slow-mo / speed ramps don't make voices sound like chipmunks or demons.
export function stretchSegment(oac, buf, seg, d) {
  const sr = buf.sampleRate, C = buf.numberOfChannels;
  const N = Math.round(sr * 0.04) & ~1, Hs = N / 2, tol = Math.round(sr * 0.012);
  const outLen = Math.max(1, Math.ceil(d * sr));
  const ins = []; for (let c = 0; c < C; c++) ins.push(buf.getChannelData(c));
  let mono = ins[0];
  if (C > 1) { mono = new Float32Array(ins[0].length); for (let i = 0; i < mono.length; i++) mono[i] = (ins[0][i] + ins[1][i]) * 0.5; }
  const win = new Float32Array(N); for (let j = 0; j < N; j++) win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N);
  const out = []; for (let c = 0; c < C; c++) out.push(new Float32Array(outLen + N));
  const maxStart = mono.length - N - 1;
  if (maxStart <= 0) return oac.createBuffer(C, outLen, sr);
  const dur = buf.duration;
  let prev = -1;
  for (let k = 0; k * Hs < outLen; k++) {
    let srcT = seg.srcStart + srcOffset(seg, (k * Hs) / sr);
    if (srcT > dur - 0.06 && dur > 0.5) srcT %= dur - 0.06;
    const target = Math.max(0, Math.min(maxStart, Math.round(srcT * sr)));
    let best = target;
    if (prev >= 0) {
      const nat = Math.min(maxStart, prev + Hs);
      let bestC = -Infinity;
      for (let dl = -tol; dl <= tol; dl += 2) {
        const p = target + dl;
        if (p < 0 || p > maxStart) continue;
        let c = 0;
        for (let j = 0; j < Hs; j += 4) c += mono[nat + j] * mono[p + j];
        if (c > bestC) { bestC = c; best = p; }
      }
    }
    const o = k * Hs;
    for (let c = 0; c < C; c++) { const src = ins[c], dst = out[c]; for (let j = 0; j < N; j++) dst[o + j] += src[best + j] * win[j]; }
    prev = best;
  }
  const res = oac.createBuffer(C, outLen, sr);
  for (let c = 0; c < C; c++) res.copyToChannel(out[c].subarray(0, outLen), c);
  return res;
}

async function mixAudio({ plan, clips, music, settings, D }) {
  const sr = 48000;
  const len = Math.max(1, Math.ceil(D * sr));
  const oac = new OfflineAudioContext(2, len, sr);
  // gain envelope helper: fade in / out over the whole edit
  const envelope = (param, vol, fin, fout) => {
    fin = Math.min(Number(fin) || 0, D / 2); fout = Math.min(Number(fout) || 0, D / 2);
    param.setValueAtTime(fin > 0 ? 0.0001 : vol, 0);
    if (fin > 0) param.linearRampToValueAtTime(vol, fin);
    if (fout > 0) { param.setValueAtTime(vol, Math.max(fin, D - fout)); param.linearRampToValueAtTime(0.0001, D); }
  };
  if (music && music.buffer && settings.musicVol > 0) {
    const src = oac.createBufferSource();
    src.buffer = music.buffer;
    const g = oac.createGain();
    envelope(g.gain, settings.musicVol, settings.musicFadeIn, settings.musicFadeOut);
    // "Best quote": the song dips under each spoken line (same as the preview)
    const duck = oac.createGain();
    duck.gain.setValueAtTime(1, 0);
    if (plan.mode === 'quotes' || plan.voice) {
      for (const seg of plan.segments) {
        if (!seg.speech || (plan.mode !== 'quotes' && !seg.voice)) continue;
        const a = Math.max(0, seg.start - 0.15), b = Math.min(D, seg.end + 0.1);
        duck.gain.setTargetAtTime(0.28, a, 0.04);
        duck.gain.setTargetAtTime(1, b, 0.08);
      }
    }
    src.connect(g).connect(duck).connect(oac.destination);
    src.start(0, plan.musicStart, D + 0.1);
  }
  if (plan.mode === 'quotes') settings = { ...settings, clipVol: 1 };
  if (settings.clipVol > 0 || plan.voice) {
    // clip sound follows the video fade
    const bus = oac.createGain();
    envelope(bus.gain, 1, settings.fadeIn, settings.fadeOut);
    bus.connect(oac.destination);
    for (const seg of plan.segments) {
      const clip = clips[seg.clip];
      if (!clip || !clip.audioBuffer) continue;
      const d = seg.end - seg.start;
      const parts = [];
      const p = seg.profile;
      if (p.type === 'stutter') {
        const sd = d * p.until, q = p.q;
        for (let k = 0; k * q < sd; k++) parts.push({ at: seg.start + k * q, off: seg.srcStart, dur: Math.min(q, sd - k * q) });
        parts.push({ at: seg.start + sd, off: seg.srcStart, dur: d - sd });
      } else if (p.type === 'const' && (p.r || 1) === 1) {
        parts.push({ at: seg.start, off: seg.srcStart, dur: d });
      } else {
        // speed ramp / slow-mo: time-stretch so the speed changes but the pitch doesn't
        parts.push({ at: seg.start, dur: d, buffer: stretchSegment(oac, clip.audioBuffer, seg, d) });
      }
      for (const pt of parts) {
        if (pt.dur <= 0.005) continue;
        const s = oac.createBufferSource();
        s.buffer = pt.buffer || clip.audioBuffer;
        const g = oac.createGain();
        const v = seg.voice ? 1 : settings.clipVol, f = Math.min(0.012, pt.dur / 4);
        if (v <= 0) continue;
        g.gain.setValueAtTime(0, pt.at);
        g.gain.linearRampToValueAtTime(v, pt.at + f);
        g.gain.setValueAtTime(v, pt.at + pt.dur - f);
        g.gain.linearRampToValueAtTime(0, pt.at + pt.dur);
        s.connect(g).connect(bus);
        if (pt.buffer) s.start(pt.at, 0, pt.dur + 0.05);
        else s.start(pt.at, Math.min(pt.off, clip.audioBuffer.duration - 0.01), pt.dur + 0.05);
        s.stop(pt.at + pt.dur + 0.01);
      }
    }
  }
  const out = await oac.startRendering();
  return encodeWav(out);
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Server error ${r.status}`);
  return j;
}

export async function exportEdit({ plan, clips, music, musicAnalysis, settings, name, onProgress, isCancelled, poolEl, overlay = null, hook = null }) {
  const [aw, ah] = settings.format.split(':').map(Number);
  const short = settings.res || 1080;
  let w, h;
  if (aw < ah) { w = short; h = Math.round(short * ah / aw); }
  else if (aw > ah) { h = short; w = Math.round(short * aw / ah); }
  else { w = h = short; }
  // video encoders top out at 4096 px on the long side (a 4K 21:9 export would be 5040 wide)
  const over = Math.max(w, h) / 4096;
  if (over > 1) { w = Math.round(w / over); h = Math.round(h / over); }
  w -= w % 2; h -= h % 2;
  const fps = settings.fps || 30;
  const D = plan.duration;
  const total = Math.round(D * fps);
  const bitrate = Math.round(w * h * fps * (fps > 30 ? 0.13 : 0.2));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const renderer = new Renderer(canvas);
  // stream clips bring their own overlay (banner, title box); the hook text is its own layer
  if (overlay) renderer.setText(overlay, 1);
  if (hook) renderer.setHook(hook, 1);

  // one decoder per clip used
  const els = new Map();
  for (const seg of plan.segments) {
    if (els.has(seg.clip)) continue;
    const clip = clips[seg.clip];
    const el = document.createElement('video');
    el.muted = true; el.preload = 'auto'; el.playsInline = true; el.crossOrigin = 'anonymous';
    el.src = clip.url;
    poolEl.appendChild(el);
    els.set(seg.clip, el);
    if (el.readyState < 2) await waitEvent(el, 'loadeddata', 15000);
  }

  const enc = await pickEncoder(w, h, fps, bitrate);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: enc.kind === 'h264' ? 'avc' : 'vp9', width: w, height: h, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let encErr = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encErr = e; },
  });
  encoder.configure(enc.cfg);

  const ctx = makeCtx(settings, musicAnalysis, clips);
  const t0 = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      if (isCancelled && isCancelled()) throw new Error('cancelled');
      if (encErr) throw encErr;
      const t = Math.min(D - 0.0005, i / fps);
      const fr = frameAt(plan, t, ctx);
      const el = els.get(fr.seg.clip);
      await seekTo(el, fr.src);
      renderer.setCaption(clips[fr.seg.clip], fr.src, settings, !plan.style.voiceCaptions || !!fr.seg.voice || plan.mode === 'quotes');
      renderer.render(el, fr.U, true);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (encoder.encodeQueueSize > 6) await waitEvent(encoder, 'dequeue', 500);
      if (i % 3 === 0) {
        const el2 = (performance.now() - t0) / 1000;
        onProgress && onProgress({ phase: 'Rendering frames', p: (i / total) * 0.9, eta: el2 / Math.max(1, i) * (total - i) });
      }
    }
    await encoder.flush();
    encoder.close();
    muxer.finalize();
  } finally {
    for (const el of els.values()) { el.pause(); el.removeAttribute('src'); el.load(); el.remove(); }
    renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  onProgress && onProgress({ phase: 'Mixing audio', p: 0.92 });
  const hasAudio = (music && music.buffer && settings.musicVol > 0) || ((settings.clipVol > 0 || plan.mode === 'quotes') && clips.some((c) => c.audioBuffer));
  const wav = hasAudio ? await mixAudio({ plan, clips, music, settings, D }) : null;

  onProgress && onProgress({ phase: 'Saving MP4', p: 0.95 });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await post(`/api/export/part?id=${id}&kind=video`, new Blob([muxer.target.buffer], { type: 'video/mp4' }));
  if (wav) await post(`/api/export/part?id=${id}&kind=audio`, wav);
  const res = await post(`/api/export/finish?id=${id}&fps=${fps}&vcodec=${enc.kind}&name=${encodeURIComponent(name)}`, '');
  onProgress && onProgress({ phase: 'Done', p: 1 });
  return { ...res, seconds: (performance.now() - t0) / 1000, w, h, fps };
}
