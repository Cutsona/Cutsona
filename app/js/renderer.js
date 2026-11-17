// WebGL2 renderer: draws one video frame with all effects into a canvas.
import { captionAt, captionOpts, drawCaptionCanvas } from './captions.js';
const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex, uTextTex, uCaptionTex, uHookTex, uLut;
uniform float uLutAmt;
uniform float uCaption, uHook, uHookScale;
uniform vec2 uHookAnchor;
uniform vec4 uGameFill;
uniform float uGameWhole, uOutside;
uniform vec2 uTexSize, uRes, uOffset, uTilt, uCrop, uBlur;
uniform vec4 uSourceRect, uCamRect, uGameRect;
uniform float uStack, uStackY;
uniform vec3 uTint, uDuoA, uDuoB;
uniform float uZoom, uRot, uCard, uFit, uRGB, uRadial, uGlitch, uFlash, uInvert, uBW, uContrast, uSat, uBright, uHue,
  uVignette, uGrain, uScan, uGlow, uMirror, uGhosts, uBars, uRound, uShadow, uWrap, uTime, uText, uTextScale, uHasTex,
  uPixel, uPoster, uFish, uWave, uCRT, uKaleido, uBleed, uEdge, uInk, uHalftone, uDuo, uSepia, uLeak, uFilm, uSplit, uFade, uFocus,
  uPixDisp, uPrint, uStars, uMosh, uTrack, uSharp,
  uDetail, uThermal, uSketch, uDither, uPrism, uSlice, uShock, uChroma;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }

vec2 sourceUV(vec2 uv){ return uSourceRect.xy + (1.0 - abs(mod(uv, 2.0) - 1.0)) * uSourceRect.zw; }
vec4 sourceLod(vec2 uv, float lod){ return textureLod(uTex, sourceUV(uv), lod); }
vec3 tex(vec2 uv){ return texture(uTex, sourceUV(uv)).rgb; }

vec3 fx(vec2 uv){
  // Slice glitch: thick horizontal slices of the picture slide sideways, re-cut 12 times a second
  if (uSlice > 0.001) {
    float t = floor(uTime * 12.0);
    float n = 6.0 + floor(hash(vec2(t, 3.1)) * 10.0);
    float row = floor(uv.y * n);
    float h = hash(vec2(row, t));
    uv.x += step(0.55, h) * (hash(vec2(row + 9.0, t)) - 0.5) * 0.22 * uSlice;
  }
  // Shockwave: a ring of warped picture rushing out from the middle (set by the beat)
  if (uShock > 0.001) {
    vec2 a = vec2(uTexSize.x / max(uTexSize.y, 1.0), 1.0);
    vec2 d = (uv - 0.5) * a;
    float r = length(d), front = (1.0 - uShock) * 0.95;
    float ring = exp(-pow((r - front) * 14.0, 2.0)) * uShock;
    uv -= (r > 1e-4 ? d / r : vec2(0.0)) / a * ring * 0.045;
  }
  if (uGlitch > 0.001) {
    float t = floor(uTime * 24.0);
    float row = floor(uv.y * 22.0);
    float h = hash(vec2(row, t));
    if (h < uGlitch * 0.45) uv.x += (hash(vec2(row + 3.0, t)) - 0.5) * 0.18 * uGlitch;
    float col = floor(uv.x * 9.0);
    if (hash(vec2(col, t + 7.0)) < uGlitch * 0.15) uv.y += (hash(vec2(col, t)) - 0.5) * 0.1 * uGlitch;
  }
  if (uBleed > 0.001) {
    float ln = floor(uv.y * 260.0);
    uv.x += (hash(vec2(ln, floor(uTime * 30.0))) - 0.5) * 0.004 * uBleed + sin(uv.y * 40.0 + uTime * 9.0) * 0.0015 * uBleed;
  }
  // PixDisplace: rows of pixels pushed sideways by their own brightness, always moving
  if (uPixDisp > 0.001) {
    float row = floor(uv.y * 120.0);
    float l = dot(sourceLod(vec2(uv.x, (row + 0.5) / 120.0), 3.0).rgb, vec3(0.299, 0.587, 0.114));
    float wob = sin(uTime * 2.3 + row * 0.37) * 0.6 + sin(uTime * 5.1 + row * 1.7) * 0.4;
    uv.x += (l - 0.45) * 0.09 * uPixDisp * wob;
    float blk = floor(uv.x * 60.0);
    uv.y += (hash(vec2(blk, floor(uTime * 10.0))) - 0.5) * 0.012 * uPixDisp * step(0.8, hash(vec2(row, blk + floor(uTime * 4.0))));
  }
  // Datamosh: macroblocks smear along fake motion vectors and refresh in waves
  if (uMosh > 0.001) {
    vec2 bc = vec2(40.0, 40.0 * uTexSize.y / max(uTexSize.x, 1.0));
    vec2 cell = floor(uv * bc);
    float tq = floor(uTime * 5.0);
    if (hash(cell * 0.73 + tq * 1.31) < uMosh * 0.6) {
      float age = fract(uTime * 5.0);
      vec2 mv = (vec2(hash(cell + tq * 2.1), hash(cell * 1.7 - tq)) - 0.5) * vec2(0.16, 0.08) * uMosh;
      uv = (cell + mix(fract(uv * bc), vec2(0.5), 0.75 * min(uMosh, 1.0))) / bc - mv * (0.4 + age);
    }
  }
  // VHS tracking: a noisy band rolls down the picture
  if (uTrack > 0.001) {
    float dy = uv.y - fract(uTime * 0.13); dy -= floor(dy + 0.5);
    float inBand = exp(-pow(dy * 18.0, 2.0));
    uv.x += (hash(vec2(floor(uv.y * 300.0), floor(uTime * 40.0))) - 0.5) * 0.06 * inBand * uTrack + sin(uv.y * 8.0 + uTime * 1.3) * 0.002 * uTrack;
  }
  vec3 c;
  if (uPrint > 0.001) {
    // PrintAnimate: ink plates slightly out of register, re-printed 8 times a second
    float fr = floor(uTime * 8.0);
    vec2 j1 = (vec2(hash(vec2(fr, 1.0)), hash(vec2(fr, 2.0))) - 0.5) * 0.007 * uPrint;
    vec2 j2 = (vec2(hash(vec2(fr, 3.0)), hash(vec2(fr, 4.0))) - 0.5) * 0.007 * uPrint;
    c = vec3(tex(uv + j1 + vec2(uRGB, 0.0)).r, tex(uv).g, tex(uv + j2 - vec2(uRGB, 0.0)).b);
  } else if (uPrism > 0.001) {
    // Prism: the picture split into red / green / blue copies that fan out from the middle
    vec2 d = (uv - 0.5) * 0.018 * uPrism, w = vec2(uRGB, 0.0);
    c = vec3(tex(uv + d + w).r, tex(uv).g, tex(uv - d - w).b);
    c = mix(c, (tex(uv + d * 2.0).rgb + tex(uv - d * 2.0).rgb) * 0.5, 0.12 * min(uPrism, 1.0));
  } else if (uRGB > 0.0005) {
    vec2 d = vec2(uRGB, uRGB * 0.35);
    c = vec3(tex(uv + d).r, tex(uv).g, tex(uv - d).b);
  } else c = tex(uv);
  if (uBleed > 0.001) {
    float b = min(uBleed, 1.0);
    c.r = mix(c.r, tex(uv + vec2(0.006 * uBleed, 0.0)).r, 0.55 * b);
    c.b = mix(c.b, tex(uv - vec2(0.004 * uBleed, 0.0)).b, 0.45 * b);
  }
  return c;
}

