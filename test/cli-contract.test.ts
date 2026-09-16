import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { destination, metres } from '../src/geo.ts';
import { safeRadius } from '../src/radius.ts';
import { cellsReached, createLookup } from '../src/lookup.ts';
import { pointsFromCsv } from '../src/points.ts';
import { quote } from '../src/text.ts';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
function workspace(points: unknown, name = 'points.json') {
  const dir = mkdtempSync(join(tmpdir(), 'pinzone-mut2-'));
  writeFileSync(join(dir, name), typeof points === 'string' ? points : JSON.stringify(points));
  return { dir, points: join(dir, name), out: join(dir, 'zones.json') };
}

// rad-3: spacing measured on the sphere, not in bearing space
test('no two neighbouring probes on a ring are more than the probe spacing apart', () => {
  const max = 250;
  const probes: [number, number][] = [];
  safeRadius((lat, lng) => { probes.push([lat, lng]); return 'Zone/A'; }, 40, 0, 'Zone/A', max);
  const rings = new Map<number, [number, number][]>();
  for (const p of probes) {
    const ring = Math.round(metres(40, 0, ...p) / 10) * 10;
    (rings.get(ring) ?? rings.set(ring, []).get(ring)!).push(p);
  }
  assert.deepEqual([...rings.keys()].sort((a, b) => a - b), Array.from({ length: max / 10 + 1 }, (_, i) => (i + 1) * 10));
  for (const [ring, ps] of rings) {
    // probes are generated in bearing order, so neighbours are adjacent (and the last wraps to the first)
    const gaps = ps.map((p, i) => metres(...p, ...ps[(i + 1) % ps.length]));
    assert.ok(Math.max(...gaps) <= 10.001, `ring ${ring}: widest gap ${Math.max(...gaps).toFixed(3)}m`);
  }
});

// lkp-1/2/9/10/12: grid geometry
const cellOf = (lat: number, lng: number) => [...cellsReached({ key: '', lat, lng, zone: 'UTC', radius: 0 })][0];
test('grid cells are one hundredth of a degree, and no two places on Earth share one', () => {
  assert.notEqual(cellOf(0, 0), cellOf(0.011, 0), 'rows must be 0.01 degrees of latitude');
  assert.notEqual(cellOf(0, 0), cellOf(0, 0.011), 'columns must be 0.01 degrees of longitude at the equator');
  // both sides of a column's midpoint, inside one column: the column is floored, not rounded
  assert.equal(cellOf(0, 0.0070002), cellOf(0, 0.0120003), 'a column covers a whole step, floored not rounded');
  assert.notEqual(cellOf(0, -90), cellOf(0, 90), 'opposite sides of the world are different cells');
  assert.notEqual(cellOf(0, 0), cellOf(1, 0), 'different rows are different cells');
});

// pts-10 / pts-13: the doubled-quote rule
test('a doubled quote is a literal quote only inside a quoted field', () => {
  assert.deepEqual(pointsFromCsv('name,lat,lng\n"a""b",1,2\n'), [{ lat: 1, lng: 2 }]);
  assert.deepEqual(pointsFromCsv('name,lat,lng\n"say ""hi""",1,2\n'), [{ lat: 1, lng: 2 }]);
  assert.deepEqual(pointsFromCsv('lat,lng\n1,2""\n'), [{ lat: 1, lng: 2 }]); // "" outside quotes opens and closes
});

// txt-3: the cap
test('quote truncates anything longer than 40 characters', () => {
  assert.equal(quote('y'.repeat(100)), `"${'y'.repeat(39)}...`);
  assert.equal(quote('y'.repeat(30)), `"${'y'.repeat(30)}"`);
});

// geo-5: antipodes
test('metres survives antipodal points instead of returning NaN', () => {
  for (const [a, b, c, d] of [[0, 0, 0, 180], [45, 10, -45, -170], [90, 0, -90, 0]]) {
    const m = metres(a, b, c, d);
    assert.ok(Number.isFinite(m) && Math.abs(m - 20_015_100) < 200, `${a},${b} -> ${c},${d}: ${m}`);
  }
});

// cli-5 / cli-6: the 20-line cap
test('--check lists at most twenty keys and says how many are left', () => {
  const points = Array.from({ length: 25 }, (_, i) => [50 + i / 1000, 0]);
  const w = workspace(points);
  const r = run('build', w.points, '-o', w.out, '--check');
  assert.equal(r.status, 1);
  const keys = r.stdout.split('\n').filter((l) => /^ {2}\d/.test(l));
  assert.equal(keys.length, 20, r.stdout);
  assert.match(r.stdout, /^\.\.\.and 5 more$/m);
});

// cli-33: the drift warning belongs to the points this run resolved
test('a rebuild that adds a point does not re-warn about points already in the table', () => {
  const w = workspace([[51.449039, 4.930128]]); // rounds into a different zone than it sits in
  assert.match(run('build', w.points, '-o', w.out).stderr, /but its key/);
  writeFileSync(w.points, JSON.stringify([[51.449039, 4.930128], [51.5561, -0.2794]]));
  const again = run('build', w.points, '-o', w.out);
  assert.equal(again.status, 0);
  assert.doesNotMatch(again.stderr, /but its key/, again.stderr);
});

// cli-53: geo-tz returns overlapping zones in western China; the first is the specific one
test('where the polygons overlap, the first zone wins', () => {
  const w = workspace([[43.5647, 89.9101]]);
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  assert.equal(JSON.parse(readFileSync(w.out, 'utf8')).points['43.5647,89.9101'][0], 'Asia/Urumqi');
});

// cli-14: a new table is not world-writable
test('a table created from scratch is not world-writable', () => {
  const w = workspace([[51.5561, -0.2794]]);
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  const mode = statSync(w.out).mode & 0o777;
  assert.equal(mode & 0o022, 0, `zones.json is mode ${mode.toString(8)}`);
});
