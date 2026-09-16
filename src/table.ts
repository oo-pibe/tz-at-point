import { keyOf, latLng, parseKey } from './key.ts';
import { quote } from './text.ts';

/**
 * The table `tz-at-point build` writes: point key → [IANA zone, safe radius in metres]. Commit it and don't
 * edit it by hand; `tz-at-point build` adds points and `tz-at-point build --refresh` re-resolves them.
 *
 * @example
 * { "v": 1, "points": { "51.5561,-0.2794": ["Europe/London", 250], "51.4394,4.9275": ["Europe/Amsterdam", 0] } }
 */
export interface Table {
  v: 1;
  /** The `--max-radius` the table was built with, so a later build can tell its radii apart from probed ones. */
  maxRadius?: number;
  /** The geo-tz version whose boundaries produced these zones, so a data bump is visible in the diff. */
  geoTz?: string;
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

/** True for a JSON-ish object, including one from another realm (whose Object.prototype is not ours). */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
};

/** Validate a table and return its entries. Throws a TypeError, prefixed with `name`, naming the first problem. */
export function readTable(table: unknown, name = 'tz-at-point table'): Entry[] {
  if (!isPlainObject(table)) throw new TypeError(`${name}: must be a plain object`);
  // `import * as table from './zones.json'` gives a module namespace, not the table.
  if ((table as { [Symbol.toStringTag]?: string })[Symbol.toStringTag] === 'Module') {
    throw new TypeError(`${name}: got a module namespace; pass the JSON module's default export`);
  }
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

/**
 * Where the zones came from. Not required: the OSM Foundation's geocoding guideline treats a collection
 * of query results like this as an insubstantial extract. It travels with the file so that whoever finds
 * it later knows to credit OpenStreetMap in anything they ship.
 */
const ATTRIBUTION = 'Timezone boundaries from OpenStreetMap (https://www.openstreetmap.org/copyright), '
  + 'ODbL 1.0. Zone names from the IANA tz database, public domain.';

/** Serialise a table with sorted keys, one entry per line, so diffs stay readable. */
export function formatTable(points: Map<string, [string, number]>, maxRadius: number, geoTz?: string): string {
  const lines = [...points.keys()].sort().map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(points.get(key))}`);
  const lineage = geoTz === undefined ? '' : `  "geoTz": ${JSON.stringify(geoTz)},\n`;
  return `{\n  "v": 1,\n  "attribution": ${JSON.stringify(ATTRIBUTION)},\n${lineage}  "maxRadius": ${maxRadius},`
    + `\n  "points": {\n${lines.join(',\n')}${lines.length ? '\n' : ''}  }\n}\n`;
}

/** The geo-tz version a table was built with, if it recorded one. */
export const tableGeoTz = (table: unknown): string | undefined => {
  const value = (table as { geoTz?: unknown } | null)?.geoTz;
  return typeof value === 'string' && /^[\w.+-]{1,32}$/.test(value) ? value : undefined;
};

/** The `--max-radius` a table was built with, if it recorded one. */
export const tableMaxRadius = (table: unknown): number | undefined => {
  const value = (table as { maxRadius?: unknown } | null)?.maxRadius;
  return isRadius(value) ? value : undefined;
};
