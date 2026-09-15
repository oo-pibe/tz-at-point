import tzlookup from '@photostructure/tz-lookup';
import { metres, mod, RAD } from './geo.ts';
import { keyOf, latLng } from './key.ts';
import { isZone, readTable, type Entry } from './table.ts';

/**
 * Where an answer came from.
 * - `table`: the coordinate rounds to a table key (4 decimals, a cell about 11m across).
 * - `table-near`: within the safe radius of the nearest covering table entry. A normal, correct answer.
 * - `raster`: not covered by the table, so the fallback answered. Approximate near borders.
 */
export type Source = 'table' | 'table-near' | 'raster';

/**
 * A lookup's answer. `zone` is an IANA name such as `Europe/London`; it is `null` only when the input is
 * not a coordinate, or no fallback is configured (or it had no answer) for a point outside the table.
 */
export type Result = { zone: string; source: Source } | { zone: null; source: null };

/** Answers the IANA zone at a coordinate. Never throws, whatever it is passed. */
export type Lookup = (lat: unknown, lng: unknown) => Result;

export interface Options {
  /**
   * Answers points the table does not cover. Defaults to `@photostructure/tz-lookup` (a 73KB raster, no
   * file reads). Pass `null` to answer only from the table. Answers that are not zone names are ignored.
   *
   * @example
   * const tableOnly = createLookup(table, { fallback: null });
   */
  fallback?: ((lat: number, lng: number) => string | null | undefined) | null;
}

/**
 * Near search reads one grid cell. Rows are 0.01° of latitude. Each row has fewer columns the nearer it
 * is to a pole, so every cell is at least ~1.1km wide, and an entry (radius at most 1km) reaches a
 * handful of cells anywhere on Earth. A lookup's cost depends on how many entries overlap that spot.
 */
const CELL = 0.01;
const EQUATOR_COLUMNS = 36_000;
/** Metres per degree of latitude, rounded down so an entry's span errs wide. */
const METRES_PER_DEGREE = 110_000;

/** Columns in a row, sized by the cosine of its poleward edge. */
const columnsIn = (row: number) =>
  Math.max(1, Math.floor(EQUATOR_COLUMNS * Math.cos(Math.min(90, Math.max(Math.abs(row), Math.abs(row + 1)) * CELL) * RAD)));
const columnOf = (lng: number, columns: number) => Math.floor(((lng + 180) / 360) * columns);
const cellId = (row: number, column: number, columns: number) => row * EQUATOR_COLUMNS + mod(column, columns);

/** Every cell an entry's radius reaches. Exported for tests. */
export function* cellsReached({ lat, lng, radius }: Entry) {
  const dLat = radius / METRES_PER_DEGREE;
  const dLng = dLat / Math.max(Math.cos((Math.abs(lat) + dLat) * RAD), 1e-9);
  for (let row = Math.floor((lat - dLat) / CELL); row <= Math.floor((lat + dLat) / CELL); row++) {
    const columns = columnsIn(row);
    const west = columnOf(lng - dLng, columns);
    const east = Math.min(columnOf(lng + dLng, columns), west + columns - 1);
    for (let column = west; column <= east; column++) yield cellId(row, column, columns);
  }
}

/**
 * Build a lookup from a table made by `npx pinzone build points.json -o zones.json`.
 *
 * Call it once, at module scope, with the table imported as JSON so your bundler embeds it; the lookup
 * then reads no files, which is what makes it safe in serverless functions. The table is validated here
 * (it is typed `unknown` because JSON imports are typed loosely): a malformed table throws a TypeError at
 * startup. The returned function never throws.
 *
 * @example
 * import { createLookup } from 'pinzone';
 * import table from './zones.json' with { type: 'json' };
 *
 * const zoneAt = createLookup(table);
 *
 * const { zone } = zoneAt(51.5561, -0.2794); // 'Europe/London'
 * const local = zone && new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeStyle: 'short' }).format(new Date('2026-11-14T19:45:00Z')); // '19:45'
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
    const row = Math.floor(y / CELL);
    const columns = columnsIn(row);
    const near = nearest(cells.get(cellId(row, columnOf(x, columns), columns)), y, x);
    if (near !== null) return { zone: near, source: 'table-near' };
    if (fallback) {
      try {
        const zone = fallback(y, x);
        if (isZone(zone)) return { zone, source: 'raster' };
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
