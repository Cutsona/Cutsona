// The viral searcher: hooks, reactions and quotable lines score high; intros, promos, dead air and black screens low.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreWords, analyzeViral, takeVirality } from '../app/js/viral.js';

const words = (t0, text, wps = 3) => text.split(' ').map((w, i) => ({ start: t0 + i / wps, end: t0 + (i + 0.9) / wps, text: w }));
// a 90 s video: an intro with a promo, a calm stretch, then a hook, a big reaction and a payoff
function fakeScan() {
  const D = 90, n = D / 0.25;
  const loud = [], burst = [], bright = [], motion = [];
  for (let i = 0; i < n; i++) {
    const t = i * 0.25, hot = t >= 50 && t < 70;
    loud.push(t < 30 ? 0.3 : hot ? 0.8 : 0.25); burst.push(t > 58 && t < 60 ? 0.9 : 0.05); bright.push(hot ? 0.6 : 0.2); motion.push(hot ? 0.7 : 0.15);
  }
  const w = [
    ...words(1, 'Hey guys welcome back to the channel, make sure you subscribe and hit the notification bell.'),
    ...words(12, 'So today I went to the store and bought some bread and then I went home.'),
    ...words(30, 'It was a normal day and the weather was fine and nothing much happened.'),
    ...words(50, 'You won’t believe what happened next, this is insane.'),
    ...words(55, 'He bet me ten thousand dollars I couldn’t do it, no way!'),
    ...words(59, '[laughter] Oh my god, I actually won the money!'),
    ...words(64, 'That’s the best day of my life, honestly.'),
  ];
  return { v: 2, step: 0.25, duration: D, loud, burst, bright, motion, cuts: [52, 54, 57, 60, 62, 66], dark: [[80, 84]], words: w, heatmap: [] };
}

test('viral words: hooks, reactions, stakes light up; promos score near zero', () => {
  const s = scoreWords(fakeScan().words);
  const promo = s.find((x) => /subscribe/.test(x.text)), hook = s.find((x) => /believe/.test(x.text)), dull = s.find((x) => /bread/.test(x.text));
  assert.ok(promo.promo && promo.viral < 0.15, `promo ${promo.viral}`);
  assert.ok(hook.hook && hook.viral > 0.5, `hook ${hook.viral}`);
  assert.ok(dull.viral < hook.viral - 0.25, `dull ${dull.viral}`);
  const k = hook.words.findIndex((w) => /believe/.test(w.text));
  assert.ok(hook.wordViral[k] >= 0.85, 'the hook word itself is marked');
});

test('viral moments: the best part starts on the hook and scores well above the calm parts', () => {
  const A = analyzeViral(fakeScan(), { lengths: [15, 20] });
  assert.ok(A.moments.length >= 2);
  const top = A.moments[0];
  assert.ok(top.start >= 48 && top.start <= 56, `starts at ${top.start}`);
  assert.ok(top.score >= 60, `score ${top.score}`);
  const calm = A.moments.find((m) => m.end <= 45);
  if (calm) assert.ok(calm.score < top.score - 15, `calm ${calm.score} vs ${top.score}`);
  assert.ok(top.why.length && top.why.some((w) => /Hook|Laugh|reaction/i.test(w)), top.why.join(' | '));
  assert.ok(A.hot.length && A.hot[0].start >= 45, 'hotspots are in the hot part');
  assert.ok(A.score >= 50);
});

test('take virality: a take opening on the best moment beats one opening on the intro', () => {
  const scan = fakeScan(), A = analyzeViral(scan);
  const clip = { viral: A, words: scan.words };
  const plan = (src) => ({ duration: 15, segments: src.map((s, k) => ({ clip: 0, start: k * 3, end: k * 3 + 3, srcStart: s, srcDur: 3 })) });
  const good = takeVirality(plan([58, 50, 55, 62, 64]), [clip], { format: '9:16', captions: 'on' }, { music: true });
  const bad = takeVirality(plan([2, 12, 30, 35, 40]), [clip], { format: '16:9', captions: 'off' }, { music: false });
  assert.ok(good.score > bad.score + 20, `${good.score} vs ${bad.score}`);
  assert.ok(bad.tips.length > 0);
});
