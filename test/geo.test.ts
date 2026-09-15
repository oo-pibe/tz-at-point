import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination, metres } from '../src/geo.ts';

test('metres between two known points', () => {
  // London to Paris, ~343.5km
  assert.ok(Math.abs(metres(51.5074, -0.1278, 48.8566, 2.3522) - 343_500) < 1_000);
  assert.equal(metres(10, 10, 10, 10), 0);
});

test('destination lands the requested distance away', () => {
  for (const bearing of [0, 45, 90, 180, 270, 359]) {
    const [lat, lng] = destination(40, -3, 500, bearing);
    assert.ok(Math.abs(metres(40, -3, lat, lng) - 500) < 0.01, `bearing ${bearing}`);
  }
});

test('destination wraps across the antimeridian', () => {
  const [, lng] = destination(0, 179.9999, 1_000, 90);
  assert.ok(lng < -179.99 && lng >= -180, String(lng));
  assert.ok(metres(0, 179.9999, 0, lng) < 1_001);
});
