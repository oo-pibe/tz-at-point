// A serverless handler (Vercel-shaped; the same code works on Lambda or Cloudflare Workers).
//
// Both data files are imported, not read, so the bundler embeds them and the function touches no
// filesystem. That is the whole point: geo-tz resolved these zones at build time and stayed behind.
import { createLookup } from 'tz-at-point';
import table from '../data/zones.json' with { type: 'json' };
import { venues } from '../data/venues.js';

const zoneAt = createLookup(table);

const local = (zone, utc) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(utc));

/** Kickoffs with the local time at each ground. */
export function kickoffs(fixtures) {
  return fixtures.map((fixture) => {
    const venue = venues.find((v) => v.name === fixture.venue);
    const { zone, source } = venue ? zoneAt(venue.lat, venue.lng) : { zone: null, source: null };
    if (source === 'raster') console.warn(`${fixture.venue}: answered by the raster, so zones.json is stale`);
    return { ...fixture, timeZone: zone, localKickoff: zone ? local(zone, fixture.utc) : null };
  });
}

export default function handler(_req, res) {
  res.json(kickoffs(FIXTURES));
}

export const FIXTURES = [
  { home: 'England', away: 'Wales', venue: 'Wembley Stadium', utc: '2026-11-14T19:45:00Z' },
  { home: 'Dortmund', away: 'Leipzig', venue: 'Westfalenstadion', utc: '2026-10-24T16:30:00Z' },
  { home: 'TP-47', away: 'KuPS', venue: 'Pohjan Stadion', utc: '2026-09-20T21:30:00Z' },
  { home: 'Tabatinga', away: 'Nacional', venue: 'Estadio General Sarmiento', utc: '2026-09-27T19:00:00Z' },
];
