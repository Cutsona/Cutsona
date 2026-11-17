// Safe zones: what TikTok, Instagram Reels and YouTube Shorts draw on top of a 9:16 video (their buttons,
// the name, the caption, the sound, the tabs). Shown over the previews as a look-alike of each app's screen,
// so you can see what your title and captions will sit under. Previews only, never exported.
// Each zone is [x, y, width, height] as a fraction of the frame. Every phone and app version differs a little,
// so the zones lean a bit generous.
export const SAFE_ZONES = {
  tiktok: {
    name: 'TikTok',
    zones: [[0, 0, 1, 0.085, 'Top tabs'], [0.84, 0.38, 0.16, 0.5, 'Buttons'], [0, 0.78, 1, 0.22, 'Name, caption, sound and tabs']],
  },
  reels: {
    name: 'Reels',
    zones: [[0, 0, 1, 0.08, 'Top bar'], [0.84, 0.5, 0.16, 0.42, 'Buttons'], [0, 0.79, 1, 0.21, 'Name, caption and tabs']],
  },
  shorts: {
    name: 'Shorts',
    zones: [[0, 0, 1, 0.07, 'Top bar'], [0.84, 0.46, 0.16, 0.47, 'Buttons'], [0, 0.76, 1, 0.24, 'Title, channel and tabs']],
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

// ---- the look-alike app screens (simple icons, made for this; sizes follow the preview's width) ----
const I = {
  heart: '<path d="M12 21s-7.6-4.7-9.6-9.3C.9 8.1 3.2 4.4 6.9 4.4c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.7 0 6 3.7 4.5 7.3C19.6 16.3 12 21 12 21z"/>',
  heartO: '<path fill="none" stroke="#fff" stroke-width="2" d="M12 20s-7.2-4.4-9-8.7C1.6 7.9 3.7 4.6 7 4.6c2 0 3.5 1.2 5 3 1.5-1.8 3-3 5-3 3.3 0 5.4 3.3 4 6.7C19.2 15.6 12 20 12 20z"/>',
  bubble: '<path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.6 1.4 4.9 3.6 6.5L5 21.5l4-2.1c1 .3 2 .4 3 .4 5.5 0 10-3.8 10-8.5S17.5 3 12 3z"/>',
  bubbleO: '<path fill="none" stroke="#fff" stroke-width="2" d="M12 3.5c-5.2 0-9.5 3.6-9.5 8 0 2.3 1.2 4.4 3.1 5.8L5 21l4.1-1.9c.9.3 1.9.4 2.9.4 5.2 0 9.5-3.6 9.5-8s-4.3-8-9.5-8z"/>',
  mark: '<path d="M6 2.8h12c.6 0 1 .4 1 1v17.4l-7-4.8-7 4.8V3.8c0-.6.4-1 1-1z"/>',
  repost: '<path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 9.5V8a3 3 0 0 1 3-3h11l-3-3M20 14.5V16a3 3 0 0 1-3 3H6l3 3"/>',
  dm: '<path fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" d="M21.5 3 2.8 9.6l7.4 3.3 3.3 7.4z"/><path fill="none" stroke="#fff" stroke-width="2" d="m10.2 12.9 4.6-4.6"/>',
  share: '<path d="M13.5 3.5 22 11.8l-8.5 8.4v-5.1c-6.4 0-9.8 1.8-12 6.2.8-6.5 4.3-11.6 12-12.3z"/>',
  send: '<path fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" d="M21.5 2.5 10.6 13.4M21.5 2.5 14.6 21l-4-7.6L3 9.4z"/>',
  dots: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>',
  vdots: '<circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="#fff" stroke-width="2.4"/><path stroke="#fff" stroke-width="2.6" stroke-linecap="round" d="m16 16 5 5"/>',
  up: '<path d="M2 10h4v11H2zM8 21h9.3c1 0 1.8-.7 2-1.6l1.5-7.1c.2-1.2-.7-2.3-1.9-2.3h-5.6l.9-4.2c.2-1.1-.6-2.3-1.8-2.3L8 10z"/>',
  down: '<path d="M22 14h-4V3h4zM16 3H6.7c-1 0-1.8.7-2 1.6l-1.5 7.1C3 12.9 3.9 14 5.1 14h5.6l-.9 4.2c-.2 1.1.6 2.3 1.8 2.3L16 14z"/>',
  remix: '<path fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6"/><path d="M18.5 2.5v5h-5zM5.5 21.5v-5h5z"/>',
  cam: '<path fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" d="M3 7.5h4l1.6-2.5h6.8L17 7.5h4V19H3z"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="#fff" stroke-width="2"/>',
  live: '<rect x="2.5" y="6" width="19" height="12" rx="3" fill="none" stroke="#fff" stroke-width="2"/><text x="12" y="15" font-size="7" font-weight="900" text-anchor="middle" fill="#fff" font-family="Arial">LIVE</text>',
  home: '<path d="M3 11 12 3.5 21 11v9.5h-6v-6H9v6H3z"/>',
  friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.8 2.9-6.5 6.5-6.5s6.5 2.7 6.5 6.5z"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 13.6c3 .2 5 2.5 5 5.9h-4.2"/>',
  inbox: '<path d="M3 5h18v14H3z" fill="none" stroke="#fff" stroke-width="2"/><path d="M3 13h5l1.5 2.5h5L16 13h5" fill="none" stroke="#fff" stroke-width="2"/>',
  user: '<circle cx="12" cy="8" r="4" fill="none" stroke="#fff" stroke-width="2"/><path d="M4 21c0-4.4 3.6-7.5 8-7.5s8 3.1 8 7.5" fill="none" stroke="#fff" stroke-width="2"/>',
  plusbox: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  reels: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="#fff" stroke-width="2"/><path d="M3 8.5h18M9 3l3 5.5M15 3l3 5.5" stroke="#fff" stroke-width="2"/><path d="M10 12v6l5-3z"/>',
  subs: '<rect x="3" y="6" width="18" height="14" rx="2.5" fill="none" stroke="#fff" stroke-width="2"/><path d="M6 3h12" stroke="#fff" stroke-width="2"/><path d="M10 10v6l5-3z"/>',
  tkbubble: '<path d="M12 3C6.5 3 2 6.6 2 11.2c0 2.7 1.6 5 4 6.5V21l3.4-2.1c.8.2 1.7.3 2.6.3 5.5 0 10-3.6 10-8S17.5 3 12 3z"/><circle cx="7.6" cy="11.2" r="1.3" fill="#000" opacity=".55"/><circle cx="12" cy="11.2" r="1.3" fill="#000" opacity=".55"/><circle cx="16.4" cy="11.2" r="1.3" fill="#000" opacity=".55"/>',
  tkshare: '<path d="M13 3.2 22.5 11 13 18.9v-4.7C7 14.2 3.6 16.3 1.5 20.8 2.4 14 6.4 9 13 8.1z"/>',
  note: '<path d="M9 17.5V5.2l11-2.2v12.2" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="6.5" cy="17.8" r="3"/><circle cx="17.5" cy="15.5" r="3"/>',
  mute: '<path d="M3 9.2h4l5-4.2v14l-5-4.2H3z"/><path d="m16 9.5 5 5m0-5-5 5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  notint: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="2.2"/><path d="m6 6 12 12" stroke="#fff" stroke-width="2.2"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  shorts: '<path d="M15.6 2.9c1.9-1 4.3-.3 5.3 1.6s.3 4.3-1.6 5.3l-1.6.9c1.4.1 2.7.9 3.4 2.2 1 1.9.3 4.3-1.6 5.3l-8.2 4.4c-1.9 1-4.3.3-5.3-1.6s-.3-4.3 1.6-5.3l1.6-.9c-1.4-.1-2.7-.9-3.4-2.2-1-1.9-.3-4.3 1.6-5.3z"/><path fill="#000" d="M10 9v6l5-3z"/>',
};
const svg = (k, cls = '') => `<svg class="sz-i ${cls}" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">${I[k]}</svg>`;
const rail = (items) => `<div class="szu-rail">${items.join('')}</div>`;
const btn = (icon, label, cls = '') => `<div class="szu-b ${cls}">${icon}${label != null ? `<span>${label}</span>` : ''}</div>`;
const nav = (items) => `<div class="szu-nav">${items.map(([k, l, on]) => `<div class="${on ? 'on' : ''} ${k === 'plus' ? 'plus' : ''}">${k === 'plus' ? '<i>+</i>' : svg(k)}${l ? `<span>${l}</span>` : ''}</div>`).join('')}</div>`;

// Late-2026 looks of each app's player screen:
// TikTok: LIVE / tabs / search on top, the round avatar with the red +, heart, comments, bookmark, share and the
//   spinning sound disc on the right, name + caption + sound at the bottom, Home / Friends / + / Inbox / Profile.
// Reels: "Reels" on top, outlined heart / comment / repost / send / more on the right, avatar + name + Follow,
//   caption and the audio chip at the bottom, and the floating glass tab bar (Home, Reels, Messages, Search, Profile).
// Shorts: mute + search + more on top, heart / not interested / comments / share / remix on the right, channel +
//   Subscribe, the title and the swipeable chip row (sound, related video) under it, Home / Shorts / + / You.
function tiktok() {
  return `<div class="szu tiktok">
    <div class="szu-top">${svg('live')}<div class="szu-tabs"><span>Explore</span><span>Following</span><b>For You</b></div>${svg('search')}</div>
    ${rail([
      `<div class="szu-av"><i></i><em>+</em></div>`,
      btn(svg('heart'), '733.4K'), btn(svg('tkbubble'), '4,182'), btn(svg('mark'), '51.2K'), btn(svg('tkshare'), '12.9K'),
      `<div class="szu-disc"><i></i></div>`])}
    <div class="szu-bottom"><b>yourname</b><p>your caption goes here and wraps onto a second line… <u>more</u></p><small>${svg('note', 'mini')} original sound - yourname</small></div>
    ${nav([['home', 'Home', 1], ['friends', 'Friends'], ['plus', ''], ['inbox', 'Inbox'], ['user', 'Profile']])}
  </div>`;
}
function reels() {
  return `<div class="szu reels">
    <div class="szu-top"><b class="szu-title">Reels <small>⌄</small></b><span class="szu-gap"></span>${svg('cam')}</div>
    ${rail([btn(svg('heartO'), '733K'), btn(svg('bubbleO'), '4,182'), btn(svg('repost'), '1,204'), btn(svg('send'), '12.9K'), btn(svg('dots'), null), `<div class="szu-sq"></div>`])}
    <div class="szu-bottom"><div class="szu-who"><i class="szu-av2"></i><b>yourname</b><span class="szu-pill">Follow</span></div><p>your caption goes here… <u>more</u></p><small class="szu-audio">${svg('note', 'mini')} yourname · Original audio</small></div>
    <div class="szu-glass">${['home', 'reels', 'send', 'search', 'user'].map((k, n) => `<div class="${n === 1 ? 'on' : ''}">${svg(k)}</div>`).join('')}</div>
  </div>`;
}
function shorts() {
  return `<div class="szu shorts">
    <div class="szu-top">${svg('mute')}<span class="szu-gap"></span>${svg('search')}${svg('vdots')}</div>
    ${rail([btn(svg('heart'), '733K'), btn(svg('notint'), null), btn(svg('bubble'), '4,182'), btn(svg('share'), 'Share'), btn(svg('remix'), 'Remix'), `<div class="szu-sq round"></div>`])}
    <div class="szu-bottom"><div class="szu-who"><i class="szu-av2"></i><b>@yourchannel</b><span class="szu-pill red">Subscribe</span></div><p class="szu-big">Your Short’s title shows here #shorts</p>
      <div class="szu-chips"><span>${svg('note', 'mini')} Original sound</span><span>${svg('play', 'mini')} Related video</span></div></div>
    ${nav([['home', 'Home'], ['shorts', 'Shorts', 1], ['plus', ''], ['user', 'You']])}
  </div>`;
}
const SCREENS = { tiktok, reels, shorts };

export function safeZoneHtml(platform) {
  const p = SAFE_ZONES[platform];
  if (!p) return '';
  // just the app's own screen on top of the take (no tinted boxes: they drew hard lines across the picture)
  return SCREENS[platform] ? SCREENS[platform]() : '';
}
