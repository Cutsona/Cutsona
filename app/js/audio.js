// Music + clip audio analysis: beat tracking, energy, impacts, highlight detection
let _ctx = null;
export function audioCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  return _ctx;
}

export async function decodeAudio(arrayBuffer) {
  return await audioCtx().decodeAudioData(arrayBuffer.slice(0));
}

function toMono(buffer, targetRate = 22050) {
  const sr = buffer.sampleRate;
  const factor = Math.max(1, Math.round(sr / targetRate));
  const n = Math.floor(buffer.length / factor);
  const out = new Float32Array(n);
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const inv = 1 / (factor * chans.length);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const o = i * factor;
    for (const ch of chans) for (let k = 0; k < factor; k++) s += ch[o + k];
    out[i] = s * inv;
  }
  return { data: out, rate: sr / factor };
}

// ---- FFT (radix-2, in place) ----
function makeFFT(n) {
  const levels = Math.log2(n) | 0;
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i, r = 0;
    for (let k = 0; k < levels; k++) { r = (r << 1) | (x & 1); x >>>= 1; }
    rev[i] = r;
  }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >>> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

function percentile(arr, p) {
  const a = Array.from(arr).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
}

function smooth(arr, radius) {
  const n = arr.length, out = new Float32Array(n);
  let acc = 0, cnt = 0;
  // moving average, centered
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + arr[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius), b = Math.min(n, i + radius + 1);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  void acc; void cnt;
  return out;
}

function normalizeTo(arr, p = 0.95) {
  const ref = percentile(arr, p) || 1;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = Math.min(1.2, arr[i] / ref);
  return out;
}

