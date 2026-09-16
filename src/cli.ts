#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import {
  accessSync, closeSync, constants, existsSync, fchmodSync, fsyncSync, lstatSync, openSync, readFileSync, readlinkSync,
  realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { keyOf, parseKey } from './key.ts';
import { pointsFromCsv, pointsFromJson, type Point } from './points.ts';
import { resolve, type Find } from './radius.ts';
import { formatTable, isRadius, MAX_RADIUS, RADIUS_STEP, readTable, tableGeoTz, tableMaxRadius } from './table.ts';
import { printable } from './text.ts';

const USAGE = `usage:
  tz-at-point build <points.json|points.csv> -o <zones.json> [--check | --refresh] [--max-radius 250]
  tz-at-point check <zones.json>`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const verb = (n: number, singular: string, plural_: string) => (n === 1 ? singular : plural_);

/** A path as it can be pasted into a POSIX shell. */
const shellQuote = (path: string) => (/^[\w./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`);

/** Print lines made from input safely, at most 20, then how many were left out. */
function printCapped(lines: string[], print = console.log): void {
  for (const line of lines.slice(0, 20)) print(printable(line));
  if (lines.length > 20) print(`...and ${lines.length - 20} more`);
}

/** The installed geo-tz version, recorded in the table so a boundary bump shows up in the diff. */
function geoTzVersion(): string | undefined {
  try {
    // geo-tz does not export ./package.json, so resolve the dataset entry and walk up out of dist/.
    const entry = new URL(import.meta.resolve('geo-tz/all'));
    return JSON.parse(readFileSync(new URL('../package.json', entry), 'utf8')).version;
  } catch {
    return undefined;
  }
}

async function loadFind(): Promise<Find> {
  // geo-tz/all, not the default export: the default dataset merges zones that have shared rules
  // since 1970, and answers Tromsø as Europe/Berlin.
  const geoTz = await import('geo-tz/all').catch((err) => {
    if (['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(err?.code)) {
      throw new Error('this command needs geo-tz 8 or later: npm install --save-dev geo-tz');
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
  // A symlink is followed even when its target does not exist yet, so the link survives the write.
  const link = lstatSync(out, { throwIfNoEntry: false })?.isSymbolicLink() ? resolvePath(dirname(out), readlinkSync(out)) : out;
  const target = existsSync(link) ? realpathSync(link) : resolvePath(link);
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
  // Bounded so a long but legal target name cannot push the temp name past NAME_MAX.
  const temp = join(dir, `.${basename(target).slice(0, 180)}.${randomUUID().slice(0, 8)}.tmp`);
  const fd = openSync(temp, 'wx', 0o644);
  try {
    // Node's permission model disables both of these; the rename still makes the swap atomic.
    if (existsSync(target)) tolerate(() => fchmodSync(fd, statSync(target).mode & 0o777));
    writeFileSync(fd, text);
    tolerate(() => fsyncSync(fd));
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
  tolerate(() => {
    const dirFd = openSync(dir, 'r');
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  });
}

/** Durability extras that some environments forbid (Node's permission model, odd filesystems). */
function tolerate(action: () => void): void {
  try {
    action();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'ERR_ACCESS_DENIED' && code !== 'EPERM' && code !== 'EINVAL' && code !== 'ENOTSUP') throw err;
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
  const readCommitted = () => (existsSync(out) ? readTable(readJson(out), out) : []);
  const table = new Map<string, [string, number]>(readCommitted().map((e) => [e.key, [e.zone, e.radius]]));
  const builtWith = exists ? tableMaxRadius(readJson(out)) : undefined;
  // Radii mean nothing without the cap they were probed under, so a different --max-radius re-resolves.
  const reResolve = values.refresh || (builtWith !== undefined && builtWith !== maxRadius);
  const points = readPoints(input).map((p) => ({ ...p, key: keyOf(p.lat, p.lng) }));
  const added = points.filter((p) => !table.has(p.key));
  const todo = new Set(added.map((p) => p.key));
  if (reResolve) for (const key of table.keys()) todo.add(key);

  if (values.check) {
    if (exists && todo.size === 0) {
      console.log(`up to date: ${plural(table.size, 'point')}`);
      return 0;
    }
    console.log(printable(exists ? `${plural(todo.size, 'point')} missing from ${out}:` : `${out} does not exist yet`));
    printCapped([...todo].sort().map((key) => `  ${key}`));
    const sameRadius = values['max-radius'] === '250' ? '' : ` --max-radius ${maxRadius}`;
    console.log(printable(`run: npx tz-at-point build ${shellQuote(input)} -o ${shellQuote(out)}${sameRadius}`));
    return 1;
  }

  const warnings = new Set<string>();
  let geoTz: string | undefined;
  if (todo.size > 0 || !exists) {
    const target = writableTarget(out);
    const before = new Map(table);
    if (todo.size > 0) {
      const find = await loadFind();
      geoTz = geoTzVersion();
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
    // Another build may have written between our read and this write: merge with whatever is on disk now,
    // keeping our freshly resolved entries, and confirm the file we leave behind holds all of them.
    for (let attempt = 1; ; attempt++) {
      for (const e of readCommitted()) if (!table.has(e.key)) table.set(e.key, [e.zone, e.radius]);
      writeAtomically(target, formatTable(table, maxRadius, geoTz ?? tableGeoTz(exists ? readJson(out) : undefined)));
      const committed = new Map(readCommitted().map((e) => [e.key, `${e.zone},${e.radius}`]));
      const lost = [...table].filter(([key, [zone, radius]]) => committed.get(key) !== `${zone},${radius}`);
      if (lost.length === 0) break;
      if (attempt === 5) throw new Error(`${out} kept changing underneath this build; run it again`);
    }
    const changed = [...before].filter(([key, [zone, radius]]) => table.get(key)![0] !== zone || table.get(key)![1] !== radius).length;
    const detail = reResolve ? `, ${changed} changed` : '';
    const what = reResolve && !values.refresh ? `re-resolved at --max-radius ${maxRadius}: ` : '';
    console.log(printable(`${what}wrote ${out}: ${plural(table.size, 'point')} (${todo.size} resolved${detail})`));
  } else {
    console.log(`up to date: ${plural(table.size, 'point')}`);
  }

  // A radius-0 entry still answers its whole ~11m key cell, including any part of it across the border.
  // A radius of 0 that came from --max-radius 0 says nothing about borders, so it earns no warning.
  for (const p of maxRadius === 0 ? [] : points) {
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
  const raw = readJson(file);
  const entries = readTable(raw, file);
  const find = await loadFind();
  const builtWith = tableGeoTz(raw);
  const installed = geoTzVersion();
  if (builtWith && installed && builtWith !== installed) {
    console.log(`built with geo-tz ${builtWith}, checked against ${installed}`);
  } else if (builtWith) {
    console.log(`built with geo-tz ${builtWith}`);
  }

  const unknownZones: string[] = [];
  for (const zone of new Set(entries.map((e) => e.zone))) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
    } catch {
      unknownZones.push(`FAIL ${zone}: not a zone this runtime's Intl accepts`);
    }
  }
  const stale: string[] = [];
  for (const { key, lat, lng, zone, radius } of entries) {
    const [truth, safe] = resolve(find, lat, lng, radius);
    if (truth !== zone) stale.push(`FAIL ${key}: table says ${zone}, polygons say ${truth}`);
    else if (safe < radius) stale.push(`FAIL ${key}: radius ${radius}m reaches another zone`);
  }

  if (unknownZones.length === 0 && stale.length === 0) {
    console.log(`ok: ${plural(entries.length, 'point')} ${verb(entries.length, 'matches', 'match')} the polygons`);
    return 0;
  }
  printCapped([...unknownZones, ...stale]);
  if (unknownZones.length) console.log("fix: update Node; its timezone data doesn't know these zones");
  if (stale.length) console.log('fix: rebuild the table with --refresh');
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
    // Usage and parseArgs guidance are several lines of tz-at-point's own text, so keep their newlines.
    // Everything else can carry a path or file content, where a newline would forge a log line.
    const message = err instanceof Error ? err.message : String(err);
    const ours = message === USAGE || String((err as { code?: string }).code).startsWith('ERR_PARSE_ARGS');
    console.error(`tz-at-point: ${printable(message, ours)}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
