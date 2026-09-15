#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { keyOf, parseKey } from './key.ts';
import { pointsFromCsv, pointsFromJson, type Point } from './points.ts';
import { resolve, type Find } from './radius.ts';
import { formatTable, isRadius, MAX_RADIUS, RADIUS_STEP, readTable } from './table.ts';

const USAGE = `usage:
  pinzone build <points.json|points.csv> -o <zones.json> [--check | --refresh] [--max-radius 250]
  pinzone check <zones.json>`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Print at most 20 lines, then how many were left out. */
function printCapped(lines: string[]): void {
  for (const line of lines.slice(0, 20)) console.log(line);
  if (lines.length > 20) console.log(`...and ${lines.length - 20} more`);
}

async function loadFind(): Promise<Find> {
  // geo-tz/all, not the default export: the default dataset merges zones that have shared rules
  // since 1970, and answers Tromsø as Europe/Berlin.
  const geoTz = await import('geo-tz/all').catch((err) => {
    if (['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(err?.code)) {
      throw new Error('this command needs geo-tz 8.1 or later: npm install --save-dev geo-tz');
    }
    throw err;
  });
  return (lat, lng) => geoTz.find(lat, lng)[0];
}

/** A file's text, without a byte-order mark. */
const readText = (file: string) => readFileSync(file, 'utf8').replace(/^﻿/, '');

function readJson(file: string): unknown {
  const text = readText(file);
  try {
    return JSON.parse(text);
  } catch {
    // Not the parser's message: it quotes the file, and the file may not be what the user meant to pass.
    throw new Error(`${file}: not valid JSON`);
  }
}

function readPoints(file: string): Point[] {
  if (file.endsWith('.json')) return pointsFromJson(readJson(file));
  if (file.endsWith('.csv')) return pointsFromCsv(readText(file));
  throw new Error(`${file}: points must be a .json or .csv file`);
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
  const { out } = values;
  if (!input || !out || positionals.length > 1) throw new Error(USAGE);
  if (values.check && values.refresh) throw new Error('--check and --refresh cannot be combined');
  const maxRadius = /^\d+$/.test(values['max-radius']) ? Number(values['max-radius']) : NaN;
  if (!isRadius(maxRadius)) throw new Error(`--max-radius must be a multiple of ${RADIUS_STEP} from 0 to ${MAX_RADIUS}`);

  const table = new Map<string, [string, number]>();
  if (existsSync(out)) for (const e of readTable(readJson(out), out)) table.set(e.key, [e.zone, e.radius]);
  const added = readPoints(input).map((p) => ({ ...p, key: keyOf(p.lat, p.lng) })).filter((p) => !table.has(p.key));
  const todo = new Set(added.map((p) => p.key));
  if (values.refresh) for (const key of table.keys()) todo.add(key);

  if (todo.size === 0) {
    console.log(`up to date: ${plural(table.size, 'point')}`);
    return 0;
  }
  if (values.check) {
    console.log(`${plural(todo.size, 'point')} missing from ${out}:`);
    printCapped([...todo].sort().map((key) => `  ${key}`));
    console.log(`run: pinzone build ${input} -o ${out}`);
    return 1;
  }

  const find = await loadFind();
  for (const key of todo) {
    const [zone, radius] = resolve(find, ...parseKey(key), maxRadius);
    if (!zone) throw new Error(`no zone found for ${key}`);
    table.set(key, [zone, radius]);
  }
  // The table answers for the rounded key. Within a few metres of a border the point itself can be across it.
  for (const p of added) {
    const zone = find(p.lat, p.lng);
    const keyZone = table.get(p.key)![0];
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
  const [file] = positionals;
  const entries = readTable(readJson(file), file);
  const find = await loadFind();
  const failures: string[] = [];

  for (const zone of new Set(entries.map((e) => e.zone))) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
    } catch {
      failures.push(`FAIL ${zone}: not a zone this runtime's Intl accepts`);
    }
  }
  for (const { key, lat, lng, zone, radius } of entries) {
    const [truth, safe] = resolve(find, lat, lng, radius);
    if (truth !== zone) failures.push(`FAIL ${key}: table says ${zone}, polygons say ${truth}`);
    else if (safe < radius) failures.push(`FAIL ${key}: radius ${radius}m reaches another zone`);
  }

  if (failures.length === 0) {
    console.log(`ok: ${plural(entries.length, 'point')} match the polygons`);
    return 0;
  }
  printCapped(failures);
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
    console.error(`pinzone: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
