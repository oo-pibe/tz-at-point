# tz-at-point

**Exact IANA timezones for the coordinates you already know, with no file reads at runtime.**

[![ci](https://github.com/oo-pibe/tz-at-point/actions/workflows/ci.yml/badge.svg)](https://github.com/oo-pibe/tz-at-point/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tz-at-point)](https://www.npmjs.com/package/tz-at-point)
[![install size](https://img.shields.io/bundlephobia/minzip/tz-at-point)](https://bundlephobia.com/package/tz-at-point)
[![license](https://img.shields.io/npm/l/tz-at-point)](LICENSE)

Resolve your points once, offline, against the real timezone boundaries. Commit the answers as a small JSON table. At runtime `createLookup` reads that table, then a nearby entry, then a compact raster, and never touches the filesystem, which is what makes it safe inside a bundled serverless function.

```ts
import { createLookup } from 'tz-at-point';
import table from './zones.json' with { type: 'json' };

const zoneAt = createLookup(table);

zoneAt(65.8481, 24.1466); // { zone: 'Europe/Helsinki', source: 'table' }
zoneAt(40.4168, -3.7038); // { zone: 'Europe/Madrid',   source: 'raster' }
```

## Why

There are two good ways to turn a coordinate into a timezone in JavaScript, and each has a catch.

**[geo-tz](https://github.com/evansiroky/node-geo-tz) is exact.** It reads the real boundary polygons from about 30MB of data files on disk. A bundler doesn't carry those files, so inside a bundled function every lookup that needs them throws:

```
Error: ENOENT: no such file or directory, open
  '/var/task/node_modules/geo-tz/data/timezones-1970.geojson.geo.dat'
```

**[@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup) reads no files.** It's 73KB of JavaScript and works anywhere. It's also approximate, and near a border the neighbour often keeps different clocks:

| Place | Coordinate | Raster says | Actually | Off by |
|---|---|---|---|---|
| Tornio, Finland | 65.8481, 24.1466 | Europe/Stockholm | Europe/Helsinki | 1 hour |
| Tabatinga, Brazil | -4.2527, -69.9381 | America/Eirunepe | America/Manaus | 1 hour |

[Its own README](https://github.com/photostructure/tz-lookup) puts the disagreement with geo-tz at ~10% of likely-inhabited points, ~5% even after forgiving zones whose clocks match. Measured a different way, at uniformly random points on land it returns a zone with the wrong UTC offset for about **3% of the world**, 2.7% of North America and 1–2% of Europe.

So the ecosystem asks you to pick: exact but unbundlable, or bundlable but approximate.

**Your venues, stores or depots are a fixed list.** Resolve them once, at build time, with the exact polygons, and the choice disappears: exact answers, no polygons shipped, nothing read at runtime.

| | geo-tz | tz-lookup (raster) | hosted API | tz-at-point |
|---|---|---|---|---|
| Accuracy at your points | exact | ~5–10% wrong | exact | **exact** (it is geo-tz, at build time) |
| Install / bundle | 73MB | 88KB | — | 29KB + ~45 bytes per point |
| Reads files at runtime | yes | no | no | **no** |
| Works on edge runtimes | no | yes | yes | **yes** |
| Answers any coordinate | yes | yes | yes | your points exactly, everything else via the raster |
| Cost per lookup | — | — | $5/1k (Google) | — |

**If none of your points are near a border, you don't need this.** One command tells you, for your own data:

```console
$ npx tz-at-point check zones.json --raster
raster: 2 of 3 points disagree with the table, 2 by a different UTC offset
  -4.2527,-69.9381: raster says America/Eirunepe, table says America/Manaus
  65.8481,24.1466: raster says Europe/Stockholm, table says Europe/Helsinki
ok: 3 points match the polygons
```

If that count is 0, use the raster on its own and skip this package.

## How it works

```mermaid
flowchart LR
  B["npx tz-at-point build<br/>(geo-tz, offline)"] --> Z[("zones.json<br/>committed")]
  Z --> L["createLookup(table)"]
  Q(["lat, lng"]) --> L
  L --> E{"exact key?"}
  E -- yes --> T["zone · table"]
  E -- no --> R{"inside an entry's<br/>safe radius?"}
  R -- yes --> N["zone · table-near"]
  R -- no --> F["zone · raster"]
```

Build resolves each point with geo-tz, then probes the ground around it on a ~10m lattice to find how far that zone holds. Those two facts, the zone and that radius, are all the runtime needs.

## Prior art

Everything maintained in this space answers "any point on Earth, at runtime", and carries a global dataset to do it. Precomputing for a *known* point set has been asked for and never built: geo-tz's maintainer [reopened an issue in 2018](https://github.com/evansiroky/node-geo-tz/issues/75) to say it "would make a good feature… I'm open to receiving a PR", and [a Lambda user asking for a smaller package in 2024](https://github.com/evansiroky/node-geo-tz/issues/170) is still waiting. Meanwhile people write the same script by hand, over and over: resolve the points with geo-tz in `scripts/`, commit the JSON, keep geo-tz out of `src/`.

This is that script, made reliable: probed radii so nearby coordinates still resolve, a `check` command for CI, and the geo-tz version recorded in the table.

## Install

```sh
npm install tz-at-point
npm install --save-dev geo-tz   # only to build and check the table
```

Node 20.19+ or 22.12+. The published types work with TypeScript 5.0 and later.

## Quick start

**1. List your points** in a `.csv` with `lat` and `lng` columns, or a `.json` array of `[lat, lng]` pairs or `{ lat, lng }` objects. Extra fields are ignored.

```json
[[65.8481, 24.1466], { "name": "Wembley", "lat": 51.5561, "lng": -0.2794 }]
```

**2. Build the table and commit it.**

```sh
npx tz-at-point build points.json -o zones.json
```

```json
{
  "v": 1,
  "geoTz": "8.1.8",
  "maxRadius": 250,
  "points": {
    "51.5561,-0.2794": ["Europe/London",250],
    "65.8481,24.1466": ["Europe/Helsinki",250]
  }
}
```

Each entry is the zone and how far it holds, in metres. A point on a border gets 0, so it answers only its own rounding cell. The table also records the geo-tz version that produced it, so when boundaries change, the diff says so.

**3. Use it.** Import the table so your bundler embeds it, and create the lookup once, at module scope.

```ts
const zoneAt = createLookup(table);

const { zone } = zoneAt(venue.lat, venue.lng);
const local = zone && new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeStyle: 'short' })
  .format(new Date(fixture.utcKickoff));
```

**4. Keep it honest in CI.**

```yaml
- run: npx tz-at-point build points.json -o zones.json --check   # someone added a point but didn't resolve it
- run: npx tz-at-point check zones.json                          # boundaries moved, or the table was edited
```

## API

`createLookup(table, options?)` returns `(lat, lng) => Result`.

```ts
type Result =
  | { zone: string; source: 'table' | 'table-near' | 'raster' }
  | { zone: null; source: null };
```

- `table` is an exact key hit; `table-near` is inside an entry's safe radius and just as correct; `raster` means the fallback answered, so it's approximate; `null` means the input wasn't a coordinate, or nothing answered.
- The returned function **never throws**, whatever you pass it. A malformed table throws a `TypeError` from `createLookup` instead, when your function starts rather than mid-request.
- `options.fallback` swaps the raster for your own, or `null` turns it off. Importing from `tz-at-point/core` leaves the raster out of your bundle entirely.
- `pointKey(lat, lng)` gives the table key for a coordinate.

Full detail: [API reference](skills/tz-at-point/references/api.md) · [CLI reference](skills/tz-at-point/references/cli.md) · [setup guide](skills/tz-at-point/references/setup.md).

## CLI

```sh
tz-at-point build <points.json|points.csv> -o <zones.json> [--check | --refresh] [--max-radius 250]
tz-at-point check <zones.json>
```

`build` only adds points, never removes them, and leaves the file alone when there's nothing to add. Parallel builds of the same table are safe. `--check` reports missing points without writing, and without needing geo-tz. `--refresh` re-resolves every entry after a geo-tz upgrade. `check` re-probes the table against the boundaries you have installed.

Exit codes: `0` success, `1` a check found a problem, `2` bad arguments or input.

## Use with AI coding agents

tz-at-point ships an agent skill, [skills/tz-at-point/SKILL.md](skills/tz-at-point/SKILL.md), that teaches a coding agent the whole workflow: building the table, wiring up the lookup, CI, and what each warning means. It uses the open Agent Skills format, so one folder works across tools.

| Tool | Install | Checked |
|---|---|---|
| Claude Code | `/plugin marketplace add oo-pibe/tz-at-point`, then `/plugin install tz-at-point@tz-at-point` | Installed, and it loads itself when a task calls for it |
| Codex | `codex plugin marketplace add oo-pibe/tz-at-point`, then `codex plugin add tz-at-point@tz-at-point` | Installed; the skill reaches the model's prompt |
| Kimi Code | `/plugins install https://github.com/oo-pibe/tz-at-point`, then `/reload` | Manifest follows Kimi's documented format; not run end to end |
| Claude.ai | Zip the `skills/tz-at-point` folder and upload it in your skills settings | Same format; not uploaded |
| Anything else | `npx skills add oo-pibe/tz-at-point`, or copy `skills/tz-at-point` into `.agents/skills/` | Codex reads `.agents/skills/` |

The skill is inside the npm package too, at `node_modules/tz-at-point/skills/tz-at-point/`. For agents that read `AGENTS.md` instead, point them at it:

```md
## Timezones
This project resolves timezones with tz-at-point. Before changing zones.json or any timezone lookup,
read node_modules/tz-at-point/skills/tz-at-point/SKILL.md.
```

## What it promises

A `table` or `table-near` answer agrees with the boundary polygons, with two documented exceptions: inside a key's ~11m rounding cell the key's zone wins, and a piece of another zone smaller than the probe lattice can resolve (about 7m) can hide inside a radius. Anything larger is caught, because every stored radius keeps a fully probed ring beyond it.

`check` re-runs those probes against your installed geo-tz, so it catches stale entries, hand edits and moved boundaries. It can't catch what the probes were too coarse to see in the first place.

The rest, measured rather than asserted:

| | |
|---|---|
| Lookup | ~350ns from the table, ~480ns through the raster |
| Startup | 60ms and 15MB for a 30,000-point table |
| Build | ~2,200 geo-tz probes per point at the default radius |
| Runtime dependencies | one, the 73KB raster, or none via `tz-at-point/core` |
| Tests | 115, including a bundled run with file reads denied and a lookup checked against a brute-force scan |
| Also checked | differential fuzzing against geo-tz over millions of points, and mutation testing of the suite |

## Keeping the table current

Timezone boundaries ship 2–4 times a year, and occasionally a zone genuinely changes: `America/Coyhaique` was carved out of `America/Santiago` in 2025b, `Asia/Choibalsan` was removed in 2024b. A committed table can go stale, so it says what produced it:

```json
{ "v": 1, "geoTz": "8.1.8", "maxRadius": 250, "points": { … } }
```

`check` re-probes every entry against the geo-tz you have installed and prints both versions, so a data bump becomes a failing CI step and a readable diff, not a silent change of answer. That is the part embedded global datasets can't give you: when a library's bundled boundaries age, nothing tells you.

## Troubleshooting

### A lookup returns `{ zone: null, source: null }`

The input isn't a pair of finite numbers in range (strings like `'51.5'` don't count), or you're using `tz-at-point/core` or `fallback: null` and the point isn't in the table.

### A known point comes back with `source: 'raster'`

The committed table is missing it. Run `npx tz-at-point build <points> -o zones.json` and commit. `build --check` in CI stops it happening again.

### `build` warns that a key is within 10m of another zone

That point sits on a border, so its entry has a radius of 0 and its whole ~11m cell answers one zone. Nothing to fix unless the point belongs on the other side.

### `check` fails with `table says A, polygons say B`

The table was edited by hand, or geo-tz changed. Run `build --refresh` with the same `--max-radius`, then `check`, and read the diff before committing.

### Zone names changed after moving from geo-tz

geo-tz's default dataset merges zones that have kept the same clocks since 1970; tz-at-point uses the finer `geo-tz/all`. Baarle-Nassau comes back as `Europe/Amsterdam` rather than `Europe/Brussels`, with identical local times.

### TypeScript rejects `import table from './zones.json'`

Under `module: nodenext`, add `with { type: 'json' }` (TypeScript 5.3+) and `"resolveJsonModule": true`. Bundler setups accept the plain import.

### The function still fails with ENOENT after switching to tz-at-point

Something else reads a file at runtime, usually a data file loaded with `readFileSync`. Import it as JSON as well.

## FAQ

**Does this replace geo-tz?** No. It uses geo-tz at build time, where reading 30MB of polygons costs nothing, and keeps it out of your deployment.

**How big does the table get?** About 45 bytes per point, so 1,000 venues is roughly 45KB of JSON inside your bundle.

**What about daylight saving?** tz-at-point gives you the zone. The offset at a given moment comes from your runtime's own timezone database through `Intl`, so DST rules stay current without touching the table.

**Does it work in the browser?** The runtime does. Building the table needs Node and geo-tz.

**What if a place moves, or I delete one?** `build` adds and never removes. To prune, delete `zones.json` and build it again.

## Contributing

Bug reports are welcome, especially ones with a coordinate that gets the wrong answer. See [CONTRIBUTING.md](CONTRIBUTING.md), and [AGENTS.md](AGENTS.md) for how the code fits together.

## Origin

I built this for [Road to Kickoff](https://roadtokickoff.com), a football trip planner that shows every kickoff in the stadium's local time. Its scheduled data refresh ran in a serverless function, where geo-tz couldn't find its data files, and about a fifth of fixtures came back with no timezone, the same fixtures every run. A missing zone means a kickoff shown at the wrong hour, with nothing on the page to say so. The fix was to resolve the grounds offline, commit the answers, and fall back to a raster for anything new. This package is that fix, extracted.

## License

MIT
