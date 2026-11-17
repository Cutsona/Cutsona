// Turn the existing Quick takes into ordinary editable cuts over the original local assets.
import { VIDEO_FORMATS } from './styles.js';
const CAPTIONS = { bold: 'quick_bold', yellow: 'quick_yellow', boxed: 'quick_boxed', clean: 'movie_sub' };
const FILM_FILTERS = { cine2383: 'film_cinema', fuji3510: 'film_fuji_print', animelut: 'film_anime' };

function timedCaptions(scenes, vertical) {
  return scenes.flatMap((scene) => {
    const words = (scene.cap ?? scene.text).split(/\s+/).filter(Boolean), chunks = [];
    for (let i = 0; i < words.length;) {
      let n = Math.min(vertical ? 3 : 5, words.length - i);
      if (words.length - i - n === 1) n++;
      chunks.push(words.slice(i, i + n).join(' ')); i += n;
    }
    const total = chunks.reduce((sum, text) => sum + text.length + 2, 0);
    let at = scene.start;
    return chunks.map((text) => { const start = at; at += scene.dur * (text.length + 2) / total; return { start, end: at, text }; });
  });
}

export function quickToEditor(project, mode, activeTake = 0) {
  const mids = [...new Set(project.takes.flatMap((take) => take.pieces.map((piece) => piece.mid)))];
  const format = VIDEO_FORMATS.find((ratio) => {
    const [w, h] = ratio.split(':').map(Number);
    return Math.abs(w / h - project.W / project.H) < 0.003;
  }) || project.W + ':' + project.H;
  const clips = mids.map((mid) => {
    const m = project.media[mid];
    return { id: `q${project.id}_${mid}`, name: m.key || 'Scene asset', url: m.url, src: m.ref,
      still: m.kind === 'img', quickAsset: true, thumb: m.thumb, origin: m.credit ? { ...m.credit, kind: 'clip' } : { local: true, title: m.key } };
  });
  const clipIds = clips.map((c) => c.id);
  const takes = project.takes.map((take) => {
    const counts = new Map();
    for (const piece of take.pieces) counts.set(piece.scene, (counts.get(piece.scene) || 0) + 1);
    let start = 0;
    const segments = take.pieces.map((piece, i) => {
      const duration = (project.scenes[piece.scene].len + (piece.scene === 0 ? 0.6 : 0)
        + (piece.scene === project.scenes.length - 1 ? 1.6 : 0)) / counts.get(piece.scene);
      const end = start + duration, clip = mids.indexOf(piece.mid);
      const seg = { clip, start, end, srcStart: 0, srcDur: duration, profile: { type: 'const', r: 1 },
        run: i, deck: i % 2, ek: `quick-${i}`, reason: `Scene ${piece.scene + 1}`, quickMotion: piece.move,
        loop: !clips[clip].still, quickFadeIn: i === 0 ? 0.6 : take.transition === 'cut' ? 0 : 0.18,
        quickFadeOut: i === take.pieces.length - 1 ? 1.2 : take.transition === 'cut' ? 0 : 0.18 };
      start = end;
      return seg;
    });
    const fx = (take.effects || []).map((name) => name === 'grain' ? 'film' : name);
    const custom = { format, layout: 'full', speed: 'off', focus: 'off', captions: project.opts.captions ? 'on' : 'off', fx,
      captionStyle: CAPTIONS[take.capStyle] || 'quick_bold', captionFont: take.capFont === 'default' || !take.capFont ? 'arial_black' : take.capFont,
      filter: take.filter || (take.look ? FILM_FILTERS[take.look] || 'film_' + take.look : 'none'),
      text: project.opts.titleCard ? project.title : '', hookStart: 0.2, hookEnd: 3.4, hookY: 0.5 };
    const plan = { mode: 'quick', styleId: 'beat', duration: start, musicStart: 0, beats: [], segments,
      quick: { voice: project.voice, song: project.music[take.music]?.url || null, songName: project.music[take.music]?.title || '',
        gain: { low: 0.14, high: 0.42 }[project.opts.musicLevel] || 0.26, captions: timedCaptions(project.scenes, project.vertical),
        captionScale: take.capScale || 1, captionY: { top: 0.86, middle: 0.5, bottom: project.vertical ? 0.28 : 0.08 }[take.capPosition || 'bottom'],
        tint: take.look && take.filter ? FILM_FILTERS[take.look] || 'film_' + take.look : null,
        banner: take.banner ? project.title : '', logo: Number.isInteger(take.logo) ? project.media[take.logo]?.url : null, quality: take.quality } };
    return { styleId: 'beat', seed: 1, custom, sourcePlan: { clipIds, plan } };
  });
  return { settings: { mode, format, length: project.total, focus: 'off', speed: 'off', clipVol: 0 },
    mode, clips, takes, focused: Math.max(0, Math.min(activeTake, takes.length - 1)), credits: project.sources || [] };
}

// The indices in a plan are local to its original list of ready clips. Keep the exact cuts when that list changes order.
export function remapSavedPlan(snapshot, ready) {
  if (!snapshot?.plan?.segments?.length) return null;
  const ids = snapshot.clipIds || snapshot.ids?.split('|') || [];
  const current = new Map(ready.map((clip, index) => [clip.id, index]));
  const indices = ids.map((id) => current.get(id));
  const plan = structuredClone(snapshot.plan);
  for (const segment of new Set([...plan.segments, ...(plan.base?.segments || [])])) {
    const index = indices[segment.clip];
    if (index == null) return null;
    segment.clip = index;
  }
  return plan;
}
