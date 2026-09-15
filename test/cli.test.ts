import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const tmp = () => mkdtempSync(join(tmpdir(), 'pinzone-'));

// Public landmarks: a city stadium, an enclave, a border town, a steppe capital, the Arctic.
const LANDMARKS = [[51.5561, -0.2794], [35.8854, -5.3279], [51.4394, 4.9275], [51.108, 71.407], [69.6496, 18.956]];

test('build writes a table the runtime accepts, with local zone names', () => {
  const d = tmp();
  writeFileSync(join(d, 'p.json'), JSON.stringify(LANDMARKS));
  const r = run('build', join(d, 'p.json'), '-o', join(d, 'zones.json'));
  assert.equal(r.status, 0, r.stderr);
  const t = JSON.parse(readFileSync(join(d, 'zones.json'), 'utf8'));
  assert.equal(t.points['69.6496,18.9560'][0], 'Europe/Oslo'); // geo-tz's default dataset says Europe/Berlin
  assert.equal(t.points['35.8854,-5.3279'][0], 'Africa/Ceuta');
  assert.equal(t.points['51.5561,-0.2794'][1], 500);
});

test('build only grows, and --check reports what is missing', () => {
  const d = tmp();
  writeFileSync(join(d, 'a.json'), JSON.stringify(LANDMARKS.slice(0, 2)));
  writeFileSync(join(d, 'b.json'), JSON.stringify(LANDMARKS.slice(2, 3)));
  const out = join(d, 'zones.json');
  assert.equal(run('build', join(d, 'a.json'), '-o', out).status, 0);
  const check = run('build', join(d, 'b.json'), '-o', out, '--check');
  assert.equal(check.status, 1);
  assert.match(check.stdout, /51\.4394,4\.9275/);
  assert.equal(run('build', join(d, 'b.json'), '-o', out).status, 0);
  assert.equal(Object.keys(JSON.parse(readFileSync(out, 'utf8')).points).length, 3);
  assert.equal(run('build', join(d, 'a.json'), '-o', out, '--check').status, 0);
});

test('check passes on a fresh table and fails on a wrong entry', () => {
  const d = tmp();
  writeFileSync(join(d, 'p.json'), JSON.stringify(LANDMARKS));
  const out = join(d, 'zones.json');
  assert.equal(run('build', join(d, 'p.json'), '-o', out).status, 0);
  const ok = run('check', out);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const t = JSON.parse(readFileSync(out, 'utf8'));
  t.points['51.5561,-0.2794'][0] = 'Europe/Paris';
  writeFileSync(out, JSON.stringify(t));
  const bad = run('check', out);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /51\.5561,-0\.2794/);
});

test('usage errors exit 2 with a message, not a stack trace', () => {
  for (const args of [[], ['nope'], ['build'], ['build', 'x.json'], ['build', 'x.txt', '-o', 'y.json'],
    ['build', 'x.json', '-o', 'y.json', '--max-radius', '5000'], ['build', 'x.json', '-o', 'y.json', '--check', '--refresh'],
    ['build', 'missing.json', '-o', 'y.json'], ['check', 'x.json', '--bogus']]) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /^pinzone: /, args.join(' '));
    assert.doesNotMatch(r.stderr, /\n\s+at /, args.join(' '));
  }
});
