// Auto-focus: finds faces and people in a clip (MediaPipe, runs locally on this PC) and builds a smooth
// "where to look" track that the edit follows, with stable framing through brief detection gaps.
import { frameChange } from './scene.js';
let visionP = null;
let workerP = null;
async function trackingWorker() {
  if (!workerP) workerP = (async () => {
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('Background vision is unavailable');
    // The MediaPipe WASM loader uses importScripts, so this must be a classic worker.
    const worker = new Worker(new URL('./track-worker.js', import.meta.url));
    let next = 0;
    const pending = new Map();
    const fail = error => {
      worker.terminate(); workerP = null;
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
      pending.clear();
    };
    worker.onerror = event => fail(new Error(event.message || 'Background vision failed'));
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id); if (!request) return;
      pending.delete(data.id); clearTimeout(request.timer);
      data.error ? request.reject(new Error(data.error)) : request.resolve(data.result);
    };
    const call = (type, values = {}, transfer = []) => new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => fail(new Error('Background vision timed out')), 30000);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, type, ...values }, transfer);
    });
    await call('reset');
    return { call };
  })();
  try { return await workerP; } catch (error) { workerP = null; throw error; }
}
export function loadVision() {
  if (!visionP) {
    visionP = (async () => {
      const r = await fetch('/api/vision', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'could not download the face detector');
      const mp = await import('/vision/vision_bundle.mjs');
      const files = await mp.FilesetResolver.forVisionTasks('/vision/wasm');
      const make = async (Cls, opts) => {
        // These small detectors are fast in WASM. Prefer CPU so software GPU
        // rendering cannot monopolize the device used by the four live previews.
        for (const delegate of ['CPU', 'GPU']) {
          try { return await Cls.createFromOptions(files, { ...opts, baseOptions: { ...opts.baseOptions, delegate } }); }
          catch (e) { console.warn('vision', delegate, e); }
        }
        return null;
      };
      const face = await make(mp.FaceDetector, { baseOptions: { modelAssetPath: '/vision/face.tflite' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 });
      // faces only (1.2): bodies, shirts and background figures are no longer tracked
      if (!face) throw new Error('face detector could not start');
      return { face, person: null };
    })();
    visionP.catch(() => { visionP = null; });
  }
  return visionP;
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function waitFor(el, ev, ms) {
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (done) return; done = true; el.removeEventListener(ev, fin); res(); };
    el.addEventListener(ev, fin); setTimeout(fin, ms);
  });
}

// pick the subject: biggest, most confident, and close to whoever we followed last
export function choose(list, prev) {
  let best = null, bs = -1;
  for (const d of list) {
    const dist = prev ? Math.hypot(d.x - prev.x, d.y - prev.y) : 0;
    // sticky: keep following the same person unless someone else is clearly the main subject
    const s = (d.w * d.h) * (0.3 + d.score) / (1 + 10 * dist) * (prev && dist < 0.08 ? 1.8 : 1);
    if (s > bs) { bs = s; best = d; }
  }
  return best;
}
export function boxes(res, W, H) {
  return ((res && res.detections) || []).map((d) => {
    const b = d.boundingBox;
    return { x: (b.originX + b.width / 2) / W, y: (b.originY + b.height / 2) / H, top: b.originY / H, w: b.width / W, h: b.height / H,
      score: (d.categories && d.categories[0] && d.categories[0].score) || 0.5 };
  }).filter((b) => b.w > 0.01 && b.h > 0.01);
}

export function selectSubject(faces, people, prev) {
  // A visible body takes precedence over a facecam or a face in the background.
  // Keep the whole detected person instead of aiming at their forehead.
  if (people.length) {
    const b = choose(people, prev);
    return { x: b.x, y: b.y, w: b.w, h: b.h, size: b.h, kind: 'body' };
  }
  if (faces.length) {
    const f = choose(faces, prev);
    return { x: f.x, y: clamp(f.y + f.h * 0.65, 0, 1), w: f.w * 1.5, h: f.h * 2.4, size: f.h, kind: 'face' };
  }
  return null;
}

// Everyone in one sample as compact [x, y, w, h] boxes (centers, 0..1): bodies, plus faces with no body found.
export function personBoxes(faces = [], people = []) {
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const bodies = people.filter((p) => (p.score ?? 1) >= 0.3);
  const out = bodies.map((p) => [r3(p.x), r3(p.y), r3(p.w), r3(p.h)]);
  for (const f of faces) {
    if ((f.score ?? 1) < 0.5) continue;
    if (bodies.some((p) => Math.abs(f.x - p.x) < p.w / 2 && f.y > p.y - p.h / 2 && f.y < p.y + p.h / 2)) continue;
    out.push([r3(f.x), r3(f.y + f.h * 0.9), r3(f.w * 2.2), r3(f.h * 3)]); // face only: treat as head-and-shoulders
  }
  return out;
}

