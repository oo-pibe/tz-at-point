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

[geo-tz](https://github.com/evansiroky/node-geo-tz) is exact, because it uses the real boundary polygons. But it reads them from data files on disk (about 30MB for one dataset, 70MB for the package), and a bundler doesn't copy those files. Inside a bundled serverless function, every lookup that needs them throws. You can copy the data yourself and point `GEO_TZ_DATA_PATH` at it, but then every deploy carries it.

[@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup) is a compressed grid of the same boundaries. It's 73KB of JavaScript and reads no files, so it works anywhere. It's also approximate. Near a border it can return the neighboring zone, and the neighbor doesn't always keep the same clocks. Checked against the polygons:

| Place | Coordinate | Raster says | Actually | Error |
|---|---|---|---|---|
| Tornio, Finland | 65.8481, 24.1466 | Europe/Stockholm | Europe/Helsinki | 1 hour |
| Tabatinga, Brazil | -4.2527, -69.9381 | America/Eirunepe | America/Manaus | 1 hour |

Most places come out right; the misses cluster along borders. Compared against geo-tz at uniformly random points on land, the raster returns a zone with a different UTC offset for about 3% of the world, 2.7% of North America and 1 to 2% of Europe.

If your points are city centers nowhere near a border, the raster alone is probably fine. If some of them sit near a border and a wrong hour matters, pinzone gives you polygon answers at those points and keeps the raster for everything else.

## Install

```sh
npm install pinzone
npm install --save-dev geo-tz   # only needed to build and check the table
```

Node 22 or later. The published types work with TypeScript 5.0 or later.

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

## Use with AI coding agents

pinzone ships an agent skill, [skills/pinzone/SKILL.md](skills/pinzone/SKILL.md), that tells a coding agent how to build the table, wire up the lookup, set up CI and read the CLI's output. It follows the open Agent Skills format, so one folder works across tools.

| Tool | Install | Checked |
|---|---|---|
| Claude Code | `/plugin marketplace add oo-pibe/pinzone`, then `/plugin install pinzone@pinzone` | Installed and listed with `claude plugin details` |
| Codex | `codex plugin marketplace add oo-pibe/pinzone`, then `codex plugin add pinzone@pinzone` | Installed; skill appears in the model's prompt (`codex debug prompt-input`) |
| Kimi Code | `/plugins install https://github.com/oo-pibe/pinzone`, then `/reload` | Manifest follows Kimi's documented format; not run end to end |
| Claude.ai | Zip the `skills/pinzone` folder and upload it in Claude.ai's skills settings | Same format as Claude Code; not uploaded |
| Any of the above | `npx skills add oo-pibe/pinzone` | Community installer; not run |
| By hand | Copy `skills/pinzone` into `.agents/skills/` (Codex, Kimi Code) or `.claude/skills/` (Claude Code) | Codex finds it in `.agents/skills/` |

The skill is also inside the npm package, at `node_modules/pinzone/skills/pinzone/`. For agents without skill support that read `AGENTS.md` (Cursor, Copilot and others), add this to your project's `AGENTS.md`:

```md
## Timezones
This project resolves timezones with pinzone. Before changing zones.json or any timezone lookup, read node_modules/pinzone/skills/pinzone/SKILL.md.
```

[llms.txt](llms.txt) indexes the docs for tools that read that format.

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

Each key is a coordinate rounded to 4 decimal places, which is about 11 meters, and the zone stored is the zone at that rounded coordinate. Each value is the zone and a safe radius in meters.

Coordinates from real data sources wobble: the same venue can arrive a few meters to the east next week. The safe radius handles that. When the table is built, pinzone probes the whole disc around each rounded key, on rings 10 meters apart with probes no more than 10 meters apart along each ring, and keeps the widest radius (250m by default) where every probe is in the same zone. A later lookup within that distance of the point gets the table's answer (`source: 'table-near'`). Baarle-Nassau, where Dutch and Belgian enclaves interlock street by street, gets a radius of 0.

Probing is not a proof. A piece of another zone less than about 14 meters across could still sit between probes.

A radius of 0 still answers every coordinate that rounds to that key, which is a cell about 11 meters across. On a border, part of that cell can be in the other zone. `build` warns about every point in your file that rounds to a radius-0 entry, and separately about any point whose own zone differs from its key's zone. Lookups at those points get the key's zone.

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

The returned function never throws, whatever it's passed. `createLookup` itself throws a `TypeError` for a malformed table, so a bad table fails when your function starts, not on a live request. It accepts the loosely typed object a JSON import gives you and validates it, zone names included.

A lookup reads one grid cell, so its cost depends on how many entries overlap that spot, not on how big the table is.

Options:

- `fallback`: `(lat, lng) => string` for points the table doesn't cover. Defaults to `@photostructure/tz-lookup`. Pass `null` to answer only from the table.

### `pointKey(lat, lng)`

The table key for a coordinate (`"51.5561,-0.2794"`), or `null` if it isn't a valid coordinate.

## CLI

```sh
pinzone build <points.json|points.csv> -o <zones.json> [--check | --refresh] [--max-radius 250]
pinzone check <zones.json>
```

- `build` adds points that are missing from the table and never removes any. A place that disappears from your data for a season is still resolved when it comes back. If nothing is missing, it doesn't touch the file. When it does write, it writes and syncs a temporary file, then renames it over the table (following a symlink if the table is one), so a failed write or a crash leaves the old table in place.
- `build --check` changes nothing and exits 1 if any point is missing from the table. Put it in CI, next to the step that updates your points. It doesn't need geo-tz.
- `build --refresh` re-resolves every entry with the current polygons and `--max-radius`, and reports how many entries changed. Use it after upgrading geo-tz, because boundaries do change.
- `--max-radius` is a multiple of 10, up to 1000. Wider radii take longer to build: about 2,000 probes per point at 250m, about 8,000 at 500m.
- `check` repeats the build's probes for every entry against the geo-tz you have installed, and exits 1 if a zone has changed or a radius now reaches another zone. It also flags zones your JavaScript runtime doesn't recognize. The fix for a failure is `build --refresh`. Its cost grows with the square of each radius, so give it a timeout if you run it on a table you didn't build.

Exit codes: 0 for success, 1 when a check finds a problem, 2 for bad arguments or input.

## Troubleshooting

### A lookup returns `{ zone: null, source: null }`

The input isn't a pair of finite numbers in range (strings like `'51.5'` don't count), or you passed `fallback: null` and the point isn't in the table.

