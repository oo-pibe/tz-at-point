# tz-at-point API

```ts
import { createLookup, pointKey, type Lookup, type Options, type Result, type Source, type Table } from 'tz-at-point';
```

Node 20.19+ or 22.12+. Published types work with TypeScript 5.0 or later.

Two entry points, same function:

- `tz-at-point` answers points outside the table with a bundled raster (74KB in a bundle; 77KB with this package around it).
- `tz-at-point/core` has no fallback, so the raster never enters your bundle (~3KB). Points outside the table return `{ zone: null, source: null }` unless you pass your own `fallback`.

## `createLookup(table, options?)`

```ts
function createLookup(table: unknown, options?: Options): Lookup;
```

Builds a lookup from a table written by `tz-at-point build`. Call it once per process, at module scope: it validates the table and builds a grid index. For 30,000 entries that took 60-270ms and 10-15MB of heap at radius 250, more as radii grow. Each lookup then takes a microsecond or so.

- `table` is typed `unknown` so a JSON import passes without a cast. It is validated at runtime.
- Throws a `TypeError` if the table is malformed. The message starts with `tz-at-point table:` and names the first bad entry.
- The returned `Lookup` never throws and reads no files.

Resolution order for a lookup:

1. **Exact key.** The coordinate rounded to 4 decimals is in the table → `{ zone, source: 'table' }`. A key covers a cell about 11m across, including a radius-0 entry's cell, even if part of that cell is across a border.
2. **Nearest covering entry.** The nearest entry whose own safe radius contains the point → `source: 'table-near'`.
3. **Fallback.** `options.fallback(lat, lng)` → `source: 'raster'`, if it returns a valid zone name.
4. Otherwise `{ zone: null, source: null }`.

## `Options`

```ts
interface Options {
  fallback?: ((lat: number, lng: number) => string | null | undefined) | null;
}
```

- `fallback` defaults to `@photostructure/tz-lookup`: a 74KB raster once bundled, no file reads, approximate near borders.
- `fallback: null` answers only from the table; everything outside it returns `{ zone: null, source: null }`.
- A fallback that throws, returns a non-string, or returns something that is not a zone name is treated as no answer.

## `Lookup`

```ts
type Lookup = (lat: unknown, lng: unknown) => Result;
```

Accepts anything. `lat` and `lng` must be finite numbers with `|lat| <= 90` and `|lng| <= 180`; strings such as `'51.5'` are not coordinates and give `{ zone: null, source: null }`. Parse numbers before calling.

## `Result` and `Source`

```ts
type Source = 'table' | 'table-near' | 'raster';
type Result = { zone: string; source: Source } | { zone: null; source: null };
```

`zone` is an IANA name such as `Europe/London` or `America/Argentina/Buenos_Aires`. Use it with `Intl.DateTimeFormat(locale, { timeZone: zone, ... })` to format local times; the UTC offset on a given date comes from the runtime's timezone data.

## `pointKey(lat, lng)`

```ts
function pointKey(lat: unknown, lng: unknown): string | null;
```

The table key for a coordinate: `pointKey(51.55614, -0.27936)` is `'51.5561,-0.2794'`. Returns `null` when the input is not a coordinate. Longitude -180 is written as 180. Useful for checking whether a point is in a table:

```ts
const key = pointKey(lat, lng);
const known = key !== null && Object.hasOwn(table.points, key);
```

## Accuracy

A `table` or `table-near` answer matches the polygons, with two exceptions:

- Inside a key's ~11m cell, the key's zone is the answer, border or not.
- A piece of another zone smaller than the probe lattice can resolve (about 7m) can hide inside the radius. Everything larger is found, including near the radius edge, because the radius keeps a verified ring beyond it.

`raster` answers are approximate everywhere, and wrong near borders often enough to matter (see the README).

## `Table`

```ts
interface Table {
  v: 1;
  attribution?: string;
  maxRadius?: number;
  geoTz?: string;
  points: Record<string, [zone: string, radius: number]>;
}
```

```json
{
  "v": 1,
  "attribution": "Timezone boundaries from OpenStreetMap (https://www.openstreetmap.org/copyright), ODbL 1.0. Zone names from the IANA tz database, public domain.",
  "geoTz": "8.1.9",
  "maxRadius": 250,
  "points": {
    "51.4394,4.9275": ["Europe/Amsterdam",0],
    "51.5561,-0.2794": ["Europe/London",250]
  }
}
```

- Keys: `lat,lng`, each with exactly 4 decimals, as `pointKey` produces them.
- Zone: an IANA name, letters, digits, `_`, `+`, `-`, up to three `/`-separated parts.
- Radius: meters, a multiple of 10 from 0 to 1000. It is the widest disc around the key that build's probes vouch for: a ~10m lattice, with a whole verified ring beyond the radius itself, because a ring only samples its circle at intervals. Radius 0 means another zone is within 10m, unless the table was built with `--max-radius 0`.
- `maxRadius`: the `--max-radius` the table was built with. A later `build` with a different value re-resolves every entry, because a radius means nothing without the cap it was probed under.
- `geoTz`: the geo-tz version whose boundaries produced these zones. `check` prints it, so a boundary data bump is visible in a diff instead of silent.
- The zone and radius are for the rounded key, not for the original input coordinate.
- `tz-at-point build` writes keys sorted, one entry per line. Don't edit the file by hand.