export function analyzeMusic(buffer) {
  const { data, rate } = toMono(buffer);
  const N = 1024, H = 256;
  const hop = H / rate;
  const frames = Math.max(1, Math.floor((data.length - N) / H));
  const fft = makeFFT(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const bins = N / 2;
  const prev = new Float32Array(bins);
  const flux = new Float32Array(frames), lowFlux = new Float32Array(frames);
  const bass = new Float32Array(frames), rms = new Float32Array(frames);
  const bassBin = Math.max(2, Math.round(150 / (rate / N)));
  const lowBin = Math.max(3, Math.round(250 / (rate / N)));
  for (let f = 0; f < frames; f++) {
    const o = f * H;
    let e = 0;
    for (let i = 0; i < N; i++) { const s = data[o + i]; re[i] = s * win[i]; im[i] = 0; e += s * s; }
    rms[f] = Math.sqrt(e / N);
    fft(re, im);
    let fl = 0, lf = 0, b = 0;
    for (let k = 1; k < bins; k++) {
      const mag2 = re[k] * re[k] + im[k] * im[k];
      const m = Math.log(1 + 100 * Math.sqrt(mag2));
      const d = m - prev[k];
      if (d > 0) { fl += d; if (k < lowBin) lf += d * 2; }
      if (k <= bassBin) b += mag2;
      prev[k] = m;
    }
    flux[f] = fl; lowFlux[f] = lf; bass[f] = Math.sqrt(b);
  }
  // onset envelope: flux minus local mean, normalized
  const localMean = smooth(flux, Math.round(0.4 / hop));
  const onset = new Float32Array(frames);
  let mean = 0, sq = 0;
  for (let i = 0; i < frames; i++) { onset[i] = Math.max(0, flux[i] - localMean[i]); mean += onset[i]; }
  mean /= frames;
  for (let i = 0; i < frames; i++) sq += (onset[i] - mean) ** 2;
  const std = Math.sqrt(sq / frames) || 1;
  for (let i = 0; i < frames; i++) onset[i] /= std;

  // ---- tempo via autocorrelation ----
  const minBpm = 70, maxBpm = 180;
  const minLag = Math.floor(60 / (maxBpm * hop)), maxLag = Math.ceil(60 / (minBpm * hop));
  let bestLag = Math.round(60 / (120 * hop)), bestScore = -Infinity;
  const acLen = Math.min(frames, Math.round(90 / hop)); // use up to 90s from the middle
  const acStart = Math.max(0, Math.floor((frames - acLen) / 2));
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = acStart; i < acStart + acLen - lag; i++) s += onset[i] * onset[i + lag];
    ac[lag] = s;
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * hop);
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const s = (ac[lag] + 0.5 * (ac[lag * 2] || 0)) * w;
    if (s > bestScore) { bestScore = s; bestLag = lag; }
  }
  // parabolic refinement
  const y0 = ac[bestLag - 1] || 0, y1 = ac[bestLag], y2 = ac[bestLag + 1] || 0;
  const denom = y0 - 2 * y1 + y2;
  const lagF = bestLag + (denom !== 0 ? 0.5 * (y0 - y2) / denom : 0);
  const bpm = 60 / (lagF * hop);

  // ---- dynamic-programming beat tracker (Ellis 2007) ----
  const P = lagF;
  const score = new Float32Array(frames), back = new Int32Array(frames).fill(-1);
  const tight = 100;
  for (let i = 0; i < frames; i++) {
    let best = 0, bi = -1;
    const lo = Math.max(0, Math.floor(i - 2 * P)), hi = Math.floor(i - P / 2);
    for (let j = lo; j <= hi; j++) {
      const r = Math.log((i - j) / P);
      const s = score[j] - tight * r * r;
      if (bi < 0 || s > best) { best = s; bi = j; }
    }
    score[i] = onset[i] + (bi >= 0 ? best : 0);
    back[i] = bi;
  }
  let end = frames - 1, bestEnd = -Infinity;
  for (let i = Math.max(0, Math.floor(frames - P)); i < frames; i++) if (score[i] > bestEnd) { bestEnd = score[i]; end = i; }
  const beatFrames = [];
  for (let i = end; i >= 0; i = back[i]) { beatFrames.push(i); if (back[i] < 0) break; }
  beatFrames.reverse();
  const toTime = (f) => (f * H + N / 2) / rate;

  // ---- energy + bass envelopes ----
  const energy = normalizeTo(smooth(rms, Math.round(0.35 / hop)), 0.97);
  const bassN = normalizeTo(bass, 0.97);
  const bassEnv = new Float32Array(frames);
  const rel = Math.exp(-hop / 0.14);
  for (let i = 0, v = 0; i < frames; i++) { v = bassN[i] > v ? bassN[i] : v * rel; bassEnv[i] = v; }

  // downbeat phase from low-frequency onsets
  const lowN = normalizeTo(lowFlux, 0.98);
  const phaseScore = [0, 0, 0, 0];
  beatFrames.forEach((f, i) => { phaseScore[i % 4] += lowN[f] + 0.5 * bassN[f]; });
  const phase = phaseScore.indexOf(Math.max(...phaseScore));
  const beats = beatFrames.map((f, i) => {
    const pos = ((i - phase) % 4 + 4) % 4;
    const base = pos === 0 ? 1 : pos === 2 ? 0.75 : 0.55;
    const local = Math.min(1, (onset[f] || 0) / 3);
    return { t: toTime(f), bar: pos, down: pos === 0, strength: base * (0.6 + 0.4 * local) };
  });

  // impacts: strong low-end hits and big energy jumps (drops)
  const impacts = [];
  const thr = percentile(lowN, 0.93);
  const longE = smooth(rms, Math.round(1.5 / hop));
  const jumpGap = Math.round(1.5 / hop);
  for (const b of beats) {
    const f = Math.round((b.t * rate - N / 2) / H);
    if (f < 0 || f >= frames) continue;
    let pk = 0;
    for (let k = Math.max(0, f - 3); k <= Math.min(frames - 1, f + 3); k++) pk = Math.max(pk, lowN[k]);
    const before = longE[Math.max(0, f - jumpGap)] || 0, after = longE[Math.min(frames - 1, f + jumpGap)] || 0;
    const jump = before > 0 ? after / before : 1;
    if ((pk >= thr && pk > 0.75 && b.bar % 2 === 0) || (jump > 1.7 && b.down)) {
      b.impact = true;
      impacts.push({ t: b.t, drop: jump > 1.7 });
    }
  }

  // waveform for drawing
  const wbins = 1600;
  const wave = new Float32Array(wbins);
  const per = data.length / wbins;
  for (let i = 0; i < wbins; i++) {
    let m = 0;
    const a = Math.floor(i * per), b = Math.floor((i + 1) * per);
    for (let k = a; k < b; k += 4) { const v = Math.abs(data[k]); if (v > m) m = v; }
    wave[i] = m;
  }
  const wmax = percentile(wave, 0.99) || 1;
  for (let i = 0; i < wbins; i++) wave[i] = Math.min(1, wave[i] / wmax);

  return { duration: buffer.duration, hop, energy, bass: bassEnv, beats, impacts, bpm, wave };
}

