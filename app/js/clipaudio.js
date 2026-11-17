import { fadeWave, bufferPeak, fadeAt, fadeFieldsHtml, fadeFromField } from './fadewave.js';
const FK = { fadeIn: 'fadeIn', fadeOut: 'fadeOut', inAt: 'fadeInAt', outAt: 'fadeOutAt', curve: 'fadeCurve' };
import { audioCtx } from './audio.js';
// A clip's own sound: double-click the clip's wave in the clip list to open its audio panel.
// Volume (up to 200%), mute, even out the loudness, bass and treble, and fades at the start and end of every cut
// from this clip. The previews play it like that and every export mixes it like that.
export const AUDIO_DEFAULTS = { vol: 1, mute: false, normalize: false, bass: 0, treble: 0, fadeIn: 0, fadeOut: 0, fadeInAt: 0, fadeOutAt: 0, fadeCurve: 'linear' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const audioOf = (clip) => ({ ...AUDIO_DEFAULTS, ...(clip?.audioFx || {}) });
export const hasAudioFx = (clip) => { const a = audioOf(clip); return a.vol !== 1 || a.mute || a.normalize || a.bass || a.treble || a.fadeIn || a.fadeOut || a.fadeInAt || a.fadeOutAt || a.fadeCurve !== 'linear'; };

// how loud the clip is (RMS of its sound), for "even out the loudness"
function loudness(clip) {
  if (clip._rms != null) return clip._rms;
  const b = clip.audioBuffer; if (!b) return (clip._rms = 0.1);
  let sum = 0, n = 0;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i += 64) { sum += d[i] * d[i]; n++; }
  }
  return (clip._rms = Math.sqrt(sum / Math.max(1, n)) || 0.1);
}
// the clip's level as one number (volume x evened-out loudness), before fades
export function clipLevel(clip) {
  const a = audioOf(clip);
  if (a.mute) return 0;
  return a.vol * (a.normalize ? clamp(0.1 / loudness(clip), 0.25, 4) : 1);
}
// the level `tIn` seconds into a cut `dur` long (fades at both ends of the cut)
export function clipGainAt(clip, tIn, dur) {
  const a = audioOf(clip);
  let k = clipLevel(clip);
  if (!k) return 0;
  return k * fadeAt(tIn, dur, { fadeIn: a.fadeIn, fadeOut: a.fadeOut, inAt: a.fadeInAt, outAt: a.fadeOutAt, curve: a.fadeCurve });
}

// A clip's fades go at the start and end of each continuous stretch of it in the edit (a "run": the beat cuts
// inside one moment don't fade in and out every half second, which made the fades sound like they did nothing)
const runCache = new WeakMap();
// The clip's fades are for the whole clip in the edit: it fades in from its first moment in the edit and out
// at its last (one clip in an edit = the whole edit). [start, end] in edit seconds
const spanCache = new WeakMap();
export function clipSpan(plan, ci) {
  let m = spanCache.get(plan);
  if (!m || m.n !== plan.segments.length) {
    m = new Map(); m.n = plan.segments.length;
    for (const s of plan.segments) { const r = m.get(s.clip); if (r) { r[0] = Math.min(r[0], s.start); r[1] = Math.max(r[1], s.end); } else m.set(s.clip, [s.start, s.end]); }
    spanCache.set(plan, m);
  }
  return m.get(ci) || [0, plan.duration || 1];
}
export function runBounds(plan, seg) {
  let m = runCache.get(plan);
  if (!m || m.n !== plan.segments.length) {
    m = new Map(); m.n = plan.segments.length;
    let a = 0, group = [];
    const flush = () => { const b = group.length ? group[group.length - 1].end : a; for (const s of group) m.set(s, [a, b]); group = []; };
    plan.segments.forEach((s, k) => {
      const p = plan.segments[k - 1];
      const joined = p && p.clip === s.clip && (p.run == null || p.run === s.run) && Math.abs(p.srcStart + (p.srcDur || p.end - p.start) - s.srcStart) < 0.2 && Math.abs(p.end - s.start) < 0.02;
      if (!joined) { flush(); a = s.start; }
      group.push(s);
    });
    flush();
    runCache.set(plan, m);
  }
  return m.get(seg) || [seg.start, seg.end];
}

// ---- the panel (laid out like the song's Edit panel: which part plays, sound, fades on the wave) ----
const fmtT = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const parseT = (v) => { const p = String(v).trim().split(':').map(Number); return p.some((x) => !Number.isFinite(x)) ? NaN : p.reduce((a, x) => a * 60 + x, 0); };

