import test from 'node:test';
import assert from 'node:assert/strict';
import { SAFE_ZONES, fitsSafeZones, coveredShare, safeZoneHtml } from '../app/js/safezones.js';

test('safe zones only on tall videos', () => {
  assert.equal(fitsSafeZones(9 / 16), true);
  assert.equal(fitsSafeZones(16 / 9), false);
  assert.equal(fitsSafeZones(1), false);
});
test('a title in the caption area is covered, one in the middle is clear', () => {
  assert.ok(coveredShare('tiktok', [0.1, 0.85, 0.6, 0.08]) > 0.9);
  assert.equal(coveredShare('tiktok', [0.2, 0.4, 0.5, 0.1]), 0);
  for (const k of Object.keys(SAFE_ZONES)) assert.match(safeZoneHtml(k), /safe zones/);
});
