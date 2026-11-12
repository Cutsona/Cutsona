// Detector inference stays off the UI thread while the previews play.
const api = import('./track.js');
const scene = import('./scene.js');
let vision, previous = null, previousPixels = null;
const canvas = new OffscreenCanvas(1, 1), motion = new OffscreenCanvas(64, 36);
const g = canvas.getContext('2d'), mg = motion.getContext('2d', { willReadFrequently: true });
const tile = new OffscreenCanvas(1, 1);
self.onmessage = async ({ data }) => {
  const { id, type, bitmap, t } = data;
  try {
    const { loadVision, boxes, selectSubject, detectFaces, subjectGroup, personBoxes } = await api;
    const { frameChange } = await scene;
    if (type === 'reset') {
      vision ||= await loadVision(); previous = null; previousPixels = null;
      self.postMessage({ id, result: true }); return;
    }
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    g.drawImage(bitmap, 0, 0); mg.drawImage(bitmap, 0, 0, 64, 36); bitmap.close();
    const pixels = mg.getImageData(0, 0, 64, 36).data;
    const { cut } = frameChange(previousPixels, pixels, 64, 36);
    previousPixels = pixels;
    const people = vision.person ? boxes(vision.person.detect(canvas), canvas.width, canvas.height) : [];
    const faces = detectFaces(vision.face, canvas, people, tile);
    const pick = selectSubject(faces, people, cut ? null : previous);
    previous = pick || (cut ? null : previous);
    self.postMessage({ id, result: { t, pick, cut, group: subjectGroup(faces, people), boxes: personBoxes(faces, people) } });
  } catch (error) { bitmap?.close(); self.postMessage({ id, error: error.message }); }
};