### A known point comes back with `source: 'raster'`

The committed table is missing it. Run `npx pinzone build <points> -o zones.json` and commit. `build --check` in CI stops this from happening again.

### `build` warns that a key is within 10m of another zone

That point sits on a border, so its entry has radius 0. Lookups that round to it all get one zone. See [the table](#the-table).

### `check` fails with `table says A, polygons say B`

The table was edited by hand, or geo-tz changed. Run `build --refresh`, then `check`, and review the diff.

### Zone names changed after moving from geo-tz

geo-tz's default dataset merges zones that have kept the same clocks since 1970; pinzone uses the finer `geo-tz/all`. Baarle-Nassau becomes `Europe/Amsterdam` instead of `Europe/Brussels`, with the same local times.

### TypeScript rejects `import table from './zones.json'`

With `module: nodenext`, add `with { type: 'json' }` (TypeScript 5.3 or later) and `"resolveJsonModule": true`. Bundler setups accept the plain import.

### The function still fails with ENOENT after switching to pinzone

Something else reads a file at runtime, often a data file loaded with `readFileSync`. Import it as JSON as well.

More in the [CLI reference](skills/pinzone/references/cli.md) and [setup guide](skills/pinzone/references/setup.md).

## Notes

The table is built with `geo-tz/all`, not geo-tz's default dataset. The default merges zones that have followed the same rules since 1970, which is why it answers `Europe/Berlin` for Tromsø. The offset is right, but nobody expects that name.

pinzone only tells you which zone a point is in. The UTC offset at a given moment comes from the timezone database in your JavaScript runtime (`Intl.DateTimeFormat`), and that database changes whenever a country changes its clocks.

## Origin

I built this for [Road to Kickoff](https://roadtokickoff.com), a football trip planner that shows every kickoff in the stadium's local time. The site's scheduled data refresh ran in a serverless function. There, geo-tz couldn't find its data files, and about a fifth of fixtures came back with no timezone, the same fixtures every run. A missing zone meant a kickoff shown at the wrong hour, with nothing on the page to say so. The fix was to resolve the stadiums offline, commit the answers and fall back to the raster for any new ground. This package is that fix, extracted for general use.

## License

MIT