// Everyone who matters in the frame, as one box: the main people (ignoring tiny background figures)
// plus faces that aren't already inside a detected body (facecams, close-ups).
export function subjectGroup(faces = [], people = []) {
  const items = [];
  const maxH = Math.max(0, ...people.map(p => p.h));
  for (const p of people) {
    if (p.h < maxH * 0.45 || p.score < 0.3) continue;
    items.push({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: p.top, y1: p.top + p.h, wgt: p.w * p.h * (0.4 + p.score) });
  }
  for (const f of faces) {
    if (f.score < 0.5) continue;
    const inside = people.some(p => Math.abs(f.x - p.x) < p.w / 2 && f.y > p.top && f.y < p.top + p.h);
    if (inside) continue;
    items.push({ x0: f.x - f.w * 0.9, x1: f.x + f.w * 0.9, y0: f.top - f.h * 0.3, y1: f.top + f.h * 2.6, wgt: f.w * f.h * 4 * (0.4 + f.score) });
  }
  if (!items.length) return null;
  let sw = 0, cx = 0, cy = 0;
  for (const it of items) { sw += it.wgt; cx += (it.x0 + it.x1) / 2 * it.wgt; cy += it.y0 * it.wgt; }
  return {
    x0: clamp(Math.min(...items.map(i => i.x0)), 0, 1), x1: clamp(Math.max(...items.map(i => i.x1)), 0, 1),
    y0: clamp(Math.min(...items.map(i => i.y0)), 0, 1), y1: clamp(Math.max(...items.map(i => i.y1)), 0, 1),
    cx: clamp(cx / sw, 0, 1), top: clamp(cy / sw, 0, 1), n: items.length,
  };
}

// Short-range face models lose small/stylized faces when a wide frame is reduced.
// Overlapping square crops give them enough detail without adding another model.
export function detectFaces(detector, canvas, people = [], tile = null, memo = null) {
  if (!detector) return [];
  const W = canvas.width, H = canvas.height;
  let faces = boxes(detector.detect(canvas), W, H);
  if (people.length || faces.some(f => f.score >= 0.75)) return faces;
  if (Math.max(W, H) / Math.min(W, H) >= 1.3) {
  const size = Math.min(W, H);
  tile ||= typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : document.createElement('canvas');
  tile.width = size; tile.height = size;
  const g = tile.getContext('2d');
  for (const position of [0, 0.5, 1]) {
    const x = W > H ? Math.round((W - size) * position) : 0;
    const y = H > W ? Math.round((H - size) * position) : 0;
    g.drawImage(canvas, x, y, size, size, 0, 0, size, size);
    for (const face of boxes(detector.detect(tile), size, size)) faces.push({ ...face,
      x: (x + face.x * size) / W, y: (y + face.y * size) / H, top: (y + face.top * size) / H,
      w: face.w * size / W, h: face.h * size / H });
  }
  }
  // Still nobody: small faces (a streamer's facecam or a cut-out of them over a busy screen is often only a few
  // percent of the picture). Zoom in: half- then third-height squares across the frame, and look first where a
  // face was found last time (memo), so a facecam costs one or two looks per frame instead of dozens.
  // (with nothing found for a while, the full zoomed search runs on every 4th frame only, so videos with nobody in
  // them don't get slow)
  if (memo) memo.n = (memo.n || 0) + 1;
  const skipZoom = memo && !memo.at && (memo.miss || 0) >= 3 && memo.n % 4 !== 0;
  if (!skipZoom && !faces.some((f) => f.score >= 0.6)) {
    const zt = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    const zg = zt.getContext('2d'), found = [];
    const look = (x, y, sz) => {
      zg.drawImage(canvas, x, y, sz, sz, 0, 0, 256, 256);
      for (const f of boxes(detector.detect(zt), 256, 256)) if (f.score >= 0.6) found.push({ ...f, x: (x + f.x * sz) / W, y: (y + f.y * sz) / H, top: (y + f.top * sz) / H, w: f.w * sz / W, h: f.h * sz / H });
    };
    const m = memo && memo.at;
    if (m) look(Math.max(0, Math.min(W - m.s, m.x)), Math.max(0, Math.min(H - m.s, m.y)), m.s);
    for (const sz of [Math.round(Math.min(W, H) / 2), Math.round(Math.min(W, H) / 3)]) {
      if (found.length) break;
      for (let y = 0; y + sz <= H + 1 && !found.length; y += sz / 2) for (let x = 0; x + sz <= W + 1; x += sz / 2) {
        look(Math.min(W - sz, x), Math.min(H - sz, y), sz);
        if (found.length) { if (memo) memo.at = { x: Math.round(found[0].x * W - sz / 2), y: Math.round(found[0].y * H - sz / 2), s: sz }; break; }
      }
    }
    if (memo) { if (found.length) memo.miss = 0; else { memo.at = null; memo.miss = (memo.miss || 0) + 1; } }
    faces.push(...found);
  }
  // Keep the strongest detection of each face, rather than counting overlapping tiles as people.
  const unique = [];
  faces.sort((a, b) => b.score - a.score).forEach(face => {
    if (!unique.some(other => Math.hypot(face.x - other.x, face.y - other.y) < Math.max(face.w, other.w) * 0.4)) unique.push(face);
  });
  return unique;
}

