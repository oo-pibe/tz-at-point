import { keyOf, latLng, parseKey } from './key.ts';
import { quote } from './text.ts';

/**
 * The table `pinzone build` writes: point key → [IANA zone, safe radius in metres]. Commit it and don't
 * edit it by hand; `pinzone build` adds points and `pinzone build --refresh` re-resolves them.
 *
 * @example
 * { "v": 1, "points": { "51.5561,-0.2794": ["Europe/London", 250], "51.4394,4.9275": ["Europe/Amsterdam", 0] } }
 */
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

/** Radii are multiples of the probe spacing, up to a kilometre. */
export const RADIUS_STEP = 10;
export const MAX_RADIUS = 1000;
export const isRadius = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_RADIUS && (n as number) % RADIUS_STEP === 0;

/** An IANA zone name: `UTC`, `Etc/GMT+12`, `America/Argentina/Buenos_Aires`. Nothing else reaches callers. */
export const isZone = (zone: unknown): zone is string => typeof zone === 'string' && /^[\w+-]{1,32}(\/[\w+-]{1,32}){0,2}$/.test(zone);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value != null && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Validate a table and return its entries. Throws a TypeError, prefixed with `name`, naming the first problem. */
export function readTable(table: unknown, name = 'pinzone table'): Entry[] {
  if (!isPlainObject(table)) throw new TypeError(`${name}: must be a plain object`);
  if (!Object.hasOwn(table, 'v') || table.v !== 1) throw new TypeError(`${name}: unsupported version ${quote(table.v)}`);
  if (!Object.hasOwn(table, 'points') || !isPlainObject(table.points)) throw new TypeError(`${name}: points must be a plain object`);

  const zones = new Set<unknown>(); // valid names already seen: a table repeats a few hundred at most
  const entries: Entry[] = [];
  for (const [key, value] of Object.entries(table.points)) {
    const fail = (problem: string) => new TypeError(`${name}: entry ${quote(key)} ${problem}`);
    const [lat, lng] = parseKey(key);
    if (!latLng(lat, lng) || keyOf(lat, lng) !== key) throw fail('is not a canonical point key');
    if (!Array.isArray(value) || value.length !== 2) throw fail('must map to [zone, radius]');
    const [zone, radius] = value;
    if (!zones.has(zone)) {
      if (!isZone(zone)) throw fail('has an invalid zone name');
      zones.add(zone);
    }
    if (!isRadius(radius)) throw fail(`has radius ${quote(radius)}; expected a multiple of ${RADIUS_STEP} from 0 to ${MAX_RADIUS}`);
    entries.push({ key, lat, lng, zone, radius });
  }
  return entries;
}

/** Serialise a table with sorted keys, one entry per line, so diffs stay readable. */
export function formatTable(points: Map<string, [string, number]>): string {
  const lines = [...points.keys()].sort().map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(points.get(key))}`);
  return `{\n  "v": 1,\n  "points": {\n${lines.join(',\n')}${lines.length ? '\n' : ''}  }\n}\n`;
}
