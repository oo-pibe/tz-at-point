# Contributing

Bug reports are welcome, especially ones with a coordinate that gets the wrong answer.

```sh
git clone https://github.com/oo-pibe/tz-at-point && cd tz-at-point
npm ci --ignore-scripts   # nothing here needs an install script; esbuild's is optional
npm test                  # node:test, needs Node 22.18+ to run the TypeScript directly
npx tsc         # typecheck
```

[AGENTS.md](AGENTS.md) is the guide to the codebase: what each module does, the invariants that must hold, and how the docs are kept in sync with the code. Claude Code, Codex and Kimi read it automatically.

A few house rules:

- Write the failing test first. Every fix in this repo's history has one.
- The lookup path stays free of Node APIs and file reads. `test/bundle.test.ts` enforces it by running a bundled lookup with file reads denied.
- Changing a CLI flag, a printed message or a public export means updating `skills/tz-at-point/references/`. `test/docs.test.ts` fails until you do.
- The table format (v1) is frozen. Anything that would make an existing `zones.json` invalid needs a new version.
