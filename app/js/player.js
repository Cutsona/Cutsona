// Live preview: plays the 4 edits in sync with one music clock, rendered in real time (no rendering step).
import { Renderer } from './renderer.js';
import { frameAt, srcRate, fadeGain } from './edit.js';
import { audioCtx } from './audio.js';
import { clipGainAt, hasAudioFx, audioOf, previewChain, clipSpan } from './clipaudio.js';
import { fadeAt } from './fadewave.js';
import { songChain } from './songedit.js';

const MAX_PER_VIEW = 4; // video decoders per edit (current shot, next shot + spares)
const FRAME_INTERVAL = 1000 / 30;

export class Player {
  constructor({ getState, getCtx, getEff, getText, getHook, getQuickAudio = () => null, poolEl, onTick }) {
    this.getState = getState; this.getCtx = getCtx; this.getEff = getEff; this.getText = getText; this.getHook = getHook;
    this.poolEl = poolEl;
    this.getQuickAudio = getQuickAudio;
    this.onTick = onTick;
    this.views = [];
    this.playing = false;
    this.t = 0;
    this.loop = true;
    this.musicNode = null;
    this.gain = null;
    this.resolutionScale = 1;
    this._lastPresent = 0; this._lastUI = 0;
    this._slowFrames = 0; this._fastFrames = 0;
    this._raf = this._raf.bind(this);
    requestAnimationFrame(this._raf);
  }

