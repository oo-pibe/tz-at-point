# Setting up pinzone in a project

## Install

```sh
npm install pinzone
npm install --save-dev geo-tz
```

geo-tz (about 70MB) is only for `build` and `check`. Nothing at runtime imports it.

## The points file

`pinzone build` reads `.csv` (header with `lat` and `lng` columns) or `.json` (array of `[lat, lng]` or `{ lat, lng }`) directly. If the project already has one of those, pass it as is.

If the data uses other names or lives elsewhere, write a points file once with a short script, and rerun it when the data changes:

```js
// scripts/points.mjs: node scripts/points.mjs > data/points.json
import stores from '../data/stores.json' with { type: 'json' };
console.log(JSON.stringify(stores.map((s) => ({ lat: Number(s.latitude), lng: Number(s.longitude) }))));
```

Keep the points file and `zones.json` in the repository, next to the code that imports the table.

## Importing the table

The table must be imported, not read with `fs`, so the bundler embeds it.

| Setup | Import |
|---|---|
| Node ESM, TypeScript `module: nodenext` | `import table from './zones.json' with { type: 'json' };` (required form; TypeScript 5.3+) |
| Bundlers: Next.js, Vite, esbuild, webpack, TypeScript `moduleResolution: bundler` | `import table from './zones.json';` also works |
| CommonJS | `const table = require('./zones.json');` |

- Add `"resolveJsonModule": true` to `tsconfig.json`.
- Node prints no warning for JSON imports from 22.12 on.
- Import other data the function needs (venue lists) the same way. A `readFileSync` of a data file in a serverless handler fails for the same reason geo-tz does. If that data is a CSV, keep it as JSON instead and pass the JSON to `pinzone build`, or generate the JSON from the CSV with a script and commit both.
- If a bundler rejects the `with { type: 'json' }` syntax, use the plain `import table from './zones.json'` form.

```js
import { createLookup } from 'pinzone';
import table from '../data/zones.json' with { type: 'json' };

export const zoneAt = createLookup(table);
```

## Formatting local time

Include the date: a kickoff at 21:30 UTC is 00:30 the next day in Helsinki.

```js
const format = (zone, utcIso) => new Intl.DateTimeFormat('en-GB', {
  timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(utcIso));
// format('Europe/Helsinki', '2026-09-20T21:30:00Z') → 'Mon 21 Sept, 00:30'
```

## A test worth adding

A point from the points file answering `raster` means the committed table is stale. Tests run in Node, not in the function, so they may read files; this one imports the JSON the handler uses. With a CSV points file and no JSON list, `build --check` in CI already covers it.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import venues from '../data/venues.json' with { type: 'json' };
import { zoneAt } from '../src/zones.js';

test('every venue resolves from the committed table', () => {
  for (const v of venues) assert.notEqual(zoneAt(v.lat, v.lng).source, 'raster', v.name);
});
```

## CI

```yaml
# .github/workflows/ci.yml, after `npm ci`
- name: Timezone table covers every point
  run: npx pinzone build data/points.csv -o data/zones.json --check
- name: Timezone table matches current boundaries
  run: npx pinzone check data/zones.json
  timeout-minutes: 10
```

The first step is fast and doesn't load geo-tz. The second re-probes every entry; on large tables, run it on dependency-update pull requests or on a schedule instead of every push.

## Upgrading geo-tz, pinzone or Node, or when `check` fails

Treat any change to the installed geo-tz version as a boundary-data change, including one from `npm update` or a Dependabot pull request. A Node upgrade can change which zone names `Intl` accepts.

```sh
npm install --save-dev geo-tz@latest
npx pinzone build data/points.csv -o data/zones.json --refresh
npx pinzone check data/zones.json
git diff data/zones.json
```

Review changed entries before committing: a changed zone is a changed local time.

## Removing points

`build` never deletes entries, so a point removed from the data stays in the table (harmless). To prune, delete `zones.json` and run `build` again; that re-resolves every point.
