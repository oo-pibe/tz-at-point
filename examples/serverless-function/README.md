# Serverless function example

A handler that returns kickoff times in each stadium's local time, reading nothing from disk. The shape is Vercel's; the same code runs on Lambda, Netlify or Cloudflare Workers.

```sh
npm install
npm run zones     # resolve data/venues.csv into data/zones.json (needs geo-tz, dev only)
npm start
```

```
England v Wales              2026-11-14T19:45:00Z → Sat 14 Nov, 19:45      Europe/London
Dortmund v Leipzig           2026-10-24T16:30:00Z → Sat 24 Oct, 18:30      Europe/Berlin
TP-47 v KuPS                 2026-09-20T21:30:00Z → Mon 21 Sept, 00:30     Europe/Helsinki
Tabatinga v Nacional         2026-09-27T19:00:00Z → Sun 27 Sept, 15:00     America/Manaus
```

The TP-47 (Tornio) kickoff is at 21:30 UTC and lands on the **next day** locally, which is why the output carries a date. And two of these four venues are ones a raster lookup gets wrong:

```sh
$ npm run zones:audit
built with geo-tz 8.1.9
raster: 2 of 4 points disagree with the table, 2 by a different UTC offset
  -4.2527,-69.9381: raster says America/Eirunepe, table says America/Manaus
  65.8481,24.1466: raster says Europe/Stockholm, table says Europe/Helsinki
ok: 4 points match the polygons
```

## What to copy

- **`data/zones.json` is committed.** It's built once and read at runtime by import, never by `fs`.
- **`data/venues.js` is committed too**, for the same reason: the handler needs the venue list, and a CSV would have to be read from disk. The CSV stays as the file you edit and the input to `tz-at-point build`.
- **geo-tz is a dev dependency.** It resolves the boundaries at build time and never ships.
- **Add `npm run zones:check` to CI.** It fails when someone adds a venue without rebuilding the table, which is the mistake this setup exists to catch.