export function sampleCurve(arr, hop, t) {
  if (!arr || !arr.length) return 0.5;
  const f = t / hop;
  const i = Math.floor(f);
  if (i < 0) return arr[0];
  if (i >= arr.length - 1) return arr[arr.length - 1];
  const a = f - i;
  return arr[i] * (1 - a) + arr[i + 1] * a;
}

// Pick the most exciting stretch of the song (snapped to a downbeat)
export function suggestWindow(music, len) {
  if (!music) return 0;
  if (music.duration <= len + 0.5) return 0;
  const avg = (a, b) => {
    let s = 0, n = 0;
    for (let t = Math.max(0, a); t < Math.min(music.duration, b); t += 0.1) { s += sampleCurve(music.energy, music.hop, t); n++; }
    return n ? s / n : 0;
  };
  let best = 0, bestScore = -Infinity;
  const downs = music.beats.filter((b) => b.down);
  for (const b of downs) {
    if (b.t + len > music.duration - 0.2) break;
    const body = avg(b.t, b.t + len);
    const head = avg(b.t, b.t + 2), pre = avg(b.t - 3, b.t);
    const lift = Math.max(0, head - pre);
    const introPenalty = b.t < 8 ? 0.08 : 0;
    const s = body + 0.9 * lift + (music.impacts.some((i) => Math.abs(i.t - b.t) < 0.05) ? 0.1 : 0) - introPenalty;
    if (s > bestScore) { bestScore = s; best = b.t; }
  }
  return best;
}

// Synthetic beat grid when there is no music
export function syntheticMusic(duration = 120, bpm = 120) {
  const beats = [];
  const p = 60 / bpm;
  for (let i = 0, t = 0; t < duration; i++, t = i * p) {
    const pos = i % 4;
    beats.push({ t, bar: pos, down: pos === 0, strength: pos === 0 ? 0.9 : pos === 2 ? 0.7 : 0.5 });
  }
  const hop = 0.05, n = Math.ceil(duration / hop);
  const energy = new Float32Array(n).fill(0.6), bass = new Float32Array(n);
  for (let i = 0; i < n; i++) { const ph = ((i * hop) % p) / p; bass[i] = Math.exp(-ph * 6) * 0.6; }
  return { duration, hop, energy, bass, beats, impacts: [], bpm, wave: null, synthetic: true };
}

// Clip audio: how loud/excited is each moment (10 Hz curve, 0..1)
export function analyzeClipAudio(buffer) {
  const { data, rate } = toMono(buffer, 11025);
  const step = Math.round(rate / 10);
  const n = Math.max(1, Math.floor(data.length / step));
  const loud = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = i * step; k < (i + 1) * step; k++) s += data[k] * data[k];
    loud[i] = Math.sqrt(s / step);
  }
  const db = loud.map((v) => Math.max(0, 1 + Math.log10(v + 1e-5) / 3)); // ~0..1
  const base = smooth(db, 60); // 12s context
  const rel = new Float32Array(n);
  for (let i = 0; i < n; i++) rel[i] = Math.max(0, db[i] - base[i]);
  const a = normalizeTo(smooth(db, 3), 0.98), r = normalizeTo(smooth(rel, 4), 0.98);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, 0.45 * a[i] + 0.55 * r[i]);
  return out;
}

export function encodeWav(buffer) {
  const ch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
  const bytes = 44 + len * ch * 2;
  const ab = new ArrayBuffer(bytes), v = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, len * ch * 2, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
