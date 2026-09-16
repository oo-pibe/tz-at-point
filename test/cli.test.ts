import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

/** A temp dir holding `points.json` (or `name`) with the given content; returns paths inside it. */
function workspace(points: unknown, name = 'points.json') {
  const dir = mkdtempSync(join(tmpdir(), 'tz-at-point-'));
  writeFileSync(join(dir, name), typeof points === 'string' ? points : JSON.stringify(points));
  return { dir, points: join(dir, name), out: join(dir, 'zones.json') };
}
const readOut = (out: string) => JSON.parse(readFileSync(out, 'utf8')).points;

// Public landmarks: a city stadium, an enclave, a border town, a steppe capital, the Arctic.
const LANDMARKS = [[51.5561, -0.2794], [35.8854, -5.3279], [51.4394, 4.9275], [51.108, 71.407], [69.6496, 18.956]];

test('build writes a table with local zone names and a default radius of 250m', () => {
  const w = workspace(LANDMARKS);
  const r = run('build', w.points, '-o', w.out);
  assert.equal(r.status, 0, r.stderr);
  const points = readOut(w.out);
  assert.deepEqual(points['69.6496,18.9560'], ['Europe/Oslo', 250]); // geo-tz's default dataset says Europe/Berlin
  assert.equal(points['35.8854,-5.3279'][0], 'Africa/Ceuta');
  assert.equal(points['51.4394,4.9275'][1], 0); // Baarle-Nassau, enclaves street by street
  assert.deepEqual(readdirSync(w.dir).sort(), ['points.json', 'zones.json']); // no temp file left behind
});

test('reads CSV points', () => {
  const w = workspace('name,lat,lng\n"Wembley, London",51.5561,-0.2794\nTornio,65.8481,24.1466\n', 'points.csv');
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  assert.deepEqual(Object.keys(readOut(w.out)).sort(), ['51.5561,-0.2794', '65.8481,24.1466']);
});

test('build only grows, --check reports what is missing, and an up-to-date build writes nothing', () => {
  const a = workspace(LANDMARKS.slice(0, 2));
  const b = join(a.dir, 'b.json');
  writeFileSync(b, JSON.stringify(LANDMARKS.slice(2, 3)));
  assert.equal(run('build', a.points, '-o', a.out).status, 0);
  const check = run('build', b, '-o', a.out, '--check');
  assert.equal(check.status, 1);
  assert.match(check.stdout, /51\.4394,4\.9275/);
  assert.equal(run('build', b, '-o', a.out).status, 0);
  assert.equal(Object.keys(readOut(a.out)).length, 3);
  assert.equal(run('build', a.points, '-o', a.out, '--check').status, 0);
  const before = statSync(a.out).mtimeMs;
  const again = run('build', a.points, '-o', a.out);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /up to date/);
  assert.equal(statSync(a.out).mtimeMs, before);
});

test('no radius reaches across the date line at sea', () => {
  const w = workspace([[0, 180], [0, -179.999]]);
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  assert.deepEqual(Object.keys(readOut(w.out)), ['0.0000,-179.9990', '0.0000,180.0000']);
  assert.equal(readOut(w.out)['0.0000,180.0000'][1], 0);
});

test('no radius swallows an enclave that sits inside it', () => {
  // 51.4330,4.9120 is Dutch; a Belgian enclave lies 345m away at 51.435377,4.915199.
  const w = workspace([[51.433, 4.912]]);
  assert.equal(run('build', w.points, '-o', w.out, '--max-radius', '1000').status, 0);
  assert.ok(readOut(w.out)['51.4330,4.9120'][1] < 345);
});

test('warns when a point and its rounded key fall in different zones', () => {
  const w = workspace([[51.449039, 4.930128]]);
  const r = run('build', w.points, '-o', w.out);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /warning: 51\.449039,4\.930128 is in Europe\/Brussels/);
});

