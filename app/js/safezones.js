// Safe zones: where TikTok, Instagram Reels and YouTube Shorts put their own buttons, names and captions on top
// of a 9:16 video, so titles and captions can stay clear of them. Shown over the previews only, never exported.
// Each zone is [x, y, width, height] as a fraction of the frame. Approximate: every phone and app version
// differs a little, so the zones lean a bit generous.
export const SAFE_ZONES = {
  tiktok: {
    name: 'TikTok',
    zones: [[0, 0, 1, 0.075, 'Top tabs'], [0.86, 0.36, 0.14, 0.44, 'Buttons'], [0, 0.8, 1, 0.2, 'Name, caption and sound']],
  },
  reels: {
    name: 'Reels',
    zones: [[0, 0, 1, 0.09, 'Top bar'], [0.86, 0.44, 0.14, 0.38, 'Buttons'], [0, 0.8, 1, 0.2, 'Name and caption']],
  },
  shorts: {
    name: 'Shorts',
    zones: [[0, 0, 1, 0.07, 'Top bar'], [0.85, 0.42, 0.15, 0.4, 'Buttons'], [0, 0.79, 1, 0.21, 'Title and channel']],
  },
};

// the zones only mean something on a tall video (9:16 and close to it)
export const fitsSafeZones = (aspect) => aspect > 0.45 && aspect < 0.7;

// how much of a box [x, y, w, h] (fractions) lies under a platform's zones, 0..1
export function coveredShare(platform, box) {
  const p = SAFE_ZONES[platform];
  if (!p || !box) return 0;
  const [bx, by, bw, bh] = box, area = bw * bh;
  if (area <= 0) return 0;
  let hit = 0;
  for (const [x, y, w, h] of p.zones) {
    const ix = Math.max(0, Math.min(bx + bw, x + w) - Math.max(bx, x)), iy = Math.max(0, Math.min(by + bh, y + h) - Math.max(by, y));
    hit += ix * iy;
  }
  return Math.min(1, hit / area);
}

export function safeZoneHtml(platform) {
  const p = SAFE_ZONES[platform];
  if (!p) return '';
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  return p.zones.map(([x, y, w, h, label]) => `<div class="sz${w < 0.25 ? ' tall' : ''}" style="left:${pct(x)};top:${pct(y)};width:${pct(w)};height:${pct(h)}"><span>${label}</span></div>`).join('')
    + `<b class="sz-tag">${p.name} safe zones</b>`;
}
