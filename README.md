# pinzone

Find the IANA timezone at a coordinate, exactly, for the places you care about, with no file reads at runtime.

You resolve your points once, offline, against the real timezone boundary polygons, and commit the answers as a small JSON table. At runtime, pinzone checks that table first. If a point isn't in it, pinzone uses a compact raster lookup that works anywhere.

```ts
import { createLookup } from 'pinzone';
import table from './zones.json' with { type: 'json' };

const zoneAt = createLookup(table);

zoneAt(65.8481, 24.1466); // { zone: 'Europe/Helsinki', source: 'table' }
zoneAt(40.4168, -3.7038); // { zone: 'Europe/Madrid', source: 'raster' }
```

## Why

There are two good ways to turn a coordinate into a timezone in JavaScript, and each has a catch.

[geo-tz](https://github.com/evansiroky/node-geo-tz) is exact, because it uses the real boundary polygons. But it reads them from about 70MB of data files on disk. A bundler doesn't copy those files, so inside a bundled serverless function every lookup that needs them throws. You can copy the data yourself and point `GEO_TZ_DATA_PATH` at it, but then every deploy ships the full 70MB.

[@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup) is a compressed grid of the same boundaries. It's about 88KB of JavaScript and reads no files, so it works anywhere. It's also approximate. Near a border it can return the neighboring zone, and the neighbor doesn't always keep the same clocks. Checked against the polygons:

| Place | Raster says | Actually | Error |
|---|---|---|---|
| Tornio, Finland | Europe/Stockholm | Europe/Helsinki | 1 hour |
| Tabatinga, Brazil | America/Eirunepe | America/Manaus | 1 hour |
| Clair, New Brunswick | America/New_York | America/Moncton | 1 hour |

Those are 3 of 30 border towns I tested; it got the other 27 right. Across uniformly random land points, it returns a zone with a different UTC offset from the true one for about 1.7% of Europe, 2.7% of North America and 3.5% of the world.

If your points are city centers nowhere near a border, the raster alone is probably fine. If some of them sit near a border and a wrong hour matters, pinzone gives you exact answers at those points and keeps the raster for everything else.

## Install

```sh
npm install pinzone
npm install --save-dev geo-tz   # only needed to build the table
```

## Quick start

1. List your points in a JSON file, as `[lat, lng]` pairs or `{ "lat": …, "lng": … }` objects (other fields are ignored), or in a CSV with `lat` and `lng` columns:

   ```json
   [[65.8481, 24.1466], { "name": "Wembley", "lat": 51.5561, "lng": -0.2794 }]
   ```

2. Build the table and commit it:

   ```sh
   npx pinzone build points.json -o zones.json
   ```

3. Import the table and look up zones:

   ```ts
   import { createLookup } from 'pinzone';
   import table from './zones.json' with { type: 'json' };

   const zoneAt = createLookup(table);
   const { zone } = zoneAt(venue.lat, venue.lng);
   ```

Importing the table this way puts it inside your bundle, so nothing is read from disk when the function runs. The test suite checks this by running a bundled lookup under Node's permission model, allowed to read only the bundle file itself.

## The table

```json
{
  "v": 1,
  "points": {
    "51.4394,4.9275": ["Europe/Amsterdam",0],
    "65.8481,24.1466": ["Europe/Helsinki",250]
  }
}
```

Each key is a coordinate rounded to 4 decimal places, which is about 11 meters. Each value is the zone and a safe radius in meters.

Coordinates from real data sources wobble: the same venue can arrive a few meters to the east next week. The safe radius handles that. When the table is built, pinzone probes 32 bearings on rings from 10m out to 500m around each point, and records the widest ring where every probe is still in the same zone. A later lookup within that distance of the point gets the table's answer (`source: 'table-near'`). Baarle-Nassau, where Dutch and Belgian enclaves interlock street by street, gets a radius of 0, so nothing snaps across the border there.

The radius comes from probing, so it isn't a proof: a sliver of another zone narrower than the gap between probes could slip through. `pinzone check` tests random points inside every radius to catch that.

Probes that land in open sea (`Etc/GMT…` zones) count as agreeing, so a stadium on the coast keeps its radius.

## API

### `createLookup(table, options?)`

Returns `(lat, lng) => Result`.

```ts
type Result =
  | { zone: string; source: 'table' | 'table-near' | 'raster' }
  | { zone: null; source: null };
```

- `table`: exact key match.
- `table-near`: within an entry's safe radius (the nearest such entry wins).
- `raster`: not covered by the table, so the fallback answered.
- `null`: not a coordinate (not a number, non-finite, out of range), or no fallback answered.

The returned function never throws, whatever it's passed. `createLookup` itself throws a `TypeError` for a malformed table, so a bad table fails when your function starts, not on a live request.

Options:

- `fallback`: `(lat, lng) => string` for points the table doesn't cover. Defaults to `@photostructure/tz-lookup`. Pass `null` to answer only from the table.

### `pointKey(lat, lng)`

The table key for a coordinate (`"51.5561,-0.2794"`), or `null` if it isn't a valid coordinate.

## CLI

```sh
pinzone build <points.json|points.csv> -o <zones.json> [--check | --refresh] [--max-radius 500]
pinzone check <zones.json> [--samples 8] [--seed 1]
```

- `build` adds points that are missing from the table and never removes any. A place that disappears from your data for a season is still resolved when it comes back.
- `build --check` changes nothing and exits 1 if any point is missing from the table. Put it in CI, next to the step that updates your points.
- `build --refresh` re-resolves every entry. Use it after upgrading `geo-tz`, because boundaries do change.
- `--max-radius` sets the outermost probe ring, up to 1000m.
- `check` compares every table answer, and random points inside each radius, against the polygons, and exits 1 on any mismatch. It also reports how often the raster disagrees with the polygons near your points, without failing on it.

Exit codes: 0 for success, 1 when a check finds a problem, 2 for a usage error.

## Notes

The table is built with `geo-tz/all`, not geo-tz's default dataset. The default merges zones that have followed the same rules since 1970, which is why it answers `Europe/Berlin` for Tromsø. The offset is right, but nobody expects that name.

pinzone only tells you which zone a point is in. The UTC offset at a given moment comes from the timezone database in your JavaScript runtime (`Intl.DateTimeFormat`), and that database changes whenever a country changes its clocks. `pinzone check` flags any zone in your table that the current runtime doesn't recognize.

An entry with a radius of 0 still answers for its own 11m cell. Right on a border, that's still better information than the raster has.

## Origin

I built this for [Road to Kickoff](https://roadtokickoff.com), a football trip planner that shows every kickoff in the stadium's local time. The site's scheduled data refresh ran in a serverless function. There, geo-tz couldn't find its data files, and about a fifth of fixtures came back with no timezone, the same fixtures every run. A missing zone meant a kickoff shown at the wrong hour, with nothing on the page to say so. The fix was to resolve the stadiums offline, commit the answers and fall back to the raster for any new ground. This package is that fix, extracted for general use.

## License

MIT
