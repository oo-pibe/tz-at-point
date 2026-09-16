# tz-at-point CLI

```
usage:
  tz-at-point build <points.json|points.csv> -o <zones.json> [--check | --refresh] [--max-radius 250]
  tz-at-point check <zones.json>
```

`build` and `check` need geo-tz installed as a dev dependency (8.0.0 or later, for its `geo-tz/all` export). `build --check`, and a `build` with nothing to resolve, never load it. `--help` / `-h` prints the usage and exits 0, before or after a command.

## `tz-at-point build <points> -o <zones.json>`

Adds every point missing from the table and never removes an entry. It never re-validates entries already in the table; `check` does that. For each new key it resolves the zone with `geo-tz/all` (not the default geo-tz export, whose merged dataset names some zones differently) and probes the safe radius.

**Points file** (chosen by extension, case-insensitive):

- `.json`: an array of `[lat, lng]` pairs or `{ "lat": …, "lng": … }` objects. Extra fields are ignored.
- `.csv`: a header row with `lat` and `lng` columns in any order; other columns are ignored. Fields may be double-quoted, with `""` for a quote. Blank lines are skipped. Quoted line breaks are not supported. Numbers must be plain decimals (`51.5561`, `-0.2794`).
- A byte-order mark is ignored in both.

**Flags**

| Flag | Meaning |
|---|---|
| `-o, --out <file>` | The table to create or extend. Required. If it is a symlink, the file it points to is updated and keeps its permissions. |
| `--check` | Change nothing. Exit 0 if every point is in the table, 1 if any is missing or the table doesn't exist. Doesn't need geo-tz. |
| `--refresh` | Re-resolve every entry, old and new, with the installed geo-tz and the given `--max-radius`, and report how many changed (a radius change counts). Pass the same `--max-radius` you built with, or every wider radius shrinks to the default. Can't be combined with `--check`. |
| `--max-radius <m>` | Largest safe radius to probe. A multiple of 10 from 0 to 1000; default 250. Cost grows with its square: about 2,000 probes per point at 250, 8,000 at 500. The table records the value, and a later build with a different one re-resolves every entry. |
| `-h, --help` | Print usage. |

Writes are atomic: a temp file is written and synced, then renamed over the table, so an interrupted build leaves the old table in place. Parallel builds of the same table are safe: each merges with what is on disk and verifies its own entries survived. It also runs under Node's permission model, where fsync and fchmod are unavailable (durability and mode preservation are skipped). A hard link to the table is not followed: the rename leaves the other link on the old contents.

Paths and table content in messages are escaped to printable ASCII. Usage text and Node's own multi-line argument errors keep their line breaks.

**Output**

- `wrote zones.json: 5 points (5 resolved)`: table written. With `--refresh`: `(5 resolved, 1 changed)`.
- `re-resolved at --max-radius 250: wrote zones.json: …`: the table was built with a different `--max-radius`, so every entry was probed again under the new one.
- `zones.json kept changing underneath this build; run it again`: five merge attempts in a row were overtaken by other builds writing the same table. Rare; rerun.
- `up to date: 5 points`: nothing to add; the file was not touched. With `--check`, exit 0.
- `1 point missing from zones.json:` followed by the missing keys and `run: npx tz-at-point build points.csv -o zones.json`: from `--check`, exit 1. Run that command and commit the table. The `run:` line repeats a non-default `--max-radius`.
- `zones.json does not exist yet`: from `--check` when there is no table, exit 1, followed by the same key list and `run:` line.
- Counts (`5 points`) are entries in the table, not lines in the points file: several coordinates can round to one key.
- `warning: 51.4394,4.9275 is within 10m of another zone; lookups that round to it answer Europe/Amsterdam, even from across the border`: the entry has radius 0. Its whole key cell (about 11m) answers one zone. Printed on stderr, once per key, on every build whose points include one. Not an error, and not printed with `--check` or when you passed `--max-radius 0`.
- `warning: 51.449039,4.930128 is in Europe/Brussels, but its key 51.4490,4.9301 is in Europe/Amsterdam; lookups there answer Europe/Amsterdam`: the input point is within a few meters of a border, across it from its rounded key. On stderr. Only points whose key is added in that run are compared, so a new point that shares an existing key is never checked. Move the coordinate onto the correct side if it matters.
- `...and 12 more`: lists are cut at 20 lines.

