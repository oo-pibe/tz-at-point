# pinzone API

```ts
import { createLookup, pointKey, type Lookup, type Options, type Result, type Source, type Table } from 'pinzone';
```

Node 22 or later. Published types work with TypeScript 5.0 or later.

## `createLookup(table, options?)`

```ts
function createLookup(table: unknown, options?: Options): Lookup;
```

Builds a lookup from a table written by `pinzone build`. Call it once per process, at module scope: it validates the table and builds a grid index (about 75ms and 13MB for 30,000 entries). Each lookup then takes about a microsecond.

- `table` is typed `unknown` so a JSON import passes without a cast. It is validated at runtime.
- Throws a `TypeError` if the table is malformed. The message starts with `pinzone table:` and names the first bad entry.
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

- `fallback` defaults to `@photostructure/tz-lookup`: a 73KB raster, no file reads, approximate near borders.
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

The table key for a coordinate: `pointKey(51.55614, -0.27936)` is `'51.5561,-0.2794'`. Returns `null` when the input is not a coordinate. Longitude -180 is written as 180. Useful for checking whether a point is in a table: `pointKey(lat, lng) in table.points`.

## `Table`

```ts
interface Table {
  v: 1;
  points: Record<string, [zone: string, radius: number]>;
}
```

```json
{
  "v": 1,
  "points": {
    "51.4394,4.9275": ["Europe/Amsterdam",0],
    "51.5561,-0.2794": ["Europe/London",250]
  }
}
```

- Keys: `lat,lng`, each with exactly 4 decimals, as `pointKey` produces them.
- Zone: an IANA name, letters, digits, `_`, `+`, `-`, up to three `/`-separated parts.
- Radius: meters, a multiple of 10 from 0 to 1000. It is the widest disc around the key in which build's probes (10m apart) all found the same zone. Radius 0 means another zone is within 10m.
- The zone and radius are for the rounded key, not for the original input coordinate.
- `pinzone build` writes keys sorted, one entry per line. Don't edit the file by hand.
