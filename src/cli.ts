#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pointKey } from './key.ts';
import { parsePoints } from './points.ts';
import { PROBE_SPACING, safeRadius } from './radius.ts';
import type { Find } from './radius.ts';
import { formatTable, MAX_RADIUS, readTable } from './table.ts';

const USAGE = `usage:
  pinzone build <points.json|points.csv> -o <zones.json> [--check | --refresh] [--max-radius 250]
  pinzone check <zones.json>`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function loadFind(): Promise<Find> {
  let geoTz: typeof import('geo-tz/all');
  try {
    // geo-tz/all, not the default export: the default dataset merges zones that have shared rules
    // since 1970, and answers Tromsø as Europe/Berlin.
    geoTz = await import('geo-tz/all');
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      throw new Error('this command needs geo-tz 8.1 or later: npm install --save-dev geo-tz');
    }
    throw err;
  }
  return (lat, lng) => geoTz.find(lat, lng)[0];
}

function readTableFile(file: string): Map<string, [string, number]> {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    // Not the parser's message: it quotes the file, and the file may not be what the user meant to pass.
    throw err instanceof SyntaxError ? new Error(`${file}: not valid JSON`) : err;
  }
  return new Map(readTable(json).map((e) => [e.key, [e.zone, e.radius]]));
}

/** Replace `file` in one rename, so a failed write never leaves a truncated table behind. */
function writeAtomically(file: string, text: string): void {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text);
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

async function build(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      check: { type: 'boolean' },
      refresh: { type: 'boolean' },
      'max-radius': { type: 'string', default: '250' },
    },
  });
  const [input] = positionals;
  const out = values.out;
  if (!input || !out || positionals.length > 1) throw new Error(USAGE);
  if (values.check && values.refresh) throw new Error('--check and --refresh cannot be combined');
  const maxRadius = Number(values['max-radius']);
  if (!/^\d+$/.test(values['max-radius']) || maxRadius > MAX_RADIUS || maxRadius % PROBE_SPACING !== 0) {
    throw new Error(`--max-radius must be a multiple of ${PROBE_SPACING} from 0 to ${MAX_RADIUS}`);
  }

  const table = existsSync(out) ? readTableFile(out) : new Map<string, [string, number]>();
  const added = parsePoints(readFileSync(input, 'utf8'), input)
    .map((p) => ({ ...p, key: pointKey(p.lat, p.lng) as string }))
    .filter((p) => !table.has(p.key));
  const todo = new Set(added.map((p) => p.key));
  if (values.refresh) for (const key of table.keys()) todo.add(key);

  if (values.check) {
    if (todo.size === 0) {
      console.log(`up to date: ${plural(table.size, 'point')}`);
      return 0;
    }
    console.log(`${plural(todo.size, 'point')} missing from ${out}:`);
    const missing = [...todo].sort();
    for (const key of missing.slice(0, 20)) console.log(`  ${key}`);
    if (missing.length > 20) console.log(`  ...and ${missing.length - 20} more`);
    console.log(`run: pinzone build ${input} -o ${out}`);
    return 1;
  }
  if (todo.size === 0) {
    console.log(`up to date: ${plural(table.size, 'point')}`);
    return 0;
  }

  const find = await loadFind();
  for (const key of todo) {
    const [lat, lng] = key.split(',').map(Number);
    const zone = find(lat, lng);
    if (!zone) throw new Error(`no zone found for ${key}`);
    table.set(key, [zone, safeRadius(find, lat, lng, zone, maxRadius)]);
  }
  // The table answers for the rounded key. Within a few metres of a border the point itself can be across it.
  for (const p of added) {
    const zone = find(p.lat, p.lng);
    const [keyZone] = table.get(p.key) as [string, number];
    if (zone !== keyZone) {
      console.error(`warning: ${p.lat},${p.lng} is in ${zone}, but its key ${p.key} is in ${keyZone}; lookups there answer ${keyZone}`);
    }
  }
  writeAtomically(out, formatTable(table));
  console.log(`wrote ${out}: ${plural(table.size, 'point')} (${todo.size} resolved)`);
  return 0;
}

async function check(args: string[]): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  if (positionals.length !== 1) throw new Error(USAGE);
  const table = readTableFile(positionals[0]);
  const find = await loadFind();
  const failures: string[] = [];

  for (const zone of new Set([...table.values()].map(([z]) => z))) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
    } catch {
      failures.push(`${zone}: not a zone this runtime's Intl accepts`);
    }
  }
  // The same probe build uses, against the polygons installed now: catches boundary changes and hand edits.
  for (const [key, [zone, radius]] of table) {
    const [lat, lng] = key.split(',').map(Number);
    const truth = find(lat, lng);
    if (truth !== zone) failures.push(`${key}: table says ${zone}, polygons say ${truth}`);
    else if (safeRadius(find, lat, lng, zone, radius) < radius) failures.push(`${key}: radius ${radius}m reaches another zone`);
  }

  if (failures.length === 0) {
    console.log(`ok: ${plural(table.size, 'point')} match the polygons`);
    return 0;
  }
  for (const f of failures.slice(0, 20)) console.log(`FAIL ${f}`);
  if (failures.length > 20) console.log(`...and ${failures.length - 20} more`);
  console.log('fix: rebuild the table with --refresh');
  return 1;
}

async function main([command, ...args]: string[]): Promise<number> {
  if (command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }
  try {
    if (command === 'build') return await build(args);
    if (command === 'check') return await check(args);
    throw new Error(USAGE);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message.startsWith('pinzone: ') ? message : `pinzone: ${message}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
