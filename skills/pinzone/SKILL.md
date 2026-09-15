---
name: pinzone
description: Use when a JavaScript or TypeScript project needs the IANA timezone or local time at latitude/longitude coordinates (venues, stadiums, stores, airports), when geo-tz fails with ENOENT on missing data files in a bundled or serverless function (Vercel, AWS Lambda, Netlify, Next.js), when a raster timezone lookup such as tz-lookup is an hour wrong near a border, or when working with the pinzone package, its zones.json table, or output from `pinzone build` or `pinzone check`.
license: MIT
---

# pinzone

pinzone answers the IANA timezone at a coordinate. `pinzone build` resolves your points offline against geo-tz's polygons into a small `zones.json`. At runtime, `createLookup(table)` answers from that table, then from the nearest table entry within its safe radius, then from a bundled raster for everything else. The runtime reads no files.

Everything below is verified against the package. You don't need to read pinzone's `dist/` source: the answers are here and in `references/`.

pinzone answers with a zone name, never a UTC offset. Get the offset for a given moment from `Intl.DateTimeFormat` with that `timeZone`.

## When not to use it

- Every point is far from any border and an approximate answer is fine: `@photostructure/tz-lookup` alone is enough.
- Browser-only code with no build step to produce the table.

## Checklist

Copy this and tick it off.

```
- [ ] npm install pinzone && npm install --save-dev geo-tz   (this also moves geo-tz out of dependencies)
- [ ] Points file: .csv with `lat` and `lng` header columns, or .json array of [lat, lng] / { lat, lng } (extra fields ignored)
- [ ] npx pinzone build <points> -o <zones.json>        (warnings go to stderr: read them)
- [ ] Commit zones.json next to the code that imports it
- [ ] Import the table as JSON and call createLookup(table) once, at module scope
- [ ] Remove every runtime readFileSync of data files: import them as JSON too (see "Data the function reads")
- [ ] Handle { zone: null } and treat source 'raster' for a known point as a stale table
- [ ] CI step 1: npx pinzone build <points> -o <zones.json> --check   (a point was added without rebuilding)
- [ ] CI step 2: npx pinzone check <zones.json>                      (table edited, or geo-tz/Node changed)
- [ ] After any geo-tz, pinzone or Node version change (npm update included): build --refresh, check, review the diff
```

## Data the function reads

`pinzone build` reads CSV directly, so `build` never needs a converter. The runtime is different: a serverless function can't `readFileSync` a CSV any more than geo-tz can read its data files. If the handler needs the venue list itself, keep that list as JSON, import it, and pass the same JSON file to `build`. One file, no drift. Only if people must keep editing a CSV, generate the JSON from it in a script and check both in. If the columns are named differently (`latitude`, `lon`), see `references/setup.md`.

## Migrating from geo-tz

`build` uses `geo-tz/all`, not the default `geo-tz` export, which merges zones that have kept the same clocks since 1970. After migrating, some names change with identical local times: Baarle-Nassau `Europe/Brussels` becomes `Europe/Amsterdam`, Tromsø `Europe/Berlin` becomes `Europe/Oslo`. That is expected, not a bug. To double-check a point, compare with `import { find } from 'geo-tz/all'`, never the default export.

## Runtime rules

```js
import { createLookup } from 'pinzone';
import table from './zones.json' with { type: 'json' };

const zoneAt = createLookup(table); // once, at module scope

export function localKickoff(lat, lng, utcIso) {
  const { zone, source } = zoneAt(lat, lng);
  if (zone === null) return null; // not a coordinate, or no fallback answer
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(utcIso)); // 'Mon 21 Sept, 00:30' on Node 22.12+; punctuation varies with the runtime's ICU
}
```

The local date can differ from the UTC date. If the user asks for a time only (`'20:45'`), give them that (`hour`, `minute`, `hourCycle: 'h23'`), but say that late kickoffs fall on the next local day and offer a date field.

```js
// Tests (not the handler) may read files. Every known point must come from the table:
for (const v of venues) assert.ok(['table', 'table-near'].includes(zoneAt(v.lat, v.lng).source), `${v.name}: zones.json is stale`);
// not notEqual(source, 'raster'): that also passes for { zone: null } from bad coordinates
```

- The JSON import is what puts the table inside the bundle. Reading `zones.json` with `fs` at runtime brings back the serverless file problem.
- geo-tz is a dev dependency, used only by `build` and `check`. Never import it at runtime.
- `createLookup` validates the table and throws a `TypeError` if it is malformed. The returned lookup never throws.
- `source`:
  - `table`: the point rounds to a table key (4 decimals, a cell about 11m across).
  - `table-near`: within an entry's safe radius. Correct and normal; not a warning sign.
  - `raster`: outside the table, approximate near borders. For a point that is in your points file this means the committed table is stale. Worth a test: every known point should resolve with `source !== 'raster'`.

## Never

- Hand-edit `zones.json`. Change the points file and run `build`.
- Run `build` or import geo-tz in a request handler.
- Use flags that don't exist. `build` takes `-o/--out`, `--check`, `--refresh`, `--max-radius` (multiple of 10, up to 1000, default 250), `-h/--help`. `check` takes only the table path.
- Expect `build` to delete entries for removed points. It only adds. To prune, delete `zones.json` and build again.

## Reading the output

| Output | Meaning | Action |
|---|---|---|
| `wrote zones.json: N points (M resolved)` | Table written | Commit it |
| `up to date: 5 points` | No point is missing. The count is table entries, not lines in your points file. `build` never re-validates existing entries; that is `check`'s job | None |
| `1 point missing from …` (exit 1) | `--check` found points not in the table, or there is no table yet | Run the `run: npx pinzone build …` line it prints, commit |
| `warning: KEY is within 10m of another zone; …` | That entry has radius 0: its whole ~11m key cell answers one zone, even the part across the border. Repeats on every build | Nothing, unless the point should be in the other zone. When both zones keep the same clocks (Amsterdam and Brussels), local times are unaffected either way. To check a specific point, resolve it with `geo-tz/all` yourself |
| `warning: LAT,LNG is in A, but its key KEY is in B; …` | The point itself is across the border from its rounded key. Printed only when that key is first added, so silence does not prove a point is on its key's side | Lookups there answer B. Nudge the coordinate onto the correct side if it matters |
| `FAIL KEY: table says A, polygons say B` (exit 1) | Table disagrees with the installed geo-tz (edited, merged badly, or boundaries changed) | `npx pinzone build <points> -o <zones.json> --refresh` with the same `--max-radius` you built with, then `check`, review `git diff`, commit |
| `FAIL KEY: radius Rm reaches another zone` | Boundaries moved closer | Same as above |
| `FAIL ZONE: not a zone this runtime's Intl accepts` | The Node running `check` is too old for that zone | Update Node. Refreshing won't change the name, unless the same entry also failed with `table says …` |
| `pinzone: …` (exit 2) | Bad arguments or input | Read the message; see references/cli.md |

Exit codes: 0 success, 1 a check found a problem, 2 bad arguments or input.

## References

- [references/api.md](references/api.md): `createLookup`, `pointKey`, types, table format, performance. Open when writing code against the API.
- [references/cli.md](references/cli.md): every flag, message and exit code. Open when a command prints something not in the table above.
- [references/setup.md](references/setup.md): points files from other data, TypeScript and bundler JSON imports, CI workflow, upgrading geo-tz, tests. Open when wiring pinzone into a project.
