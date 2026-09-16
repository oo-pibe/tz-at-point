import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination, metres } from '../src/geo.ts';
import { resolve, safeRadius } from '../src/radius.ts';

/** Everything more than `m` metres north of 40,0 is Zone/B. */
const borderNorth = (m: number) => {
  const [edge] = destination(40, 0, m, 0);
  return (lat: number) => (lat > edge ? 'Zone/B' : 'Zone/A');
};

test('the radius keeps a whole verified ring beyond it, because probes only sample a ring tangentially', () => {
  // A zone that first appears at 305m fails the 310m ring, so 300m is only verified at 82 bearings:
  // a narrow lobe can cross it between two probes. Stop a further ring short.
  assert.equal(safeRadius(borderNorth(305), 40, 0, 'Zone/A', 1000), 290);
  assert.equal(safeRadius(borderNorth(65), 40, 0, 'Zone/A', 250), 50);
  assert.equal(safeRadius(borderNorth(5), 40, 0, 'Zone/A', 250), 0);
  assert.equal(safeRadius(borderNorth(15), 40, 0, 'Zone/A', 250), 0);
  assert.equal(safeRadius(borderNorth(25), 40, 0, 'Zone/A', 250), 10);
});

test('the ring beyond the cap is probed too, so a capped radius is verified like any other', () => {
  const probed: number[] = [];
  const find = (lat: number, lng: number) => { probed.push(metres(40, 0, lat, lng)); return 'Zone/A'; };
  assert.equal(safeRadius(find, 40, 0, 'Zone/A', 250), 250);
  assert.ok(Math.max(...probed) > 255, `outermost probe was ${Math.max(...probed)}`);
  assert.equal(safeRadius(() => 'Zone/A', 40, 0, 'Zone/A', 0), 0);
});

test('a small enclave off every axis is found, not stepped over', () => {
  // A 16m-wide pocket of Zone/B, 120m out on an arbitrary bearing.
  const [cLat, cLng] = destination(40, 0, 120, 47);
  const find = (lat: number, lng: number) => (metres(lat, lng, cLat, cLng) < 8 ? 'Zone/B' : 'Zone/A');
  assert.equal(safeRadius(find, 40, 0, 'Zone/A', 1000), 100);
});

test('capped by max, rounded down to the probe spacing', () => {
  const everywhere = () => 'Zone/A';
  assert.equal(safeRadius(everywhere, 40, 0, 'Zone/A', 250), 250);
  assert.equal(safeRadius(everywhere, 40, 0, 'Zone/A', 255), 250);
  assert.equal(safeRadius(everywhere, 40, 0, 'Zone/A', 5), 0);
});

test('a wrong zone reaching just inside the last verified ring is now excluded', () => {
  // The fuzzer's case: a lobe that dips 1.2m inside a 130m radius, between two probes on that ring.
  const [lobeLat, lobeLng] = destination(40, 0, 128.8, 301.4);
  // 20m across: bigger than the ~7m the lattice can resolve, so the probes must catch it.
  const find = (lat: number, lng: number) => (metres(lat, lng, lobeLat, lobeLng) < 10 ? 'Zone/B' : 'Zone/A');
  const radius = safeRadius(find, 40, 0, 'Zone/A', 250);
  assert.ok(radius <= 120, `radius ${radius} still reaches the lobe at 128.8m`);
});

test('sea zones are compared like any other zone', () => {
  // Either side of the date line at the equator, a day apart.
  const find = (_lat: number, lng: number) => (lng > 0 ? 'Etc/GMT-12' : 'Etc/GMT+12');
  assert.equal(safeRadius(find, 0, 179.9989, 'Etc/GMT-12', 1000), 110);
});

test('a probe with no answer is a disagreement, and a point with no zone has no radius', () => {
  assert.equal(safeRadius(() => undefined, 40, 0, 'Zone/A', 250), 0);
  assert.deepEqual(resolve(() => undefined, 40, 0, 250), [undefined, 0]);
  assert.deepEqual(resolve(borderNorth(65), 40, 0, 250), ['Zone/A', 50]);
});
