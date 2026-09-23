# tz-at-point

**Exact IANA timezones for the coordinates you already know, with no file reads at runtime.**

[![ci](https://github.com/oo-pibe/tz-at-point/actions/workflows/ci.yml/badge.svg)](https://github.com/oo-pibe/tz-at-point/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tz-at-point)](https://www.npmjs.com/package/tz-at-point)
[![install size](https://badgen.net/packagephobia/install/tz-at-point)](https://packagephobia.com/result?p=tz-at-point)
[![types: TypeScript](https://img.shields.io/npm/types/tz-at-point)](https://www.typescriptlang.org/)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/oo-pibe/tz-at-point/blob/main/LICENSE)

Timezone lookup from latitude and longitude, resolved offline at build time. You point the CLI at your own coordinates, it resolves each one against the real timezone boundaries with geo-tz, and commits the answers as a small JSON table. At runtime `createLookup` reads that table, then a nearby entry, then a compact raster, and never touches the filesystem, which is what makes it safe inside a bundled serverless function.

```ts
import { createLookup } from 'tz-at-point';
import table from './zones.json' with { type: 'json' };

const zoneAt = createLookup(table);

zoneAt(65.8481, 24.1466); // { zone: 'Europe/Helsinki', source: 'table' }
zoneAt(40.4168, -3.7038); // { zone: 'Europe/Madrid',   source: 'raster' }
```

**Status:** 1.0.0. The runtime API is stable and the table format is versioned; changes are recorded in the [changelog](https://github.com/oo-pibe/tz-at-point/blob/main/CHANGELOG.md).

[Why](#why) · [How it works](#how-it-works) · [Prior art](#prior-art) · [Install](#install) · [Quick start](#quick-start) · [API](#api) · [CLI](#cli) · [AI coding agents](#use-with-ai-coding-agents) · [What it promises](#what-it-promises) · [Keeping the table current](#keeping-the-table-current) · [Troubleshooting](#troubleshooting) · [FAQ](#faq) · [Data sources](#data-sources)

## Why

There are two common ways to turn a coordinate into a timezone in JavaScript, and each has a catch.

**[geo-tz](https://github.com/evansiroky/node-geo-tz) is exact.** It reads the real boundary polygons from about 30MB of data files on disk. A JavaScript bundler won't pull those into your bundle, so unless you ship the `data/` directory alongside it and point `GEO_TZ_DATA_PATH` at it, every lookup that needs them throws:

```
Error: ENOENT: no such file or directory, open
  '/var/task/node_modules/geo-tz/data/timezones-1970.geojson.geo.dat'
```

On Lambda you can do exactly that, and people do: copy the directory into a layer and set the variable, at 74MB against the 250MB unzipped limit. On an edge runtime you can't, because there is no filesystem to point it at.

**[@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup) reads no files.** It's 73KB of JavaScript, 74KB once bundled, and works anywhere. It's also approximate, and near a border the neighbour often keeps different clocks:

| Place | Coordinate | Raster says | Actually | Off by |
|---|---|---|---|---|
| Tornio, Finland | 65.8481, 24.1466 | Europe/Stockholm | Europe/Helsinki | 1 hour |
| Tabatinga, Brazil | -4.2527, -69.9381 | America/Eirunepe | America/Manaus | 1 hour |

[Its own README](https://github.com/photostructure/tz-lookup) puts the disagreement with geo-tz at ~10% of likely-inhabited points, ~5% even after forgiving zones whose clocks match. Measured a different way, at points sampled uniformly by area on land, it returns a zone with the wrong UTC offset for **3.4% of the world**, 3.5% of North America and 1.4% of Europe ([the script](https://github.com/oo-pibe/tz-at-point/blob/main/scripts/raster-disagreement.mjs), 60,000 samples per region, run it yourself).

So the usual choice is: exact, but heavy and tied to a filesystem, or light and portable, but approximate. ([tzf-wasm](#prior-art) sits between them: simplified polygons in a 4MB wasm asset, exact except within about 110m of a border.)

**Your venues, stores or depots are a fixed list.** Resolve them once, at build time, with the exact polygons, and the choice disappears: exact answers, no polygons shipped, nothing read at runtime.

| | geo-tz | tz-lookup (raster) | hosted API | tz-at-point |
|---|---|---|---|---|
| Accuracy at your points | exact | ~5–10% wrong | exact | **exact** (it is geo-tz, at build time) |
| Adds to your bundle | 74MB `data/`, shipped beside it | 74KB | — | **77KB, or 3KB via `/core`** + ~50 bytes per point |
| Reads files at runtime | yes | no | no | **no** |
| Works on edge runtimes | no | yes | yes | **yes** |
| Answers any coordinate | yes | yes | yes | your points exactly, everything else via the raster |
| Cost per lookup | — | — | $5/1k after 10k free (Google) | — |

"Exact" here means it agrees with the OpenStreetMap boundary data, which is what every option in that table is measured against. One case is not exact: a point so close to a border that its rounded key falls on the other side. `build` warns by name when that happens, and [What it promises](#what-it-promises) says what the lookup does about it.

**If none of your points are near a border, you don't need this.** One command tells you, for your own data:

```console
$ npx tz-at-point check zones.json --raster
built with geo-tz 8.1.9
raster: 2 of 3 points disagree with the table, 2 by a different UTC offset
  -4.2527,-69.9381: raster says America/Eirunepe, table says America/Manaus
  65.8481,24.1466: raster says Europe/Stockholm, table says Europe/Helsinki
ok: 3 points match the polygons
```

If that count is 0, use the raster on its own and skip this package.

## How it works

<img src="https://raw.githubusercontent.com/oo-pibe/tz-at-point/main/docs/flow.svg" alt="Build time: points.csv plus tz-at-point build, using geo-tz polygons and 10m probes, produce zones.json, committed to your repo; geo-tz never ships. Runtime: a lat/lng is answered by an exact key (source: table), then the nearest entry within its radius (source: table-near), then the raster fallback (source: raster, approximate), with no file reads." width="920">

Build resolves each point with geo-tz, then probes the ground around it on a ~10m lattice to find how far that zone holds. Those two facts, the zone and that radius, are all the runtime needs.

## Prior art

Everything else in this space answers "any point on Earth, at runtime", and carries a global dataset to do it. The interesting ones:

- **[tzf-wasm](https://github.com/ringsaturn/tzf-wasm)**, the wasm build of the Rust port of **[tzf](https://github.com/ringsaturn/tzf)** (Go). It carries simplified boundary polygons in a separate 4MB `.wasm` asset, loaded by `fetch` with no filesystem, and answers any coordinate. Its bundled dataset is the simplified one: [its own accuracy notes](https://github.com/ringsaturn/tzf#accuracy) put boundaries within about 110m of the full-precision border, which is exactly the strip where this package spends its effort. On an edge runtime that needs arbitrary coordinates it is the better fit; for a fixed list of points near borders, it is not exact and this is.
- **geo-tz** itself, if you can ship its `data/` directory and set `GEO_TZ_DATA_PATH`.
- **[@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup)**, the maintained raster, which this package uses as its fallback.

People have asked geo-tz for a smaller dataset for years: in 2018 its maintainer reopened [an issue about shipping a subset](https://github.com/evansiroky/node-geo-tz/issues/75) to say "that'd make a good feature… I'm open to receiving a PR", and closed it two and a half months later with a commit that added in-memory caching of lookup areas rather than a smaller download. [A Lambda user asking the same in 2024](https://github.com/evansiroky/node-geo-tz/issues/170) has had no reply from the maintainer. Narrowing the *dataset* is what people ask for; resolving a *known point set* instead is the answer I could not find packaged anywhere, so people write the same script by hand: resolve the points with geo-tz in `scripts/`, commit the JSON, keep geo-tz out of `src/`.

This is that script, made reliable: probed radii so nearby coordinates still resolve, a `check` command for CI, and the geo-tz version recorded in the table.

## Install

```sh
npm install tz-at-point
npm install --save-dev geo-tz   # only to build and check the table
```

Node 20.19+ or 22.12+ (the built package is tested on 20.19.0 in CI, though Node 20 has been end-of-life since April 2026). The published types work with TypeScript 5.0 and later.

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
  "attribution": "Timezone boundaries from OpenStreetMap (https://www.openstreetmap.org/copyright), ODbL 1.0. Zone names from the IANA tz database, public domain.",
  "geoTz": "8.1.9",
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

A complete handler, with its table, CI step and audit: [examples/serverless-function](https://github.com/oo-pibe/tz-at-point/tree/main/examples/serverless-function).

Full detail: [API reference](https://github.com/oo-pibe/tz-at-point/blob/main/skills/tz-at-point/references/api.md) · [CLI reference](https://github.com/oo-pibe/tz-at-point/blob/main/skills/tz-at-point/references/cli.md) · [setup guide](https://github.com/oo-pibe/tz-at-point/blob/main/skills/tz-at-point/references/setup.md).

## CLI

```sh
tz-at-point build <points.json|points.csv> -o <zones.json> [--check | --refresh] [--max-radius 250]
tz-at-point check <zones.json> [--raster]
tz-at-point --version
```

`build` only adds points, never removes them, and leaves the file alone when there's nothing to add. `check --raster` reports what the raster alone would answer for your points. Parallel builds of the same table are safe. `--check` reports missing points without writing, and without needing geo-tz. `--refresh` re-resolves every entry after a geo-tz upgrade. `check` re-probes the table against the boundaries you have installed.

Exit codes: `0` success, `1` a check found a problem, `2` bad arguments or input.

## Use with AI coding agents

tz-at-point ships an agent skill, [skills/tz-at-point/SKILL.md](https://github.com/oo-pibe/tz-at-point/blob/main/skills/tz-at-point/SKILL.md), that teaches a coding agent the whole workflow: building the table, wiring up the lookup, CI, and what each warning means. It uses the open Agent Skills format, so one folder works across tools.

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

A `table` or `table-near` answer agrees with the boundary polygons, with two documented exceptions: inside a key's ~11m rounding cell the key's zone wins, and a piece of another zone smaller than the probe lattice can resolve (about 7m) can hide inside a radius. Every stored radius keeps a fully probed ring beyond it, so a compact region bigger than that is caught, but this is sampling rather than proof: a sliver narrower than the lattice can still thread between probes however long it is.

`check` re-runs those probes against your installed geo-tz, so it catches stale entries, hand edits and moved boundaries. It can't catch what the probes were too coarse to see in the first place.

The rest, measured rather than asserted:

| | |
|---|---|
| Lookup | ~380ns from the table, ~550ns through the raster |
| Startup | 55-70ms and ~18MB for 30,000 points spread worldwide |
| Build | 2,218 geo-tz probes per point at the default radius, 8,357 at 500 |
| Runtime dependencies | one, the raster; `tz-at-point/core` keeps it out of your bundle |
| Tests | 130, including bundled runs with file reads denied and a lookup checked against a brute-force scan |

Timings are from [`scripts/bench.mjs`](https://github.com/oo-pibe/tz-at-point/blob/main/scripts/bench.mjs) on one machine, and startup in particular moves with how your points are spread. Run it on yours rather than trusting mine.

During development the radius prober was also fuzzed differentially against geo-tz, and the suite was checked with mutation testing. Neither runs in CI. The fuzzer's one real find was a radius that could over-claim about 124m from its key; [`test/radius.test.ts`](https://github.com/oo-pibe/tz-at-point/blob/main/test/radius.test.ts) keeps that case.

## Keeping the table current

Timezone boundaries ship a few times a year (five releases so far in 2026), and occasionally a zone genuinely changes: `America/Coyhaique` was carved out of `America/Santiago` in 2025b, `Asia/Choibalsan` became an alias for `Asia/Ulaanbaatar` in 2024b. A committed table can go stale, so it says what produced it:

```json
{ "v": 1, "attribution": "…OpenStreetMap…ODbL 1.0…", "geoTz": "8.1.9", "maxRadius": 250, "points": { … } }
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

**How big does the table get?** Roughly 50 bytes per point (45 for short zone names like `Europe/London`, 65 for `America/Argentina/Buenos_Aires`), so 1,000 venues is about 50KB of JSON.

**What about daylight saving?** tz-at-point gives you the zone. The offset at a given moment comes from your runtime's own timezone database through `Intl`, so DST rules stay current without touching the table.

**Does it work in the browser?** The runtime does. Building the table needs Node and geo-tz.

**What if a place moves, or I delete one?** `build` adds and never removes. To prune, delete `zones.json` and build it again.

## Data sources

tz-at-point's code is MIT. The answers come from three upstreams on different terms, and only one of them travels in your bundle.

| What | From | Licence |
|---|---|---|
| Zone names (`Europe/Madrid`) | [IANA time zone database](https://www.iana.org/time-zones) | [Public domain](https://github.com/eggert/tz/blob/main/LICENSE) |
| Boundaries, at build time | [geo-tz](https://github.com/evansiroky/node-geo-tz) ← [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder) ← OpenStreetMap | Code MIT, data [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| Raster fallback, at runtime | [@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup) | CC0-1.0, built from the same OpenStreetMap boundaries |

This package ships no OpenStreetMap data of its own. geo-tz is an optional peer dependency the CLI uses on your machine, never imported at runtime.

### What you install

| | Packages | Maintainer accounts | Size |
|---|---|---|---|
| Runtime (what your app installs) | 2, including this one | 1 | ~180KB |
| Build time, with geo-tz | 29 more | 62 more | 74MB |

The CLI loads geo-tz through a dynamic import, so it never enters a consumer's runtime graph. If you only need the table, `npm install --save-dev geo-tz` on the machine that builds it and nothing else inherits that footprint.

Every dependency here resolves from the npm registry with a verified signature, and `npm audit` reports nothing. The only install script in the whole tree is esbuild's, which is a dev dependency and isn't needed: this repo's `.npmrc` sets `ignore-scripts=true`, and everything still builds and tests.

### What that means for your table

`zones.json` holds your own coordinates, a zone name and a radius. It carries no OpenStreetMap geometry. The OSM Foundation's [Geocoding Guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline) treats results like these as insubstantial extracts that don't trigger ODbL share-alike, and its [Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) say a group of geocoding results "need not maintain attribution attached to the results, as long as it does not form a Derivative Database". Committing the table doesn't put your application code under ODbL, and the licence itself [doesn't reach software](https://opendatacommons.org/licenses/odbl/1-0/) ("This License does not apply to computer programs used in the making or operation of the Database").

Those guidelines are the Foundation's stated view rather than the licence text, and by its own [Legal FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ) they "carry no formal legal weight". No court has ruled on where the line sits. If your table is large or central to a product, read them yourself.

Two things still apply.

**Credit OpenStreetMap in anything you ship.** The default import bundles the raster fallback, which is built from OpenStreetMap boundaries. One line wherever your app already lists third-party credits:

> Timezone data from [OpenStreetMap](https://www.openstreetmap.org/copyright), available under the [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).

Importing from `tz-at-point/core` leaves the raster out, and then the table is all you ship. Every generated table carries this line in an `attribution` field, so the file explains itself wherever it ends up.

**Keep the table a list of your own places.** Resolving your venues is what this is for. Probing a lattice across a city or a country is what that guideline calls "systematically reverse engineering the whole or a substantial part of the OSM database through Geocoding", which would make your table a Derivative Database and put it under ODbL.

This is a summary, not legal advice.

## Contributing

Bug reports are welcome, especially ones with a coordinate that gets the wrong answer. See [CONTRIBUTING.md](https://github.com/oo-pibe/tz-at-point/blob/main/CONTRIBUTING.md), and [AGENTS.md](https://github.com/oo-pibe/tz-at-point/blob/main/AGENTS.md) for how the code fits together.

## Origin

I built this for [Road to Kickoff](https://roadtokickoff.com), a football trip planner that shows every kickoff in the stadium's local time. Its scheduled data refresh ran in a serverless function, where geo-tz couldn't find its data files, and about a fifth of fixtures came back with no timezone, the same fixtures every run. A missing zone means a kickoff shown at the wrong hour, with nothing on the page to say so. The fix was to resolve the grounds offline, commit the answers, and fall back to a raster for anything new. This package is that fix, extracted.

## License

MIT
