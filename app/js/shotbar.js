// Shot editor: click a cut on the timeline to choose what the camera captures in it.
// Shows the whole source frame with the part the edit shows (drag it to aim, scroll to zoom,
// click a person to follow them). The choice belongs to that one cut of that one edit
// (stored on the cut, see reframe.js for the modes) and is used in the preview and in exports.
import { frameAt, srcOffset } from './edit.js';
import { personAt, keyAim, FRAME_MODES } from './reframe.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };

export function initShotBar({ el, player, getView, onChange, onToggle, toast, wantTrack, saveCut, cutOps = {}, wantKeys = () => false }) {
  let si = -1, picking = false;
  el.innerHTML = `
    <div class="sb-frame"><canvas></canvas><div class="sb-hint"></div></div>
    <div class="sb-side">
      <div class="sb-top">
        <button class="sb-nav sb-prev" title="Previous cut  [" aria-label="Previous cut"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="sb-title"><b></b><small></small></div>
        <button class="sb-nav sb-next" title="Next cut  ]" aria-label="Next cut"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
        <button class="small sb-close" title="Close (Esc)">Done</button>
      </div>
      <div class="sb-lbl">What the camera captures</div>
      <div class="sb-modes">${FRAME_MODES.map(([k, l, d]) => `<button data-mode="${k}" title="${esc(d)}">${l}</button>`).join('')}</div>
      <div class="sb-desc"></div>
      <div class="sb-people"></div>
      <div class="sb-row">
        <label class="sb-zoom"><span>Zoom <b></b></span><input type="range" min="1" max="3" step="0.05" value="1"></label>
        <span class="sb-only">Only this cut</span>
        <button class="small sb-reset" title="Back to the automatic camera for this cut">↺ Reset cut</button>
      </div>
      <div class="sb-move">
        <div class="sb-mv-h"><span class="sb-lbl">Camera move <em>keyframes</em></span><small class="sb-mv-info"></small></div>
        <p class="kb-note">Moves the camera inside <b>this cut only</b>. To move the whole video across every cut, use <a href="#" data-card-link>Card motion</a>.</p>
        <div class="sb-mv-row">
          <button class="small sb-kadd" title="Mark where the camera is right now (K). Then move the playhead and drag or zoom the box: that records the next keyframe">◆ Add keyframe</button>
          <button class="small sb-kdel" hidden title="Delete the keyframe at the playhead">Delete keyframe</button>
          <button class="small sb-kclear" hidden title="Remove the whole camera move from this cut">Clear move</button>
        </div>
      </div>
      <div class="sb-row sb-cutops">
        <button class="small sb-replace" title="Different footage for this cut: same spot and length in the edit. Press again for another moment">Replace cut</button>
        <button class="small sb-own" hidden title="Put back the footage the edit picked for this cut">Use its own footage</button>
        <button class="small sb-delete" title="Take this cut out: everything after it moves up and the edit gets shorter (Delete key)">Delete cut</button>
        <button class="small sb-undel" hidden title="Bring back the cuts you deleted from this edit"></button>
      </div>
      <div class="sb-note"></div>
    </div>`;
  const cv = el.querySelector('canvas'), g = cv.getContext('2d');
  const hint = el.querySelector('.sb-hint'), zoomIn = el.querySelector('.sb-zoom input');

  // ---------- the shot being edited ----------
  function cur() {
    const v = getView();
    const seg = v.plan && v.plan.segments[si];
    if (!seg) return null;
    const clip = v.clips[seg.clip];
    if (!clip || !clip.duration) return null;
    const used = Math.max(seg.srcDur || 0, srcOffset(seg, seg.end - seg.start));
    const shotA = seg.srcStart, shotB = Math.min(clip.duration, seg.srcStart + used);
    return { v, seg, clip, shotA, shotB };
  }
  function timeIn(c) { const t = player.now(); return t >= c.seg.start && t < c.seg.end ? t : c.seg.start + 0.02; }
  function srcAt(c, t) { return clamp(c.seg.srcStart + srcOffset(c.seg, t - c.seg.start), 0, c.clip.duration - 0.04); }
  const entryOf = (c) => c.seg.framing || null;

  // the visible window (full-frame coordinates) for the edit's output size at time t
  function windowAt(c, t) {
    const fr = frameAt(c.v.plan, t, c.v.ctx), U = fr.U;
    const [x, y, w, h] = U.sourceRect;
    const fo = c.seg.framing;
    const z = fo ? clamp(fo.mode === 'keys' && fo.keys?.length ? keyAim(fo.keys, srcAt(c, t)).z : Number(fo.z) || 1, 1, 4) : 1;
    if (U.fit > 0.5) return { x0: x, y0: y, x1: x + w, y1: y + h, fit: true, rect: [x, y, w, h] };
    const va = ((c.clip.w || 16) * w) / ((c.clip.h || 9) * h), oa = c.v.ctx.aspect || 9 / 16;
    const ww = (Math.min(1, oa / va) * w) / z, wh = (Math.min(1, va / oa) * h) / z;
    let cx, cy;
    if (U.focus) { cx = x + U.crop[0] * w; cy = y + U.crop[1] * h; }
    else { cx = x + ww / 2 + U.crop[0] * (w - ww); cy = y + wh / 2 + U.crop[1] * (h - wh); }
    cx = clamp(cx, x + ww / 2, x + w - ww / 2); cy = clamp(cy, y + wh / 2, y + h - wh / 2);
    return { x0: cx - ww / 2, y0: cy - wh / 2, x1: cx + ww / 2, y1: cy + wh / 2, cx, cy, rect: [x, y, w, h] };
  }

  // ---------- source frame ----------
  const vids = new Map();
  let seekBusy = false, wantSrc = null, shownSrc = null, shownClip = null;
  function videoFor(clip) {
    let v = vids.get(clip.id);
    if (!v) {
      v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true; v.crossOrigin = 'anonymous';
      v.src = clip.previewUrl || clip.url;
      v.addEventListener('seeked', () => { seekBusy = false; paint(); if (wantSrc != null && Math.abs(v.currentTime - wantSrc) > 0.03) seekNow(); });
      v.addEventListener('loadeddata', () => seekNow());
      vids.set(clip.id, v);
    }
    return v;
  }
  function seekNow() {
    const c = cur(); if (!c) return;
    const v = videoFor(c.clip);
    if (v.readyState < 1 || seekBusy) return;
    seekBusy = true; v.currentTime = wantSrc ?? 0;
    setTimeout(() => { seekBusy = false; }, 1500);
  }
  function showFrame(force) {
    const c = cur(); if (!c) return;
    const src = srcAt(c, timeIn(c));
    if (!force && shownClip === c.clip && shownSrc != null && Math.abs(src - shownSrc) < 0.04) { paint(); return; }
    wantSrc = src; shownSrc = src; shownClip = c.clip;
    const v = videoFor(c.clip);
    if (Math.abs(v.currentTime - src) < 0.02 && v.readyState >= 2) paint(); else seekNow();
  }

  function layoutCanvas(c) {
    // the frame's size follows the shot editor's height (drag the divider above it)
    const fr = cv.parentElement, ar = (c.clip.w || 16) / (c.clip.h || 9), maxW = fr?.clientWidth || 330, maxH = fr?.clientHeight || 186;
    let w = maxW, h = w / ar;
    if (h > maxH) { h = maxH; w = h * ar; }
    const dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
  }
  let hoverBox = null;
  function boxesAt(c, src) {
    const tr = c.clip.track;
    if (!tr || !tr.boxes) return [];
    let lo = 0, hi = tr.n - 1;
    while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (tr.times[m] <= src) lo = m; else hi = m - 1; }
    const j = Math.min(tr.n - 1, lo + 1), i = Math.abs(tr.times[j] - src) < Math.abs(tr.times[lo] - src) ? j : lo;
    return tr.boxes[i] || [];
  }
  function paint() {
    const c = cur(); if (!c) return;
    layoutCanvas(c);
    const W = cv.width, H = cv.height, v = videoFor(c.clip), t = timeIn(c), src = srcAt(c, t);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (v.readyState >= 2) g.drawImage(v, 0, 0, W, H);
    const win = windowAt(c, t), col = c.v.color || '#ffc933', dpr = devicePixelRatio || 1;
    // dim what the edit doesn't show
    g.fillStyle = 'rgba(0,0,0,0.6)';
    const X0 = win.x0 * W, Y0 = win.y0 * H, X1 = win.x1 * W, Y1 = win.y1 * H;
    g.fillRect(0, 0, W, Y0); g.fillRect(0, Y1, W, H - Y1); g.fillRect(0, Y0, X0, Y1 - Y0); g.fillRect(X1, Y0, W - X1, Y1 - Y0);
    // people the tracker found (click one to follow them)
    const fo = c.seg.framing;
    const followed = fo && fo.mode === 'person' ? personAt(c.clip.track, fo, src) : null;
    for (const b of boxesAt(c, src)) {
      const hov = hoverBox && hoverBox[0] === b[0] && hoverBox[1] === b[1];
      const isF = followed && Math.hypot(b[0] - followed.x, b[1] - followed.y) < 0.05;
      g.setLineDash(isF ? [] : [4 * dpr, 3 * dpr]);
      g.lineWidth = (isF || hov ? 2 : 1) * dpr;
      g.strokeStyle = isF ? col : hov || picking ? '#fff' : 'rgba(255,255,255,0.45)';
      g.strokeRect((b[0] - b[2] / 2) * W, (b[1] - b[3] / 2) * H, b[2] * W, b[3] * H);
    }
    g.setLineDash([]);
    // the window the edit shows
    g.lineWidth = 2 * dpr; g.strokeStyle = col; g.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    if (!win.fit) {
      g.fillStyle = col; const s = 5 * dpr;
      g.fillRect(win.cx * W - s, win.cy * H - 1 * dpr, 2 * s, 2 * dpr); g.fillRect(win.cx * W - 1 * dpr, win.cy * H - s, 2 * dpr, 2 * s);
    }
    // the camera move: the path through the keyframes, a ◆ at each one
    if (fo && fo.mode === 'keys' && fo.keys.length) {
      const o = t - c.seg.start;
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.5 * dpr; g.setLineDash([3 * dpr, 3 * dpr]);
      g.beginPath(); fo.keys.forEach((k, i) => (i ? g.lineTo(k.x * W, k.y * H) : g.moveTo(k.x * W, k.y * H))); g.stroke(); g.setLineDash([]);
      for (const k of fo.keys) {
        const on = Math.abs(k.o - o) < KEY_NEAR, r = (on ? 6 : 4) * dpr, x = k.x * W, y = k.y * H;
        g.fillStyle = on ? col : '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1 * dpr;
        g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); g.stroke();
      }
    }
    paintTrack(c);
  }

  // ---------- changing the framing ----------
  // every change goes to the cut under the playhead only
  function apply(props, { keepEntry = false } = {}) {
    const c = cur(); if (!c) return;
    const e = entryOf(c);
    if (props === null) { delete c.seg.framing; saveCut(c.seg, null); }
    else if (keepEntry && e) Object.assign(e, props);
    else {
      const n = { ...(e ? { mode: e.mode, z: e.z, x: e.x, y: e.y, seed: e.seed } : { mode: 'auto', z: 1 }), ...props };
      c.seg.framing = n; saveCut(c.seg, n);
    }
    onChange(); render();
  }
  function needPeople(c, withBoxes) {
    const tr = c.clip.track;
    if (tr && (!withBoxes || tr.boxes)) return false;
    wantTrack(c.clip, withBoxes);
    return true;
  }
  el.querySelector('.sb-modes').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-mode]'); if (!b) return;
    const c = cur(); if (!c) return;
    const m = b.dataset.mode, e = entryOf(c), z = e ? e.z || 1 : 1;
    picking = false;
    if (m === 'auto') { z > 1.001 ? apply({ mode: 'auto', z }) : apply(null); return; }
    if (m === 'lock') { const w = windowAt(c, timeIn(c)); apply({ mode: 'lock', x: w.cx ?? 0.5, y: w.cy ?? 0.5, z }); return; }
    if (m === 'main' || m === 'face') {
      if (needPeople(c, false)) toast('Finding the faces in this clip: the framing follows them as soon as that’s done');
      apply({ mode: m, z: m === 'face' ? Math.max(z, 1.8) : z });
      return;
    }
    if (m === 'person') {
      if (needPeople(c, true)) { toast('Finding the faces in this clip first: then pick one to follow'); render(); return; }
      if (!boxesAt(c, srcAt(c, timeIn(c))).length) toast('No face at this moment: pick one of the faces below, move to another moment, or drag the box instead');
      picking = true; render();
    }
  });
  zoomIn.addEventListener('input', () => {
    const c = cur(); if (!c) return;
    const z = Number(zoomIn.value), e = entryOf(c);
    if (e?.mode === 'keys') { setKey(c, { z }); return; }
    if (e) apply({ z }, { keepEntry: true }); else apply({ mode: 'auto', z });
  });
  el.querySelector('.sb-reset').onclick = () => { picking = false; apply(null); };
  // ---------- the faces in this clip, as pictures: click one to follow that person in this cut ----------
  function renderPeople(c) {
    const box = el.querySelector('.sb-people');
    const tr = c.clip.track, people = tr?.people;
    const busy = c.clip.trackState === 'running' || c.clip.trackState === 'queued';
    if (!people || busy) {
      box.innerHTML = busy
        ? `<span class="sb-pp-note"><i class="spin"></i>${(c.clip.trackPct || 0) >= 0.99 ? 'Telling the people apart…' : `Scanning the faces… ${Math.round((c.clip.trackPct || 0) * 100)}%`}</span>`
        : `<button class="small sb-findfaces">Show the faces in this clip</button>`;
      return;
    }
    if (!people.length) { box.innerHTML = '<span class="sb-pp-note">No faces found in this clip. Drag the box to aim instead.</span><button class="small sb-findfaces">Scan again</button>'; return; }
    const e = entryOf(c), following = e?.mode === 'person' ? e.seed?.face : null;
    const old = (tr.peopleV || 1) < 2;
    // every person of the clip, always in the same order: the ones not in this cut are greyed out
    box.innerHTML = `<span class="sb-pp-lbl">Faces <em>${people.length}</em></span><div class="sb-pp-strip">` + people.map((p) => {
      const here = p.seen.some((s) => s.t >= c.shotA - 0.05 && s.t <= c.shotB + 0.05);
      return `<button class="sb-face ${here ? 'here' : 'away'} ${following === p.id ? 'on' : ''}" data-face="${p.id}" title="${esc(p.name)}: in ${Math.round(p.share * 100)}% of the clip${here ? '. In this cut: click to follow' : '. Not in this cut: click to jump to a cut with them'}">
        <img src="${p.thumb}" alt=""><span>${esc(p.name.replace('Person ', 'P'))}</span></button>`;
    }).join('') + `</div><button class="small sb-findfaces" title="Look through the clip for faces again${old ? ' (better at telling people apart than the last scan)' : ''}">${old ? 'Rescan (better)' : 'Rescan'}</button>`;
  }
  el.querySelector('.sb-people').addEventListener('click', (ev) => {
    if (!ev.target.closest('.sb-findfaces')) return;
    const c = cur(); if (!c) return;
    c.clip.track = null; c.clip.trackState = null; c.clip.trackPromise = null; // a fresh scan
    wantTrack(c.clip, 'people'); toast('Scanning the faces in this clip…'); renderPeople(c);
  });
  el.querySelector('.sb-people').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-face]'); if (!b) return;
    const c = cur(); if (!c) return;
    const p = c.clip.track?.people?.find((x) => x.id === b.dataset.face); if (!p) return;
    const inCut = p.seen.filter((s) => s.t >= c.shotA - 0.05 && s.t <= c.shotB + 0.05);
    if (!inCut.length) { showPerson(c.seg.clip, p.id); return; }
    const now = srcAt(c, timeIn(c));
    const s = inCut.reduce((a, x) => (Math.abs(x.t - now) < Math.abs(a.t - now) ? x : a));
    picking = false;
    // the same box the picture shows around a face (head and shoulders)
    apply({ mode: 'person', seed: { t: s.t, x: s.x, y: s.y + s.h * 0.9, h: s.h * 3, face: p.id } });
    toast(`Following ${p.name} in this cut`);
  });

  // put the playhead on the cut of this edit where a person of a clip shows up (the nearest to the open cut),
  // open the shot editor there and follow them. Used by the face buttons here and in the clip list.
  function showPerson(clipIdx, pid) {
    const v = getView(); if (!v.plan) return false;
    const p = v.clips[clipIdx]?.track?.people?.find((x) => x.id === pid); if (!p) return false;
    const from = si < 0 ? shotAt(player.now()) : si;
    let best = null;
    v.plan.segments.forEach((sg, k) => {
      if (sg.clip !== clipIdx) return;
      const used = Math.max(sg.srcDur || 0, srcOffset(sg, sg.end - sg.start)), a = sg.srcStart, b = a + used;
      const hit = p.seen.find((s) => s.t >= a - 0.05 && s.t <= b + 0.05);
      if (hit && (!best || Math.abs(k - from) < Math.abs(best.k - from))) best = { k, sg, hit };
    });
    if (!best) {
      const times = [...new Set(p.seen.map((s) => fmt(Math.floor(s.t))))].slice(0, 4).join(', ');
      toast(`${p.name} isn’t in any cut of this edit. They show up at ${times} of the clip: use Swap on a cut to use that part`);
      return false;
    }
    select(best.k, { seek: false });
    const sg = best.sg, span = sg.end - sg.start;
    // the playhead goes to the moment they're on screen (about: the cut may play faster or slower)
    const ratio = Math.max(0.01, srcOffset(sg, span) / span);
    player.pause(); player.seek(clamp(sg.start + (best.hit.t - sg.srcStart) / ratio, sg.start + 0.02, sg.end - 0.03));
    const s2 = best.hit;
    picking = false;
    apply({ mode: 'person', seed: { t: s2.t, x: s2.x, y: s2.y + s2.h * 0.9, h: s2.h * 3, face: p.id } });
    toast(`Cut ${best.k + 1}: ${p.name} is here. Following them`);
    return true;
  }

  // ---------- camera keyframes (a camera move inside this cut, like CapCut) ----------
  // A keyframe is where the camera is at one moment of the cut: aim x, y and zoom z. Add one, move the playhead,
  // then drag or zoom the box: that records a keyframe there. The camera glides from one keyframe to the next.
  const KEY_NEAR = 0.04; // seconds: "on" a keyframe
  const nowAt = (c) => { const t = timeIn(c); return { t, s: srcAt(c, t), o: Math.round((t - c.seg.start) * 1000) / 1000 }; };
  const keyHere = (e, o) => (e?.keys || []).findIndex((k) => Math.abs(k.o - o) < KEY_NEAR);
  // set the camera at the playhead: updates the keyframe there, or makes a new one from where the camera is now
  function setKey(c, props, light = false) {
    const e = entryOf(c); if (!e || e.mode !== 'keys') return false;
    const { s, o } = nowAt(c), i = keyHere(e, o);
    if (i >= 0) Object.assign(e.keys[i], props);
    else {
      e.keys.push({ ...keyAim(e.keys, s), ...props, s, o });
      e.keys.sort((a, b) => a.s - b.s);
    }
    for (const k of e.keys) { k.x = clamp(k.x, 0, 1); k.y = clamp(k.y, 0, 1); k.z = clamp(k.z || 1, 1, 3); }
    onChange();
    if (light) { paint(); updateNote(); } else render();
    return true;
  }
  function addKey(quiet = false) {
    const c = cur(); if (!c) return;
    picking = false;
    const e = entryOf(c), { t, s, o } = nowAt(c);
    if (e?.mode === 'keys') {
      if (keyHere(e, o) >= 0) { toast('There is already a keyframe here: move the playhead first'); return; }
      setKey(c, {});
    } else {
      const w = windowAt(c, t);
      if (w.fit) { toast('This edit uses “Fit + blur”: switch Framing to Fill to move the camera'); return; }
      const z = e ? clamp(Number(e.z) || 1, 1, 3) : 1;
      const n = { mode: 'keys', z, keys: [{ s, o, x: w.cx ?? 0.5, y: w.cy ?? 0.5, z }] };
      c.seg.framing = n; saveCut(c.seg, n);
      onChange(); render();
    }
    const k = entryOf(c).keys.length;
    if (quiet) return;
    toast(k === 1 ? 'Keyframe 1 set. Move the playhead, then drag or zoom the box to record where the camera goes' : `Keyframe ${keyHere(entryOf(c), o) + 1} of ${k} set`);
  }
  el.querySelector('.sb-kadd').onclick = addKey;
  el.querySelector('.sb-kdel').onclick = () => {
    const c = cur(), e = c && entryOf(c); if (!e || e.mode !== 'keys') return;
    const i = keyHere(e, nowAt(c).o); if (i < 0) return;
    e.keys.splice(i, 1);
    if (!e.keys.length) apply(null); else { onChange(); render(); }
  };
  el.querySelector('.sb-kclear').onclick = () => { apply(null); toast('Camera move removed from this cut'); };
  // the keyframes themselves are on the timeline (Camera row); here the Add button just shows where it adds one
  function paintTrack(c) {
    const b = el.querySelector('.sb-kadd'); if (b) b.textContent = `◆ Add keyframe at ${fmt(player.now())}`;
  }
  // delete / replace this cut (main.js does the work, remembered per edit)
  // after a change: stay on the same cut number (after a delete that's the next cut) and show it
  function reshow() {
    const p = getView().plan; if (!p || !p.segments.length) return;
    si = clamp(si, 0, p.segments.length - 1); shownSrc = null;
    player.pause(); player.seek(p.segments[si].start + 0.02);
    render();
  }
  function delCut() { const c = cur(); if (!c || !cutOps.del) return; picking = false; if (cutOps.del(c.seg)) reshow(); }
  el.querySelector('.sb-delete').onclick = delCut;
  const repBtn = el.querySelector('.sb-replace');
  repBtn.onclick = async () => {
    const c = cur(); if (!c || !cutOps.replace || repBtn.disabled) return;
    picking = false; repBtn.disabled = true; repBtn.textContent = 'Finding movement…';
    try { if (await cutOps.replace(c.seg)) reshow(); } finally { repBtn.disabled = false; repBtn.textContent = 'Replace cut'; }
  };
  el.querySelector('.sb-own').onclick = () => { const c = cur(); if (!c || !cutOps.restore) return; if (cutOps.restore(c.seg)) reshow(); };
  el.querySelector('.sb-undel').onclick = () => { if (!cutOps.restoreDeleted) return; cutOps.restoreDeleted(); reshow(); };
  el.querySelector('.sb-prev').onclick = () => step(-1);
  el.querySelector('.sb-next').onclick = () => step(1);
  el.querySelector('.sb-close').onclick = () => close();

  // canvas: drag = aim (locks the camera there), wheel = zoom, click a person = follow them
  let down = null;
  const posOf = (ev) => { const r = cv.getBoundingClientRect(); return { x: clamp((ev.clientX - r.left) / r.width, 0, 1), y: clamp((ev.clientY - r.top) / r.height, 0, 1) }; };
  const boxUnder = (c, p) => boxesAt(c, srcAt(c, timeIn(c))).filter((b) => Math.abs(p.x - b[0]) < b[2] / 2 && Math.abs(p.y - b[1]) < b[3] / 2)
    .sort((a, b) => a[2] * a[3] - b[2] * b[3])[0] || null;
  cv.addEventListener('pointerdown', (ev) => {
    const c = cur(); if (!c) return;
    cv.setPointerCapture(ev.pointerId);
    const p = posOf(ev), w = windowAt(c, timeIn(c));
    down = { p, moved: false, off: w.cx != null ? { x: w.cx - p.x, y: w.cy - p.y } : { x: 0, y: 0 }, inside: p.x > w.x0 && p.x < w.x1 && p.y > w.y0 && p.y < w.y1 };
  });
  cv.addEventListener('pointermove', (ev) => {
    const c = cur(); if (!c) return;
    const p = posOf(ev);
    if (!down) { const b = boxUnder(c, p); if (b !== hoverBox) { hoverBox = b; paint(); } cv.style.cursor = b ? 'pointer' : 'grab'; return; }
    if (!down.moved && Math.hypot(p.x - down.p.x, p.y - down.p.y) < 0.012) return;
    down.moved = true; picking = false; cv.style.cursor = 'grabbing';
    // grabbing the box moves it; grabbing elsewhere aims straight at that point
    const aim = down.inside ? { x: p.x + down.off.x, y: p.y + down.off.y } : p;
    if (wantKeys() && entryOf(c)?.mode !== 'keys') addKey(true);
    const e = entryOf(c);
    if (e && e.mode === 'keys') { setKey(c, { x: aim.x, y: aim.y }, true); return; } // records a keyframe at the playhead
    if (e && e.mode === 'lock') { e.x = clamp(aim.x, 0, 1); e.y = clamp(aim.y, 0, 1); onChange(); paint(); updateNote(); }
    else apply({ mode: 'lock', x: clamp(aim.x, 0, 1), y: clamp(aim.y, 0, 1) });
  });
  cv.addEventListener('pointerup', (ev) => {
    const c = cur(); const d = down; down = null; cv.style.cursor = 'grab';
    if (!c || !d || d.moved) { render(); return; }
    const p = posOf(ev), b = boxUnder(c, p);
    if (b) { picking = false; apply({ mode: 'person', seed: { t: srcAt(c, timeIn(c)), x: b[0], y: b[1], h: b[3] } }); toast('Following that face in this cut'); }
    else if (picking) toast('Click inside one of the boxes around a face');
    else if (entryOf(c)?.mode === 'keys') setKey(c, { x: p.x, y: p.y });
    else { const e = entryOf(c); apply({ mode: 'lock', x: p.x, y: p.y, z: e ? e.z || 1 : 1 }); }
  });
  // Ctrl + scroll zooms the camera; a plain scroll does nothing here (it used to change the zoom by accident)
  cv.addEventListener('wheel', (ev) => {
    const c = cur(); if (!c || !(ev.ctrlKey || ev.metaKey)) return;
    ev.preventDefault();
    const e0 = entryOf(c);
    if (e0?.mode === 'keys') { setKey(c, { z: clamp(keyAim(e0.keys, srcAt(c, timeIn(c))).z * Math.exp(-ev.deltaY * 0.0015), 1, 3) }, true); return; }
    const e = entryOf(c), z = clamp((e ? e.z || 1 : 1) * Math.exp(-ev.deltaY * 0.0015), 1, 3);
    if (e) apply({ z }, { keepEntry: true }); else apply({ mode: 'auto', z });
  }, { passive: false });

  // ---------- panel ----------
  function updateNote() {
    const c = cur(); if (!c) return;
    const e = entryOf(c), mode = picking ? 'person' : e ? e.mode : 'auto';
    el.querySelectorAll('.sb-modes [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    const keyed = e?.mode === 'keys' && e.keys?.length, now = nowAt(c);
    const z = keyed ? keyAim(e.keys, now.s).z : e ? Number(e.z) || 1 : 1;
    zoomIn.value = String(z); el.querySelector('.sb-zoom b').textContent = z > 1.001 ? `${z.toFixed(2).replace(/0$/, '')}×` : 'off';
    // camera move controls
    const onKey = keyed ? keyHere(e, now.o) : -1;
    el.querySelector('.sb-kdel').hidden = onKey < 0;
    el.querySelector('.sb-kclear').hidden = !keyed;
    el.querySelector('.sb-kadd').disabled = onKey >= 0;
    el.querySelector('.sb-mv-info').textContent = keyed
      ? `${e.keys.length} keyframe${e.keys.length > 1 ? 's' : ''}${onKey >= 0 ? `, on keyframe ${onKey + 1}` : ''}`
      : 'none: the camera follows the setting above';
    const n = c.v.plan.segments.filter((s) => s.framing).length;
    const tr = c.clip.track;
    el.querySelector('.sb-note').textContent = c.v.ctx && c.v.ctx.framing === 'fit'
      ? 'This edit uses “Fit + blur”, which always shows the whole picture: switch Framing to Fill to aim the camera.'
      : keyed
        ? (e.keys.length < 2 ? 'Now move the playhead (on the timeline, or ← →), then drag or zoom the box: that records keyframe 2 and the camera glides between them.'
          : 'Drag or zoom the box with the playhead anywhere in the cut to add or change a keyframe. The ◆ are in the Camera row of the timeline: drag one to move it.')
      : `Changes only cut ${si + 1} of Edit ${c.v.index + 1}: every other cut and edit keeps its own framing. Exports use it too.` +
        (n ? ` ${n} cut${n > 1 ? 's' : ''} in this edit ${n > 1 ? 'have' : 'has'} your framing (◆ on the timeline).` : '') +
        (!tr && c.clip.trackState === 'running' ? ' Finding people…' : '');
    el.querySelector('.sb-desc').textContent = (FRAME_MODES.find((m) => m[0] === mode) || FRAME_MODES[0])[2];
    renderPeople(c);
    hint.textContent = picking ? 'Click the face to follow' : (tr && tr.boxes ? 'Drag to aim, Ctrl + scroll to zoom, click a face to follow' : 'Drag to aim, Ctrl + scroll to zoom');
  }
  function render(force = true) {
    const c = cur();
    if (!c) { if (!el.hidden) close(); return; }
    const N = c.v.plan.segments.length;
    el.querySelector('.sb-title b').textContent = `Edit ${c.v.index + 1}, cut ${si + 1} of ${N}`;
    el.querySelector('.sb-title small').textContent = `${c.clip.name}, ${fmt(c.shotA)}–${fmt(c.shotB)} of the clip, ${c.seg.reason || ''}`;
    el.style.setProperty('--c', c.v.color || '#ffc933');
    const own = el.querySelector('.sb-own'), undel = el.querySelector('.sb-undel'), nDel = cutOps.deleted ? cutOps.deleted() : 0;
    own.hidden = !c.seg.swapped;
    undel.hidden = !nDel; undel.textContent = `Bring back ${nDel} deleted`;
    el.querySelector('.sb-delete').disabled = N <= 1;
    updateNote();
    showFrame(force);
  }

  function select(i, { seek = true } = {}) {
    const v = getView();
    if (!v.plan || !v.plan.segments.length) return;
    si = clamp(i, 0, v.plan.segments.length - 1); picking = false;
    const wasHidden = el.hidden;
    el.hidden = false;
    if (seek) { player.pause(); player.seek(v.plan.segments[si].start + 0.02); }
    render();
    if (wasHidden) onToggle(true);
  }
  function close() { if (el.hidden) return; el.hidden = true; picking = false; si = -1; onToggle(false); }
  function shotAt(t) { const p = getView().plan; if (!p) return -1; let k = p.segments.findIndex((s) => t >= s.start && t < s.end); return k < 0 ? p.segments.length - 1 : k; }
  function step(d) { if (el.hidden || si < 0) select(shotAt(player.now())); else select(si + d); }
  let lastTick = 0;
  function tick() {
    if (el.hidden) return;
    const now = performance.now();
    if (player.playing && now - lastTick < 200) return;
    lastTick = now;
    const c = cur(); if (!c) return;
    // playing or scrubbing: follow the playhead shot by shot
    const k = shotAt(player.now());
    if (k !== si && k >= 0) { si = k; picking = false; render(); return; }
    showFrame(false);
    paintTrack(c);
    if (!player.playing) updateNote(); // on / off a keyframe as the playhead moves
  }
  // the take's picture dragged while this cut is selected: the camera moves the opposite way (the picture follows
  // the pointer), by the share of the window it's dragged; with camera keyframes it records one at the playhead
  let aimDrag = null;
  function dragAim(phase, dx = 0, dy = 0) {
    const c = cur(); if (!c) return false;
    if (phase === 'start') {
      const w = windowAt(c, timeIn(c)); if (w.fit) { toast('This edit uses “Fit + blur”: switch Framing to Fill to move the camera'); return false; }
      if (wantKeys() && entryOf(c)?.mode !== 'keys') addKey(true);
      const e = entryOf(c), k = e?.mode === 'keys' ? keyAim(e.keys, srcAt(c, timeIn(c))) : null;
      aimDrag = { cx: k ? k.x : w.cx ?? 0.5, cy: k ? k.y : w.cy ?? 0.5, ww: Math.max(0.02, w.x1 - w.x0), wh: Math.max(0.02, w.y1 - w.y0) };
      picking = false; player.pause();
      return true;
    }
    if (!aimDrag) return false;
    if (phase === 'end') { aimDrag = null; render(); return true; }
    const x = clamp(aimDrag.cx - dx * aimDrag.ww, 0, 1), y = clamp(aimDrag.cy - dy * aimDrag.wh, 0, 1), e = entryOf(c);
    if (e && e.mode === 'keys') setKey(c, { x, y }, true);
    else if (e && e.mode === 'lock') { e.x = x; e.y = y; onChange(); paint(); updateNote(); }
    else apply({ mode: 'lock', x, y, z: e ? e.z || 1 : 1 });
    return true;
  }
  // the take's picture scrolled while this cut is selected: zoom the camera (a keyframe when it has camera keyframes)
  function zoomBy(deltaY) {
    const c = cur(); if (!c) return;
    if (wantKeys() && entryOf(c)?.mode !== 'keys') addKey(true);
    const e0 = entryOf(c);
    if (e0?.mode === 'keys') { setKey(c, { z: clamp(keyAim(e0.keys, srcAt(c, timeIn(c))).z * Math.exp(-deltaY * 0.0015), 1, 3) }, true); return; }
    const z = clamp((e0 ? e0.z || 1 : 1) * Math.exp(-deltaY * 0.0015), 1, 3);
    if (e0) apply({ z }, { keepEntry: true }); else apply({ mode: 'auto', z });
  }
  function deleteKeyHere() {
    const c = cur(), e = c && entryOf(c); if (!e || e.mode !== 'keys') return false;
    const i = keyHere(e, nowAt(c).o); if (i < 0) return false;
    e.keys.splice(i, 1);
    if (!e.keys.length) apply(null); else { onChange(); render(); }
    return true;
  }
  return {
    dragAim, deleteKeyHere, zoomBy,
    select, close, step, tick, shotAt, deleteSelected: delCut, addKey, showPerson,
    isOpen: () => !el.hidden, selected: () => (el.hidden ? -1 : si),
    refresh: () => { if (!el.hidden) { const p = getView().plan; if (!p || !p.segments.length) close(); else { si = Math.min(si, p.segments.length - 1); render(false); } } },
  };
}