export async function analyzeTrack(clip, onProgress, isCancelled) {
  let vis = null, remote = null;
  try { remote = await trackingWorker(); await remote.call('reset'); }
  catch (error) {
    console.warn('Background auto-focus unavailable; using local fallback:', error.message);
    try { vis = await loadVision(); } catch (e) { console.warn('auto-focus: using motion only —', e.message); }
  }
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true; v.crossOrigin = 'anonymous';
  v.src = clip.previewUrl || clip.url;
  document.getElementById('pool').appendChild(v);
  try {
    if (v.readyState < 2) await waitFor(v, 'loadeddata', 20000);
    const dur = clip.duration || v.duration;
    if (!Number.isFinite(dur) || dur <= 0 || !v.videoWidth) throw new Error('Video is not ready for tracking');
    const n = Math.max(2, Math.min(600, Math.ceil(dur * 4)));
    const zoomMemo = {}; // where a small face was found (see detectFaces)
    const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    const W = Math.max(2, Math.round(v.videoWidth * scale)), H = Math.max(2, Math.round(v.videoHeight * scale));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const mc = document.createElement('canvas'); mc.width = 64; mc.height = 36;
    const mg = mc.getContext('2d', { willReadFrequently: true });
    const raw = new Array(n).fill(null);
    let prevPix = null, prev = null;
    const gallery = faceGallery();

    // Run both detectors: a face must not prevent body detection.
    const sample = async (i, t) => {
      if (remote) {
        const bitmap = await createImageBitmap(v, { resizeWidth: W, resizeHeight: H });
        raw[i] = await remote.call('sample', { bitmap, t }, [bitmap]);
        gallery.add(v, raw[i].faces, t, raw[i].cut);
        if (onProgress && i % 4 === 0) onProgress(i / n);
        return;
      }
      g.drawImage(v, 0, 0, W, H);
      let pick = null, localFaces = [], seen = [];
      if (vis) {
        try { seen = detectFaces(vis.face, cv, [], null, zoomMemo); } catch {}
        pick = selectSubject(seen, [], prev);
      }
      // motion centroid (where things are moving)
      mg.drawImage(v, 0, 0, 64, 36);
      const px = mg.getImageData(0, 0, 64, 36).data;
      let mot = null;
      if (prevPix) {
        let sx = 0, sy = 0, sw = 0, tot = 0;
        for (let k = 0, j = 0; k < px.length; k += 4, j++) {
          const d = Math.abs(px[k] - prevPix[k]) + Math.abs(px[k + 1] - prevPix[k + 1]) + Math.abs(px[k + 2] - prevPix[k + 2]);
          tot += d;
          if (d > 45) { sx += (j % 64) * d; sy += Math.floor(j / 64) * d; sw += d; }
        }
        if (sw > 0) mot = { x: (sx / sw + 0.5) / 64, y: (sy / sw + 0.5) / 36, amount: tot / (64 * 36 * 765) };
      }
      const cut = frameChange(prevPix, px, 64, 36).cut;
      prevPix = px;
      let group = null, found = null;
      if (vis) {
        const faces = seen, people = [];
        if (cut) { prev = null; pick = selectSubject(faces, people, null); }
        group = subjectGroup(faces, people);
        found = personBoxes(faces, people);
        localFaces = faces;
      }
      prev = pick || (cut ? null : prev);
      raw[i] = { t, pick, mot, cut, group, boxes: found || [], faces: localFaces };
      gallery.add(v, localFaces, t, cut);
      if (onProgress && i % 4 === 0) onProgress(i / n);
    };

    // Seek while paused: real-time playback used to skip samples under detector load,
    // then incorrectly interpolate those holes as if every sample had been captured.
    for (let i = 0; i < n; i++) {
      if (isCancelled && isCancelled()) return null;
      const t = Math.min(Math.max(0, dur - 0.04), ((i + 0.5) / n) * dur);
      if (Math.abs(v.currentTime - t) > 0.001) {
        const ready = waitFor(v, 'seeked', 3000); v.currentTime = t; await ready;
        if (v.seeking || v.readyState < 2) continue;
      }
      await sample(i, v.currentTime);
    }
    onProgress?.(1);
    return { ...buildTrack(raw, dur), background: !!remote, people: await gallery.people(), peopleV: PEOPLE_V };
  } finally {
    v.removeAttribute('src'); v.load(); v.remove();
  }
}

