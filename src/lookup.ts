import tzlookup from '@photostructure/tz-lookup';
import { metres, mod, RAD } from './geo.ts';
import { keyOf, latLng } from './key.ts';
import { readTable, type Entry } from './table.ts';

export type Source = 'table' | 'table-near' | 'raster';
export type Result = { zone: string; source: Source } | { zone: null; source: null };
export type Lookup = (lat: unknown, lng: unknown) => Result;

export interface Options {
  /** Answers points the table does not cover. Defaults to @photostructure/tz-lookup; `null` disables it. */
  fallback?: ((lat: number, lng: number) => string | null | undefined) | null;
}

/**
 * Near search reads one grid cell. Every entry is filed under each 0.01° cell its radius reaches, so a
 * lookup's cost depends on how many entries overlap that spot, not on the size of the table.
 */
const CELL = 0.01;
const COLUMNS = 360 / CELL;
/** Rows beyond ±89°, where a radius spans too many columns to file, are each a single cell. */
const POLAR_ROW = 8900;
/** Metres per degree of latitude, rounded down so an entry's span errs wide. */
const METRES_PER_DEGREE = 110_000;

const cellId = (row: number, column: number) => row * COLUMNS + (Math.abs(row) >= POLAR_ROW ? 0 : mod(column, COLUMNS));

/** Every cell an entry's radius reaches. */
function* cellsReached({ lat, lng, radius }: Entry) {
  const dLat = radius / METRES_PER_DEGREE;
  const dLng = dLat / Math.max(Math.cos((Math.abs(lat) + dLat) * RAD), 1e-9);
  const west = Math.floor((lng - dLng) / CELL);
  const east = Math.min(Math.floor((lng + dLng) / CELL), west + COLUMNS - 1);
  for (let row = Math.floor((lat - dLat) / CELL); row <= Math.floor((lat + dLat) / CELL); row++) {
    if (Math.abs(row) >= POLAR_ROW) yield cellId(row, 0);
    else for (let column = west; column <= east; column++) yield cellId(row, column);
  }
}

/**
 * Build a lookup from a committed table. The table is validated here rather than typed as `Table`,
 * because a JSON import is typed loosely (`v: number`). Throws a TypeError if it is malformed; the
 * returned function never throws and never touches the filesystem.
 */
export function createLookup(table: unknown, { fallback = tzlookup }: Options = {}): Lookup {
  const exact = new Map<string, string>();
  const cells = new Map<number, Entry[]>();
  for (const entry of readTable(table)) {
    exact.set(entry.key, entry.zone);
    if (entry.radius === 0) continue;
    for (const id of cellsReached(entry)) {
      const list = cells.get(id);
      if (list) list.push(entry);
      else cells.set(id, [entry]);
    }
  }

  return (lat, lng) => {
    const point = latLng(lat, lng);
    if (!point) return { zone: null, source: null };
    const [y, x] = point;
    const hit = exact.get(keyOf(y, x));
    if (hit !== undefined) return { zone: hit, source: 'table' };
    const near = nearest(cells.get(cellId(Math.floor(y / CELL), Math.floor(x / CELL))), y, x);
    if (near !== null) return { zone: near, source: 'table-near' };
    if (fallback) {
      try {
        const zone = fallback(y, x);
        if (typeof zone === 'string' && zone !== '') return { zone, source: 'raster' };
      } catch {
        // A fallback failure is an unresolved point, not a crash.
      }
    }
    return { zone: null, source: null };
  };
}

/** Zone of the nearest entry whose own radius covers the point. */
function nearest(entries: Entry[] | undefined, lat: number, lng: number): string | null {
  let zone: string | null = null;
  let best = Infinity;
  for (const e of entries ?? []) {
    const d = metres(lat, lng, e.lat, e.lng);
    if (d <= e.radius && d < best) {
      best = d;
      zone = e.zone;
    }
  }
  return zone;
}
