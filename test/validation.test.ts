import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metres } from '../src/geo.ts';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
function workspace(points: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'tz-at-point-mut3-'));
  writeFileSync(join(dir, 'points.json'), JSON.stringify(points));
  return { dir, points: join(dir, 'points.json'), out: join(dir, 'zones.json') };
}

// cli-6
test('exactly twenty missing keys are all listed, with nothing left over', () => {
  const w = workspace(Array.from({ length: 20 }, (_, i) => [50 + i / 1000, 0]));
  const r = run('build', w.points, '-o', w.out, '--check');
  assert.equal(r.status, 1);
  assert.equal(r.stdout.split('\n').filter((l) => /^ {2}\d/.test(l)).length, 20);
  assert.doesNotMatch(r.stdout, /more$/m, r.stdout);
});

// cli-11
test('an unwritable output directory is refused by name, before any point is resolved', () => {
  const w = workspace([[51.5561, -0.2794]]);
  const ro = mkdtempSync(join(tmpdir(), 'tz-at-point-ro-'));
  chmodSync(ro, 0o555);
  try {
    const r = run('build', w.points, '-o', join(ro, 'zones.json'));
    assert.equal(r.status, 2);
    assert.equal(r.stderr.trim(), `tz-at-point: EACCES: permission denied, access '${ro}'`);
  } finally {
    chmodSync(ro, 0o755);
  }
});

// cli-14
test('the table is created 0644 even when the shell asks for more', () => {
  const w = workspace([[51.5561, -0.2794]]);
  const r = spawnSync('/bin/sh', ['-c', `umask 000; ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} build ${JSON.stringify(w.points)} -o ${JSON.stringify(w.out)}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((statSync(w.out).mode & 0o777).toString(8), '644');
});

// geo-5
test('an exactly antipodal pair does not fall out of the arcsine domain', () => {
  const m = metres(-15.608468698337674, 32.2642691899091, 15.608468698337674, -147.7357308100909);
  assert.ok(Number.isFinite(m), `${m}`);
  assert.ok(Math.abs(m - 20_015_100) < 200, `${m}`);
});