// ---------------- the faces in a clip, as small pictures ----------------
// Every face big enough to see is followed from one sample to the next inside a shot (a "tracklet": surely the
// same person). Each tracklet gets a face fingerprint from a face recognition model (face-api, a few crops per
// tracklet), and tracklets are grouped into people: the most alike first, never two that are on screen at the
// same time (two faces in one frame are two people). Without the model, colors and light / dark pattern are used.
let faceApiP = null, faceApiDead = false;
function faceApi() {
  if (faceApiDead) return Promise.resolve(null);
  if (!faceApiP) faceApiP = (async () => {
    const m = await import('./vendor/faceapi/face-api.esm.js');
    try { await m.tf.setBackend('webgl'); await m.tf.ready(); } catch { await m.tf.setBackend('cpu'); await m.tf.ready(); }
    await m.nets.faceRecognitionNet.loadFromUri(new URL('./vendor/faceapi/model', import.meta.url).href);
    return m;
  })().catch((e) => { console.warn('face recognition unavailable', e); faceApiDead = true; return null; });
  return faceApiP;
}
export function faceGallery() {
  const S = 64, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const E = 112; // crop size for the recognition model
  const tracks = [];
  let last = [], samples = 0;
  const describe = (d) => {
    const hist = new Float32Array(12), grid = new Float32Array(64);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const k = (y * S + x) * 4, r = d[k] / 255, gg = d[k + 1] / 255, b = d[k + 2] / 255;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), c = mx - mn, l = (mx + mn) / 2;
      let h = 0;
      if (c > 1e-3) h = mx === r ? ((gg - b) / c + 6) % 6 : mx === gg ? (b - r) / c + 2 : (r - gg) / c + 4;
      const sat = c / (1 - Math.abs(2 * l - 1) + 1e-3);
      hist[Math.min(5, Math.floor(h)) * 2 + (sat > 0.35 ? 1 : 0)] += 0.2 + c;
      grid[Math.floor(y / 8) * 8 + Math.floor(x / 8)] += l;
    }
    const hs = hist.reduce((a, v) => a + v, 0) || 1; for (let i = 0; i < 12; i++) hist[i] /= hs;
    const m = grid.reduce((a, v) => a + v, 0) / 64; let n = 0;
    for (let i = 0; i < 64; i++) { grid[i] -= m; n += grid[i] * grid[i]; }
    n = Math.sqrt(n) || 1; for (let i = 0; i < 64; i++) grid[i] /= n;
    return { hist, grid };
  };
  const ddist = (a, b) => {
    let h = 0, dot = 0;
    for (let i = 0; i < 12; i++) h += Math.abs(a.hist[i] - b.hist[i]);
    for (let i = 0; i < 64; i++) dot += a.grid[i] * b.grid[i];
    return 0.6 * h / 2 + 0.4 * (1 - dot) / 2;
  };
  const edist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };
  return {
    add(video, faces, t, cut) {
      const k = samples++;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (cut) last = [];
      if (!vw || !faces?.length) { last = []; return; }
      const now = [];
      for (const f of faces) {
        if ((f.score ?? 1) < 0.6 || f.h < 0.03) continue;
        // a square around the face, a little bigger than it (hair, chin)
        const side = Math.max(f.w * vw, f.h * vh) * 1.5, sx = f.x * vw - side / 2, sy = f.y * vh - side / 2;
        try { g.clearRect(0, 0, S, S); g.drawImage(video, sx, sy, side, side, 0, 0, S, S); } catch { continue; }
        const desc = describe(g.getImageData(0, 0, S, S).data);
        if (globalThis.__czFaceDump) globalThis.__czFaceDump.push({ k, t, cut: !!cut, x: f.x, y: f.y, w: f.w, h: f.h, score: f.score ?? 1, big: Array.from(g.getImageData(0, 0, S, S).data) });
        // the same face as a moment ago (same shot, about the same place)
        let tr = last.find((p) => !now.some((q) => q.tr === p.tr) && Math.hypot(p.x - f.x, p.y - f.y) < Math.max(p.w, f.w) * 0.7)?.tr;
        if (!tr) { tr = { n: 0, ks: new Set(), seen: [], q: 0, thumb: '', dsum: null, crops: [], weak: null, wq: 0 }; tracks.push(tr); }
        tr.n++; tr.ks.add(k);
        tr.seen.push({ t: Math.round(t * 100) / 100, x: f.x, y: f.y, w: f.w, h: f.h });
        if (!tr.dsum) tr.dsum = { hist: Float32Array.from(desc.hist), grid: Float32Array.from(desc.grid) };
        else { for (let i = 0; i < 12; i++) tr.dsum.hist[i] += desc.hist[i]; for (let i = 0; i < 64; i++) tr.dsum.grid[i] += desc.grid[i]; }
        // a few clear looks at this face for the recognition model (a sure, front-on detection); for a tracklet with
        // none (a turned head, the back of a head) its best look, used only to join it to someone found clearly
        const sure = (f.score ?? 1) >= 0.85;
        if (sure ? tr.crops.length < 4 && (!tr.crops.length || tr.n % 5 === 0) : !tr.crops.length && (f.score ?? 1) > tr.wq) {
          const c = document.createElement('canvas'); c.width = E; c.height = E;
          try { c.getContext('2d').drawImage(video, sx, sy, side, side, 0, 0, E, E); if (sure) tr.crops.push(c); else { tr.weak = c; tr.wq = f.score ?? 1; } } catch {}
        }
        // the clearest, biggest look at this face becomes its picture
        const q = (f.score ?? 1) * f.h;
        if (q > tr.q * 1.15) { tr.q = q; tr.thumb = cv.toDataURL('image/jpeg', 0.82); }
        now.push({ x: f.x, y: f.y, w: f.w, tr });
      }
      last = now;
    },
    // every person of the clip, most seen first (only a face caught once or twice is left out)
    async people() {
      const T = tracks.filter((tr) => tr.thumb);
      if (!T.length) return [];
      // face fingerprints, a few crops at a time
      let useE = false;
      const api = await faceApi();
      if (api) {
        try {
          const all = [];
          T.forEach((tr, i) => (tr.crops.length ? tr.crops : tr.weak ? [tr.weak] : []).forEach((c) => all.push([i, c])));
          const sums = T.map(() => null), cnt = T.map(() => 0);
          for (let s0 = 0; s0 < all.length; s0 += 16) {
            const part = all.slice(s0, s0 + 16);
            let ds = await api.nets.faceRecognitionNet.computeFaceDescriptor(part.map((x) => x[1]));
            if (!Array.isArray(ds)) ds = [ds];
            ds.forEach((d, j) => { const i = part[j][0]; if (!sums[i]) sums[i] = new Float32Array(d.length); for (let q = 0; q < d.length; q++) sums[i][q] += d[q]; cnt[i]++; });
            await new Promise((r) => setTimeout(r, 0)); // let the app breathe between batches
          }
          T.forEach((tr, i) => { tr.emb = sums[i] ? sums[i].map((v) => v / cnt[i]) : null; });
          useE = T.every((tr) => tr.emb);
        } catch (e) { console.warn('face fingerprints failed', e); }
      }
      if (!useE) T.forEach((tr) => {
        const h = tr.dsum.hist.map((v) => v / tr.n), gr = tr.dsum.grid.slice();
        let n = 0; for (const v of gr) n += v * v; n = Math.sqrt(n) || 1;
        tr.d = { hist: h, grid: gr.map((v) => v / n) };
      });
      T.forEach((tr) => { tr.good = !useE || tr.crops.length > 0; tr.crops = []; tr.weak = null; }); // done with the crops
      // average-linkage grouping, never joining two that share a moment
      const N = T.length, TH = useE ? 0.47 : 0.2;
      const D = Array.from({ length: N }, () => new Float32Array(N));
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) D[i][j] = D[j][i] = useE ? edist(T[i].emb, T[j].emb) : ddist(T[i].d, T[j].d);
      if (globalThis.__czFaceEmb) T.forEach((tr) => globalThis.__czFaceEmb.push({ e: tr.emb && Array.from(tr.emb), ks: [...tr.ks], n: tr.n, good: tr.good, thumb: tr.thumb }));
      // only clear faces start or join groups; the unclear ones are joined to a group afterwards
      const cl = T.map((tr, i) => ({ alive: tr.good, size: 1, trs: [tr], ks: new Set(tr.ks), i }));
      const shares = (a, b) => { const [x, y] = a.ks.size < b.ks.size ? [a.ks, b.ks] : [b.ks, a.ks]; for (const v of x) if (y.has(v)) return true; return false; };
      for (;;) {
        let best = null;
        for (let i = 0; i < N; i++) {
          if (!cl[i].alive) continue;
          for (let j = i + 1; j < N; j++) {
            if (!cl[j].alive || D[i][j] >= TH || (best && D[i][j] >= best[0])) continue;
            if (shares(cl[i], cl[j])) continue;
            best = [D[i][j], i, j];
          }
        }
        if (!best) break;
        const [, i, j] = best, a = cl[i], b = cl[j];
        for (let k = 0; k < N; k++) if (k !== i && k !== j && cl[k].alive) D[i][k] = D[k][i] = (a.size * D[i][k] + b.size * D[j][k]) / (a.size + b.size);
        a.size += b.size; a.trs.push(...b.trs); for (const v of b.ks) a.ks.add(v); b.alive = false;
      }
      // a turned head / back of a head: joins the closest group it can belong to, or is left out
      T.forEach((tr, i) => {
        if (tr.good) return;
        let best = null;
        for (let j = 0; j < N; j++) {
          const c = cl[j]; if (!c.alive || shares(c, { ks: tr.ks })) continue;
          let d = 0; for (const o of c.trs) d += edist(tr.emb, o.emb); d /= c.trs.length;
          if (d < 0.42 && (!best || d < best[0])) best = [d, c];
        }
        if (best) { best[1].trs.push(tr); for (const v of tr.ks) best[1].ks.add(v); }
      });
      // last: a small group that looks like a bigger one (a face seen in other light) joins it
      if (useE) for (;;) {
        const live = cl.filter((c) => c.alive), cnt = (c) => c.trs.reduce((s, tr) => s + tr.n, 0);
        let best = null;
        for (let x = 0; x < live.length; x++) for (let y = x + 1; y < live.length; y++) {
          const a = live[x], b = live[y];
          if (Math.min(cnt(a), cnt(b)) > 20 || shares(a, b)) continue;
          let d = 0; for (const p of a.trs) for (const q of b.trs) d += edist(p.emb, q.emb); d /= a.trs.length * b.trs.length;
          if (d < 0.5 && (!best || d < best[0])) best = [d, a, b];
        }
        if (!best) break;
        const [, a, b2] = best; a.trs.push(...b2.trs); for (const v of b2.ks) a.ks.add(v); b2.alive = false;
      }
      const min = Math.max(2, Math.round(samples * 0.004));
      return cl.filter((c) => c.alive).map((c) => {
        const n = c.trs.reduce((s, tr) => s + tr.n, 0), top = c.trs.reduce((a, tr) => (tr.q > a.q ? tr : a));
        return { n, thumb: top.thumb, seen: c.trs.flatMap((tr) => tr.seen).sort((x, y) => x.t - y.t) };
      }).filter((p) => p.n >= min).sort((a, b) => b.n - a.n).slice(0, 40)
        .map((p, k) => ({ id: 'p' + (k + 1), name: `Person ${k + 1}`, thumb: p.thumb, n: p.n, share: p.n / Math.max(1, samples), seen: p.seen }));
    },
  };
}
// the version of the face grouping: clips grouped by an older one are scanned again when their faces are shown
export const PEOPLE_V = 2;

