// Runs against the PACKED tarball, never against src/. The rest of the suite
// imports ../src/*.ts, so without this nothing executes what npm actually
// ships. CI installs the tarball into an empty project and runs this file
// there; it is not part of `npm test` and is not in the published package.
//
// By hand:
//   npm run build && npm pack
//   mkdir /tmp/smoke && cd /tmp/smoke && npm init -y
//   npm install --ignore-scripts /path/to/tz-at-point-1.0.0.tgz
//   cp /path/to/test/smoke.mjs . && node smoke.mjs
import { createLookup, pointKey } from 'tz-at-point';
import { createLookup as coreLookup } from 'tz-at-point/core';

const table = { v: 1, maxRadius: 250, points: { '51.5561,-0.2794': ['Europe/London', 250] } };

const equal = (actual, expected, what) => {
  const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
};

const at = createLookup(table);
equal(at(51.5561, -0.2794), { zone: 'Europe/London', source: 'table' }, 'exact key');
equal(at(51.5563, -0.2794), { zone: 'Europe/London', source: 'table-near' }, 'within radius');
equal(at(40.4168, -3.7038), { zone: 'Europe/Madrid', source: 'raster' }, 'raster fallback');
equal(pointKey(51.5561, -0.2794), '51.5561,-0.2794', 'pointKey');

// The point of the deep entry: no raster, so an unknown coordinate is null.
equal(coreLookup(table)(40.4168, -3.7038), { zone: null, source: null }, 'core without raster');

console.log('smoke ok: exact, near, raster, pointKey, core');