test('check passes a fresh table, fails a wrong zone or an oversized radius, and --refresh repairs both', () => {
  const w = workspace(LANDMARKS);
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  const ok = run('check', w.out);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);

  const t = JSON.parse(readFileSync(w.out, 'utf8'));
  t.points['51.5561,-0.2794'][0] = 'Europe/Paris';
  t.points['51.4394,4.9275'][1] = 500;
  writeFileSync(w.out, JSON.stringify(t));
  const bad = run('check', w.out);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /51\.5561,-0\.2794: table says Europe\/Paris, polygons say Europe\/London/);
  assert.match(bad.stdout, /51\.4394,4\.9275: radius 500m reaches another zone/);

  assert.equal(run('build', w.points, '-o', w.out, '--refresh').status, 0);
  assert.equal(run('check', w.out).status, 0);
});

test('check names the right fix for each kind of failure', () => {
  const w = workspace(LANDMARKS.slice(0, 1));
  writeFileSync(w.out, JSON.stringify({ v: 1, points: { '51.5561,-0.2794': ['Mars/Olympus_Mons', 0] } }));
  const r = run('check', w.out);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL Mars\/Olympus_Mons: not a zone this runtime's Intl accepts/);
  assert.match(r.stdout, /fix: update Node/);
  assert.match(r.stdout, /fix: rebuild the table with --refresh/); // the zone also disagrees with the polygons
});

test('check --raster counts how many of your own points the raster alone would get wrong', () => {
  // Tornio is the documented case: the raster says Europe/Stockholm, an hour behind Europe/Helsinki.
  const w = workspace([[65.8481, 24.1466], [51.5561, -0.2794]]);
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  const r = run('check', w.out, '--raster');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /raster: 1 of 2 points disagrees with the table, 1 by a different UTC offset/);
  assert.match(r.stdout, /65\.8481,24\.1466: raster says Europe\/Stockholm, table says Europe\/Helsinki/);
  assert.doesNotMatch(run('check', w.out).stdout, /raster:/, 'only with the flag');
});

test('a file that is not JSON is named, never echoed', () => {
  const w = workspace('AWS_SECRET_ACCESS_KEY=abc123');
  writeFileSync(join(w.dir, 'ok.json'), '[[1,2]]');
  for (const args of [['check', w.points], ['build', join(w.dir, 'ok.json'), '-o', w.points]]) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /not valid JSON/);
    assert.doesNotMatch(r.stderr, /AWS_SECRET/);
  }
});

test('a byte-order mark is ignored, and a bad table is named in the error', () => {
  const w = workspace('\uFEFF[[65.8481, 24.1466]]');
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  writeFileSync(w.out, '{"v":1,"points":{"nope":["UTC",0]}}');
  const r = run('check', w.out);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /zones\.json: entry "nope" is not a canonical point key/);
});

test('--help prints usage and succeeds', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage:/);
});

test('usage errors exit 2 with one message, not a stack trace', () => {
  for (const args of [[], ['nope'], ['build'], ['build', 'x.json'], ['build', 'x.txt', '-o', 'y.json'],
    ['build', 'x.json', '-o', 'y.json', '--max-radius', '5000'], ['build', 'x.json', '-o', 'y.json', '--max-radius', '255'],
    ['build', 'x.json', '-o', 'y.json', '--max-radius', '0x10'], ['build', 'x.json', '-o', 'y.json', '--max-radius', ''],
    ['build', 'x.json', '-o', 'y.json', '--check', '--refresh'], ['build', 'missing.json', '-o', 'y.json'], ['check', 'x.json', '--bogus']]) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /^tz-at-point: /, args.join(' '));
    assert.doesNotMatch(r.stderr, /\n\s+at /, args.join(' '));
  }
});

test('every point that rounds onto a border entry is warned about, new or not', () => {
  const w = workspace([[51.4394, 4.9275]]); // Baarle-Nassau: radius 0
  const first = run('build', w.points, '-o', w.out);
  assert.equal(first.status, 0);
  assert.match(first.stderr, /warning: 51\.4394,4\.9275 is within 10m of another zone/);
  writeFileSync(w.points, JSON.stringify([[51.43941, 4.92751], [51.43942, 4.92752]]));
  const again = run('build', w.points, '-o', w.out);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /up to date/);
  assert.equal(again.stderr.match(/within 10m/g)?.length, 1); // two points, one key, one warning
});

