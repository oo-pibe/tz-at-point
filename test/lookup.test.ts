import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination, metres } from '../src/geo.ts';
import { createLookup, pointKey } from '../src/index.ts';
import { cellsReached } from '../src/lookup.ts';
import { readTable } from '../src/table.ts';
import { createLookup as coreLookup } from '../src/lookup.ts';

const table = {
  v: 1,
  points: {
    '35.8854,-5.3279': ['Africa/Ceuta', 0], // on a border: never snaps a neighbour
    '51.5561,-0.2794': ['Europe/London', 500],
    '51.5600,-0.2794': ['Europe/Dublin', 100], // fictional neighbour ~430m north, to test nearest-wins
  },
};
const lookup = createLookup(table, { fallback: () => 'Fake/Raster' });

test('an exact key hit comes from the table', () => {
  assert.deepEqual(lookup(51.55614, -0.27936), { zone: 'Europe/London', source: 'table' });
});

test('a drifted point inside an entry radius comes from that entry', () => {
  assert.deepEqual(lookup(...destination(51.5561, -0.2794, 150, 200)), { zone: 'Europe/London', source: 'table-near' });
});

test('the nearest entry whose own radius covers the point wins, from either side', () => {
  // 60m from Dublin (r=100) and ~490m from London (r=500), then the mirror image.
  assert.deepEqual(lookup(...destination(51.56, -0.2794, 60, 0)), { zone: 'Europe/Dublin', source: 'table-near' });
  assert.deepEqual(lookup(...destination(51.5561, -0.2794, 60, 180)), { zone: 'Europe/London', source: 'table-near' });
});

test('a radius-0 entry never snaps a neighbour, and outside every radius goes to the fallback', () => {
  assert.deepEqual(lookup(...destination(35.8854, -5.3279, 30, 180)), { zone: 'Fake/Raster', source: 'raster' });
  assert.deepEqual(lookup(48.85, 2.35), { zone: 'Fake/Raster', source: 'raster' });
});

test('the default fallback is the bundled raster; fallback: null answers only from the table', () => {
  assert.deepEqual(createLookup({ v: 1, points: {} })(36.149, -5.352), { zone: 'Europe/Gibraltar', source: 'raster' });
  assert.deepEqual(createLookup(table, { fallback: null })(48.85, 2.35), { zone: null, source: null });
});

test('never throws: not a coordinate, or a fallback that throws or answers nothing', () => {
  for (const [lat, lng] of [['51.5', '-0.27'], [NaN, 1], [-91, 200]]) {
    assert.deepEqual(lookup(lat, lng), { zone: null, source: null }, JSON.stringify([lat, lng]));
  }
  for (const fallback of [() => { throw new Error('boom'); }, () => '', () => undefined]) {
    assert.deepEqual(createLookup(table, { fallback })(48.85, 2.35), { zone: null, source: null });
  }
});

test('each call returns a fresh object', () => {
  (lookup(NaN, 0) as { zone: string | null }).zone = 'mutated';
  assert.equal(lookup(NaN, 0).zone, null);
});

test('a malformed table throws at creation, not at lookup', () => {
  assert.throws(() => createLookup({ v: 1, points: { nope: ['Europe/London', 0] } }), TypeError);
});

test('a JSON module namespace says what to pass instead of blaming the version', () => {
  const namespace = Object.create(null, { [Symbol.toStringTag]: { value: 'Module' }, default: { value: table, enumerable: true } });
  assert.throws(() => createLookup(namespace), { name: 'TypeError', message: /default export/ });
});

test('a table from another realm is still a table', async () => {
  const vm = await import('node:vm');
  const other = vm.runInNewContext(`(${JSON.stringify(table)})`);
  assert.equal(createLookup(other, { fallback: null })(51.5561, -0.2794).zone, 'Europe/London');
});

test('near search agrees with a brute-force scan on a dense table, at the poles and the antimeridian', () => {
  let state = 7;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const points: Record<string, [string, number]> = {};
  const centres = [[40, -10, 20], [89.99, -180, 360], [-89.99, -180, 360], [-17, 179.9, 0.1], [-17, -180, 0.1]];
  for (let i = 0; i < 4000; i++) {
    const [lat, lng, span] = centres[i % centres.length];
    points[pointKey(lat + random() * 0.009, lng + random() * span) as string] = [`Zone/E${i}`, 10 * Math.floor(random() * 101)];
  }
  const dense = createLookup({ v: 1, points }, { fallback: null });
  const entries = readTable({ v: 1, points });
  for (let i = 0; i < 4000; i++) {
    const e = entries[Math.floor(random() * entries.length)];
    const [lat, lng] = destination(e.lat, e.lng, random() * 1200, random() * 360);
    if ((pointKey(lat, lng) as string) in points) continue;
    let best: string | null = null;
    let bestM = Infinity;
    for (const c of entries) {
      const m = metres(lat, lng, c.lat, c.lng);
      if (c.radius > 0 && m <= c.radius && m < bestM) {
        best = c.zone;
        bestM = m;
      }
    }
    assert.equal(dense(lat, lng).zone, best, `${lat},${lng}`);
  }
});

test('near search works across the antimeridian', () => {
  const fiji = createLookup({ v: 1, points: { '-17.0000,180.0000': ['Pacific/Fiji', 500] } }, { fallback: null });
  const [lat, lng] = destination(-17, 180, 200, 90);
  assert.ok(lng < 0);
  assert.deepEqual(fiji(lat, lng), { zone: 'Pacific/Fiji', source: 'table-near' });
});

test('an entry of any radius reaches only a handful of grid cells, even at the poles', () => {
  for (const lat of [0, 45, 60, 80, 88.5, 88.99, 89, 89.5, 89.99, 90, -89.995, -90]) {
    for (const lng of [-180, 0, 179.99]) {
      const reached = [...cellsReached({ key: '', lat, lng, zone: 'UTC', radius: 1000 })].length;
      assert.ok(reached <= 12, `${lat},${lng} reaches ${reached} cells`);
    }
  }
});

test('a custom fallback cannot hand back something that is not a zone name', () => {
  assert.deepEqual(createLookup(table, { fallback: () => '<script>' })(48.85, 2.35), { zone: null, source: null });
});
test('tz-at-point/core answers only from the table, so the raster never reaches a bundle', () => {
  assert.deepEqual(coreLookup(table)(51.5561, -0.2794), { zone: 'Europe/London', source: 'table' });
  assert.deepEqual(coreLookup(table)(40.4168, -3.7038), { zone: null, source: null });
  assert.equal(createLookup(table)(40.4168, -3.7038).source, 'raster'); // the main entry keeps the fallback
  assert.deepEqual(coreLookup(table, { fallback: () => 'Fake/Zone' })(40.4168, -3.7038), { zone: 'Fake/Zone', source: 'raster' });
});
