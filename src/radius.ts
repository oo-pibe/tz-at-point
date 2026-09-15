import { destination } from './geo.ts';

export type Find = (lat: number, lng: number) => string | undefined;

/** Metres between probe rings, and the most arc allowed between probes on one ring. */
export const PROBE_SPACING = 10;

/**
 * The largest radius (metres, a multiple of PROBE_SPACING, at most `max`) around a point inside which
 * every probe is in `zone`. Probes fill the disc on a ~10m lattice, so no piece of another zone wider
 * than about 14m can sit inside the radius unseen.
 */
export function safeRadius(find: Find, lat: number, lng: number, zone: string, max: number): number {
  for (let ring = PROBE_SPACING; ring <= max; ring += PROBE_SPACING) {
    const bearings = Math.ceil((2 * Math.PI * ring) / PROBE_SPACING);
    for (let i = 0; i < bearings; i++) {
      if (find(...destination(lat, lng, ring, (360 * i) / bearings)) !== zone) return ring - PROBE_SPACING;
    }
  }
  return Math.floor(max / PROBE_SPACING) * PROBE_SPACING;
}