// Fill detector gaps from anchors in the SAME shot, never the middle of the frame.
export function shotPicks(samples) {
  const picks = samples.map(r => r.pick || null);
  for (let start = 0; start < samples.length;) {
    let end = start + 1;
    while (end < samples.length && !samples[end].cut) end++;
    const anchors = [];
    for (let i = start; i < end; i++) if (picks[i]) anchors.push(i);
    if (anchors.length) {
      let cursor = 0;
      for (let i = start; i < end; i++) {
        while (cursor + 1 < anchors.length && anchors[cursor + 1] <= i) cursor++;
        if (picks[i]) continue;
        const a = anchors[cursor], b = anchors[Math.min(cursor + 1, anchors.length - 1)];
        if (i < a || a === b) picks[i] = picks[a];
        else {
          const u = clamp((samples[i].t - samples[a].t) / Math.max(0.001, samples[b].t - samples[a].t), 0, 1);
          picks[i] = { ...picks[a], x: picks[a].x + (picks[b].x - picks[a].x) * u,
            y: picks[a].y + (picks[b].y - picks[a].y) * u };
        }
      }
    }
    start = end;
  }
  return picks;
}

// Keep actual source timestamps and reset at hard cuts.
export function buildTrack(raw, dur) {
  const samples = raw.filter(Boolean).sort((a, b) => a.t - b.t);
  const n = samples.length;
  if (!n) return { n: 1, dur, times: [0], xs: [0.5], ys: [0.5], zs: [1], ws: [0], hs: [0], cuts: [false], kind: 'motion', found: 0 };
  const times = samples.map(r => r.t), cuts = samples.map(r => !!r.cut);
  const xs = [], ys = [], zs = [], ws = [], hs = [];
  const found = samples.filter(r => r.pick).length;
  const bodies = samples.filter(r => r.pick?.kind === 'body').length;
  const picks = shotPicks(samples);
  let last = null;
  samples.forEach((r, i) => {
    if (r.cut) last = null;
    const pick = picks[i];
    if (pick) {
      // A small dead band stops jitter without lagging behind a walking person.
      const a = !last || r.cut ? 1 : 1 - Math.exp(-(r.t - times[Math.max(0, i - 1)]) / 0.16);
      const x = last && Math.abs(pick.x - last.x) < 0.008 ? last.x : pick.x;
      const y = last && Math.abs(pick.y - last.y) < 0.008 ? last.y : pick.y;
      last = { ...pick, x: last ? last.x + (x - last.x) * a : x, y: last ? last.y + (y - last.y) * a : y };
      xs.push(clamp(last.x, 0, 1)); ys.push(clamp(last.y, 0, 1));
      ws.push(clamp(pick.w || 0, 0, 1)); hs.push(clamp(pick.h || pick.size || 0, 0, 1));
    } else {
      // No person here: stop chasing background motion or a subject from another scene.
      last = null; xs.push(0.5); ys.push(0.5); ws.push(0); hs.push(0);
    }
    zs.push(1); // tracking must never zoom in and chop the person's body off
  });
  const groups = samples.map(r => r.group || null);
  // every person seen in each sample, so the shot editor can follow the one you click
  const boxes = samples.some(r => r.boxes) ? samples.map(r => r.boxes || []) : null;
  return { n, dur, times, xs, ys, zs, ws, hs, cuts, groups, boxes, kind: bodies ? 'body' : found ? 'face' : 'motion', found };
}

