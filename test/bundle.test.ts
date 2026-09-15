import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const permission = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';

/** Bundle `body` (with the package and a small table importable) and run it allowed to read only itself. */
async function runBundled(body: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pinzone-bundle-')));
  writeFileSync(join(dir, 'zones.json'), JSON.stringify({ v: 1, points: { '51.5561,-0.2794': ['Europe/London', 500] } }));
  writeFileSync(join(dir, 'entry.ts'), `
    import { createLookup } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).pathname)};
    import table from './zones.json';
    ${body}
  `);
  const out = join(dir, 'bundle.mjs');
  await build({ entryPoints: [join(dir, 'entry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent' });
  return spawnSync(process.execPath, [permission, `--allow-fs-read=${out}`, out], { cwd: dir, encoding: 'utf8' });
}

test('a bundled lookup answers with no filesystem access beyond its own file', async () => {
  const r = await runBundled(`
    const lookup = createLookup(table as any);
    console.log(JSON.stringify([lookup(51.5561, -0.2794), lookup(51.557, -0.2794), lookup(36.149, -5.352)]));
  `);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { zone: 'Europe/London', source: 'table' },
    { zone: 'Europe/London', source: 'table-near' },
    { zone: 'Europe/Gibraltar', source: 'raster' },
  ]);
});

test('the sandbox really does refuse file reads (so the test above means something)', async () => {
  const r = await runBundled(`
    import { readFileSync } from 'node:fs';
    readFileSync(${JSON.stringify(new URL('../package.json', import.meta.url).pathname)});
  `);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ERR_ACCESS_DENIED/);
});