vec3 sampleFx(vec2 uv){
  float amt = length(uBlur) + uRadial;
  if (amt < 0.002) return fx(uv);
  vec3 acc = vec3(0.0);
  const int N = 12;
  for (int i = 0; i < N; i++) {
    float f = float(i) / float(N - 1) - 0.5;
    vec2 p = uv + uBlur * f;
    p = 0.5 + (p - 0.5) * (1.0 - uRadial * (f + 0.5) * 0.6);
    acc += fx(p);
  }
  return acc / float(N);
}

float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

void main(){
  float oa = uRes.x / uRes.y;
  float va = uTexSize.x / max(uTexSize.y, 1.0);
  vec2 suv = vUv;
  // CRT screen curvature
  float crtMask = 1.0;
  if (uCRT > 0.001) {
    vec2 cc = suv * 2.0 - 1.0;
    cc += cc * (cc.yx * cc.yx) * (uCRT * 0.22);
    vec2 e = smoothstep(vec2(1.0), vec2(0.985), abs(cc));
    crtMask = e.x * e.y;
    suv = cc * 0.5 + 0.5;
  }
  vec3 col;
  if (uStack > 0.5) {
    // card motion on a stream clip: the whole two-panel picture moves / turns / sizes as one card
    float cardIn = 1.0;
    if (abs(uCard - 1.0) > 0.0005 || abs(uOffset.x) + abs(uOffset.y) > 0.0005 || abs(uRot) > 0.0005) {
      vec2 cq = (suv - 0.5) * vec2(oa, 1.0) - uOffset;
      float cr = cos(-uRot), sr = sin(-uRot);
      cq = mat2(cr, sr, -sr, cr) * cq / max(uCard, 0.05);
      vec2 hs = vec2(oa, 1.0) * 0.5;
      float csd = sdBox(cq, hs, uCard < 0.999 ? 0.03 : 0.0);
      cardIn = clamp(0.5 - csd / (1.5 / uRes.y), 0.0, 1.0);
      suv = cq / vec2(oa, 1.0) + 0.5;
    }
    // stream clip: the streamer's cam on top, the gameplay below (two crops of the same video)
    float yy = 1.0 - suv.y;
    bool topP = yy < uStackY;
    vec4 R = topP ? uCamRect : uGameRect;
    float ly = topP ? yy / uStackY : (yy - uStackY) / max(1e-4, 1.0 - uStackY);
    vec2 sp = R.xy + vec2(suv.x, ly) * R.zw;
    // "whole screen": the full stream picture fits its panel; the space around it is a dimmed, blurred copy
    // uGameWhole: 1 = the bottom panel shows the whole screen, 2 = the top one (sides swapped)
    bool wholeHere = (uGameWhole > 0.5 && uGameWhole < 1.5 && !topP) || (uGameWhole > 1.5 && topP);
    if (sp.x < 0.0 || sp.x > 1.0 || sp.y < 0.0 || sp.y > 1.0) {
      // outside the picture: black bars, or (whole screen with "Blurred") a dimmed, blurred copy behind it.
      // Never a mirrored copy of the video.
      if (wholeHere && uOutside < 0.5) {
        vec2 q = uGameFill.xy + vec2(suv.x, ly) * uGameFill.zw;
        col = textureLod(uTex, sourceUV(q), 5.5).rgb * 0.45;
      } else col = vec3(0.0);
    } else col = sampleFx(sp);
    if (uHasTex < 0.5) col = vec3(0.04);
    col = mix(vec3(0.03), col, cardIn);
  } else {
  // pixelate
  if (uPixel > 0.0005) { vec2 cells = vec2(oa, 1.0) / uPixel; suv = (floor(suv * cells) + 0.5) / cells; }
  vec2 q = (suv - 0.5) * vec2(oa, 1.0);
  // fisheye bulge
  if (abs(uFish) > 0.001) { float r2 = dot(q, q); q *= (1.0 + uFish * r2 * 2.0) / (1.0 + uFish * 0.4); }
  // wavy warp
  if (uWave > 0.001) {
    q.x += uWave * 0.025 * sin(q.y * 14.0 + uTime * 5.0);
    q.y += uWave * 0.018 * sin(q.x * 11.0 + uTime * 4.0);
  }
  // kaleidoscope
  if (uKaleido > 1.5) {
    float r = length(q), a = atan(q.y, q.x) + uTime * 0.25, sg = 6.2831853 / uKaleido;
    a = mod(a, sg); a = abs(a - sg * 0.5);
    q = r * vec2(cos(a), sin(a));
  }
  if (uMirror > 1.5) q = abs(q) * vec2(-1.0, 1.0);
  else if (uMirror > 0.5) q.x = -abs(q.x);

  // card size (height units)
  float sCover = max(oa / va, 1.0), sContain = min(oa / va, 1.0);
  float s = mix(sCover, sContain, uFit);
  vec2 hsz = vec2(va * s, s) * 0.5 * uCard;
  // framing: manual crop slider, or auto-focus that keeps the tracked face/body in the middle
  vec2 center;
  if (uFocus > 0.5) {
    float zc = max(uZoom, 1.0);
    vec2 ex = vec2(max(hsz.x - oa * 0.5 / zc, 0.0), max(hsz.y - 0.5 / zc, 0.0));
    center = clamp(vec2((0.5 - uCrop.x) * 2.0 * hsz.x, (uCrop.y - 0.5) * 2.0 * hsz.y), -ex, ex);
  } else center = vec2((0.5 - uCrop.x) * 2.0 * max(hsz.x - oa * 0.5, 0.0), (uCrop.y - 0.5) * 2.0 * max(hsz.y - 0.5, 0.0));

  // 3D plane intersection
  vec2 qs = q - uOffset;
  float F = 2.2;
  mat3 R = rotY(uTilt.y) * rotX(uTilt.x);
  vec3 n = R * vec3(0.0, 0.0, 1.0);
  vec3 ro = vec3(0.0, 0.0, -F), rd = vec3(qs, F);
  float den = dot(rd, n);
  float tt = -dot(ro, n) / (abs(den) < 1e-5 ? 1e-5 : den);
  vec3 P = ro + rd * tt;
  vec2 lp = (transpose(R) * P).xy;
  float cr = cos(-uRot), sr = sin(-uRot);
  lp = mat2(cr, sr, -sr, cr) * lp;
  lp /= uZoom;
  bool front = tt > 0.0;

  vec2 rel = lp - center;
  vec2 uv = vec2(rel.x / (2.0 * hsz.x) + 0.5, 0.5 - rel.y / (2.0 * hsz.y));
  float px = 1.5 / uRes.y / uZoom;
  float sd = sdBox(rel, hsz, uRound);
  float inside = front ? clamp(0.5 - sd / px, 0.0, 1.0) : 0.0;
  if (uWrap > 0.5 && front) inside = 1.0;

  // background: blurred cover copy
  vec2 bq = q / 1.08;
  vec2 bh = vec2(va * sCover, sCover) * 0.5;
  vec2 buv = vec2(bq.x / (2.0 * bh.x) + 0.5, 0.5 - bq.y / (2.0 * bh.y));
  vec3 bg = (sourceLod(buv, 5.0).rgb * 0.6 + sourceLod(buv + vec2(0.01, 0.0), 6.0).rgb * 0.4) * 0.42;
  bg *= 1.0 - uShadow * 0.85 * exp(-max(sd, 0.0) * 18.0);
  if (uOutside > 0.5) bg = vec3(0.0); // black bars around the whole video

  // echo layers ("dimension" ghosts)
  if (uGhosts > 0.0 && inside < 1.0 && front) {
    for (int k = 1; k <= 2; k++) {
      float gs = 1.0 + 0.085 * float(k);
      vec2 gr = rel / gs;
      float gsd = sdBox(gr, hsz, uRound);
      if (gsd < 0.0) {
        vec2 guv = vec2(gr.x / (2.0 * hsz.x) + 0.5, 0.5 - gr.y / (2.0 * hsz.y));
        vec3 gc = sourceLod(guv, 1.5).rgb;
        bg = mix(bg, gc * vec3(0.75, 0.8, 1.15), 0.42 / float(k) * uGhosts);
        break;
      }
    }
  }

  col = bg;
  if (inside > 0.0) {
    vec3 fg = sampleFx(uv);
    // sharpen ("CC" look): unsharp mask against the 4 neighbouring source pixels
    if (uSharp > 0.001) {
      vec2 sp = 1.0 / max(uTexSize, vec2(1.0));
      vec3 nb = (sourceLod(uv + vec2(sp.x, 0.0), 0.0).rgb + sourceLod(uv - vec2(sp.x, 0.0), 0.0).rgb
        + sourceLod(uv + vec2(0.0, sp.y), 0.0).rgb + sourceLod(uv - vec2(0.0, sp.y), 0.0).rgb) * 0.25;
      fg = clamp(fg + (fg - nb) * uSharp * 1.6, 0.0, 1.0);
    }
    // Extreme detail: every texture pulled out. Local contrast against two blur sizes (fine + wide),
    // the way "clarity" / "structure" sliders work, then the tones pushed back so nothing clips
    if (uDetail > 0.001) {
      vec3 W = vec3(0.299, 0.587, 0.114);
      vec3 b1 = sourceLod(uv, 1.2).rgb, b2 = sourceLod(uv, 3.2).rgb;
      float lf = dot(fg, W), l1 = dot(b1, W), l2 = dot(b2, W);
      float dFine = lf - l1, dWide = l1 - l2;
      float gain = uDetail * (1.0 - 0.6 * abs(lf - 0.5) * 2.0);
      float nl = clamp(lf + dFine * 2.6 * gain + dWide * 1.5 * gain, 0.0, 1.0);
      fg = clamp(fg * (nl / max(lf, 0.02)), 0.0, 1.0);
      fg = mix(fg, fg * fg * (3.0 - 2.0 * fg), 0.35 * uDetail);
    }
    if (uSketch > 0.001) {
      // Pencil sketch: dark strokes where the picture changes, on paper
      vec2 px3 = 1.0 / max(uTexSize, vec2(1.0));
      vec3 W = vec3(0.299, 0.587, 0.114);
      float c0 = dot(sourceLod(uv, 0.0).rgb, W), cb = dot(sourceLod(uv, 2.5).rgb, W);
      float dodge = clamp(c0 / max(cb + 0.04, 0.05), 0.0, 1.0);
      float gx = dot(sourceLod(uv + vec2(px3.x * 1.5, 0.0), 0.0).rgb - sourceLod(uv - vec2(px3.x * 1.5, 0.0), 0.0).rgb, W);
      float gy = dot(sourceLod(uv + vec2(0.0, px3.y * 1.5), 0.0).rgb - sourceLod(uv - vec2(0.0, px3.y * 1.5), 0.0).rgb, W);
      float ln = 1.0 - clamp(length(vec2(gx, gy)) * 4.0, 0.0, 1.0);
      float hatch = 0.92 + 0.08 * sin((uv.x + uv.y) * uTexSize.y * 0.7);
      vec3 paper = vec3(0.97, 0.95, 0.9) * min(dodge, ln) * mix(1.0, hatch, 1.0 - dodge);
      fg = mix(fg, paper, uSketch);
    }
    if (uGlow > 0.0) { vec3 g = sourceLod(uv, 3.5).rgb; fg += max(g - 0.55, 0.0) * uGlow * 1.6; }
    if (uEdge > 0.001 || uInk > 0.001) {
      vec2 px2 = 1.5 / max(uTexSize, vec2(1.0));
      vec3 W = vec3(0.299, 0.587, 0.114);
      float lx = dot(sourceLod(uv + vec2(px2.x, 0.0), 0.5).rgb - sourceLod(uv - vec2(px2.x, 0.0), 0.5).rgb, W);
      float ly = dot(sourceLod(uv + vec2(0.0, px2.y), 0.5).rgb - sourceLod(uv - vec2(0.0, px2.y), 0.5).rgb, W);
      float e = clamp(length(vec2(lx, ly)) * 3.5, 0.0, 1.0);
      vec3 neon = 0.5 + 0.5 * cos(6.2831 * (uTime * 0.15 + uv.y * 0.5 + vec3(0.0, 0.33, 0.67)));
      fg = mix(fg, fg * 0.22 + neon * e * 1.8, uEdge);
      fg *= 1.0 - uInk * smoothstep(0.2, 0.55, e);
    }
    col = mix(bg, fg, inside);
  }
  if (uHasTex < 0.5) col = vec3(0.04);
  }

  // grade
  col = (col - 0.5) * uContrast + 0.5;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat) * uTint;
  if (abs(uHue) > 0.001) {
    float c = cos(uHue), s2 = sin(uHue);
    mat3 toY = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    mat3 toR = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    vec3 yiq = toY * col; yiq.yz = mat2(c, s2, -s2, c) * yiq.yz; col = toR * yiq;
  }
  float l2 = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(smoothstep(0.08, 0.92, l2)), uBW);
  // split toning (teal shadows, orange highlights)
  if (abs(uSplit) > 0.001) col *= mix(vec3(1.0), mix(vec3(0.82, 1.0, 1.14), vec3(1.14, 1.0, 0.84), smoothstep(0.15, 0.75, l2)), uSplit);
  if (uSepia > 0.001) {
    vec3 sp = vec3(dot(col, vec3(0.393, 0.769, 0.189)), dot(col, vec3(0.349, 0.686, 0.168)), dot(col, vec3(0.272, 0.534, 0.131)));
    col = mix(col, sp, uSepia);
  }
  if (uDuo > 0.001) col = mix(col, mix(uDuoA, uDuoB, smoothstep(0.05, 0.95, dot(col, vec3(0.299, 0.587, 0.114)))), uDuo);
  // Thermal camera: brightness mapped to a heat palette (black, purple, red, orange, yellow, white)
  if (uThermal > 0.001) {
    float h = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    vec3 th = h < 0.25 ? mix(vec3(0.02, 0.0, 0.08), vec3(0.35, 0.0, 0.55), h / 0.25)
      : h < 0.5 ? mix(vec3(0.35, 0.0, 0.55), vec3(0.9, 0.08, 0.2), (h - 0.25) / 0.25)
      : h < 0.75 ? mix(vec3(0.9, 0.08, 0.2), vec3(1.0, 0.62, 0.0), (h - 0.5) / 0.25)
      : mix(vec3(1.0, 0.62, 0.0), vec3(1.0, 1.0, 0.85), (h - 0.75) / 0.25);
    col = mix(col, th, uThermal);
  }
  // Chroma boost: colors pushed hard, skin and greys left alone
  if (uChroma > 0.001) {
    float lc = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 ch = col - lc;
    float satNow = length(ch);
    col = lc + ch * (1.0 + uChroma * 1.4 * smoothstep(0.02, 0.25, satNow));
  }
  if (uPoster > 1.5) col = floor(clamp(col, 0.0, 1.0) * uPoster + 0.5) / uPoster;
  // comic halftone dots
  if (uHalftone > 0.001) {
    float cs = uRes.y / 140.0;
    vec2 hp = mat2(0.7071, 0.7071, -0.7071, 0.7071) * (vUv * uRes) / cs;
    vec2 f = fract(hp) - 0.5;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float rad = 0.62 * sqrt(clamp(1.0 - lum, 0.0, 1.0));
    float m = smoothstep(rad + 0.06, rad - 0.06, length(f));
    col = mix(col, mix(col * 1.2 + 0.08, col * 0.15, m), uHalftone);
  }
  col = col * (1.0 + min(uBright, 0.0)) + max(uBright, 0.0);
  // 1-bit dither: ordered (Bayer) dots like an old Game Boy / Mac screen
  if (uDither > 0.001) {
    vec2 dp = floor(vUv * uRes / max(1.0, uRes.y / 360.0));
    int bi = int(mod(dp.y, 4.0)) * 4 + int(mod(dp.x, 4.0));
    float BAY[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    float bay = (BAY[bi] + 0.5) / 16.0;
    float lum = dot(clamp(col, 0.0, 1.0), vec3(0.299, 0.587, 0.114));
    vec3 ink = vec3(0.06, 0.07, 0.1), pap = vec3(0.86, 0.93, 0.8);
    col = mix(col, mix(ink, pap, step(bay, lum)), uDither);
  }
  // PrintAnimate: limited inks on paper, with a dot screen that shifts every printed frame
  if (uPrint > 0.001) {
    float fr = floor(uTime * 8.0);
    vec3 inked = floor(clamp(col, 0.0, 1.0) * 4.0 + 0.5) / 4.0;
    float cs = uRes.y / 110.0;
    vec2 hp = mat2(0.966, 0.259, -0.259, 0.966) * (vUv * uRes) / cs + vec2(hash(vec2(fr, 9.0)), hash(vec2(fr, 7.0))) * 0.5;
    float lum = dot(inked, vec3(0.299, 0.587, 0.114));
    float rr = 0.55 * sqrt(clamp(1.0 - lum, 0.0, 1.0));
    float dotm = smoothstep(rr + 0.05, rr - 0.05, length(fract(hp) - 0.5));
    float pg = hash(floor(vUv * uRes / 2.0) + fr * 3.7);
    vec3 pr = vec3(0.96, 0.93, 0.86) * mix(vec3(1.0), inked * 1.1, 0.85) * (1.0 - dotm * 0.2) * (0.94 + 0.06 * pg);
    col = mix(col, pr, clamp(uPrint, 0.0, 1.0));
  }
  // Stars: twinkling glints that pop on the bright parts of the picture
  if (uStars > 0.001) {
    vec2 sp = vUv * vec2(oa, 1.0) * 26.0;
    vec2 cid = floor(sp), f = fract(sp) - 0.5;
    float tq = floor(uTime * 1.5 + hash(cid) * 7.0);
    vec2 p = f - (vec2(hash(cid + tq), hash(cid * 1.9 + tq)) - 0.5) * 0.6;
    float d = length(p);
    float tw = 0.5 + 0.5 * sin(uTime * 6.0 + hash(cid) * 30.0);
    float rays = 0.0025 / (abs(p.x * p.y) + 0.0025) * exp(-d * 5.0) + exp(-d * 30.0) * 2.0;
    float on = step(0.55, hash(cid + tq * 3.3)) * smoothstep(0.42, 0.8, dot(col, vec3(0.299, 0.587, 0.114)));
    col += vec3(1.0, 0.97, 0.9) * rays * tw * on * uStars * 0.9;
  }
  // light leaks
  if (uLeak > 0.001) {
    vec2 a = vec2(oa, 1.0);
    vec2 p1 = vec2(0.15 + 0.25 * sin(uTime * 0.37), 0.25 + 0.2 * sin(uTime * 0.23));
    vec2 p2 = vec2(0.85 + 0.15 * sin(uTime * 0.29 + 2.0), 0.8 + 0.15 * cos(uTime * 0.31));
    vec3 lk = vec3(1.0, 0.45, 0.12) * exp(-length((vUv - p1) * a) * 3.0) + vec3(1.0, 0.2, 0.45) * exp(-length((vUv - p2) * a) * 3.5);
    col = 1.0 - (1.0 - clamp(col, 0.0, 1.0)) * (1.0 - clamp(lk * uLeak * 0.9, 0.0, 1.0));
  }
  // old film: scratches, dust, flicker
  if (uFilm > 0.001) {
    float fr = floor(uTime * 24.0);
    float sx = hash(vec2(fr, 1.3));
    float sc = step(0.55, hash(vec2(fr, 2.1))) * smoothstep(0.0025, 0.0, abs(vUv.x - sx));
    col = mix(col, vec3(0.85, 0.82, 0.75), sc * 0.45 * uFilm);
    float dust = step(0.9993, hash(floor(vUv * uRes / 3.0) + fr * 7.1));
    col = mix(col, vec3(0.05), dust * uFilm);
    col *= 1.0 - uFilm * 0.06 * hash(vec2(fr, 5.0));
  }
  // a film look (a 64x64x64 colour table, 8x8 tiles of blue slices)
  if (uLutAmt > 0.001) {
    vec3 cc = clamp(col, 0.0, 1.0);
    float lb = cc.b * 63.0, l0 = floor(lb), l1 = min(l0 + 1.0, 63.0);
    vec2 lrg = cc.rg * 63.0 + 0.5;
    vec3 la = texture(uLut, (vec2(mod(l0, 8.0), floor(l0 / 8.0)) * 64.0 + lrg) / 512.0).rgb;
    vec3 lc = texture(uLut, (vec2(mod(l1, 8.0), floor(l1 / 8.0)) * 64.0 + lrg) / 512.0).rgb;
    col = mix(col, mix(la, lc, lb - l0), uLutAmt);
  }
  col = mix(col, 1.0 - col, uInvert);
  col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
  vec2 vq = (vUv - 0.5) * vec2(oa, 1.0) / max(oa, 1.0);
  col *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(vq) * 1.25);
  if (uScan > 0.0) col *= 1.0 - uScan * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.6));
  if (uGrain > 0.0) col += (hash(vUv * uRes + fract(uTime * 13.7) * 91.0) - 0.5) * uGrain;
  if (abs(vUv.y - 0.5) > 0.5 - uBars) col = vec3(0.0);

  // hook text overlay
  if (uText > 0.0) {
    vec2 anchor = vec2(0.5, 0.8);
    vec2 tuv = (vUv - anchor) / uTextScale + anchor;
    vec4 t = texture(uTextTex, tuv);
    col = mix(col, t.rgb, t.a * uText);
  }
  // hook text: its own layer (your font, size and spot), timed, with a little pop on the beat
  if (uHook > 0.0) {
    vec2 huv = (vUv - uHookAnchor) / uHookScale + uHookAnchor;
    vec4 hk = texture(uHookTex, huv);
    col = mix(col, hk.rgb, hk.a * uHook);
  }
  if (uCaption > 0.5) {
    vec4 caption = texture(uCaptionTex, vUv);
    col = mix(col, caption.rgb, caption.a);
  }
  col *= crtMask * (1.0 - clamp(uFade, 0.0, 1.0));
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const EXTRA_UNIFORMS = [['uSharp', 'sharp'], ['uPixel', 'pixel'], ['uPoster', 'poster'], ['uFish', 'fish'], ['uWave', 'wave'], ['uCRT', 'crt'], ['uKaleido', 'kaleido'],
  ['uBleed', 'bleed'], ['uEdge', 'edge'], ['uInk', 'ink'], ['uHalftone', 'halftone'], ['uDuo', 'duo'], ['uSepia', 'sepia'], ['uLeak', 'leak'],
  ['uFilm', 'film'], ['uSplit', 'split'], ['uFade', 'fade'], ['uFocus', 'focus'],
  ['uPixDisp', 'pixdisp'], ['uPrint', 'print'], ['uStars', 'stars'], ['uMosh', 'mosh'], ['uTrack', 'track'],
  ['uDetail', 'detail'], ['uThermal', 'thermal'], ['uSketch', 'sketch'], ['uDither', 'dither'], ['uPrism', 'prism'], ['uSlice', 'slice'], ['uShock', 'shock'], ['uChroma', 'chroma']];

