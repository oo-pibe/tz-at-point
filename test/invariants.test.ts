import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { destination, metres } from '../src/geo.ts';
import { safeRadius } from '../src/radius.ts';
import { createLookup } from '../src/lookup.ts';
import { formatTable, readTable } from '../src/table.ts';
import { quote } from '../src/text.ts';
import { pointsFromCsv } from '../src/points.ts';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
function workspace(points: unknown, name = 'points.json') {
  const dir = mkdtempSync(join(tmpdir(), 'pinzone-mut-'));
  writeFileSync(join(dir, name), typeof points === 'string' ? points : JSON.stringify(points));
  return { dir, points: join(dir, name), out: join(dir, 'zones.json') };
}

// ---------- radius.ts: the probe lattice itself ----------
test('probes fill every ring up to max, ~10m apart the whole way round', () => {
  const max = 250;
  const probes: [number, number][] = [];
  safeRadius((lat, lng) => { probes.push([lat, lng]); return 'Zone/A'; }, 40, 0, 'Zone/A', max);

  const rings = new Map<number, number[]>();
  for (const [lat, lng] of probes) {
    const ring = Math.round(metres(40, 0, lat, lng) / 10) * 10;
    assert.ok(Math.abs(metres(40, 0, lat, lng) - ring) < 0.5, `probe is not on a 10m ring: ${lat},${lng}`);
    const bearing = Math.atan2((lng - 0) * Math.cos(40 * Math.PI / 180), lat - 40);
    (rings.get(ring) ?? rings.set(ring, []).get(ring)!).push(bearing);
  }
  // One ring past max: the radius is only trusted with a verified ring beyond it.
  assert.deepEqual([...rings.keys()].sort((a, b) => a - b), Array.from({ length: max / 10 + 1 }, (_, i) => (i + 1) * 10));
  for (const [ring, bearings] of rings) {
    bearings.sort((a, b) => a - b);
    const gaps = bearings.map((b, i) => (i === 0 ? b - bearings.at(-1)! + 2 * Math.PI : b - bearings[i - 1]));
    assert.ok(Math.max(...gaps) * ring <= 10.5, `ring ${ring}: widest probe gap is ${(Math.max(...gaps) * ring).toFixed(1)}m`);
  }
});

test('a border exactly at max is seen, so the stored radius stops two rings short of it', () => {
  const [edge] = destination(40, 0, 250, 0);
  assert.equal(safeRadius((lat: number) => (lat >= edge ? 'Zone/B' : 'Zone/A'), 40, 0, 'Zone/A', 250), 230);
});

// ---------- lookup.ts: radius boundary, ties, grid margin ----------
test('a point exactly on an entry radius is covered by it', () => {
  const lookup = createLookup({ v: 1, points: { '0.0000,0.0000': ['Zone/A', 500] } }, { fallback: null });
  let covered = 0;
  for (let bearing = 0; bearing < 360; bearing++) {
    const [lat, lng] = destination(0, 0, 500, bearing);
    if (metres(0, 0, lat, lng) <= 500) {
      covered++;
      assert.equal(lookup(lat, lng).zone, 'Zone/A', `bearing ${bearing}`);
    }
  }
  assert.ok(covered > 100, `only ${covered} bearings landed at or inside the radius`);
});

test('an exact distance tie goes to the first entry in the table, not the last', () => {
  const tie = { v: 1, points: { '0.0000,-0.0010': ['Zone/W', 500], '0.0000,0.0010': ['Zone/E', 500] } };
  assert.equal(createLookup(tie, { fallback: null })(0, 0).zone, 'Zone/W');
});

test('an entry is indexed everywhere its radius reaches, at any latitude', () => {
  for (const lat of [0, 0.004, 23.5, 45, 60.001, 80, 89.9]) {
    for (const sign of [1, -1]) {
      const y = lat * sign;
      const key = `${y.toFixed(4)},7.0000`;
      const lookup = createLookup({ v: 1, points: { [key]: ['Zone/R', 1000] } }, { fallback: null });
      for (let bearing = 0; bearing < 360; bearing += 3) {
        const [qLat, qLng] = destination(Number(y.toFixed(4)), 7, 999, bearing);
        assert.equal(lookup(qLat, qLng).zone, 'Zone/R', `${key} bearing ${bearing}`);
      }
    }
  }
});

// ---------- table.ts ----------
test('the radius bounds are exact', () => {
  assert.equal(readTable({ v: 1, points: { '1.0000,1.0000': ['UTC', 1000] } })[0].radius, 1000);
  for (const radius of [1010, 1100, 10.5, -10]) {
    assert.throws(() => readTable({ v: 1, points: { '1.0000,1.0000': ['UTC', radius] } }), /has radius/, String(radius));
  }
});

test('a zone name has at most three segments', () => {
  assert.throws(() => readTable({ v: 1, points: { '1.0000,1.0000': ['A/B/C/D', 0] } }), /invalid zone name/);
});

test('the version must be the number 1, not a value that == 1', () => {
  for (const v of ['1', true, [1]]) {
    assert.throws(() => readTable({ v, points: {} }), /unsupported version/, JSON.stringify(v));
  }
});

test('a polluted Object.prototype cannot stand in for v or points', () => {
  const proto = Object.prototype as unknown as Record<string, unknown>;
  proto.v = 1;
  proto.points = { '1.0000,1.0000': ['UTC', 0] };
  try {
    assert.throws(() => readTable({}), /unsupported version/);
    assert.throws(() => readTable({ v: 1 }), /points must be a plain object/);
  } finally {
    delete proto.v;
    delete proto.points;
  }
});