// ---------------- the "invisible camera operator" ----------------
// For a given crop window (fraction of the frame that's visible), find a camera path per shot that
// keeps everyone in frame, moves as little as possible, and eases smoothly when it must move.
// Allowed positions form a tube [lo, hi] per sample; we relax a smooth curve inside that tube.
// Like a real operator: (1) ignore detector flicker (short median), (2) follow the person as they move,
// ignoring only tiny jitter, (3) glide (no corners, no sudden whips) when switching to someone else,
// (4) and never let the main person leave the frame.
// dead: small, so it follows people as they move · keep: loose safety net (people must stay in frame) ·
// sigma: smoothing in seconds (the path is solved for the whole clip ahead of time, so smoothing adds no lag) ·
// speed: max pan speed (frame widths / s), which turns a switch to another person into a glide
export const CAM = { median: 0.35, dead: 0.06, sigma: 0.28, keep: 0.8, speed: 0.5 };
export function medianOf(arr, ts, k, r) {
  const v = [];
  for (let j = k; j >= 0 && ts[k] - ts[j] <= r; j--) if (!Number.isNaN(arr[j])) v.push(arr[j]);
  for (let j = k + 1; j < arr.length && ts[j] - ts[k] <= r; j++) if (!Number.isNaN(arr[j])) v.push(arr[j]);
  if (!v.length) return arr[k];
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}
export function gaussSmooth(p, ts, sigma) {
  const n = p.length, out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let sw = 0, sv = 0;
    for (let j = k; j >= 0 && ts[k] - ts[j] <= sigma * 2.5; j--) { const w = Math.exp(-(((ts[k] - ts[j]) / sigma) ** 2) / 2); sw += w; sv += w * p[j]; }
    for (let j = k + 1; j < n && ts[j] - ts[k] <= sigma * 2.5; j++) { const w = Math.exp(-(((ts[j] - ts[k]) / sigma) ** 2) / 2); sw += w; sv += w * p[j]; }
    out[k] = sv / sw;
  }
  return out;
}
function solveAxis(track, s, e, win, ax, out) {
  const n = e - s;
  if (win >= 0.995) { for (let i = 0; i < n; i++) out[s + i] = 0.5; return; }
  const half = win / 2, minC = half, maxC = 1 - half;
  const times = track.times || Array.from({ length: track.n }, (_, i) => (i + 0.5) / track.n * track.dur);
  const ts = Array.from({ length: n }, (_, k) => times[s + k]);
  // per sample: where the camera would like to be (tgt) and the range that keeps the subject in frame (lo..hi)
  const tgt = new Float32Array(n).fill(NaN), lo = new Float32Array(n).fill(NaN), hi = new Float32Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    const i = s + k, g = track.groups?.[i];
    if (g) {
      const g0 = ax === 'x' ? g.x0 : g.y0, g1 = ax === 'x' ? g.x1 : g.y1;
      const m = Math.max(0, Math.min(ax === 'x' ? 0.03 : 0.05, (win - (g1 - g0)) / 2)); // tighter margin when they only just fit
      if (g1 - g0 <= win) {                       // everyone fits: anywhere that keeps them all in
        lo[k] = g1 + m - half; hi[k] = g0 - m + half;
        tgt[k] = ax === 'x' ? (g0 + g1) / 2 * 0.5 + g.cx * 0.5 : g.top - 0.04 + half * 0.92;
      } else {                                            // too wide: frame the main person (not the empty middle of the group)
        const c = ax === 'x' ? ((track.hs?.[i] || 0) > 0 ? track.xs[i] : g.cx) : g.top - 0.04 + half;
        tgt[k] = c; lo[k] = c - half * CAM.keep; hi[k] = c + half * CAM.keep;
      }
    } else if ((track.hs?.[i] || 0) > 0) {
      const c = ax === 'x' ? track.xs[i] : track.ys[i];
      tgt[k] = c; lo[k] = c - half * CAM.keep; hi[k] = c + half * CAM.keep;
    }
  }
  // gaps (missed detections) hold the nearest known framing from the same shot; nobody at all = locked center
  for (const arr of [tgt, lo, hi]) {
    let last = -1;
    for (let k = 0; k < n; k++) if (!Number.isNaN(arr[k])) last = k; else if (last >= 0) arr[k] = arr[last];
    last = -1;
    for (let k = n - 1; k >= 0; k--) if (!Number.isNaN(arr[k])) last = k; else if (last >= 0) arr[k] = arr[last];
  }
  if (Number.isNaN(tgt[0])) { for (let k = 0; k < n; k++) out[s + k] = clamp(0.5, minC, maxC); return; }
  // 1) drop flicker: short detector jumps and people blinking in/out of the group (at least 2 samples each side)
  const dt = n > 1 ? (ts[n - 1] - ts[0]) / (n - 1) : 0.25, mr = Math.max(CAM.median, dt * 2.2);
  const T = new Float32Array(n), L0 = new Float32Array(n), H0 = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    L0[k] = clamp(medianOf(lo, ts, k, mr), minC, maxC); H0[k] = clamp(medianOf(hi, ts, k, mr), minC, maxC);
    if (L0[k] > H0[k]) L0[k] = H0[k] = (L0[k] + H0[k]) / 2;
    T[k] = medianOf(tgt, ts, k, mr);
  }
  // the camera may move at most CAM.speed of the frame per second: when the subject jumps (a new main person),
  // start gliding a little early and arrive on time, instead of snapping across
  const L = new Float32Array(n), H = new Float32Array(n), reach = (maxC - minC) / CAM.speed + dt;
  for (let k = 0; k < n; k++) {
    let l = L0[k], h = H0[k];
    for (let j = k - 1; j >= 0 && ts[k] - ts[j] <= reach; j--) { const d = CAM.speed * (ts[k] - ts[j]); l = Math.max(l, L0[j] - d); h = Math.min(h, H0[j] + d); }
    for (let j = k + 1; j < n && ts[j] - ts[k] <= reach; j++) { const d = CAM.speed * (ts[j] - ts[k]); l = Math.max(l, L0[j] - d); h = Math.min(h, H0[j] + d); }
    if (l > h) l = h = (l + h) / 2;
    L[k] = l; H[k] = h; T[k] = clamp(T[k], l, h);
  }
  // 2) dead zone: stay put until the subject drifts well off-center (run both ways so it doesn't lag)
  const dz = half * CAM.dead;
  const lazy = (from, to, step) => {
    const p = new Float32Array(n); let cam = T[from];
    for (let k = from; k !== to; k += step) { const d = T[k] - cam; if (Math.abs(d) > dz) cam = T[k] - Math.sign(d) * dz; p[k] = cam; }
    return p;
  };
  const f = lazy(0, n, 1), b = lazy(n - 1, -1, -1);
  let p = new Float32Array(n);
  for (let k = 0; k < n; k++) p[k] = clamp((f[k] + b[k]) / 2, L[k], H[k]);
  // 3) glide: smooth in time, keeping the subject in frame; repeat so the constraint and the smoothing agree
  for (let it = 0; it < 8; it++) {
    p = gaussSmooth(p, ts, it < 5 ? CAM.sigma : CAM.sigma * 0.6);
    for (let k = 0; k < n; k++) p[k] = clamp(p[k], L[k], H[k]);
  }
  // last pass: round off the corners the clamp leaves, allowing a hair (1.5% of the window) of slack
  p = gaussSmooth(p, ts, CAM.sigma * 0.5);
  for (let k = 0; k < n; k++) p[k] = clamp(p[k], Math.max(minC, L[k] - win * 0.015), Math.min(maxC, H[k] + win * 0.015));
  for (let k = 0; k < n; k++) out[s + k] = p[k];
}
export function cameraPath(track, winW, winH) {
  if (!track._paths) Object.defineProperty(track, '_paths', { value: new Map(), enumerable: false });
  const key = winW.toFixed(3) + '|' + winH.toFixed(3);
  let path = track._paths.get(key);
  if (path) return path;
  const n = track.n, xs = new Float32Array(n), ys = new Float32Array(n);
  for (let s = 0; s < n;) {
    let e = s + 1;
    while (e < n && !track.cuts?.[e]) e++;
    solveAxis(track, s, e, winW, 'x', xs); solveAxis(track, s, e, winH, 'y', ys);
    s = e;
  }
  path = { xs, ys };
  track._paths.set(key, path);
  return path;
}
// where the camera looks at source time t, for a crop window of winW × winH (fractions of the frame)
export function cameraAt(track, t, winW, winH) {
  if (!track?.n) return { x: 0.5, y: 0.5 };
  const path = cameraPath(track, winW, winH);
  const times = track.times || Array.from({ length: track.n }, (_, i) => (i + 0.5) / track.n * track.dur);
  let lo = 0, hi = track.n - 1;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (times[m] <= t) lo = m; else hi = m - 1; }
  const i = lo, j = Math.min(track.n - 1, i + 1);
  const a = track.cuts?.[j] ? 0 : clamp((t - times[i]) / Math.max(0.001, times[j] - times[i]), 0, 1);
  // Catmull-Rom through the samples (same shot only): continuous speed, so pans never stop-start at each sample
  const h = Math.min(track.n - 1, j + 1), g = Math.max(0, i - 1);
  const prev = track.cuts?.[i] ? i : g, next = track.cuts?.[h] ? j : h;
  const cr = (v) => {
    const p0 = v[prev], p1 = v[i], p2 = v[j], p3 = v[next];
    return 0.5 * ((2 * p1) + (-p0 + p2) * a + (2 * p0 - 5 * p1 + 4 * p2 - p3) * a * a + (-p0 + 3 * p1 - 3 * p2 + p3) * a * a * a);
  };
  return { x: clamp(cr(path.xs), 0, 1), y: clamp(cr(path.ys), 0, 1) };
}

