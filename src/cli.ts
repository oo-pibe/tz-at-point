#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import {
  accessSync, closeSync, constants, existsSync, fchmodSync, fsyncSync, openSync, readFileSync, realpathSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { keyOf, parseKey } from './key.ts';
import { pointsFromCsv, pointsFromJson, type Point } from './points.ts';
import { resolve, type Find } from './radius.ts';
import { formatTable, isRadius, MAX_RADIUS, RADIUS_STEP, readTable } from './table.ts';
import { printable } from './text.ts';

const USAGE = `usage:
  pinzone build <points.json|points.csv> -o <zones.json> [--check | --refresh] [--max-radius 250]
  pinzone check <zones.json>`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A path as it can be pasted into a POSIX shell. */
const shellQuote = (path: string) => (/^[\w./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`);

/** Print lines made from input safely, at most 20, then how many were left out. */
function printCapped(lines: string[], print = console.log): void {
  for (const line of lines.slice(0, 20)) print(printable(line));
  if (lines.length > 20) print(`...and ${lines.length - 20} more`);
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
  const lower = file.toLowerCase();
  if (lower.endsWith('.json')) return pointsFromJson(readJson(file));
  if (lower.endsWith('.csv')) return pointsFromCsv(readText(file));
  throw new Error(`${file}: points must be a .json or .csv file`);
}

/** The real file behind `out` (following a symlink), after checking its directory is writable. */
function writableTarget(out: string): string {
  const target = existsSync(out) ? realpathSync(out) : resolvePath(out);
  accessSync(dirname(target), constants.W_OK);
  return target;
}

/**
 * Replace `target` in one rename: an unguessable temp file created exclusively (so nothing planted at
 * that name is followed), synced, renamed over the target, then the directory synced. A crash or power
 * loss leaves either the old table or the new one. The target's permissions are kept.
 */
function writeAtomically(target: string, text: string): void {
  const dir = dirname(target);
  const temp = join(dir, `.${basename(target)}.${randomUUID()}.tmp`);
  const fd = openSync(temp, 'wx', 0o644);
  try {
    if (existsSync(target)) fchmodSync(fd, statSync(target).mode & 0o777);
    writeFileSync(fd, text);
    fsyncSync(fd);
  } catch (err) {
    closeSync(fd);
    rmSync(temp, { force: true });
    throw err;
  }
  closeSync(fd);
  try {
    renameSync(temp, target);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
  try {
    const dirFd = openSync(dir, 'r');
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Not every platform can sync a directory; the rename has already happened.
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
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const [input] = positionals;
  const { out } = values;
  if (!input || !out || positionals.length > 1) throw new Error(USAGE);
  if (values.check && values.refresh) throw new Error('--check and --refresh cannot be combined');
  const maxRadius = /^\d+$/.test(values['max-radius']) ? Number(values['max-radius']) : NaN;
  if (!isRadius(maxRadius)) throw new Error(`--max-radius must be a multiple of ${RADIUS_STEP} from 0 to ${MAX_RADIUS}`);

  const exists = existsSync(out);
  const table = new Map<string, [string, number]>();
  if (exists) for (const e of readTable(readJson(out), out)) table.set(e.key, [e.zone, e.radius]);
  const points = readPoints(input).map((p) => ({ ...p, key: keyOf(p.lat, p.lng) }));
  const added = points.filter((p) => !table.has(p.key));
  const todo = new Set(added.map((p) => p.key));
  if (values.refresh) for (const key of table.keys()) todo.add(key);

  if (values.check) {
    if (exists && todo.size === 0) {
      console.log(`up to date: ${plural(table.size, 'point')}`);
      return 0;
    }
    console.log(exists ? `${plural(todo.size, 'point')} missing from ${out}:` : `${out} does not exist yet`);
    printCapped([...todo].sort().map((key) => `  ${key}`));
    console.log(printable(`run: pinzone build ${shellQuote(input)} -o ${shellQuote(out)}`));
    return 1;
  }

  const warnings = new Set<string>();
  if (todo.size > 0 || !exists) {
    const target = writableTarget(out);
    const before = new Map(table);
    if (todo.size > 0) {
      const find = await loadFind();
      for (const key of todo) {
        const [zone, radius] = resolve(find, ...parseKey(key), maxRadius);
        if (!zone) throw new Error(`no zone found for ${key}`);
        table.set(key, [zone, radius]);
      }
      // The table answers for the rounded key. Within a few metres of a border the point itself can be across it.
      for (const p of added) {
        const zone = find(p.lat, p.lng);
        const [keyZone] = table.get(p.key)!;
        if (zone !== keyZone) warnings.add(`warning: ${p.lat},${p.lng} is in ${zone}, but its key ${p.key} is in ${keyZone}; lookups there answer ${keyZone}`);
      }
    }
    writeAtomically(target, formatTable(table));
    const changed = [...before].filter(([key, [zone, radius]]) => table.get(key)![0] !== zone || table.get(key)![1] !== radius).length;
    console.log(printable(`wrote ${out}: ${plural(table.size, 'point')} (${todo.size} resolved${values.refresh ? `, ${changed} changed` : ''})`));
  } else {
    console.log(`up to date: ${plural(table.size, 'point')}`);
  }

  // A radius-0 entry still answers its whole ~11m key cell, including any part of it across the border.
  for (const p of points) {
    const [zone, radius] = table.get(p.key)!;
    if (radius === 0) warnings.add(`warning: ${p.key} is within 10m of another zone; lookups that round to it answer ${zone}, even from across the border`);
  }
  printCapped([...warnings], console.error);
  return 0;
}

async function check(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
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
    const message = err instanceof Error ? err.message : String(err);
    console.error(message === USAGE ? `pinzone: ${USAGE}` : `pinzone: ${printable(message)}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