test('an empty points file still creates a table to import', () => {
  const w = workspace([]);
  assert.equal(run('build', w.points, '-o', w.out, '--check').status, 1); // no table yet
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  assert.deepEqual(readOut(w.out), {});
});

test('--refresh says how many entries changed', () => {
  const w = workspace(LANDMARKS.slice(0, 1));
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  writeFileSync(w.out, JSON.stringify({ v: 1, points: { '51.5561,-0.2794': ['Europe/Paris', 250] } }));
  assert.match(run('build', w.points, '-o', w.out, '--refresh').stdout, /1 changed/);
});

test('writes through a symlinked table, keeps its permissions, and leaves no temp files', () => {
  const w = workspace(LANDMARKS.slice(0, 1));
  const real = join(w.dir, 'real.json');
  writeFileSync(real, '{"v":1,"points":{}}');
  chmodSync(real, 0o600);
  symlinkSync(real, w.out);
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  assert.ok(lstatSync(w.out).isSymbolicLink());
  assert.equal(Object.keys(readOut(real)).length, 1);
  assert.equal(statSync(real).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(w.dir).sort(), ['points.json', 'real.json', 'zones.json']);
});

test('a missing output directory fails before any work, and paths are printed safely', () => {
  const w = workspace(LANDMARKS.slice(0, 1));
  const r = run('build', w.points, '-o', join(w.dir, 'no\n::error::dir', 'zones.json'));
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trimEnd().split('\n').length, 1, r.stderr);
});

test('paths and counts in --check output are escaped and read correctly', () => {
  const w = workspace(LANDMARKS.slice(0, 1));
  const weird = join(w.dir, 'z\u00f6n\nes.json');
  const r = run('build', w.points, '-o', weird, '--check');
  assert.equal(r.status, 1);
  assert.equal(r.stdout.split('\n').length, 4, r.stdout); // heading, key, run line, trailing newline
  assert.doesNotMatch(r.stdout, /\u00f6/);
  assert.match(r.stdout, /run: npx tz-at-point build/);
});

test('--max-radius 0 stores radius 0 without claiming every point is on a border', () => {
  const w = workspace(LANDMARKS.slice(0, 1));
  const r = run('build', w.points, '-o', w.out, '--max-radius', '0');
  assert.equal(r.status, 0);
  assert.equal(readOut(w.out)['51.5561,-0.2794'][1], 0);
  assert.equal(r.stderr, '');
});

test('counts read as English', () => {
  const w = workspace(LANDMARKS.slice(0, 1));
  run('build', w.points, '-o', w.out);
  assert.match(run('check', w.out).stdout, /ok: 1 point matches the polygons/);
  const two = workspace(LANDMARKS.slice(0, 2));
  run('build', two.points, '-o', two.out);
  assert.match(run('check', two.out).stdout, /ok: 2 points match the polygons/);
});

test('a dangling symlink target is created, not replaced by a regular file', () => {
  const w = workspace(LANDMARKS.slice(0, 1));
  const real = join(w.dir, 'real.json');
  symlinkSync(real, w.out);
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  assert.ok(lstatSync(w.out).isSymbolicLink());
  assert.equal(Object.keys(readOut(real)).length, 1);
});

