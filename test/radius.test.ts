import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination, metres } from '../src/geo.ts';
import { resolve, safeRadius } from '../src/radius.ts';

/** Everything more than `m` metres north of 40,0 is Zone/B. */
const borderNorth = (m: number) => {
  const [edge] = destination(40, 0, m, 0);
  return (lat: number) => (lat > edge ? 'Zone/B' : 'Zone/A');
};

test('the radius stops one ring short of the first probe in another zone', () => {
  assert.equal(safeRadius(borderNorth(305), 40, 0, 'Zone/A', 1000), 300);
  assert.equal(safeRadius(borderNorth(65), 40, 0, 'Zone/A', 250), 60);
  assert.equal(safeRadius(borderNorth(5), 40, 0, 'Zone/A', 250), 0);
});

test('a small enclave off every axis is found, not stepped over', () => {
  // A 16m-wide pocket of Zone/B, 120m out on an arbitrary bearing.
  const [cLat, cLng] = destination(40, 0, 120, 47);
  const find = (lat: number, lng: number) => (metres(lat, lng, cLat, cLng) < 8 ? 'Zone/B' : 'Zone/A');
  assert.equal(safeRadius(find, 40, 0, 'Zone/A', 1000), 110);
});

test('capped by max, rounded down to the probe spacing', () => {
  const everywhere = () => 'Zone/A';
  assert.equal(safeRadius(everywhere, 40, 0, 'Zone/A', 250), 250);
  assert.equal(safeRadius(everywhere, 40, 0, 'Zone/A', 255), 250);
  assert.equal(safeRadius(everywhere, 40, 0, 'Zone/A', 5), 0);
});

test('sea zones are compared like any other zone', () => {
  // Either side of the date line at the equator, a day apart.
  const find = (_lat: number, lng: number) => (lng > 0 ? 'Etc/GMT-12' : 'Etc/GMT+12');
  assert.equal(safeRadius(find, 0, 179.9989, 'Etc/GMT-12', 1000), 120);
});

test('a probe with no answer is a disagreement, and a point with no zone has no radius', () => {
  assert.equal(safeRadius(() => undefined, 40, 0, 'Zone/A', 250), 0);
  assert.deepEqual(resolve(() => undefined, 40, 0, 250), [undefined, 0]);
  assert.deepEqual(resolve(borderNorth(65), 40, 0, 250), ['Zone/A', 60]);
});
