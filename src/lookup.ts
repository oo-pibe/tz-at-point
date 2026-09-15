import tzlookup from '@photostructure/tz-lookup';
import { metres } from './geo.ts';
import { pointKey } from './key.ts';
import { readTable } from './table.ts';
import type { Entry } from './table.ts';

export type Source = 'table' | 'table-near' | 'raster';
export type Result = { zone: string; source: Source } | { zone: null; source: null };
export type Lookup = (lat: unknown, lng: unknown) => Result;

export interface Options {
  /** Answers points the table does not cover. Defaults to @photostructure/tz-lookup; `null` disables it. */
  fallback?: ((lat: number, lng: number) => string | null | undefined) | null;
}

/**
 * Near search reads one grid cell. Every entry is filed under each 0.01° cell its radius reaches,
 * so the cost of a lookup depends on how many entries overlap that spot, not on the table's size.
 */
const CELL = 0.01;
const COLUMNS = 360 / CELL;
/** Metres per degree of latitude, rounded down so an entry's cell span errs wide. */
const METRES_PER_DEGREE = 110_000;

const cellId = (row: number, column: number): number => row * COLUMNS + (((column % COLUMNS) + COLUMNS) % COLUMNS);

/** Every cell an entry's radius reaches. Near a pole that is every column. */
function* cellsReached({ lat, lng, radius }: Entry): Generator<number> {
  const dLat = radius / METRES_PER_DEGREE;
  const cos = Math.cos((Math.min(90, Math.abs(lat) + dLat) * Math.PI) / 180);
  const dLng = dLat / Math.max(cos, 1e-9);
  const [west, east] = dLng >= 180 ? [0, COLUMNS - 1] : [Math.floor((lng - dLng) / CELL), Math.floor((lng + dLng) / CELL)];
  for (let row = Math.floor((lat - dLat) / CELL); row <= Math.floor((lat + dLat) / CELL); row++) {
    for (let column = west; column <= east; column++) yield cellId(row, column);
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
    const key = pointKey(lat, lng);
    if (key === null) return { zone: null, source: null };
    const hit = exact.get(key);
    if (hit !== undefined) return { zone: hit, source: 'table' };
    const [y, x] = [lat as number, lng as number];
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
