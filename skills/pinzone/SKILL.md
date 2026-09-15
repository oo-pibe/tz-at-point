---
name: pinzone
description: Use when a JavaScript or TypeScript project needs the IANA timezone or local time at latitude/longitude coordinates (venues, stadiums, stores, airports), when geo-tz fails with ENOENT on missing data files in a bundled or serverless function (Vercel, AWS Lambda, Netlify, Next.js), when a raster timezone lookup such as tz-lookup is an hour wrong near a border, or when working with the pinzone package, its zones.json table, or output from `pinzone build` or `pinzone check`.
license: MIT
---

# pinzone

pinzone answers the IANA timezone at a coordinate. `pinzone build` resolves your points offline against geo-tz's polygons into a small `zones.json`. At runtime, `createLookup(table)` answers from that table, then from the nearest table entry within its safe radius, then from a bundled raster for everything else. The runtime reads no files.

Everything below is verified against the package. You don't need to read pinzone's `dist/` source: the answers are here and in `references/`.

## When not to use it

- Every point is far from any border and an approximate answer is fine: `@photostructure/tz-lookup` alone is enough.
- You need a UTC offset, not a zone: get the zone from pinzone, then use `Intl.DateTimeFormat` with `timeZone`.
- Browser-only code with no build step to produce the table.

## Checklist

Copy this and tick it off.

```
- [ ] npm install pinzone && npm install --save-dev geo-tz
- [ ] Points file: .csv with `lat` and `lng` header columns, or .json array of [lat, lng] / { lat, lng } (extra fields ignored)
- [ ] npx pinzone build <points> -o <zones.json>        (read every warning line)
- [ ] Commit zones.json next to the code that imports it
- [ ] Import the table as JSON and call createLookup(table) once, at module scope
- [ ] Import other runtime data (venue lists) as JSON too, instead of readFileSync
- [ ] Handle { zone: null } and treat source 'raster' for a known point as a stale table
- [ ] CI: npx pinzone build <points> -o <zones.json> --check
- [ ] After upgrading geo-tz: build --refresh, then check, then review the diff
```

`pinzone build` reads CSV directly. Don't write a CSV parser or conversion script just to feed it. If the columns are named differently (`latitude`, `lon`), write a one-off points file with the right names; `references/setup.md` has a snippet.

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
  }).format(new Date(utcIso)); // include the date: local time can fall on a different day than UTC
}
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
| `up to date: N points` | Nothing missing; file untouched | None |
| `N points missing from …` (exit 1) | `--check` found points not in the table | Run the `run: pinzone build …` line it prints, commit |
| `warning: KEY is within 10m of another zone; …` | That entry has radius 0: its whole ~11m key cell answers one zone, even the part across the border | Confirm the coordinate; nothing to fix unless the point is on the wrong side |
| `warning: LAT,LNG is in A, but its key KEY is in B; …` | The point itself is across the border from its rounded key | Lookups there answer B. Nudge the coordinate onto the correct side if it matters |
| `FAIL KEY: table says A, polygons say B` (exit 1) | Table disagrees with the installed geo-tz (edited, merged badly, or boundaries changed) | `build … --refresh`, check, review diff |
| `FAIL KEY: radius Rm reaches another zone` | Boundaries moved closer | `build … --refresh` |
| `pinzone: …` (exit 2) | Bad arguments or input | Read the message; see references/cli.md |

Exit codes: 0 success, 1 a check found a problem, 2 bad arguments or input.

## References

- [references/api.md](references/api.md): `createLookup`, `pointKey`, types, table format, performance. Open when writing code against the API.
- [references/cli.md](references/cli.md): every flag, message and exit code. Open when a command prints something not in the table above.
- [references/setup.md](references/setup.md): points files from other data, TypeScript and bundler JSON imports, CI workflow, upgrading geo-tz, tests. Open when wiring pinzone into a project.