// film looks (open-source HaldCLUT film emulations, see server.js LUTS): fetched once, converted once, shared
const lutCache = new Map();
function lutData(name) {
  if (!lutCache.has(name)) {
    const p = (async () => {
      const img = new Image(); img.src = `/luts/${name}.png`; await img.decode();
      const W = img.naturalWidth, H = img.naturalHeight, L = Math.round(Math.cbrt(W)), N = L * L;
      if (L * L * L !== W || W !== H) throw new Error('not a HaldCLUT');
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const src = g.getImageData(0, 0, W, H).data, out = new Uint8Array(512 * 512 * 4);
      const at = (r, gg, b) => { const i = r + gg * N + b * N * N; return ((Math.floor(i / W)) * W + (i % W)) * 4; };
      for (let b = 0; b < 64; b++) for (let gg = 0; gg < 64; gg++) for (let r = 0; r < 64; r++) {
        const k = at(Math.round(r * (N - 1) / 63), Math.round(gg * (N - 1) / 63), Math.round(b * (N - 1) / 63));
        const o = (((Math.floor(b / 8)) * 64 + gg) * 512 + (b % 8) * 64 + r) * 4;
        out[o] = src[k]; out[o + 1] = src[k + 1]; out[o + 2] = src[k + 2]; out[o + 3] = 255;
      }
      return out;
    })();
    p.catch(() => lutCache.delete(name));
    lutCache.set(name, p);
  }
  return lutCache.get(name);
}
export class Renderer {
  constructor(canvas, { preview = false, onLutReady } = {}) {
    this.preview = preview;
    this.onLutReady = onLutReady;
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: !preview, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, preview ? FS.replace('const int N = 12;', 'const int N = 4;') : FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); this.loc[u.name] = gl.getUniformLocation(p, u.name); }
    gl.uniform1i(this.loc.uTex, 0);
    gl.uniform1i(this.loc.uTextTex, 1);
    gl.uniform1i(this.loc.uCaptionTex, 2);
    if (this.loc.uHookTex) gl.uniform1i(this.loc.uHookTex, 3);
    if (this.loc.uLut) gl.uniform1i(this.loc.uLut, 5);
    this.lutTex = this._makeTex(true); this.lutName = ''; this.lutReady = false;
    this.texCache = new Map();
    this.textTex = this._makeTex(false);
    this.textVersion = -1;
    this.hookTex = this._makeTex(false);
    this.hookVersion = -1;
    this.captionTex = this._makeTex(false);
    this.captionVersion = '';
    this.captionVisible = false;
    this.lastSource = null;
  }

  _makeTex(mip) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mip ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mip ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([10, 10, 12, 255]));
    return t;
  }

  // Upload the current frame of a <video> (returns false if nothing to show yet)
  upload(video) {
    const gl = this.gl;
    const w = video.videoWidth || video.naturalWidth || video.width, h = video.videoHeight || video.naturalHeight || video.height;
    if (!w || (video.readyState != null && video.readyState < 2)) return this.texCache.has(video);
    let e = this.texCache.get(video);
    if (!e) { e = { tex: this._makeTex(true), w: 0, h: 0 }; this.texCache.set(video, e); }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (e.w !== w || e.h !== h) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); e.w = w; e.h = h; }
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.generateMipmap(gl.TEXTURE_2D);
    return true;
  }

  setText(canvas, version) {
    if (version === this.textVersion) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (canvas) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    this.textVersion = version;
    this.hasText = !!canvas; // the overlay layer: stream banner / title box and your watermark
  }

  setHook(canvas, version) {
    if (version === this.hookVersion) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.hookTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (canvas) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    this.hookVersion = version;
    this.hasHook = !!canvas;
  }

  // film looks: a HaldCLUT picture (any size) turned into a 64³ table laid out as 8x8 tiles of 64x64 (512x512)
  setLut(name) {
    this.lutName = name; this.lutReady = false;
    if (!name) return;
    lutData(name).then((data) => {
      if (this.lutName !== name || !data) return;
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      this.lutReady = true; this.dirty = true;
      this.onLutReady?.();
    }).catch(() => {});
  }
  forget(video) {
    const e = this.texCache.get(video);
    if (e) { this.gl.deleteTexture(e.tex); this.texCache.delete(video); }
  }

  // show = false hides captions for this frame (Movie Edit: subtitles only on the opening line of dialogue)
  setCaption(clip, sourceTime, settings, show = true) {
    const o = captionOpts(settings.captionStyle), phrase = o.word ? 'word' : !!o.phrase;
    // captions in the language you picked (translated words) when there are, else the words as spoken
    const caption = show && settings.captions === 'on' ? captionAt(clip?.capWords || clip?.words, sourceTime, phrase) : null;
    this._drawCaption(caption, `${clip?.id || clip?.url}|${clip?.capLang || ''}|${phrase}`, settings);
  }
  setTimelineCaption(quick, time, settings) {
    const cue = settings.captions === 'on' && quick.captions.find((x) => time >= x.start && time < x.end);
    const caption = cue ? { index: cue.start, group: { words: cue.text.split(/\s+/).map((text) => ({ text })) } } : null;
    this._drawCaption(caption, cue?.text || '', { ...settings, captionY: settings.captionY ?? quick.captionY }, quick.captionScale);
  }
  _drawCaption(caption, identity, settings, scale = 1) {
    this.captionVisible = !!caption;
    if (!caption) return;
    const aspect = this.canvas.width / this.canvas.height;
    const key = `${identity}|${caption.index}|${settings.captionStyle}|${settings.captionFont}|${aspect}|${settings.captionY ?? ''}|${settings.captionX ?? ''}|${scale}`;
    if (key === this.captionVersion) return;
    const canvas = drawCaptionCanvas(caption, aspect, settings.captionStyle, settings.captionFont, settings.captionY ?? null, settings.captionX ?? null, scale);
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.captionTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.activeTexture(gl.TEXTURE0);
    this.captionVersion = key;
  }

  render(video, U, fresh = true) {
    const gl = this.gl, L = this.loc;
    const cw = this.canvas.width, ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    let has = false;
    if (video) has = fresh ? this.upload(video) : this.texCache.has(video);
    let e = video && this.texCache.get(video);
    if (!e && this.lastSource) { e = this.texCache.get(this.lastSource); }
    if (e) { has = true; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, e.tex); if (video && this.texCache.has(video)) this.lastSource = video; }
    const w = e ? e.w : 16, h = e ? e.h : 9;
    const rect = U.sourceRect || [0, 0, 1, 1];
    gl.uniform4f(L.uSourceRect, ...rect);
    // stream clip layout (cam on top / gameplay below)
    if (L.uStack) gl.uniform1f(L.uStack, U.stack ? 1 : 0);
    if (L.uStackY) gl.uniform1f(L.uStackY, U.stackY || 0.5);
    if (L.uCamRect) gl.uniform4f(L.uCamRect, ...(U.camRect || [0, 0, 1, 1]));
    if (L.uGameRect) gl.uniform4f(L.uGameRect, ...(U.gameRect || [0, 0, 1, 1]));
    gl.uniform2f(L.uTexSize, w * rect[2], h * rect[3]);
    gl.uniform2f(L.uRes, cw, ch);
    gl.uniform1f(L.uHasTex, has ? 1 : 0);
    gl.uniform2f(L.uOffset, U.offset[0], U.offset[1]);
    gl.uniform2f(L.uTilt, U.tilt[0], U.tilt[1]);
    gl.uniform2f(L.uCrop, U.crop[0], U.crop[1]);
    gl.uniform2f(L.uBlur, U.blur[0], U.blur[1]);
    gl.uniform3f(L.uTint, U.tint[0], U.tint[1], U.tint[2]);
    const f = (n, v) => L[n] && gl.uniform1f(L[n], v);
    f('uZoom', Math.max(0.05, U.zoom)); f('uRot', U.rot); f('uCard', U.card); f('uFit', U.fit); f('uRGB', U.rgb);
    f('uRadial', Math.min(0.9, U.radial)); f('uGlitch', U.glitch); f('uFlash', U.flash); f('uInvert', U.invert); f('uBW', Math.min(1, U.bw));
    f('uContrast', U.contrast); f('uSat', U.sat); f('uBright', U.bright); f('uHue', U.hue); f('uVignette', U.vignette);
    f('uGrain', U.grain); f('uScan', U.scan); f('uGlow', U.glow); f('uMirror', U.mirror); f('uGhosts', U.ghosts);
    f('uBars', U.bars); f('uRound', U.round); f('uShadow', U.shadow); f('uWrap', U.wrap); f('uTime', U.time);
    f('uText', this.hasText ? (U.text > 0 ? U.text : 1) : 0); f('uTextScale', U.textScale || 1);
    f('uHook', this.hasHook ? U.hook || 0 : 0); f('uHookScale', U.hookScale || 1);
    if (L.uHookAnchor) gl.uniform2f(L.uHookAnchor, ...(U.hookAnchor || [0.5, 0.8]));
    f('uGameWhole', U.gameWhole || 0); f('uOutside', U.outside || 0);
    if (L.uGameFill) gl.uniform4f(L.uGameFill, ...(U.gameFill || [0, 0, 1, 1]));
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.captionTex); gl.activeTexture(gl.TEXTURE0);
    f('uCaption', this.captionVisible ? 1 : 0);
    // the film look's colour table (loaded once, then kept)
    if (U.lut !== this.lutName) this.setLut(U.lut || '');
    f('uLutAmt', this.lutReady && U.lut ? (U.lutAmt ?? 1) : 0);
    if (this.lutReady) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.lutTex); gl.activeTexture(gl.TEXTURE0); }
    for (const k of EXTRA_UNIFORMS) f(k[0], U[k[1]] || 0);
    const da = U.duoA || [0, 0, 0], db = U.duoB || [1, 1, 1];
    if (L.uDuoA) gl.uniform3f(L.uDuoA, da[0], da[1], da[2]);
    if (L.uDuoB) gl.uniform3f(L.uDuoB, db[0], db[1], db[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// Hook text on its own layer: your font, size, color and position. Returns the canvas; canvas.box is the text's
// box (0..1, from the top left) so the text can be grabbed and dragged on the preview.
export function drawHookCanvas(text, aspect, { family = '"Arial Black", "Segoe UI Black", Impact, sans-serif', weight = 900, size = 1, color = 'white', x = 0.5, y = 0.2 } = {}) {
  const H = 1280, W = Math.round(H * aspect);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.box = null;
  const g = c.getContext('2d');
  if (!text || !text.trim()) return c;
  const maxW = W * 0.88;
  let px = Math.round(Math.min(W, H) * (aspect < 1 ? 0.085 : 0.075) * size);
  const font = (s) => `${weight} ${s}px ${family}`;
  const words = text.trim().split(/\s+/);
  let lines;
  for (;;) {
    g.font = font(px);
    lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    if ((lines.length <= 3 && Math.max(...lines.map((l) => g.measureText(l).width)) <= maxW) || px < 20) break;
    px = Math.round(px * 0.9);
  }
  const lh = px * 1.12, tw = Math.max(...lines.map((l) => g.measureText(l).width)), th = lines.length * lh;
  // keep the whole block on screen wherever it's dragged
  const cx = Math.min(W - tw / 2 - W * 0.02, Math.max(tw / 2 + W * 0.02, x * W));
  const cy = Math.min(H - th / 2 - H * 0.02, Math.max(th / 2 + H * 0.02, y * H));
  const y0 = cy - (lines.length - 1) * lh / 2;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const fill = color === 'yellow' ? '#ffe14d' : color === 'black' ? '#111111' : '#ffffff';
  lines.forEach((ln, i) => {
    const ly = y0 + i * lh;
    g.font = font(px);
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = px * 0.35; g.shadowOffsetY = px * 0.06;
    g.lineWidth = px * 0.2; g.strokeStyle = color === 'black' ? '#ffffff' : '#000000';
    g.strokeText(ln, cx, ly);
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.fillStyle = fill;
    g.fillText(ln, cx, ly);
  });
  c.box = [(cx - tw / 2) / W, (cy - th / 2) / H, (cx + tw / 2) / W, (cy + th / 2) / H];
  c.center = [cx / W, cy / H];
  return c;
}

// Hook text drawn into a canvas that matches the output aspect
export function drawTextCanvas(text, aspect, style = 'bold') {
  const H = 1280, W = Math.round(H * aspect);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!text || !text.trim()) return c;
  const maxW = W * 0.86;
  let size = Math.round(Math.min(W, H) * (aspect < 1 ? 0.085 : 0.075));
  const font = (s) => `900 ${s}px "Arial Black", "Segoe UI Black", Impact, system-ui, sans-serif`;
  const words = text.trim().split(/\s+/);
  let lines;
  for (;;) {
    g.font = font(size);
    lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length <= 3 || size < 30) break;
    size = Math.round(size * 0.88);
  }
  const lh = size * 1.12;
  const cy = H * 0.2;
  const y0 = cy - (lines.length - 1) * lh / 2;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  lines.forEach((ln, i) => {
    const y = y0 + i * lh;
    g.font = font(size);
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = size * 0.35; g.shadowOffsetY = size * 0.06;
    g.lineWidth = size * 0.2; g.strokeStyle = '#000';
    g.strokeText(ln, W / 2, y);
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.fillStyle = style === 'yellow' ? '#ffe14d' : '#ffffff';
    g.fillText(ln, W / 2, y);
  });
  return c;
}
