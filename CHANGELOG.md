# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-06

First release.

### Added

- `createLookup(table)`: resolves a coordinate from a committed table, then the nearest entry within its safe radius, then a raster fallback. Never throws, never reads a file.
- `tz-at-point/core`: the same lookup without the raster, so it never enters your bundle; about 3KB bundled.
- `tz-at-point build`: resolves your points offline with `geo-tz/all` and writes a table. Adds points, never removes them; `--check` fails CI when a point is missing; `--refresh` re-resolves after a boundary update.
- `tz-at-point check`: re-probes every entry against the installed geo-tz, and flags zones your runtime doesn't recognise. `--raster` reports what the raster alone would answer for your points.
- Safe radius per entry, probed on a ~10m lattice with a verified ring beyond it, so a nearby coordinate still resolves from the table.
- Tables record the `geo-tz` version and `--max-radius` they were built with, plus an OpenStreetMap attribution line.
- An [agent skill](skills/tz-at-point/SKILL.md) for Claude Code, Codex and Kimi Code, shipped in the package.

[1.0.0]: https://github.com/oo-pibe/tz-at-point/releases/tag/v1.0.0
