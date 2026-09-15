#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { destination } from './geo.ts';
import { pointKey } from './key.ts';
import { createLookup } from './lookup.ts';
import { parsePoints } from './points.ts';
import { safeRadius } from './radius.ts';
import type { Find } from './radius.ts';
import { formatTable, MAX_RADIUS, readTable } from './table.ts';
import type { Table } from './table.ts';

const USAGE = `usage:
  pinzone build <points.json|points.csv> -o <zones.json> [--check | --refresh] [--max-radius 500]
  pinzone check <zones.json> [--samples 8] [--seed 1]`;

async function loadFind(): Promise<Find> {
  let geoTz;
  try {
    // geo-tz/all, not the default export: the default dataset merges zones that have shared rules
    // since 1970, and answers Tromsø as Europe/Berlin.
    geoTz = await import('geo-tz/all');
  } catch {
    throw new Error('this command needs geo-tz: npm install --save-dev geo-tz');
  }
  return (lat, lng) => geoTz.find(lat, lng)[0];
}

function integer(value: string | undefined, name: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`--${name} must be an integer from 0 to ${max}`);
  return n;
}

async function build(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      check: { type: 'boolean' },
      refresh: { type: 'boolean' },
      'max-radius': { type: 'string' },
    },
  });
  const [input] = positionals;
  const out = values.out;
  if (!input || !out || positionals.length > 1) throw new Error(USAGE);
  if (values.check && values.refresh) throw new Error('--check and --refresh cannot be combined');
  const maxRadius = integer(values['max-radius'], 'max-radius', 500, MAX_RADIUS);

  const points = parsePoints(readFileSync(input, 'utf8'), input);
  const table = new Map<string, [string, number]>(
    existsSync(out) ? readTable(JSON.parse(readFileSync(out, 'utf8'))).map((e) => [e.key, [e.zone, e.radius]]) : [],
  );
  const wanted = new Set(points.map((p) => pointKey(p.lat, p.lng) as string));
  if (values.refresh) for (const key of table.keys()) wanted.add(key);
  const todo = [...wanted].filter((key) => values.refresh || !table.has(key)).sort();

  if (values.check) {
    if (todo.length === 0) {
      console.log(`up to date: ${table.size} points`);
      return 0;
    }
    console.log(`${todo.length} point(s) missing from ${out}:`);
    for (const key of todo.slice(0, 20)) console.log(`  ${key}`);
    if (todo.length > 20) console.log(`  ...and ${todo.length - 20} more`);
    console.log(`run: pinzone build ${input} -o ${out}`);
    return 1;
  }

  const find = await loadFind();
  for (const key of todo) {
    const [lat, lng] = key.split(',').map(Number);
    const zone = find(lat, lng);
    if (!zone) throw new Error(`no zone found for ${key}`);
    table.set(key, [zone, safeRadius(find, lat, lng, zone, maxRadius)]);
  }
  writeFileSync(out, formatTable(table));
  console.log(`wrote ${out}: ${table.size} points (${todo.length} resolved)`);
  return 0;
}

async function check(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { samples: { type: 'string' }, seed: { type: 'string' } },
  });
  if (positionals.length !== 1) throw new Error(USAGE);
  const samples = integer(values.samples, 'samples', 8, 1000);
  let state = integer(values.seed, 'seed', 1, 2 ** 32 - 1);
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;

  const table = JSON.parse(readFileSync(positionals[0], 'utf8')) as Table;
  const entries = readTable(table);
  const lookup = createLookup(table);
  const find = await loadFind();
  const failures: string[] = [];
  let rasterAnswered = 0;
  let rasterDisagreed = 0;

  for (const zone of new Set(entries.map((e) => e.zone))) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
    } catch {
      failures.push(`${zone}: this runtime's Intl does not accept it`);
    }
  }

  for (const e of entries) {
    // Every table answer must match the polygons: the entry itself, and points inside its radius.
    const inside: [number, number][] = [[e.lat, e.lng]];
    for (let i = 0; i < samples && e.radius > 0; i++) {
      inside.push(destination(e.lat, e.lng, Math.sqrt(random()) * e.radius, random() * 360));
    }
    for (const [lat, lng] of inside) {
      const truth = find(lat, lng);
      const { zone } = lookup(lat, lng);
      if (zone !== truth && !truth?.startsWith('Etc/')) {
        failures.push(`${pointKey(lat, lng)} (entry ${e.key}): table says ${zone}, polygons say ${truth}`);
      }
    }
    // The raster is approximate by design: report how it does nearby, never fail on it.
    for (let i = 0; i < samples; i++) {
      const [lat, lng] = destination(e.lat, e.lng, 1000 + random() * 4000, random() * 360);
      const got = lookup(lat, lng);
      const truth = find(lat, lng);
      if (got.source !== 'raster' || !truth || truth.startsWith('Etc/')) continue;
      rasterAnswered++;
      if (got.zone !== truth) rasterDisagreed++;
    }
  }

  console.log(`${entries.length} points, ${samples} samples each`);
  console.log(`raster: ${rasterDisagreed} of ${rasterAnswered} nearby points outside the table disagreed with the polygons`);
  if (failures.length === 0) {
    console.log('ok: every table answer matches the polygons');
    return 0;
  }
  for (const f of failures.slice(0, 20)) console.log(`FAIL ${f}`);
  if (failures.length > 20) console.log(`...and ${failures.length - 20} more`);
  console.log('fix: rebuild the table with --refresh');
  return 1;
}

async function main([command, ...args]: string[]): Promise<number> {
  try {
    if (command === 'build') return await build(args);
    if (command === 'check') return await check(args);
    throw new Error(USAGE);
  } catch (err) {
    console.error(`pinzone: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
