import { destination } from './geo.ts';
import { RADIUS_STEP } from './table.ts';

export type Find = (lat: number, lng: number) => string | undefined;

/**
 * The widest radius (a multiple of RADIUS_STEP, at most `max`) around a point that the probes vouch for.
 *
 * Probes fill the disc on a ~10m lattice, ring by ring. A ring only samples its circle at intervals, so a
 * narrow lobe of another zone can cross it between two probes; the radius therefore stops a whole ring
 * short of the frontier, and the ring beyond `max` is probed as well. Even so this is sampling, not proof:
 * a piece of another zone smaller than the lattice's ~7m cover radius can sit inside the radius unseen.
 */
export function safeRadius(find: Find, lat: number, lng: number, zone: string, max: number): number {
  if (max < RADIUS_STEP) return 0;
  for (let ring = RADIUS_STEP; ring <= max + RADIUS_STEP; ring += RADIUS_STEP) {
    const bearings = Math.ceil((2 * Math.PI * ring) / RADIUS_STEP);
    // Each ring starts at a different bearing, stepping by the golden angle so no two rings share
    // one. With every ring starting at 0, the meridian through the point was a seam on all of them
    // and a 4m strip beside it threaded every ring to the cap.
    const phase = ((ring / RADIUS_STEP) * 0.618033988749895) % 1;
    for (let i = 0; i < bearings; i++) {
      if (find(...destination(lat, lng, ring, (360 * (i + phase)) / bearings)) !== zone) return Math.max(0, ring - 2 * RADIUS_STEP);
    }
  }
  return Math.floor(max / RADIUS_STEP) * RADIUS_STEP;
}

/** A point's zone and safe radius: what build stores, and what check expects to find again. */
export function resolve(find: Find, lat: number, lng: number, max: number): [zone: string | undefined, radius: number] {
  const zone = find(lat, lng);
  return [zone, zone === undefined ? 0 : safeRadius(find, lat, lng, zone, max)];
}
