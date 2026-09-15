import { destination } from './geo.ts';

export type Find = (lat: number, lng: number) => string | undefined;

const RINGS = [10, 25, 50, 100, 250, 500, 1000];
const BEARINGS = 32;

/**
 * The largest ring radius (metres, at most `max`) around a point whose probes all agree with `zone`,
 * innermost ring first. `Etc/` answers are open sea and count as agreeing.
 *
 * A probe, not a proof: a border sliver narrower than the spacing between bearings can slip through.
 * `pinzone check` samples inside every radius as the backstop.
 */
export function safeRadius(find: Find, lat: number, lng: number, zone: string, max: number): number {
  let safe = 0;
  for (const ring of RINGS) {
    if (ring > max) break;
    for (let i = 0; i < BEARINGS; i++) {
      const found = find(...destination(lat, lng, ring, (360 * i) / BEARINGS));
      if (found !== zone && !found?.startsWith('Etc/')) return safe;
    }
    safe = ring;
  }
  return safe;
}
