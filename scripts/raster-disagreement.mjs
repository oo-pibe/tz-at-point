// Measures how often the bundled raster disagrees with geo-tz's polygons by a
// real clock offset, so the percentages in the README can be reproduced rather
// than taken on trust.
//
//   node scripts/raster-disagreement.mjs [samples-per-region]
//
// Method: sample points uniformly by area (lat = asin(U), not uniform lat, or
// the poles are oversampled), drop anything geo-tz answers with an Etc/* ocean
// zone, and compare the raster's zone to geo-tz's by UTC offset in January and
// July. Offset rather than name, because two names can keep the same clock and
// a user only notices a difference in the hour shown.
import { find } from 'geo-tz/all';
import tzlookup from '@photostructure/tz-lookup';

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
    const lat = Math.asin(s0 + Math.random() * (s1 - s0)) * DEG;
    const lng = box.lng[0] + Math.random() * (box.lng[1] - box.lng[0]);
    const truth = find(lat, lng)[0];
    if (!truth || truth.startsWith('Etc/')) continue; // ocean
    land++;
    const guess = tzlookup(lat, lng);
    if (offset(truth, JAN) !== offset(guess, JAN) || offset(truth, JUL) !== offset(guess, JUL)) wrong++;
  }
  console.log(`${name.padEnd(14)} ${((wrong / land) * 100).toFixed(2)}% wrong offset  (${wrong}/${land})`);
}
