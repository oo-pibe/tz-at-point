/**
 * pinzone: the IANA timezone at a coordinate, exact at the points you care about, with no file reads at
 * runtime.
 *
 * Workflow: list your points, run `npx pinzone build points.json -o zones.json` (needs geo-tz as a dev
 * dependency), commit zones.json, import it as JSON and call `createLookup(table)` once.
 *
 * Coding agents: the full guide is in this package at `skills/pinzone/SKILL.md`.
 *
 * @packageDocumentation
 */
export { createLookup } from './lookup.ts';
export type { Lookup, Options, Result, Source } from './lookup.ts';
export { pointKey } from './key.ts';
export type { Table } from './table.ts';
