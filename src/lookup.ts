import tzlookup from '@photostructure/tz-lookup';
import { metres } from './geo.ts';
import { pointKey } from './key.ts';
import { MAX_RADIUS, readTable } from './table.ts';
import type { Entry } from './table.ts';

export type Source = 'table' | 'table-near' | 'raster';
export type Result = { zone: string; source: Source } | { zone: null; source: null };
export type Lookup = (lat: unknown, lng: unknown) => Result;

export interface Options {
  /** Answers points the table does not cover. Defaults to @photostructure/tz-lookup; `null` disables it. */
  fallback?: ((lat: number, lng: number) => string) | null;
}

/** A degree of latitude is at least 110.5km, so this window cannot exclude an entry within MAX_RADIUS. */
const LAT_WINDOW = MAX_RADIUS / 110_000;

/**
 * Build a lookup from a committed table. The table is validated here rather than typed as `Table`,
 * because a JSON import is typed loosely (`v: number`). Throws a TypeError if it is malformed; the
 * returned function never throws and never touches the filesystem.
 */
export function createLookup(table: unknown, { fallback = tzlookup }: Options = {}): Lookup {
  const entries = readTable(table);
  const exact = new Map(entries.map((e) => [e.key, e.zone]));
  const near = entries.filter((e) => e.radius > 0);

  return (lat, lng) => {
    const key = pointKey(lat, lng);
    if (key === null) return { zone: null, source: null };
    const hit = exact.get(key);
    if (hit !== undefined) return { zone: hit, source: 'table' };
    const zone = nearest(near, lat as number, lng as number);
    if (zone !== null) return { zone, source: 'table-near' };
    if (fallback) {
      try {
        const raster = fallback(lat as number, lng as number);
        if (typeof raster === 'string' && raster !== '') return { zone: raster, source: 'raster' };
      } catch {
        // A fallback failure is an unresolved point, not a crash.
      }
    }
    return { zone: null, source: null };
  };
}

/** Zone of the nearest entry whose own radius covers the point. `sorted` is ordered by latitude. */
function nearest(sorted: Entry[], lat: number, lng: number): string | null {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid].lat < lat - LAT_WINDOW) lo = mid + 1;
    else hi = mid;
  }
  let zone: string | null = null;
  let best = Infinity;
  for (let i = lo; i < sorted.length && sorted[i].lat <= lat + LAT_WINDOW; i++) {
    const e = sorted[i];
    const d = metres(lat, lng, e.lat, e.lng);
    if (d <= e.radius && d < best) {
      best = d;
      zone = e.zone;
    }
  }
  return zone;
}