  attach(i, canvas) {
    this.views[i] = { canvas, renderer: new Renderer(canvas, { preview: true }), pool: new Map(), lastEl: null };
  }
  // a take was removed: stop its decoders, free its GL context, and shift the later views down
  detach(i) {
    const v = this.views[i];
    if (v) {
      for (const [k, el] of [...v.pool]) this._kill(v, k, el);
      try { v.renderer.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
    }
    this.views.splice(i, 1);
  }

  setViewSize(i, width, height) {
    const view = this.views[i]; if (!view) return;
    view.displaySize = [width, height];
    this._sizeView(view);
  }
  _sizeView(view) {
    if (!view.displaySize) return;
    const [width, height] = view.displaySize;
    const cap = this.getState().solo ? 960 : 640;
    const scale = Math.min(devicePixelRatio || 1, cap / Math.max(width, height)) * this.resolutionScale;
    const w = Math.max(2, Math.round(width * scale)), h = Math.max(2, Math.round(height * scale));
    if (view.canvas.width !== w || view.canvas.height !== h) { view.canvas.width = w; view.canvas.height = h; view.dirty = true; this._uiDirty = true; }
  }

  duration() {
    const s = this.getState();
    return Math.max(0.1, ...s.variants.map((v) => (v.plan ? v.plan.duration : 0)));
  }

  // ---- video element pool (capped, recycled least-recently-used) ----
  _el(view, clip, deck, keep) {
    const key = clip.id + ':' + deck;
    let el = view.pool.get(key);
    const url = clip.previewUrl || clip.url;
    if (el && (el._src !== url || el._dead)) { this._kill(view, key, el); el = null; }
    if (!el) {
      while (view.pool.size >= MAX_PER_VIEW && this._evict(view, keep));
      if (clip.still) {
        el = new Image();
        el.src = url; el._src = url;
        el.addEventListener('error', () => { el._dead = true; });
        view.pool.set(key, el);
        el._used = performance.now();
        return el;
      }
      el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
      el.preservesPitch = true; // speed ramps keep the voice at its normal pitch
      el.src = url; el._src = url;
      if (el.requestVideoFrameCallback) {
        const presented = (_, meta) => { el._frameVersion = meta.mediaTime; el._frameRequest = el.requestVideoFrameCallback(presented); };
        el._frameRequest = el.requestVideoFrameCallback(presented);
      }
      el.addEventListener('seeked', () => {
        el._up = -1;
        if (el._ss) { const lat = (performance.now() - el._ss) / 1000; el._lat = Math.min(0.5, el._lat ? el._lat * 0.7 + lat * 0.3 : lat); el._ss = 0; }
      });
      el.addEventListener('error', () => { el._dead = true; });
      this.poolEl.appendChild(el);
      view.pool.set(key, el);
    }
    el._used = performance.now();
    return el;
  }
  _kill(view, key, el) {
    if (el._frameRequest != null) el.cancelVideoFrameCallback?.(el._frameRequest);
    view.renderer.forget(el);
    try { el.pause(); el.removeAttribute('src'); el.load(); } catch {}
    el.remove();
    view.pool.delete(key);
  }
  _evict(view, keep) {
    let oldKey = null, old = null;
    for (const [k, e] of view.pool) if (!keep.includes(e) && (!old || e._used < old._used)) { old = e; oldKey = k; }
    if (!old) return false;
    this._kill(view, oldKey, old);
    return true;
  }

  dropClip(clipId) {
    for (const v of this.views) {
      if (!v) continue;
      for (const [k, el] of [...v.pool]) if (k.startsWith(clipId + ':')) this._kill(v, k, el);
    }
  }

  // ---- transport ----
  _startMusic() {
    this._stopMusic();
    const s = this.getState();
    const ctx = audioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    this.t0 = ctx.currentTime;
    this.tStart = this.t;
    const take = s.variants[s.focused], quick = take?.plan?.quick, audio = quick && this.getQuickAudio(take);
    const music = quick ? audio?.song : s.music?.buffer;
    const at = ctx.currentTime + 0.03;
    if (audio?.voice && this.t < audio.voice.duration) {
      const voice = ctx.createBufferSource();
      const gain = ctx.createGain(); gain.gain.value = audio.voiceGain ?? 1;
      voice.buffer = audio.voice; voice.connect(gain).connect(ctx.destination); voice.start(at, this.t);
      this.voiceNode = voice;
    }
    if (music) {
      const src = ctx.createBufferSource();
      src.buffer = music; src.loop = !!quick;
      const g = ctx.createGain();
      g.gain.value = this._musicTarget(this.t, s);
      this._gTarget = g.gain.value;
      src.connect(g).connect(songChain(ctx, s.settings, ctx.destination)); // the song's bass / treble (Music → Edit)
      src.start(at, quick ? this.t % music.duration : Math.max(0, s.musicStart + this.t));
      this.musicNode = src; this.gain = g;
    }
    if (this.voiceNode || this.musicNode) this.t0 = at;
  }
  _stopMusic() {
    if (this.musicNode) { try { this.musicNode.stop(); } catch {} this.musicNode.disconnect(); this.musicNode = null; this.gain = null; }
    if (this.voiceNode) { try { this.voiceNode.stop(); } catch {} this.voiceNode.disconnect(); this.voiceNode = null; }
  }
  // music volume incl. the song fade in / out of the edit you're listening to
  _musicTarget(t, s) {
    const plan = s.variants[s.focused] && s.variants[s.focused].plan;
    const e = this.getEff(s.focused);
    const D = plan ? plan.duration : this.duration();
    if (plan?.quick) {
      const speaking = plan.quick.captions.some((x) => t >= x.start && t < x.end);
      const vol = this.getQuickAudio(s.variants[s.focused])?.songGain ?? plan.quick.gain;
      return t < D ? vol * (speaking ? 0.45 : 1) * fadeGain(t, D, 1.5, 3) : 0;
    }
    if (plan?.noMusic) return 0; // stream clips: the stream's own sound only
    if (s.settings.musicMute === 'on') return 0;
    // the song's fades: where they start and end and their shape (set on the wave in Music → Edit)
    const f = { fadeIn: Number(e.musicFadeIn) || 0, fadeOut: Number(e.musicFadeOut) || 0, inAt: Number(e.musicFadeInAt) || 0, outAt: Number(e.musicFadeOutAt) || 0, curve: e.musicFadeCurve || 'linear' };
    return s.settings.musicVol * fadeAt(t, D, f) * duckAt(plan, t);
  }
  setMusicVolume() { this._gTarget = -1; }

  play() { if (this.playing) return; this.playing = true; if (this.t >= this.duration() - 0.05) this.t = 0; this._startMusic(); }
  pause() {
    if (!this.playing) return;
    this.t = this.now();
    this.playing = false;
    this._stopMusic();
    for (const v of this.views) if (v) for (const el of v.pool.values()) el.pause?.();
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  // nothing left to play (all clips removed): silence everything and rewind
  stop() {
    this.pause();
    this._stopMusic();
    this.t = 0;
    for (const v of this.views) if (v) for (const [k, el] of [...v.pool]) this._kill(v, k, el);
  }
  seek(t) {
    this.t = Math.max(0, Math.min(this.duration() - 0.02, t));
    if (this.playing) this._startMusic();
  }
  restartAudio() { if (this.playing) { this.t = this.now(); this._startMusic(); } }
  now() {
    if (!this.playing) return this.t;
    return this.tStart + Math.max(0, audioCtx().currentTime - this.t0);
  }

  _raf(now = performance.now()) {
    requestAnimationFrame(this._raf);
    if (document.hidden) return;
    const elapsed = now - this._lastPresent;
    if (elapsed < FRAME_INTERVAL - 1) return;
    this._lastPresent = now - Math.min(10, Math.max(0, elapsed - FRAME_INTERVAL));
    if (this.playing && elapsed < 250) {
      this._slowFrames = elapsed > 49 ? this._slowFrames + 1 : Math.max(0, this._slowFrames - 1);
      this._fastFrames = elapsed < 38 ? this._fastFrames + 1 : 0;
      let scale = this.resolutionScale;
      if (this._slowFrames >= 12) { scale = Math.max(0.45, scale * 0.8); this._slowFrames = 0; }
      if (this._fastFrames >= 150) { scale = Math.min(1, scale + 0.1); this._fastFrames = 0; }
      if (scale !== this.resolutionScale) { this.resolutionScale = scale; this.views.forEach(v => v && this._sizeView(v)); }
    }
    const s = this.getState();
    let t = this.now();
    const D = this.duration();
    if (this.playing && t >= D) {
      if (this.loop) { this.t = 0; this._startMusic(); t = 0; } else { this.pause(); this.t = D - 0.02; t = this.t; }
    }
    if (this.gain) {
      const g = this._musicTarget(t, s);
      if (Math.abs(g - this._gTarget) > 0.002) { this.gain.gain.setTargetAtTime(g, audioCtx().currentTime, 0.03); this._gTarget = g; }
    }
    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i];
      if (!view) continue;
      if (s.solo && i !== s.focused) { for (const el of view.pool.values()) if (el.paused === false) el.pause(); continue; }
      this._renderView(i, t, s, D);
    }
    const activePlan = s.variants[s.focused]?.plan;
    if (this.onTick && now - this._lastUI >= 100 && (this.playing || this._uiDirty || this._lastUITime !== t || this._lastUIPlan !== activePlan || this._lastUIFocus !== s.focused || this._lastUIDuration !== D)) {
      this._lastUI = now; this._lastUITime = t; this._lastUIPlan = activePlan; this._lastUIFocus = s.focused; this._lastUIDuration = D;
      this._uiDirty = false; this.onTick(t, D);
    }
  }

