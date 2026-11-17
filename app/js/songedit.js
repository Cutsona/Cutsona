// The song's Edit panel (Music → Edit): how it sounds (volume, mute, bass, treble, fades) and which part of it
// plays: where it starts (best part, a drop, on the beat) and how long the edit runs (any length, a whole
// musical phrase, or up to the next drop).
import { audioCtx } from './audio.js';
import { fadeWave, bufferPeak, fadeFieldsHtml, fadeFromField, fadeParam } from './fadewave.js';
// the song's fade settings, by fade key
const FK = { fadeIn: 'musicFadeIn', fadeOut: 'musicFadeOut', inAt: 'musicFadeInAt', outAt: 'musicFadeOutAt', curve: 'musicFadeCurve' };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtT = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const parseT = (v) => { const p = String(v).trim().split(':').map(Number); return p.some((x) => !Number.isFinite(x)) ? NaN : p.reduce((a, x) => a * 60 + x, 0); };

export function createSongEditor({ state, toast, esc, suggestWindow, currentLength, setLength, onStart, onSound, saveSettings }) {
  const box = document.createElement('div');
  box.className = 'ca-pop se-pop'; box.hidden = true;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Edit the song');
  document.body.appendChild(box);
  let src = null, anchor = null, fades = null;
  const S = () => state.settings;
  const A = () => state.music?.analysis;
  const beatsAll = () => (A()?.beats || []);
  const period = () => 60 / (A()?.bpm || 120);
  const snapOn = () => S().musicSnap !== 'off';
  const snapBeat = (t) => {
    const list = beatsAll().filter((b) => b.down);
    let best = t, bd = Infinity;
    for (const b of list) { const d = Math.abs(b.t - t); if (d < bd) { bd = d; best = b.t; } }
    return bd < period() * 2.5 ? best : t;
  };
  function setStart(t, why) {
    const a = A(); if (!a) return;
    const L = currentLength();
    let s = clamp(t, 0, Math.max(0, a.duration - L));
    if (snapOn()) s = clamp(snapBeat(s), 0, Math.max(0, a.duration - L));
    state.musicStart = s;
    onStart(); draw();
    if (why) toast(`Song starts at ${fmtT(s)}: ${why}`);
  }
  const fadeOf = () => { const s = S(); return { fadeIn: Number(s.musicFadeIn) || 0, fadeOut: Number(s.musicFadeOut) || 0, inAt: Number(s.musicFadeInAt) || 0, outAt: Number(s.musicFadeOutAt) || 0, curve: s.musicFadeCurve || 'linear' }; };
  const refreshFields = () => { const el = box.querySelector('.fw-fields'); if (el) el.innerHTML = fadeFieldsHtml(fadeOf(), currentLength()); };
  const drops = () => (A()?.impacts || []).filter((x) => x.drop).map((x) => x.t);
  const row = (k, label, min, max, step, val, fmt) => `<label class="ca-row"><span>${label}</span><input type="range" data-se="${k}" min="${min}" max="${max}" step="${step}" value="${val}"><b data-sev="${k}">${fmt(val)}</b></label>`;
  const pct = (v) => `${Math.round(v * 100)}%`, db = (v) => `${v > 0 ? '+' : ''}${v} dB`, sec = (v) => (Number(v) ? `${Number(v).toFixed(1)}s` : 'off');
  const FMT = { musicVol: pct, musicBass: db, musicTreble: db, musicFadeIn: sec, musicFadeOut: sec };

  function draw() {
    const s = S(), a = A();
    if (!a) { close(); return; }
    const L = currentLength(), muted = s.musicMute === 'on';
    const dropList = drops(), nextDrop = dropList.find((t) => t > state.musicStart + 0.5);
    box.innerHTML = `<div class="ca-h"><b>Song</b><span title="${esc(state.music.name)}">${esc(state.music.name.replace(/\.[^.]+$/, ''))}</span><button class="small ca-reset" title="Song sound back to normal: volume, bass, treble, mute and fades">Reset</button><button class="ca-x" aria-label="Close">×</button></div>
      <canvas class="ca-wave se-wave" title="Click to start the song there"></canvas>
      <div class="se-sec"><b>Which part plays</b>
        <div class="se-start"><label>Starts at <input type="text" class="se-in" value="${fmtT(state.musicStart)}" spellcheck="false"></label>
          <button class="small" data-beat="-1" title="One bar earlier">‹ bar</button><button class="small" data-beat="1" title="One bar later">bar ›</button>
          <button class="small se-play" title="Play this part">${src ? '■ Stop' : '▶ Play'}</button></div>
        <div class="se-quick">
          <button class="small" data-st="best" title="The part with the most energy, for this length">Best part</button>
          <button class="small" data-st="drop" ${dropList.length ? '' : 'disabled'} title="${dropList.length ? 'Start right on the first big drop' : 'No drops found in this song'}">First drop</button>
          <button class="small" data-st="before" ${dropList.length ? '' : 'disabled'} title="Start a few bars before the drop, so the drop hits inside the edit">Build-up to drop</button>
          <button class="small" data-st="zero">Song start</button></div>
        <label class="fd-check"><input type="checkbox" class="se-snap" ${snapOn() ? 'checked' : ''}> Start on a bar (on the beat)</label>
      </div>
      <div class="se-sec"><b>How long the edit runs <em>${L}s now</em></b>
        <div class="se-len"><input type="number" class="se-l" min="3" max="${Math.floor(a.duration)}" step="1" value="${L}"><span>s</span>
          ${[7, 10, 15, 20, 30, 45, 60].map((x) => `<button class="chip${Math.abs(L - x) < 0.5 ? ' on' : ''}" data-len="${x}">${x}s</button>`).join('')}</div>
        <div class="se-quick">
          <button class="small" data-lenmode="phrase" title="Round the length to whole 8-beat phrases, so the edit ends where the music does">Whole phrases (${Math.max(1, Math.round(L / (period() * 8)))} × 8 beats)</button>
          <button class="small" data-lenmode="drop" ${nextDrop ? '' : 'disabled'} title="End just as the next drop hits">Until the next drop${nextDrop ? ` (${Math.round(nextDrop - state.musicStart)}s)` : ''}</button>
          <button class="small" data-lenmode="rest" title="Run to the end of the song">To the song’s end</button></div>
      </div>
      <div class="se-sec"><b>Sound</b>
        <div class="ca-toggles"><button class="ca-t ${muted ? 'on' : ''}" data-se-mute>${muted ? 'Muted' : 'Mute song'}</button></div>
        ${row('musicVol', 'Volume', 0, 1.5, 0.05, Number(s.musicVol) || 0, pct)}
        ${row('musicBass', 'Bass', -12, 12, 1, Number(s.musicBass) || 0, db)}
        ${row('musicTreble', 'Treble', -12, 12, 1, Number(s.musicTreble) || 0, db)}
      </div>
      <div class="se-sec"><b>Fades <em>drag the handles on the wave</em></b>
        <canvas class="ca-wave fw-wave se-fades"></canvas>
        <div class="fw-fields">${fadeFieldsHtml(fadeOf(), L)}</div>
      </div>`;
    drawWave();
    // the edit's part of the song, with its fade in / fade out handles
    const fcv = box.querySelector('.se-fades');
    fades = fadeWave(fcv, {
      span: () => currentLength(), max: 5, muted: () => S().musicMute === 'on',
      peak: (t0, t1) => {
        const b = state.music?.buffer;
        if (b) return bufferPeak(b, state.musicStart, t0, t1) * 1.15;
        const w = A()?.wave, d = A()?.duration || 1; if (!w) return 0.3;
        return w[Math.floor(((state.musicStart + t0) / d) * w.length)] || 0;
      },
      get: fadeOf,
      set: (k, v) => { S()[FK[k]] = v; onSound(FK[k]); },
      onDone: () => { saveSettings(); refreshFields(); },
    });
    fades.draw();
  }
  function drawWave() {
    const cv = box.querySelector('.se-wave'), a = A(); if (!cv || !a) return;
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    cv.width = Math.max(10, Math.round(r.width * dpr)); cv.height = Math.max(10, Math.round(r.height * dpr));
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, L = currentLength();
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--tape').trim() || '#ffc933';
    const x0 = (state.musicStart / a.duration) * W, x1 = ((state.musicStart + L) / a.duration) * W;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x0, 0, x1 - x0, H);
    for (let x = 0; x < W; x += 2) {
      const v = a.wave ? a.wave[Math.floor((x / W) * a.wave.length)] || 0 : 0.3, inWin = x >= x0 && x <= x1;
      g.fillStyle = inWin ? acc : 'rgba(168,165,157,0.4)';
      const h = Math.max(1, v * H * 0.85); g.fillRect(x, (H - h) / 2, 1.3 * dpr, h);
    }
    g.fillStyle = '#ff6ad5';
    for (const t of drops()) g.fillRect((t / a.duration) * W, 0, 1.5 * dpr, H);
    g.strokeStyle = acc; g.lineWidth = 1.5 * dpr; g.strokeRect(x0 + 1, 1, Math.max(2, x1 - x0 - 2), H - 2);
  }
  function stopPlay() { if (src) { try { src.stop(); } catch {} src = null; } }
  function play() {
    if (src) { stopPlay(); draw(); return; }
    const b = state.music?.buffer; if (!b) return;
    const ctx = audioCtx(); if (ctx.state === 'suspended') ctx.resume();
    src = ctx.createBufferSource(); src.buffer = b;
    const g = ctx.createGain(), vol = S().musicMute === 'on' ? 0 : Number(S().musicVol) || 0, L = currentLength(), now = ctx.currentTime;
    // play it with its fades and bass / treble, the way the edit will sound
    fadeParam(g.gain, vol, now, L, fadeOf());
    g.connect(ctx.destination);
    src.connect(songChain(ctx, S(), g));
    src.start(0, state.musicStart, L);
    src.onended = () => { src = null; if (!box.hidden) draw(); };
    draw();
  }
  box.addEventListener('input', (e) => {
    const el = e.target.closest('[data-se]'); if (!el) return;
    S()[el.dataset.se] = Number(el.value);
    box.querySelector(`[data-sev="${el.dataset.se}"]`).textContent = FMT[el.dataset.se](Number(el.value));
    saveSettings(); onSound(el.dataset.se);
  });
  box.addEventListener('change', (e) => {
    if (e.target.matches('[data-ft]')) {
      const ch = fadeFromField(fadeOf(), currentLength(), e.target.dataset.ft, e.target.value);
      for (const [k, v] of Object.entries(ch)) { S()[FK[k]] = v; onSound(FK[k]); }
      saveSettings(); fades?.draw(); refreshFields(); return;
    }
    if (e.target.matches('.se-in')) { const t = parseT(e.target.value); if (Number.isFinite(t)) setStart(t); else draw(); }
    else if (e.target.matches('.se-l')) { const L = Math.round(Number(e.target.value)); if (L >= 3) { setLength(L); draw(); } }
    else if (e.target.matches('.se-snap')) { S().musicSnap = e.target.checked ? 'on' : 'off'; saveSettings(); if (e.target.checked) setStart(state.musicStart); }
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
  box.addEventListener('click', (e) => {
    const a = A(); if (!a) return;
    if (e.target.closest('.ca-x')) return close();
    if (e.target.closest('.se-play')) return play();
    if (e.target.closest('.ca-reset')) {
      Object.assign(S(), { musicVol: 0.9, musicBass: 0, musicTreble: 0, musicMute: 'off', musicFadeIn: 0, musicFadeOut: 1, musicFadeInAt: 0, musicFadeOutAt: 0, musicFadeCurve: 'linear' });
      saveSettings(); onSound('musicVol'); onSound('musicBass'); draw(); toast('Song sound back to normal'); return;
    }
    const fc = e.target.closest('[data-fcurve]');
    if (fc) { S().musicFadeCurve = fc.dataset.fcurve; saveSettings(); onSound('musicFadeCurve'); fades?.draw(); refreshFields(); return; }
    if (e.target.closest('[data-se-mute]')) { S().musicMute = S().musicMute === 'on' ? 'off' : 'on'; saveSettings(); onSound('musicMute'); draw(); return; }
    const bt = e.target.closest('[data-beat]');
    if (bt) { const was = snapOn(); S().musicSnap = 'off'; setStart(state.musicStart + Number(bt.dataset.beat) * period() * 4); S().musicSnap = was ? 'on' : 'off'; return; }
    const st = e.target.closest('[data-st]');
    if (st) {
      const d = drops(), k = st.dataset.st;
      if (k === 'best') setStart(suggestWindow(a, currentLength()), 'the best part for this length');
      else if (k === 'drop' && d.length) setStart(d[0], 'right on the first drop');
      else if (k === 'before' && d.length) setStart(Math.max(0, d[0] - period() * 8), 'two bars of build-up, then the drop');
      else if (k === 'zero') setStart(0);
      return;
    }
    const ln = e.target.closest('[data-len]');
    if (ln) { setLength(Number(ln.dataset.len)); draw(); return; }
    const lm = e.target.closest('[data-lenmode]');
    if (lm) {
      const L = currentLength(), P8 = period() * 8;
      let n = L;
      if (lm.dataset.lenmode === 'phrase') n = Math.max(P8, Math.round(L / P8) * P8);
      else if (lm.dataset.lenmode === 'drop') { const nd = drops().find((t) => t > state.musicStart + 0.5); if (nd) n = nd - state.musicStart + 0.1; }
      else if (lm.dataset.lenmode === 'rest') n = a.duration - state.musicStart;
      setLength(clamp(Math.round(n * 10) / 10, 3, Math.floor(a.duration)));
      draw();
    }
  });
  box.addEventListener('pointerdown', (e) => {
    const cv = e.target.closest('.se-wave'); if (!cv || !A()) return;
    const r = cv.getBoundingClientRect();
    setStart(((e.clientX - r.left) / r.width) * A().duration);
  });
  function place() {
    if (!anchor || box.hidden) return;
    const r = anchor.getBoundingClientRect(), side = document.querySelector('.side')?.getBoundingClientRect();
    box.style.left = `${side ? side.right + 10 : r.left}px`;
    box.style.top = `${Math.max(64, Math.min(innerHeight - box.offsetHeight - 10, r.top - 20))}px`;
  }
  function open(el) { if (!state.music) return toast('Choose a song first'); anchor = el; box.hidden = false; draw(); place(); requestAnimationFrame(() => { place(); drawWave(); fades?.draw(); }); }
  function close() { stopPlay(); box.hidden = true; anchor = null; }
  document.addEventListener('pointerdown', (e) => { if (!box.hidden && !box.contains(e.target) && !e.target.closest('#btnEditMusic')) close(); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) { close(); e.stopPropagation(); } }, true);
  addEventListener('resize', place);
  return { open, close, refresh: () => { if (!box.hidden) draw(); }, isOpen: () => !box.hidden };
}

// the song's bass / treble in an audio chain (preview and export): returns the node to connect the song into
export function songChain(ctx, settings, dest) {
  let node = dest;
  const t = Number(settings.musicTreble) || 0, b = Number(settings.musicBass) || 0;
  if (t) { const f = ctx.createBiquadFilter(); f.type = 'highshelf'; f.frequency.value = 3200; f.gain.value = t; f.connect(node); node = f; }
  if (b) { const f = ctx.createBiquadFilter(); f.type = 'lowshelf'; f.frequency.value = 160; f.gain.value = b; f.connect(node); node = f; }
  return node;
}