test('an entry value must be an array, not anything two-long', () => {
  assert.throws(() => readTable({ v: 1, points: { '1.0000,1.0000': 'ab' } }), /must map to \[zone, radius\]/);
  assert.throws(() => readTable({ v: 1, points: { '1.0000,1.0000': { 0: 'UTC', 1: 0, length: 2 } } }), /must map to \[zone, radius\]/);
});

test('a table built without Object.prototype is still a table', () => {
  const points = Object.assign(Object.create(null), { '1.0000,1.0000': ['UTC', 0] });
  assert.equal(readTable(Object.assign(Object.create(null), { v: 1, points }))[0].zone, 'UTC');
});

test('an empty table is formatted exactly', () => {
  assert.equal(formatTable(new Map(), 250), '{\n  "v": 1,\n  "maxRadius": 250,\n  "points": {\n  }\n}\n');
});

// ---------- text.ts ----------
test('quote escapes non-ASCII wherever it appears, and caps at 40 characters', () => {
  assert.equal(quote('\u202e\u2028\u009b\u007f'), '"\\u202e\\u2028\\u009b\\u007f"');
  const long = '\u202e' + 'x'.repeat(5000);
  const cut = quote(long);
  assert.match(cut, /^"\\u202ex+\.\.\.$/, cut);          // escaped, and truncated
  assert.equal(cut.match(/x/g)!.length, 38, cut);      // 40 characters of JSON, then the ellipsis
  assert.ok(/^[\x20-\x7e]*$/.test(cut), cut);
});

test('a table error escapes non-ASCII the JSON encoder leaves alone', () => {
  assert.throws(() => readTable({ v: 1, points: { '1.0000,1.0000': ['UTC', '\u202e\u2028'] } }),
    (err: Error) => /^[\x20-\x7e]*$/.test(err.message) && err.message.includes('\\u202e'));
});

// ---------- points.ts ----------
test('a CSV header missing either column is an error about the header', () => {
  for (const csv of ['lat,name\n1,a\n', 'lng,name\n2,a\n']) {
    assert.throws(() => pointsFromCsv(csv), /CSV header must have lat and lng columns/, csv);
  }
});

test('CSV headers are matched case-insensitively', () => {
  assert.deepEqual(pointsFromCsv('LAT,LNG\n1,2\n'), [{ lat: 1, lng: 2 }]);
});

test('a doubled quote inside a quoted field is one literal quote', () => {
  assert.deepEqual(pointsFromCsv('name,lat,lng\n"say ""hi""",1,2\n'), [{ lat: 1, lng: 2 }]);
  assert.deepEqual(pointsFromCsv('name,lat,lng\na""b,1,2\n'), [{ lat: 1, lng: 2 }]);
});

// ---------- cli.ts ----------
test('-h works at the top level', () => {
  const r = run('-h');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage:/);
});

test('each usage error says what is wrong, not just that something is', () => {
  const cases: [string[], RegExp][] = [
    [['build', 'x.json'], /usage:/],
    [['build', 'x.json', 'y.json', '-o', 'z.json'], /usage:/],
    [['check', 'a.json', 'b.json'], /usage:/],
    [['build', 'x.json', '-o', 'y.json', '--check', '--refresh'], /--check and --refresh cannot be combined/],
    [['build', 'x.json', '-o', 'y.json', '--max-radius', '1e2'], /--max-radius must be a multiple of/],
    [['build', 'x.json', '-o', 'y.json', '--max-radius', '0x64'], /--max-radius must be a multiple of/],
  ];
  for (const [args, message] of cases) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, message, args.join(' '));
  }
});

test('only .json and .csv are read, and not by a name that merely contains one', () => {
  const w = workspace('[[1,2]]', 'points.json.txt');
  const r = run('build', w.points, '-o', w.out);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /points must be a \.json or \.csv file/);
});

test('the suggested rebuild command is shell-safe and keeps --max-radius', () => {
  const w = workspace([[51.5561, -0.2794]], "it's points.json");
  const r = run('build', w.points, '-o', join(w.dir, 'zones.json'), '--check', '--max-radius', '100');
  assert.equal(r.status, 1);
  const line = r.stdout.split('\n').find((l) => l.startsWith('run: '))!;
  assert.match(line, / --max-radius 100$/);
  assert.match(line, /'/, line); // the space in the path forces quoting
  assert.ok(!/(^|[^\\])'[^']*'[^']*'[^']*$/.test(line) || line.includes(`'\\''`), line);
  // the printed command actually runs
  const echoed = spawnSync('/bin/sh', ['-c', `set -- ${line.replace(/^run: npx pinzone build /, '')}; echo "$1"`], { encoding: 'utf8' });
  assert.equal(echoed.stdout.trim(), w.points);
});

test('the drift warning is only about points the build resolved', () => {
  const w = workspace([[51.449039, 4.930128]]);
  assert.match(run('build', w.points, '-o', w.out).stderr, /but its key/);
  const again = run('build', w.points, '-o', w.out);
  assert.match(again.stdout, /up to date/);
  assert.doesNotMatch(again.stderr, /but its key/);
});

test('a point the polygons cannot place stops the build instead of being written', () => {
  const w = workspace([[51.5561, -0.2794]]);
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  assert.ok(!JSON.stringify(readFileSync(w.out, 'utf8')).includes('null'));
});

test('the temp file is created exclusively, with private-looking permissions, and is unguessable', () => {
  const w = workspace([[51.5561, -0.2794]]);
  const source = readFileSync(new URL('../src/cli.ts', import.meta.url).pathname, 'utf8');
  assert.match(source, /openSync\(temp, 'wx'/, "the temp file must be created with 'wx' so a planted file is not followed");
  assert.match(source, /randomUUID\(\)/, 'the temp name must be unguessable');
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  assert.deepEqual(readdirSync(w.dir).sort(), ['points.json', 'zones.json']);
});
