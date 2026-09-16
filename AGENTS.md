# Working on pinzone

pinzone answers the IANA timezone at a coordinate from a committed JSON table, falling back to a raster, with no file reads at runtime. This file is for agents and people changing pinzone itself. For using pinzone in another project, read `skills/pinzone/SKILL.md`.

## Map

| Path | What it does |
|---|---|
| `src/index.ts` | Public API: `createLookup`, `pointKey` and types. Nothing else is public. |
| `src/lookup.ts` | `createLookup`: exact key, then nearest entry within its radius (grid index), then fallback. |
| `src/table.ts` | Table format v1: validation (`readTable`), serialisation (`formatTable`), radius and zone rules. |
| `src/key.ts` | Coordinate validation and the 4-decimal key. |
| `src/geo.ts` | Great-circle distance and destination point. |
| `src/radius.ts` | Build-time probing of the safe radius on a 10m lattice; `resolve` is shared by `build` and `check`. |
| `src/points.ts` | Points from JSON or CSV. Pure: no file access. |
| `src/text.ts` | Escaping untrusted text for messages. |
| `src/cli.ts` | `pinzone build` and `pinzone check`. The only module that touches the filesystem or geo-tz. |
| `test/` | `node:test` suites per module (text escaping is covered in `table.test.ts`), plus `cli.test.ts` (spawns the CLI), `bundle.test.ts` and `docs.test.ts`. |
| `skills/pinzone/` | The agent skill shipped to users: `SKILL.md` and `references/`. |
| `.claude-plugin/`, `kimi.plugin.json` | Plugin manifests for Claude Code, Codex and Kimi Code. They point at `skills/`. |

## Invariants

- The lookup function returned by `createLookup` never throws. Bad input gives `{ zone: null, source: null }`.
- `src/lookup.ts` (`pinzone/core`) has no fallback and must never import the raster; `src/index.ts` adds it. That split is what keeps the raster out of table-only bundles.
- A stored radius always has a fully probed ring beyond it, so a lobe crossing the radius between two probes cannot be missed.
- Runtime modules (`index`, `lookup`, `table`, `key`, `geo`, `text`) import no Node built-ins and never import geo-tz. `test/bundle.test.ts` runs a bundled lookup with file reads denied.
- Table format v1 is frozen: keys are `lat,lng` at 4 decimals with -180 written as 180; values are `[zone, radius]`; radii are multiples of 10 up to 1000.
- `build` resolves zones with `geo-tz/all`, never the default geo-tz export.
- Anything printed that came from input goes through `printable` or `quote`.
- The CLI exits 0 on success, 1 when a check finds a problem, 2 on bad arguments or input.

## Commands

```sh
npm test                           # all tests; Node 22.18+ runs the .ts files directly
npx tsc                            # typecheck src and test
npm run build                      # emit dist/
npm pack --dry-run                 # confirm what ships
claude plugin validate --strict .  # plugin and skill manifests
```

## Changing code

- Write the failing test first, then the code.
- CLI behaviour is tested by spawning `src/cli.ts` on temp directories; see `test/cli.test.ts` for the helpers.
- Keep erasable TypeScript only (no enums or namespaces): tests run through Node's type stripping.
- If you change a CLI flag, a printed message or a public export, update `skills/pinzone/references/`. `test/docs.test.ts` fails until you do, and lists the messages it tracks in `MESSAGES`.
- Keep `SKILL.md` short. Detail belongs in `references/`.

## Releasing

1. Bump `version` in `package.json` and `.claude-plugin/plugin.json` (`test/docs.test.ts` checks they match; Claude Code and Codex users only get the new skill when it changes).
2. `npm test && npx tsc && npm pack --dry-run && claude plugin validate --strict .`
3. Publish to npm, then create a GitHub release with a tag. Kimi Code installs a plugin from the latest GitHub release, so a release without these files would give Kimi users an old skill.
