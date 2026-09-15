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
  const dir = mkdtempSync(join(tmpdir(), 'pinzone-'));
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
    assert.match(r.stderr, /^pinzone: /, args.join(' '));
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

test('--help works on subcommands, and extensions are case-insensitive', () => {
  assert.equal(run('build', '--help').status, 0);
  assert.equal(run('check', '-h').status, 0);
  const w = workspace(LANDMARKS.slice(0, 1), 'POINTS.JSON');
  assert.equal(run('build', w.points, '-o', w.out).status, 0);
});