// smooth curve through per-sample values at source time t (Catmull-Rom, never across a cut)
function curveAt(track, v, t) {
  const times = track.times || Array.from({ length: track.n }, (_, i) => (i + 0.5) / track.n * track.dur);
  let lo = 0, hi = track.n - 1;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (times[m] <= t) lo = m; else hi = m - 1; }
  const i = lo, j = Math.min(track.n - 1, i + 1);
  const a = track.cuts?.[j] ? 0 : clamp((t - times[i]) / Math.max(0.001, times[j] - times[i]), 0, 1);
  const h = Math.min(track.n - 1, j + 1), g = Math.max(0, i - 1);
  const p0 = v[track.cuts?.[i] ? i : g], p1 = v[i], p2 = v[j], p3 = v[track.cuts?.[h] ? j : h];
  return 0.5 * ((2 * p1) + (-p0 + p2) * a + (2 * p0 - 5 * p1 + 4 * p2 - p3) * a * a + (-p0 + 3 * p1 - 3 * p2 + p3) * a * a * a);
}
// the main person's position without detector jitter (for "Main person" / "Face close-up" framing)
export function steadyFocusAt(track, t) {
  if (!track?.n) return { x: 0.5, y: 0.5, z: 1, w: 0, h: 0 };
  if (!track._steady) {
    const n = track.n, times = track.times || Array.from({ length: n }, (_, i) => (i + 0.5) / n * track.dur);
    const out = { xs: Float32Array.from(track.xs), ys: Float32Array.from(track.ys), hs: Float32Array.from(track.hs || new Float32Array(n)) };
    for (let s = 0; s < n;) {
      let e = s + 1;
      while (e < n && !track.cuts?.[e]) e++;
      const ts = times.slice(s, e), dt = e - s > 1 ? (ts.at(-1) - ts[0]) / (e - s - 1) : 0.25, r = Math.max(CAM.median, dt * 1.6);
      for (const arr of [out.xs, out.ys, out.hs]) {
        const part = arr.slice(s, e), med = new Float32Array(e - s);
        for (let k = 0; k < e - s; k++) med[k] = medianOf(part, ts, k, r);
        const sm = gaussSmooth(med, ts, CAM.sigma);
        for (let k = 0; k < e - s; k++) arr[s + k] = sm[k];
      }
      s = e;
    }
    Object.defineProperty(track, '_steady', { value: out, enumerable: false });
  }
  const S = track._steady;
  return { x: clamp(curveAt(track, S.xs, t), 0, 1), y: clamp(curveAt(track, S.ys, t), 0, 1), z: 1, w: 0, h: Math.max(0, curveAt(track, S.hs, t)) };
}
export function focusAt(track, t) {
  if (!track?.n) return { x: 0.5, y: 0.5, z: 1, w: 0, h: 0 };
  const times = track.times || Array.from({ length: track.n }, (_, i) => (i + 0.5) / track.n * track.dur);
  let lo = 0, hi = track.n - 1;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (times[m] <= t) lo = m; else hi = m - 1; }
  const i = lo, j = Math.min(track.n - 1, i + 1);
  // Never pan through unrelated people across a shot change.
  const a = track.cuts?.[j] ? 0 : clamp((t - times[i]) / Math.max(0.001, times[j] - times[i]), 0, 1);
  const lerp = (values, fallback) => values ? values[i] + (values[j] - values[i]) * a : fallback;
  return { x: lerp(track.xs, 0.5), y: lerp(track.ys, 0.5), z: lerp(track.zs, 1), w: lerp(track.ws, 0), h: lerp(track.hs, 0) };
}
