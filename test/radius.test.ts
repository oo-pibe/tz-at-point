import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination } from '../src/geo.ts';
import { safeRadius } from '../src/radius.ts';

/** Everything more than `m` metres north of 40,0 is Zone/B. */
const borderNorth = (m: number) => {
  const [edge] = destination(40, 0, m, 0);
  return (lat: number) => (lat > edge ? 'Zone/B' : 'Zone/A');
};

test('the radius is the largest ring that stays in the zone', () => {
  assert.equal(safeRadius(borderNorth(300), 40, 0, 'Zone/A', 500), 250);
  assert.equal(safeRadius(borderNorth(60), 40, 0, 'Zone/A', 500), 50);
  assert.equal(safeRadius(borderNorth(5), 40, 0, 'Zone/A', 500), 0);
});

test('capped by max', () => {
  const everywhere = () => 'Zone/A';
  assert.equal(safeRadius(everywhere, 40, 0, 'Zone/A', 500), 500);
  assert.equal(safeRadius(everywhere, 40, 0, 'Zone/A', 300), 250);
  assert.equal(safeRadius(everywhere, 40, 0, 'Zone/A', 1000), 1000);
  assert.equal(safeRadius(everywhere, 40, 0, 'Zone/A', 5), 0);
});

test('open sea does not cost a coastal point its radius', () => {
  const coast = (lat: number) => (lat > 40.001 ? 'Etc/GMT' : 'Zone/A');
  assert.equal(safeRadius(coast, 40, 0, 'Zone/A', 500), 500);
});

test('a probe with no answer is a disagreement', () => {
  assert.equal(safeRadius(() => undefined, 40, 0, 'Zone/A', 500), 0);
});
