// The numbers in the README's "measured rather than asserted" table.
//
//   node scripts/bench.mjs [entries]
//
// Synthesises a table of the given size rather than resolving real points,
// because the index only cares about how the keys are spread, not which zones
// they name. Reports the slowest of several runs as well as the fastest: a
// README that quotes only a best case is how optimistic numbers get published.
import { createLookup, pointKey } from '../src/index.ts';

const entries = Number(process.argv[2] ?? 30_000);
const ZONES = ['Europe/London', 'Europe/Madrid', 'America/Manaus', 'Asia/Tokyo', 'Europe/Helsinki'];

const points = {};
// mulberry32. A textbook LCG loses precision here: seed * 1103515245 exceeds
// 2^53, the sequence collapses, and the dedupe loop below never terminates.
let seed = 42;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
for (let made = 0; made < entries; ) {
  const lat = (random() * 180 - 90) * 0.99;
  const lng = random() * 360 - 180;
  const key = pointKey(lat, lng);
  if (key in points) continue;
  points[key] = [ZONES[Math.floor(random() * ZONES.length)], 250];
  made++;
}
const table = { v: 1, maxRadius: 250, points };
const keys = Object.keys(points).map((k) => k.split(',').map(Number));

if (!global.gc) console.log('(run with --expose-gc for a heap figure that is not at the mercy of when GC happened to run)\n');
const startups = [];
let heap = 0;
for (let i = 0; i < 6; i++) {
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const at = createLookup(table);
  startups.push(performance.now() - started);
  heap = process.memoryUsage().heapUsed - before;
  at(0, 0); // keep it alive
}

const at = createLookup(table);
const time = (label, fn) => {
  const runs = [];
  for (let r = 0; r < 5; r++) {
    const started = performance.now();
    for (let i = 0; i < 1_000_000; i++) fn(i);
    runs.push(((performance.now() - started) * 1e6) / 1_000_000);
  }
  runs.sort((a, b) => a - b);
  console.log(`${label.padEnd(22)} ${runs[0].toFixed(0)}-${runs.at(-1).toFixed(0)}ns`);
};

// Coordinates that genuinely miss the table. A single constant coordinate
// would let the engine hoist the whole call and report a fictional number.
const misses = [];
while (misses.length < 1024) {
  const lat = (random() * 180 - 90) * 0.99;
  const lng = random() * 360 - 180;
  if (at(lat, lng).source === 'raster') misses.push([lat, lng]);
}

console.log(`${entries} entries, node ${process.version}\n`);
time('table hit', (i) => at(keys[i % keys.length][0], keys[i % keys.length][1]));
time('raster fallback', (i) => at(misses[i % misses.length][0], misses[i % misses.length][1]));
startups.sort((a, b) => a - b);
console.log(`\nstartup               ${startups[0].toFixed(0)}-${startups.at(-1).toFixed(0)}ms`);
console.log(`heap                  ${(heap / 1e6).toFixed(1)}MB`);