  _renderView(i, t, s, D) {
    const view = this.views[i];
    const variant = s.variants[i];
    const plan = variant && variant.plan;
    const tx = this.getText(i);
    view.renderer.setText(tx && tx.canvas, tx ? tx.key : '');
    const hk = this.getHook ? this.getHook(i) : null;
    view.renderer.setHook(hk && hk.canvas, hk ? hk.key : '');
    if (!plan?.segments.length || !s.clips.length) {
      // no clips: make sure no decoder keeps playing sound in the background
      for (const [k, el] of [...view.pool]) this._kill(view, k, el);
      if (!view.blank || view.dirty) { view.renderer.setCaption(null, 0, {}); view.renderer.render(null, { ...blankU }); view.blank = true; view.dirty = false; }
      return;
    }
    view.blank = false;
    const ctx = this.getCtx(i);
    const tt = Math.min(t, plan.duration - 0.001);
    const fr = frameAt(plan, tt, ctx);
    const clip = s.clips[fr.seg.clip];
    if (!clip || !clip.url) return;
    if (plan.quick) view.renderer.setTimelineCaption(plan.quick, tt, this.getEff(i));
    else view.renderer.setCaption(clip, fr.src, this.getEff(i), !plan.style.voiceCaptions || !!fr.seg.voice || plan.mode === 'quotes');
    const keep = [];
    const el = this._el(view, clip, fr.seg.deck, keep);
    keep.push(el);
    const now = performance.now();
    if (clip.still) {
      for (const other of view.pool.values()) if (other.paused === false) other.pause();
      const fresh = !view.renderer.texCache.has(el);
      if (view.dirty || fresh || view.lastTime !== tt || view.lastEl !== el || view.lastCtx !== ctx || view.lastText !== tx?.key) {
        view.renderer.render(el, fr.U, fresh);
        view.dirty = false;
      }
      view.lastEl = el; view.lastTime = tt; view.lastCtx = ctx; view.lastText = tx?.key;
      return;
    }
    el.loop = !!fr.seg.loop;

    // only the selected edit plays its clip sound (so you don't hear 4 at once)
    // "Best quote" edits always let you hear the line
    const clipVol = plan.quick ? 0 : plan.mode === 'quotes' || plan.mode === 'stream' || fr.seg.voice ? 1 : s.settings.clipVol;
    const wantMuted = !(s.focused === i && clipVol > 0.001 && this.playing);
    if (el.muted !== wantMuted) el.muted = wantMuted;
    if (!wantMuted) {
      // the clip's own audio settings (Clip audio panel): level, fades at the cut's ends, bass / treble
      const rb = clipSpan(plan, fr.seg.clip), k = clipGainAt(clip, tt - rb[0], rb[1] - rb[0]);
      const vol = clipVol * fadeGain(tt, plan.duration, ctx.fadeIn, ctx.fadeOut) * k;
      const a = audioOf(clip);
      if (el._ca || (hasAudioFx(clip) && (vol > 1 || a.bass || a.treble))) {
        const ch = previewChain(audioCtx(), el, clip);
        if (ch) { if (el.volume !== 1) el.volume = 1; ch.gain.gain.value = vol; }
        else if (Math.abs(el.volume - Math.min(1, vol)) > 0.01) el.volume = Math.min(1, vol);
      } else if (Math.abs(el.volume - Math.min(1, vol)) > 0.01) el.volume = Math.min(1, vol);
    }

    if (this.playing && t < plan.duration) {
      const stut = fr.seg.profile.type === 'stutter';
      let rate = Math.max(0.1, Math.min(4, srcRate(fr.seg, tt - fr.seg.start)));
      if (el.paused) {
        if (!el.seeking) {
          if (Math.abs(el.currentTime - fr.src) > 0.1) seekEl(el, fr.src + rate * (el._lat || 0.05));
          el.play().catch(() => {});
        }
      } else if (!el.seeking) {
        const drift = el.currentTime - fr.src;
        const changedShot = view.lastRun !== fr.seg.run || view.lastClip !== fr.seg.clip;
        if (Math.abs(drift) > (stut ? 0.06 : changedShot ? 0.25 : 0.65) && now - (el._lastSeek || 0) > (stut ? 60 : 1000)) {
          el._lastSeek = now;
          seekEl(el, fr.src + rate * Math.min(0.4, el._lat || 0.08));
        } else if (!stut) rate *= Math.max(0.85, Math.min(1.15, 1 - drift * 0.8));
        // stall guard: playing but the picture isn't moving -> kick it
        if (el.currentTime !== el._lastCT) { el._lastCT = el.currentTime; el._lastCTAt = now; }
        else if (now - (el._lastCTAt || now) > 1200 && now - (el._lastSeek || 0) > 1200) { el._lastCTAt = now; el._lastSeek = now; seekEl(el, fr.src); el.play().catch(() => {}); }
      }
      if (Math.abs(el.playbackRate - rate) > 0.02) el.playbackRate = rate;
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - fr.src) > 0.02) seekEl(el, fr.src);
    }
    // a decoder stuck seeking for ages -> throw it away and make a fresh one
    if (el.seeking && el._ss && now - el._ss > 2500) el._dead = true;

    // pre-roll the next shot (or the first shot when about to loop) so the cut is instant
    let next = plan.segments.slice(fr.si + 1).find(segment => segment.clip !== fr.seg.clip || segment.deck !== fr.seg.deck);
    if (!next && this.loop && plan.duration - tt < 1.5) next = plan.segments[0];
    let nextEl = null;
    if (next && s.clips[next.clip] && (next.start - tt < 1.2 || next.start < tt)) {
      nextEl = this._el(view, s.clips[next.clip], next.deck, keep);
      keep.push(nextEl);
      if (nextEl !== el && !s.clips[next.clip].still && !nextEl.seeking) {
        const off = Math.abs(nextEl.currentTime - next.srcStart) > 0.05;
        const soon = next.start - tt < 1.2 && next.start > tt;
        if (off || !nextEl.paused) { nextEl.pause(); seekEl(nextEl, next.srcStart); nextEl._touched = now; }
        else if (soon && now - (nextEl._touched || 0) > 4000) { seekEl(nextEl, next.srcStart); nextEl._touched = now; } // wake a sleeping decoder
      }
    }
    for (const other of view.pool.values()) if (other !== el && other !== nextEl && other.paused === false) other.pause();

    const token = el._frameVersion ?? el.getVideoPlaybackQuality?.().totalVideoFrames ?? el.currentTime;
    const fresh = view.lastEl !== el || el._up !== token || !view.renderer.texCache.has(el);
    const settings = this.getEff(i);
    if (this.playing || view.dirty || fresh || view.lastTime !== tt || view.lastCtx !== ctx || view.lastSettings !== settings || view.lastTrack !== clip.track || view.lastText !== tx?.key) {
      view.renderer.render(el, fr.U, fresh);
      if (!el.seeking && el.readyState >= 2) el._up = token;
      view.dirty = false;
    }
    view.lastEl = el;
    view.lastTime = tt; view.lastCtx = ctx; view.lastSettings = settings; view.lastTrack = clip.track; view.lastText = tx?.key;
    view.lastRun = fr.seg.run; view.lastClip = fr.seg.clip;
  }
}

// music dips under the spoken line in "Best quote" edits
export function duckAt(plan, t) {
  if (!plan || (plan.mode !== 'quotes' && !plan.voice)) return 1;
  const seg = plan.segments.find((s) => t >= s.start - 0.15 && t < s.end + 0.1);
  return seg && seg.speech && (plan.mode === 'quotes' || seg.voice) ? 0.28 : 1;
}

function seekEl(el, t) {
  el._ss = performance.now();
  el.currentTime = Math.max(0, Math.min(Number.isFinite(el.duration) ? Math.max(0, el.duration - 0.02) : Infinity, t));
}

const blankU = { zoom: 1, offset: [0, 0], rot: 0, tilt: [0, 0], card: 1, fit: 0, crop: [0.5, 0.5], rgb: 0, blur: [0, 0], radial: 0,
  glitch: 0, flash: 0, invert: 0, bw: 0, contrast: 1, sat: 1, bright: 0, tint: [1, 1, 1], hue: 0, vignette: 0, grain: 0,
  scan: 0, glow: 0, mirror: 0, ghosts: 0, bars: 0, round: 0, shadow: 0, wrap: 0, text: 0, textScale: 1, time: 0 };
