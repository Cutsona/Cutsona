import assert from 'node:assert/strict';
import test from 'node:test';
import { quickToEditor, remapSavedPlan } from '../app/js/quicktransfer.js';

test('Quick transfer keeps every take, the selected take, and source media references', () => {
  const project = {
    id: 'project1', W: 1080, H: 1920, vertical: true, total: 5.2, title: 'Test topic',
    opts: { captions: true, titleCard: true, musicLevel: 'low' }, voice: '/voice.wav',
    scenes: [{ start: 0.6, dur: 2, len: 3, text: 'Original', cap: 'A custom caption.' }],
    media: [{ kind: 'img', url: '/one.jpg', ref: { quick: { id: 'project1', index: 0 } } },
      { kind: 'vid', url: '/two.mp4', ref: { quick: { id: 'project1', index: 1 } } }],
    music: [{ url: '/music.mp3', title: 'Theme' }],
    takes: [
      { pieces: [{ scene: 0, mid: 0, move: 1 }, { scene: 0, mid: 1, move: 4 }], transition: 'cut', music: -1 },
      { pieces: [{ scene: 0, mid: 1, move: 2 }], music: 0 },
    ],
  };
  const doc = quickToEditor(project, 'stream', 1);
  assert.equal(doc.settings.format, '9:16');
  assert.equal(doc.focused, 1);
  assert.deepEqual(doc.clips.map((clip) => clip.src), project.media.map((media) => media.ref));
  const [first, second] = doc.takes.map((t) => t.sourcePlan.plan);
  assert.deepEqual(first.segments.map(({ clip, start, end, quickMotion }) => [clip, start, end, quickMotion]), [
    [0, 0, 2.6, 1], [1, 2.6, 5.2, 4],
  ]);
  assert.equal(second.segments[0].clip, 1);
  assert.equal(second.quick.voice, '/voice.wav');
  assert.equal(second.quick.song, '/music.mp3');
  assert.equal(second.quick.captions[0].text, 'A custom caption.');
});

test('reopening a stored plan preserves footage times and order when ready clip indices change', () => {
  const first = { clip: 1, start: 0, end: 2, srcStart: 16 };
  const second = { clip: 0, start: 2, end: 6, srcStart: 4 };
  const snapshot = { ids: 'a|b', plan: { duration: 6, segments: [first, second], base: { segments: [first, second] } } };
  const restored = remapSavedPlan(snapshot, [{ id: 'b' }, { id: 'new' }, { id: 'a' }]);
  const expected = [{ ...first, clip: 0 }, { ...second, clip: 2 }];
  assert.deepEqual(restored.segments, expected);
  assert.deepEqual(restored.base.segments, expected);
  assert.deepEqual(snapshot.plan.segments, [first, second]);
  assert.equal(remapSavedPlan(snapshot, [{ id: 'b' }]), null);
});
