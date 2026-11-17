// Silent reactions: MediaPipe Face Landmarker (Google, Apache 2.0, runs on this PC) reads the face in a clip (the
// streamer's webcam when there is one) every half second: mouth dropping open, a big smile, eyebrows shooting up,
// eyes going wide. A face that suddenly reacts is a moment, even when nobody says a word.
let lmP = null;
export function loadFaceReader() {
  if (!lmP) {
    lmP = (async () => {
      const r = await fetch('/api/facemodel', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'could not download the face reader');
      const mp = await import('/vision/vision_bundle.mjs');
      const files = await mp.FilesetResolver.forVisionTasks('/vision/wasm');
      return mp.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: '/vision/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'IMAGE', numFaces: 2, outputFaceBlendshapes: true, minFaceDetectionConfidence: 0.4 });
    })();
    lmP.catch(() => { lmP = null; });
  }
  return lmP;
}
const once = (el, ev, ms) => new Promise((ok, no) => { const t = setTimeout(() => no(new Error('slow')), ms); el.addEventListener(ev, () => { clearTimeout(t); ok(); }, { once: true }); el.addEventListener('error', () => { clearTimeout(t); no(new Error('video')); }, { once: true }); });
// how much a face reacts in each half second (0..1, above its own calm look)
export async function faceReactions(clip, onPct = () => {}) {
  const lm = await loadFaceReader();
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = clip.previewUrl || clip.url;
  await once(v, 'loadeddata', 15000);
  const dur = Math.min(clip.duration || v.duration || 0, 1800); // the first half hour of a long video
  const step = dur > 600 ? 1 : 0.5, n = Math.max(1, Math.ceil(dur / step));
  // the webcam box when the clip has one (the streamer's face fills more of the picture there)
  // else around the face that's on screen most (a small face in a big picture is too small to read)
  const W = 512, vw = v.videoWidth || 16, vh = v.videoHeight || 9;
  let box = clip.cam?.box || null;
  const main = (clip.track?.people || []).slice().sort((a, b) => (b.seen?.length || 0) - (a.seen?.length || 0))[0];
  if (!box && main?.seen?.length) {
    const med = (k) => { const a = main.seen.map((q) => q[k]).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
    const fx = med('x'), fy = med('y'), fh = med('h');
    if (fh < 0.3) {
      const side = Math.min(vh, Math.max(fh * vh * 3.4, 180));
      const cx = Math.max(side / 2, Math.min(vw - side / 2, fx * vw)), cy = Math.max(side / 2, Math.min(vh - side / 2, fy * vh));
      box = [(cx - side / 2) / vw, (cy - side / 2) / vh, side / vw, side / vh];
    }
  }
  const sx = box ? box[0] * vw : 0, sy = box ? box[1] * vh : 0, sw = box ? box[2] * vw : vw, sh = box ? box[3] * vh : vh;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = Math.max(16, Math.round(W * sh / sw));
  const g = cv.getContext('2d', { willReadFrequently: true });
  const raw = new Float32Array(n), seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    v.currentTime = Math.min(dur - 0.05, i * step + step / 2);
    try { await once(v, 'seeked', 5000); } catch { continue; }
    g.drawImage(v, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    let res; try { res = lm.detect(cv); } catch { continue; }
    let top = 0;
    for (const f of res.faceBlendshapes || []) {
      const s = Object.fromEntries((f.categories || []).map((c) => [c.categoryName, c.score]));
      const smile = ((s.mouthSmileLeft || 0) + (s.mouthSmileRight || 0)) / 2, wide = ((s.eyeWideLeft || 0) + (s.eyeWideRight || 0)) / 2;
      const brows = Math.max(s.browInnerUp || 0, ((s.browOuterUpLeft || 0) + (s.browOuterUpRight || 0)) / 2);
      top = Math.max(top, 1.0 * (s.jawOpen || 0) + 0.7 * smile + 0.6 * brows + 0.7 * wide);
    }
    if (res.faceBlendshapes?.length) { raw[i] = top; seen[i] = 1; }
    if (i % 10 === 0) { onPct(Math.round(i / n * 100)); await new Promise((r) => setTimeout(r, 0)); }
  }
  v.removeAttribute('src'); v.load();
  // relative to how this face usually looks (someone always smiling isn't always reacting)
  const vals = Array.from(raw).filter((x, i) => seen[i]).sort((a, b) => a - b);
  if (vals.length < 4) return null;
  const calm = vals[Math.floor(vals.length * 0.5)], hi = vals[Math.floor(vals.length * 0.97)] || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = seen[i] ? Math.max(0, Math.min(1, (raw[i] - calm) / Math.max(0.15, hi - calm))) : 0;
  return { step, v: out, seen: vals.length / n };
}
export function faceAt(f, t) { return f ? f.v[Math.floor(t / f.step)] || 0 : 0; }