// trim: { get(c) -> [a, b], full(c), set(c, a, b), best(c, L) -> start, done(c) }, cutLen(c): about how long a cut of it runs
export function createClipAudio({ toast, onChange, esc, trim = null, cutLen = () => 2, mix = null, editMap = null }) {
  const box = document.createElement('div');
  box.className = 'ca-pop se-pop'; box.hidden = true;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Clip audio');
  document.body.appendChild(box);
  let clip = null, anchor = null, fades = null, src = null, embedded = false; // embedded: inside a clip's preview
  const row = (k, label, min, max, step) => `<label class="ca-row"><span>${label}</span><input type="range" data-ca="${k}" min="${min}" max="${max}" step="${step}"><b data-cav="${k}"></b></label>`;
  const FMT = { vol: (v) => `${Math.round(v * 100)}%`, bass: (v) => `${v > 0 ? '+' : ''}${v} dB`, treble: (v) => `${v > 0 ? '+' : ''}${v} dB` };
  const span = () => Math.max(0.4, cutLen(clip) || 2);
  const fadeOf = () => { const a = audioOf(clip); return { fadeIn: a.fadeIn, fadeOut: a.fadeOut, inAt: a.fadeInAt, outAt: a.fadeOutAt, curve: a.fadeCurve }; };
  const refreshFields = () => { const el = box.querySelector('.fw-fields'); if (el && clip) el.innerHTML = fadeFieldsHtml(fadeOf(), span()); };
  function draw() {
    const a = audioOf(clip), [ta, tb] = trim ? trim.get(clip) : [0, clip.duration || 0], full = trim ? trim.full(clip) : clip.duration || 0, L = tb - ta;
    box.innerHTML = `<div class="ca-h"><b>${embedded ? 'Clip sound' : 'Clip audio'}</b>${embedded ? '<span>this clip’s volume, tone and fades</span>' : `<span title="${esc(clip.name)}">${esc(clip.name)}</span>`}<button class="small ca-reset" title="This clip's sound back to normal (volume, bass, treble, mute, fades)">Reset</button>${embedded ? '' : '<button class="ca-x" aria-label="Close">×</button>'}</div>
      ${embedded ? '' : '<canvas class="ca-wave se-wave ca-whole" title="Click to start this clip’s part there"></canvas>'}
      ${trim && !embedded ? `<div class="se-sec"><b>Which part plays</b>
        <div class="se-start"><label>Starts at <input type="text" class="se-in ca-in" value="${fmtT(ta)}" spellcheck="false"></label>
          <button class="small" data-step="-1" title="One second earlier">‹ 1s</button><button class="small" data-step="1" title="One second later">1s ›</button>
          <button class="small ca-play" title="Play this part with this sound">${src ? '■ Stop' : '▶ Play'}</button></div>
        <div class="se-quick"><button class="small" data-part="best" title="The most action-packed part of this length">Best part</button>
          <button class="small ${trim && L >= full - 0.05 ? 'on' : ''}" data-part="whole">Whole clip</button></div>
      </div>
      <div class="se-sec"><b>How long a part <em>${L.toFixed(1)}s of ${full.toFixed(1)}s</em></b>
        <div class="se-len"><input type="number" class="se-l ca-l" min="0.5" max="${full.toFixed(1)}" step="0.5" value="${L.toFixed(1)}"><span>s</span>
          ${[3, 5, 8, 10, 15, 20, 30].filter((x) => x < full).map((x) => `<button class="chip${Math.abs(L - x) < 0.05 ? ' on' : ''}" data-plen="${x}">${x}s</button>`).join('')}</div>
      </div>` : ''}
      <div class="se-sec"><b>Sound</b>
        <div class="ca-toggles">
          <button class="ca-t ${a.mute ? 'on' : ''}" data-cat="mute">${a.mute ? 'Muted' : 'Mute clip'}</button>
          <button class="ca-t ${a.normalize ? 'on' : ''}" data-cat="normalize" title="Make quiet clips louder and loud ones quieter, so every clip sits at about the same level">Even out loudness</button>
        </div>
        ${mix ? `<label class="ca-row" title="How loud every clip plays under the song (the song's own volume is in Music → Edit)"><span>All clips</span><input type="range" data-mix min="0" max="1" step="0.05" value="${mix.get()}"><b data-mixv>${Math.round(mix.get() * 100)}%</b></label>` : ''}
        ${row('vol', 'This clip', 0, 2, 0.05)}
        ${row('bass', 'Bass', -12, 12, 1)}
        ${row('treble', 'Treble', -12, 12, 1)}
        <div class="ca-presets"><span>Quick</span>
          <button class="small" data-cap="voice" title="Clearer speech: less rumble, more presence">Voice clear</button>
          <button class="small" data-cap="bass" title="Deeper, punchier sound">Bass boost</button>
          <button class="small" data-cap="soft" title="Quieter, with smooth fades on every cut">Soft</button>
          <button class="small" data-cap="reset">Reset</button></div>
      </div>
      <div class="se-sec"><b>Fades <em>over the whole clip</em></b>
        <canvas class="ca-wave fw-wave ca-fades"></canvas>
        <div class="fw-fields">${fadeFieldsHtml(fadeOf(), span())}</div>
        <small class="ca-note">Top handles: where the fade in ends and the fade out starts. Bottom handles: where the sound starts and stops.</small>
      </div>
      <div class="se-sec pf-sec"><b>Picture fades <em>where this clip comes on and goes off</em></b>
        <div class="pf-row">
          <label>In <input type="number" data-pf="in" min="0" max="3" step="0.1" value="${(clip.vfade?.in || 0).toFixed(1)}">s</label>
          <label>Out <input type="number" data-pf="out" min="0" max="3" step="0.1" value="${(clip.vfade?.out || 0).toFixed(1)}">s</label>
          ${[['none', 'None', 0, 0], ['soft', 'Soft', 0.15, 0.15], ['dip', 'Dip', 0.35, 0.35], ['in', 'In only', 0.5, 0], ['slow', 'Slow', 1, 1]].map(([k, l, a, b]) => `<button class="chip${Math.abs((clip.vfade?.in || 0) - a) < 0.01 && Math.abs((clip.vfade?.out || 0) - b) < 0.01 ? ' on' : ''}" data-pfp="${a},${b}">${l}</button>`).join('')}
        </div>
        <small class="ca-note">From and to black. Cuts that carry on the same moment don't fade in between. A single cut can have its own (right-click the FX row).</small>
      </div>`;
    for (const el of box.querySelectorAll('[data-ca]')) { el.value = a[el.dataset.ca]; box.querySelector(`[data-cav="${el.dataset.ca}"]`).textContent = FMT[el.dataset.ca](a[el.dataset.ca]); }
    fades = fadeWave(box.querySelector('.ca-fades'), {
      span, max: 12, muted: () => !!audioOf(clip).mute,
      // what you hear of this clip at that moment of the edit (silent where another clip plays)
      peak: (t0, t1) => {
        const M = editMap?.(clip), lvl = Math.min(2, clipLevel(clip) || 0.0001) * 1.2;
        if (!M) return Math.min(1, bufferPeak(clip.audioBuffer, (trim ? trim.get(clip)[0] : 0), t0, t1) * lvl);
        const s0 = M.at((t0 + t1) / 2); return s0 == null ? 0 : Math.min(1, bufferPeak(clip.audioBuffer, s0, 0, t1 - t0) * lvl);
      },
      get: fadeOf,
      set: (k, v) => set(FK[k], v), onDone: refreshFields,
    });
    drawWave(); fades.draw();
  }
  function drawWave() {
    const cv = box.querySelector('.ca-whole'); if (!cv || !clip) return;
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    cv.width = Math.max(10, Math.round(r.width * dpr)); cv.height = Math.max(10, Math.round(r.height * dpr));
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, b = clip.audioBuffer;
    g.clearRect(0, 0, W, H);
    if (!b) { g.fillStyle = 'rgba(242,240,234,0.4)'; g.font = `${12 * dpr}px sans-serif`; g.fillText('This clip has no sound', 8 * dpr, H / 2); return; }
    const full = trim ? trim.full(clip) : b.duration, [ta, tb] = trim ? trim.get(clip) : [0, full];
    const x0 = (ta / full) * W, x1 = (tb / full) * W;
    const d = b.getChannelData(0), lvl = Math.min(2, clipLevel(clip)), acc = getComputedStyle(document.documentElement).getPropertyValue('--tape').trim() || '#ffc933';
    const per = (full / b.duration) * d.length / W;
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x0, 0, x1 - x0, H);
    for (let x = 0; x < W; x += 2) {
      let m = 0; const i0 = Math.floor(x * per); for (let i = i0; i < i0 + per * 2 && i < d.length; i += 8) m = Math.max(m, Math.abs(d[i]));
      const h = Math.max(1, Math.min(1, m * Math.max(lvl, 0.0001)) * H * 0.95), inWin = x >= x0 && x <= x1;
      g.fillStyle = clip.audioFx?.mute ? 'rgba(242,240,234,0.25)' : inWin ? acc : 'rgba(168,165,157,0.4)';
      g.fillRect(x, (H - h) / 2, 1.2 * dpr, h);
    }
    g.strokeStyle = acc; g.lineWidth = 1.5 * dpr; g.strokeRect(x0 + 1, 1, Math.max(2, x1 - x0 - 2), H - 2);
    if (lvl > 1) { g.fillStyle = 'rgba(255,90,61,0.8)'; g.fillRect(0, 0, W, 2 * dpr); g.fillRect(0, H - 2 * dpr, W, 2 * dpr); }
  }
  function set(k, v) {
    clip.audioFx = { ...audioOf(clip), [k]: v };
    if (!hasAudioFx(clip)) delete clip.audioFx;
    onChange(clip);
  }
  function setPart(a, b) { if (!trim) return; trim.set(clip, a, b); trim.done(clip); draw(); }
  function stopPlay() { if (src) { try { src.stop(); } catch {} src = null; } }
  function play() {
    if (src) { stopPlay(); draw(); return; }
    const b = clip.audioBuffer; if (!b) return toast('This clip has no sound');
    const ctx = audioCtx(); if (ctx.state === 'suspended') ctx.resume();
    const [ta, tb] = trim ? trim.get(clip) : [0, b.duration], L = Math.min(tb - ta, 20);
    src = ctx.createBufferSource(); src.buffer = b;
    const g = ctx.createGain(); g.gain.value = clipLevel(clip);
    g.connect(ctx.destination); src.connect(clipChain(ctx, clip, g));
    src.start(0, ta, L);
    src.onended = () => { src = null; if (!box.hidden && clip) draw(); };
    draw();
  }
  box.addEventListener('input', (e) => {
    if (e.target.matches('[data-mix]') && mix) { mix.set(Number(e.target.value)); box.querySelector('[data-mixv]').textContent = `${Math.round(Number(e.target.value) * 100)}%`; return; }
    const el = e.target.closest('[data-ca]'); if (!el || !clip) return;
    const k = el.dataset.ca, v = Number(el.value);
    set(k, v);
    box.querySelector(`[data-cav="${k}"]`).textContent = FMT[k](v);
    drawWave(); fades?.draw();
  });
  box.addEventListener('change', (e) => {
    if (clip && e.target.matches('[data-ft]')) {
      for (const [k, v] of Object.entries(fadeFromField(fadeOf(), span(), e.target.dataset.ft, e.target.value))) set(FK[k], v);
      fades?.draw(); refreshFields(); return;
    }
    if (!clip || !trim) return;
    const [a, b] = trim.get(clip), full = trim.full(clip);
    if (e.target.matches('.ca-in')) { const t = parseT(e.target.value); if (Number.isFinite(t)) { const s0 = clamp(t, 0, full - 0.5); setPart(s0, Math.min(full, s0 + (b - a))); } else draw(); }
    else if (e.target.matches('.ca-l')) { const L = Number(e.target.value); if (L > 0) setPart(a, a + L); else draw(); }
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
  box.addEventListener('pointerdown', (e) => {
    const cv = e.target.closest('.ca-whole'); if (!cv || !clip || !trim) return;
    const r = cv.getBoundingClientRect(), full = trim.full(clip), [a, b] = trim.get(clip), t = ((e.clientX - r.left) / r.width) * full;
    setPart(t, t + (b - a));
  });
  box.addEventListener('click', (e) => {
    if (!clip) return;
    if (e.target.closest('.ca-x')) return close();
    if (e.target.closest('.ca-play')) return play();
    if (e.target.closest('.ca-reset')) { delete clip.audioFx; onChange(clip); draw(); toast(`${clip.name}: sound back to normal`); return; }
    const pp = e.target.closest('[data-pfp]');
    if (pp) { const [a, b] = pp.dataset.pfp.split(',').map(Number); setPf(a, b); draw(); return; }
    const fc = e.target.closest('[data-fcurve]');
    if (fc) { set('fadeCurve', fc.dataset.fcurve); fades?.draw(); refreshFields(); return; }
    const t = e.target.closest('[data-cat]');
    if (t) { set(t.dataset.cat, !audioOf(clip)[t.dataset.cat]); draw(); return; }
    if (trim) {
      const [a, b] = trim.get(clip), full = trim.full(clip), L = b - a;
      const st = e.target.closest('[data-step]'); if (st) { setPart(a + Number(st.dataset.step), b + Number(st.dataset.step)); return; }
      const pt = e.target.closest('[data-part]');
      if (pt) { if (pt.dataset.part === 'whole') setPart(0, full); else { const Lb = L >= full - 0.05 ? Math.min(full, 8) : L, s0 = trim.best(clip, Lb); setPart(s0, s0 + Lb); toast(`The best ${Lb.toFixed(1)}s of ${clip.name}`); } return; }
      const pl = e.target.closest('[data-plen]'); if (pl) { setPart(a, a + Number(pl.dataset.plen)); return; }
    }
    const p = e.target.closest('[data-cap]');
    if (p) {
      const P = { voice: { bass: -4, treble: 4, normalize: true }, bass: { bass: 8, treble: 1 }, soft: { vol: 0.6, fadeIn: 0.3, fadeOut: 0.3 }, reset: AUDIO_DEFAULTS }[p.dataset.cap];
      clip.audioFx = p.dataset.cap === 'reset' ? undefined : { ...audioOf(clip), ...P };
      if (!clip.audioFx || !hasAudioFx(clip)) delete clip.audioFx;
      onChange(clip); draw();
      toast(p.dataset.cap === 'reset' ? 'Clip audio back to normal' : `${p.textContent} on ${clip.name}`);
    }
  });
  // picture fades of this clip (from / to black where it comes on and goes off)
  function setPf(a, b) {
    a = Math.max(0, Math.min(3, Math.round((+a || 0) * 10) / 10)); b = Math.max(0, Math.min(3, Math.round((+b || 0) * 10) / 10));
    if (a || b) clip.vfade = { in: a, out: b }; else delete clip.vfade;
    onChange(clip);
  }
  box.addEventListener('change', (e) => {
    const f = e.target.closest('[data-pf]'); if (!f || !clip) return;
    const v = clip.vfade || { in: 0, out: 0 };
    setPf(f.dataset.pf === 'in' ? f.value : v.in, f.dataset.pf === 'out' ? f.value : v.out); draw();
  });
  function place() {
    if (embedded || !anchor || box.hidden) return;
    const r = anchor.getBoundingClientRect(), side = document.querySelector('.side')?.getBoundingClientRect();
    const w = box.offsetWidth || 360, left = side ? side.right + 10 : Math.min(innerWidth - w - 10, r.left);
    box.style.left = `${left}px`;
    box.style.top = `${Math.max(64, Math.min(innerHeight - box.offsetHeight - 10, r.top - 40))}px`;
  }
  function open(c, el) {
    if (!c) return;
    stopPlay();
    clip = c; anchor = el; box.hidden = false;
    draw(); place();
    requestAnimationFrame(() => { place(); drawWave(); fades?.draw(); });
  }
  function close() {
    stopPlay(); box.hidden = true; clip = null; anchor = null;
    if (embedded) { embedded = false; box.classList.remove('ca-embed'); document.body.appendChild(box); }
  }
  // the same controls inside a clip's preview (the part is picked there, so no part rows here)
  function embed(c, host) {
    if (!c || !host) return;
    stopPlay();
    clip = c; anchor = null; embedded = true; box.classList.add('ca-embed'); host.appendChild(box); box.hidden = false;
    draw(); requestAnimationFrame(() => fades?.draw());
  }
  document.addEventListener('pointerdown', (e) => { if (!embedded && !box.hidden && !box.contains(e.target) && !e.target.closest('.heat, .tr-audio')) close(); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden && !embedded) { close(); e.stopPropagation(); } }, true);
  addEventListener('resize', place);
  return { open, embed, close, isOpen: () => !box.hidden, clip: () => clip, refresh: () => { if (!box.hidden && clip) draw(); } };
}

// ---- export: the clip's chain (level + bass / treble) in an offline mix ----
export function clipChain(oac, clip, dest) {
  const a = audioOf(clip);
  let node = dest;
  if (a.treble) { const f = oac.createBiquadFilter(); f.type = 'highshelf'; f.frequency.value = 3200; f.gain.value = a.treble; f.connect(node); node = f; }
  if (a.bass) { const f = oac.createBiquadFilter(); f.type = 'lowshelf'; f.frequency.value = 180; f.gain.value = a.bass; f.connect(node); node = f; }
  return node;
}
// ---- preview: a playing video element's sound through the same chain ----
export function previewChain(ctx, el, clip) {
  const a = audioOf(clip);
  if (!el._ca) {
    try {
      const src = ctx.createMediaElementSource(el);
      const bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 180;
      const treble = ctx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 3200;
      const gain = ctx.createGain();
      src.connect(bass).connect(treble).connect(gain).connect(ctx.destination);
      el._ca = { bass, treble, gain };
    } catch { el._ca = { failed: true }; }
  }
  if (el._ca.failed) return false;
  el._ca.bass.gain.value = a.bass; el._ca.treble.gain.value = a.treble;
  return el._ca;
}
