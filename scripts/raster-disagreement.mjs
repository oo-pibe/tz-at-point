// Measures how often the bundled raster disagrees with geo-tz's polygons by a
// real clock offset, so the percentages in the README can be reproduced rather
// than taken on trust.
//
//   node scripts/raster-disagreement.mjs [samples-per-region]
//
// Method: sample points uniformly by area (lat = asin(U), not uniform lat, or
// the poles are oversampled), drop anything geo-tz answers with an Etc/* ocean
// zone or an Antarctica/* one, and compare the raster's zone to geo-tz's by UTC
// offset in January and July. Offset rather than name, because two names can
// keep the same clock and a user only notices a difference in the hour shown.
// Where geo-tz returns several zones (disputed areas: Xinjiang, Hebron, Abyei)
// the raster is right if its clock matches any of them. The generator is seeded,
// so the same sample count reproduces the same figures.
import { find } from 'geo-tz/all';
import tzlookup from '@photostructure/tz-lookup';

// mulberry32; Math.random cannot be seeded and "run it yourself" should reproduce.
let seed = 2026;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const REGIONS = {
  world: { lat: [-90, 90], lng: [-180, 180] },
  'north america': { lat: [15, 72], lng: [-168, -52] },
  europe: { lat: [36, 71], lng: [-10, 40] },
};

const DEG = 180 / Math.PI;
const offset = (zone, when) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(when).find((p) => p.type === 'timeZoneName')?.value ?? zone;
  } catch {
    return zone; // an unknown zone can never match a known one
  }
};
const JAN = new Date('2026-01-15T12:00:00Z');
const JUL = new Date('2026-07-15T12:00:00Z');

const samples = Number(process.argv[2] ?? 20_000);
console.log(`${samples} land samples per region, geo-tz/all as truth\n`);

for (const [name, box] of Object.entries(REGIONS)) {
  // Sample in sin(lat) space so every cell of equal area is equally likely.
  const [s0, s1] = [Math.sin(box.lat[0] / DEG), Math.sin(box.lat[1] / DEG)];
  let land = 0;
  let wrong = 0;
  while (land < samples) {
    const lat = Math.asin(s0 + random() * (s1 - s0)) * DEG;
    const lng = box.lng[0] + random() * (box.lng[1] - box.lng[0]);
    const zones = find(lat, lng);
    if (zones.length === 0 || /^(Etc|Antarctica)\//.test(zones[0])) continue; // ocean, ice
    land++;
    const guess = tzlookup(lat, lng);
    const agrees = zones.some((z) => offset(z, JAN) === offset(guess, JAN) && offset(z, JUL) === offset(guess, JUL));
    if (!agrees) wrong++;
  }
  console.log(`${name.padEnd(14)} ${((wrong / land) * 100).toFixed(2)}% wrong offset  (${wrong}/${land})`);
}