test('concurrent builds keep every entry each of them reported writing', () => {
  const w = workspace([[51.5561, -0.2794]]);
  const madrid = join(w.dir, 'madrid.json');
  const tokyo = join(w.dir, 'tokyo.json');
  writeFileSync(madrid, JSON.stringify([[40.4168, -3.7038]]));
  writeFileSync(tokyo, JSON.stringify([[35.6762, 139.6503]]));
  const runs = [w.points, madrid, tokyo].map((points) =>
    spawnSync(process.execPath, ['-e', `require('node:child_process').spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(CLI)}, 'build', ${JSON.stringify(points)}, '-o', ${JSON.stringify(w.out)}], { stdio: 'inherit' })`], { encoding: 'utf8' }));
  // (spawnSync is sequential; the real race is exercised by the parallel runs below)
  for (const r of runs) assert.equal(r.status, 0, r.stderr);
  const parallel = spawnSync(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const points = ${JSON.stringify([w.points, madrid, tokyo])};
    let done = 0;
    for (const p of points) spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(CLI)}, 'build', p, '-o', ${JSON.stringify(w.out)}, '--refresh'], { stdio: 'ignore' })
      .on('exit', (code) => { if (code !== 0) process.exitCode = 1; if (++done === points.length) process.exit(process.exitCode ?? 0); });
  `], { encoding: 'utf8' });
  assert.equal(parallel.status, 0, parallel.stderr);
  assert.deepEqual(Object.keys(readOut(w.out)).sort(), ['35.6762,139.6503', '40.4168,-3.7038', '51.5561,-0.2794']);
});

test('the table records the geo-tz that produced it, and check reports what is installed now', () => {
  const w = workspace(LANDMARKS.slice(0, 1));
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
  const installed = JSON.parse(readFileSync(new URL('../node_modules/geo-tz/package.json', import.meta.url), 'utf8')).version;
  assert.equal(JSON.parse(readFileSync(w.out, 'utf8')).geoTz, installed);

  const ok = run('check', w.out);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, new RegExp(`built with geo-tz ${installed.replace(/\./g, '\\.')}`));

  const table = JSON.parse(readFileSync(w.out, 'utf8'));
  table.geoTz = '8.0.0';
  writeFileSync(w.out, JSON.stringify(table));
  const drifted = run('check', w.out);
  assert.equal(drifted.status, 0, 'a newer geo-tz is not a failure on its own');
  assert.match(drifted.stdout, /built with geo-tz 8\.0\.0, checked against/);
});

test('the table records the --max-radius it was built with, and a later build re-resolves rather than mixing', () => {
  const w = workspace([[51.5561, -0.2794]]);
  assert.equal(run('build', w.points, '-o', w.out, '--max-radius', '0').status, 0);
  assert.equal(JSON.parse(readFileSync(w.out, 'utf8')).maxRadius, 0);
  assert.equal(readOut(w.out)['51.5561,-0.2794'][1], 0);

  const again = run('build', w.points, '-o', w.out); // default 250
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readOut(w.out)['51.5561,-0.2794'][1], 250, 'radii should follow the --max-radius in force');
  assert.equal(again.stderr, '', 'a radius of 0 that came from --max-radius 0 is not a border warning');
  assert.match(again.stdout, /re-resolved/);
});

test('build works where fsync and fchmod are unavailable', () => {
  const w = workspace(LANDMARKS.slice(0, 1));
  const permission = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
  const r = spawnSync(process.execPath, [permission, `--allow-fs-read=*`, `--allow-fs-write=${w.dir}/*`, CLI, 'build', w.points, '-o', w.out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(Object.keys(readOut(w.out)).length, 1);
});

test('a long output filename still fits a temp file', () => {
  const w = workspace(LANDMARKS.slice(0, 1));
  const long = join(w.dir, `${'a'.repeat(240)}.json`);
  const r = run('build', w.points, '-o', long);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(Object.keys(readOut(long)).length, 1);
});

test('Node\'s own multi-line errors stay readable', () => {
  const r = run('build', 'x.json', '-o', 'y.json', '--max-radius', '-10');
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr, /\\u000a/);
});

test('--help works on subcommands, and extensions are case-insensitive', () => {
  assert.equal(run('build', '--help').status, 0);
  assert.equal(run('check', '-h').status, 0);
  const w = workspace(LANDMARKS.slice(0, 1), 'POINTS.JSON');
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
});
