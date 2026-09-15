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

/** Radii are probed up to this, and the runtime near-search window assumes it. */
export const MAX_RADIUS = 1000;

/** Validate a table and return its entries sorted by latitude. Throws a TypeError naming the first problem. */
export function readTable(table: unknown): Entry[] {
  if (typeof table !== 'object' || table === null) throw new TypeError('pinzone: table must be an object');
  const { v, points } = table as Partial<Table>;
  if (v !== 1) throw new TypeError(`pinzone: unsupported table version ${JSON.stringify(v)}`);
  if (typeof points !== 'object' || points === null || Array.isArray(points)) throw new TypeError('pinzone: table.points must be an object');

  const entries: Entry[] = [];
  for (const [key, value] of Object.entries(points)) {
    const [lat, lng] = key.split(',').map(Number);
    if (pointKey(lat, lng) !== key) throw new TypeError(`pinzone: "${key}" is not a canonical point key`);
    if (!Array.isArray(value) || typeof value[0] !== 'string' || value[0] === '') throw new TypeError(`pinzone: "${key}" must map to [zone, radius]`);
    const radius = value[1];
    if (!Number.isInteger(radius) || radius < 0 || radius > MAX_RADIUS) {
      throw new TypeError(`pinzone: "${key}" has radius ${JSON.stringify(radius)}; expected an integer 0..${MAX_RADIUS}`);
    }
    entries.push({ key, lat, lng, zone: value[0], radius });
  }
  return entries.sort((a, b) => a.lat - b.lat);
}

/** Serialise a table with sorted keys, one entry per line, so diffs stay readable. */
export function formatTable(points: Map<string, [string, number]>): string {
  const lines = [...points].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n  "v": 1,\n  "points": {\n${lines.join(',\n')}${lines.length ? '\n' : ''}  }\n}\n`;
}
