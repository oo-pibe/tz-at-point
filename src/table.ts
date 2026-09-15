import { pointKey } from './key.ts';

/** The committed table: `pointKey` → [IANA zone, safe radius in metres]. */
export interface Table {
  v: 1;
  points: Record<string, [zone: string, radius: number]>;
}

export interface Entry {
  key: string;
  lat: number;
  lng: number;
  zone: string;
  radius: number;
}

/** The largest radius a table may hold, in metres. */
export const MAX_RADIUS = 1000;

/** An IANA zone name: `UTC`, `Etc/GMT+12`, `America/Argentina/Buenos_Aires`. Nothing else reaches callers. */
const ZONE = /^[\w+-]{1,32}(\/[\w+-]{1,32}){0,2}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Validate a table and return its entries. Throws a TypeError naming the first problem. */
export function readTable(table: unknown): Entry[] {
  if (!isPlainObject(table)) throw new TypeError('pinzone: table must be a plain object');
  if (table.v !== 1) throw new TypeError(`pinzone: unsupported table version ${JSON.stringify(table.v)}`);
  if (!isPlainObject(table.points)) throw new TypeError('pinzone: table.points must be a plain object');

  return Object.entries(table.points).map(([key, value]) => {
    // JSON.stringify escapes control characters, so a hostile key cannot forge lines in a log.
    const entry = `pinzone: table entry ${JSON.stringify(key)}`;
    const [lat, lng] = key.split(',').map(Number);
    if (pointKey(lat, lng) !== key) throw new TypeError(`${entry} is not a canonical point key`);
    if (!Array.isArray(value) || value.length !== 2) throw new TypeError(`${entry} must map to [zone, radius]`);
    const [zone, radius] = value;
    if (typeof zone !== 'string' || !ZONE.test(zone)) throw new TypeError(`${entry} has an invalid zone name`);
    if (!Number.isInteger(radius) || radius < 0 || radius > MAX_RADIUS) {
      throw new TypeError(`${entry} has radius ${JSON.stringify(radius)}; expected an integer from 0 to ${MAX_RADIUS}`);
    }
    return { key, lat, lng, zone, radius };
  });
}

/** Serialise a table with sorted keys, one entry per line, so diffs stay readable. */
export function formatTable(points: Map<string, [string, number]>): string {
  const lines = [...points].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n  "v": 1,\n  "points": {\n${lines.join(',\n')}${lines.length ? '\n' : ''}  }\n}\n`;
}
