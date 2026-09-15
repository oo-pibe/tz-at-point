import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination, metres } from '../src/geo.ts';
import { createLookup, pointKey } from '../src/index.ts';
import type { Table } from '../src/index.ts';

const table: Table = {
  v: 1,
  points: {
    '35.8854,-5.3279': ['Africa/Ceuta', 0], // on a border: never snaps a neighbour
    '51.5561,-0.2794': ['Europe/London', 500],
    '51.5600,-0.2794': ['Europe/Dublin', 100], // fictional neighbour ~430m north, to test nearest-wins
  },
};
const fake = () => 'Fake/Raster';

test('an exact key hit comes from the table', () => {
  assert.deepEqual(createLookup(table, { fallback: fake })(51.55614, -0.27936), { zone: 'Europe/London', source: 'table' });
});

test('a drifted point inside an entry radius comes from that entry', () => {
  const [lat, lng] = destination(51.5561, -0.2794, 150, 200);
  assert.deepEqual(createLookup(table, { fallback: fake })(lat, lng), { zone: 'Europe/London', source: 'table-near' });
});

test('the nearest entry whose own radius covers the point wins', () => {
  const [lat, lng] = destination(51.56, -0.2794, 60, 0); // 60m from Dublin (r=100), ~490m from London (r=500)
  assert.deepEqual(createLookup(table, { fallback: fake })(lat, lng), { zone: 'Europe/Dublin', source: 'table-near' });
});

test('the nearest covering entry wins whichever side of it the point is', () => {
  const [lat, lng] = destination(51.5561, -0.2794, 60, 180); // 60m south of London (r=500), ~490m from Dublin (r=100)
  assert.deepEqual(createLookup(table, { fallback: fake })(lat, lng), { zone: 'Europe/London', source: 'table-near' });
});

test('a radius-0 entry never snaps a neighbour', () => {
  const [lat, lng] = destination(35.8854, -5.3279, 30, 180);
  assert.deepEqual(createLookup(table, { fallback: fake })(lat, lng), { zone: 'Fake/Raster', source: 'raster' });
});

test('outside every radius goes to the fallback', () => {
  assert.deepEqual(createLookup(table, { fallback: fake })(48.85, 2.35), { zone: 'Fake/Raster', source: 'raster' });
});

test('the default fallback is the bundled raster', () => {
  assert.deepEqual(createLookup({ v: 1, points: {} })(36.149, -5.352), { zone: 'Europe/Gibraltar', source: 'raster' });
});

test('fallback: null answers only from the table', () => {
  assert.deepEqual(createLookup(table, { fallback: null })(48.85, 2.35), { zone: null, source: null });
});

test('never throws, whatever it is given or whatever the fallback does', () => {
  const lookups = [
    createLookup(table),
    createLookup(table, { fallback: () => { throw new Error('boom'); } }),
    createLookup(table, { fallback: () => '' }),
    createLookup(table, { fallback: () => undefined }),
  ];
  for (const lookup of lookups) {
    for (const [lat, lng] of [[null, null], [undefined, 1], ['51.5', '-0.27'], [{}, 1], [NaN, 1], [Infinity, 1], [999, 999], [-91, 200]]) {
      assert.deepEqual(lookup(lat, lng), { zone: null, source: null }, JSON.stringify([lat, lng]));
    }
  }
  assert.deepEqual(lookups[1](48.85, 2.35), { zone: null, source: null });
  assert.deepEqual(lookups[2](48.85, 2.35), { zone: null, source: null });
  assert.deepEqual(lookups[3](48.85, 2.35), { zone: null, source: null });
});

test('each call returns a fresh object', () => {
  const lookup = createLookup(table);
  (lookup(NaN, 0) as { zone: string | null }).zone = 'mutated';
  assert.equal(lookup(NaN, 0).zone, null);
});

test('a malformed table throws at creation, not at lookup', () => {
  assert.throws(() => createLookup({ v: 1, points: { nope: ['Europe/London', 0] } }), TypeError);
});

test('near search works across the antimeridian', () => {
  const lookup = createLookup({ v: 1, points: { '-17.0000,180.0000': ['Pacific/Fiji', 500] } }, { fallback: null });
  const [lat, lng] = destination(-17, 180, 200, 90);
  assert.ok(lng < 0);
  assert.deepEqual(lookup(lat, lng), { zone: 'Pacific/Fiji', source: 'table-near' });
});

test('accepts a table typed the way a JSON import is typed, and validates it at runtime instead', () => {
  // `import table from './zones.json'` infers v: number and (string | number)[] values, not Table.
  const inferred = { v: 1, points: { '51.5561,-0.2794': ['Europe/London', 500] } };
  assert.equal(createLookup(inferred)(51.5561, -0.2794).zone, 'Europe/London');
});

test('near search agrees with a brute-force scan on a dense table, at the poles and the antimeridian', () => {
  let state = 7;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const points: Record<string, [string, number]> = {};
  const centres = [[40, -10, 20], [89.99, -180, 360], [-89.99, -180, 360], [-17, 179.9, 0.1], [-17, -180, 0.1]];
  for (let i = 0; i < 4000; i++) {
    const [lat, lng, span] = centres[i % centres.length];
    const key = pointKey(lat + random() * 0.009, lng + random() * span) as string;
    points[key] = [`Zone/E${i}`, Math.floor(random() * 1001)];
  }
  const lookup = createLookup({ v: 1, points }, { fallback: null });
  const entries = Object.entries(points).map(([key, [zone, radius]]) => {
    const [lat, lng] = key.split(',').map(Number);
    return { key, lat, lng, zone, radius };
  });
  for (let i = 0; i < 4000; i++) {
    const e = entries[Math.floor(random() * entries.length)];
    const [lat, lng] = destination(e.lat, e.lng, random() * 1200, random() * 360);
    if ((pointKey(lat, lng) as string) in points) continue;
    let best: string | null = null;
    let bestM = Infinity;
    for (const c of entries) {
      const m = metres(lat, lng, c.lat, c.lng);
      if (c.radius > 0 && m <= c.radius && m < bestM) { best = c.zone; bestM = m; }
    }
    assert.equal(lookup(lat, lng).zone, best, `${lat},${lng}`);
  }
});
