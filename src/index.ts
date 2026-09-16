/**
 * tz-at-point: the IANA timezone at a coordinate, exact at the points you care about, with no file reads at
 * runtime.
 *
 * Workflow: list your points, run `npx tz-at-point build points.json -o zones.json` (needs geo-tz as a dev
 * dependency), commit zones.json, import it as JSON and call `createLookup(table)` once.
 *
 * Coding agents: the full guide is in this package at `skills/tz-at-point/SKILL.md`.
 *
 * @packageDocumentation
 */
import tzlookup from '@photostructure/tz-lookup';
import { createLookup as fromTable } from './lookup.ts';
import type { Lookup, Options } from './lookup.ts';

/**
 * Build a lookup from a table made by `npx tz-at-point build points.json -o zones.json`.
 *
 * Call it once, at module scope, with the table imported as JSON so your bundler embeds it; the lookup
 * then reads no files, which is what makes it safe in serverless functions. Points the table doesn't
 * cover are answered by a bundled raster unless you pass `fallback`. The table is validated here (it is
 * typed `unknown` because JSON imports are typed loosely): a malformed table throws a TypeError at
 * startup. The returned function never throws.
 *
 * @example
 * import { createLookup } from 'tz-at-point';
 * import table from './zones.json' with { type: 'json' };
 *
 * const zoneAt = createLookup(table);
 *
 * const { zone } = zoneAt(51.5561, -0.2794); // 'Europe/London'
 * const local = zone && new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeStyle: 'short' }).format(new Date('2026-11-14T19:45:00Z')); // '19:45'
 */
export const createLookup = (table: unknown, options?: Options | null): Lookup =>
  fromTable(table, { fallback: options?.fallback === undefined ? tzlookup : options.fallback });
export type { Lookup, Options, Result, Source } from './lookup.ts';
export { pointKey } from './key.ts';
export type { Table } from './table.ts';