## `tz-at-point check <zones.json> [--raster]`

Re-runs build's probes for every entry against the installed geo-tz, and checks every zone name against the runtime's `Intl`. Run it after upgrading geo-tz or Node, or in CI (give it a timeout on tables you didn't build: cost grows with each radius squared).

It uses the same lattice build used, so it finds stale entries, hand edits and moved boundaries. It cannot find something build's probes were too coarse to see in the first place.

**Output**

- With `--raster`: `raster: 1 of 2 points disagrees with the table, 1 by a different UTC offset`, followed by each disagreement (`65.8481,24.1466: raster says Europe/Stockholm, table says Europe/Helsinki`). This is what the bundled fallback alone would answer for your own points, so it shows what the table is buying you. Informational; it never changes the exit code. If the count is 0, the raster alone would do for your data.
- `built with geo-tz 8.1.8`, or `built with geo-tz 8.1.8, checked against 8.2.0` when the installed version has moved on. Informational: `check` re-probes against what is installed either way, so a version difference alone is not a failure.
- `ok: 5 points match the polygons` (`1 point matches`): exit 0.
- `FAIL 51.4926,7.4519: table says Europe/Paris, polygons say Europe/Berlin`: the entry's zone is wrong for the installed geo-tz: the table was edited, merged badly, or boundaries changed. Exit 1.
- `FAIL 51.4394,4.9275: radius 500m reaches another zone`: a probe inside the stored radius found another zone. Exit 1.
- `FAIL America/Ciudad_Juarez: not a zone this runtime's Intl accepts`: the Node/ICU running `check` doesn't know that zone. Exit 1.
- `fix: update Node; its timezone data doesn't know these zones`: printed when any zone failed the `Intl` check. Upgrade Node; rebuilding won't change the zone name.
- `fix: rebuild the table with --refresh`: printed when any entry's zone or radius failed. Run `tz-at-point build <points> -o <zones.json> --refresh` (`check` only knows the table path, so supply the points file), then `check` again, and review `git diff` before committing.

## Errors (exit 2)

Every error line starts with `tz-at-point: ` and exits 2.

| Message | Cause |
|---|---|
| the usage text | Missing or extra arguments, or an unknown command |
| `Unknown option '--x'. …` | A flag that doesn't exist |
| `this command needs geo-tz 8 or later: npm install --save-dev geo-tz` | geo-tz missing or too old |
| `zones.json: not valid JSON` | The file isn't JSON. Its content is never echoed. |
| `points.txt: points must be a .json or .csv file` | Wrong extension |
| `--check and --refresh cannot be combined` | Both flags given |
| `--max-radius must be a multiple of 10 from 0 to 1000` | Bad `--max-radius` |
| `no zone found for KEY` | geo-tz returned nothing for a coordinate |
| `JSON points must be an array` | A JSON points file that isn't an array |
| `row 3: expected [lat, lng] or { lat, lng } with numbers in range` | A bad JSON row (strings, out of range, wrong length) |
| `CSV header must have lat and lng columns` | Header missing `lat` or `lng` (other names like `latitude` aren't recognized) |
| `line 4: unterminated quote (quoted line breaks are not supported)` | A CSV quote left open |
| `line 4: lat and lng must be decimal numbers in range` | Empty, hex, exponent or out-of-range values |
| `zones.json: entry "KEY" is not a canonical point key` | Table key not in `pointKey` form (hand edit) |
| `zones.json: entry "KEY" must map to [zone, radius]` | Wrong value shape |
| `zones.json: entry "KEY" has an invalid zone name` | Zone isn't an IANA-style name |
| `zones.json: entry "KEY" has radius 255; expected a multiple of 10 from 0 to 1000` | Bad radius |
| `zones.json: unsupported version 2` | Not a v1 table |
| `zones.json: must be a plain object` / `zones.json: points must be a plain object` | Not a table at all |
| `ENOENT: …` / `EACCES: …` | File or directory missing or not writable; checked before any work starts |

Paths and table content in messages are escaped to printable ASCII.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, or `--help` |
| 1 | `build --check` found missing points or no table; `check` found a failure |
| 2 | Bad arguments or input |
