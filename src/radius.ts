import { destination } from './geo.ts';
import { RADIUS_STEP } from './table.ts';

export type Find = (lat: number, lng: number) => string | undefined;

/**
 * The widest radius (a multiple of RADIUS_STEP, at most `max`) around a point inside which every probe
 * is in `zone`. Probes fill the disc on a ~10m lattice, so no piece of another zone wider than about
 * 14m can sit inside the radius unseen.
 */
export function safeRadius(find: Find, lat: number, lng: number, zone: string, max: number): number {
  for (let ring = RADIUS_STEP; ring <= max; ring += RADIUS_STEP) {
    const bearings = Math.ceil((2 * Math.PI * ring) / RADIUS_STEP);
    for (let i = 0; i < bearings; i++) {
      if (find(...destination(lat, lng, ring, (360 * i) / bearings)) !== zone) return ring - RADIUS_STEP;
    }
  }
  return Math.floor(max / RADIUS_STEP) * RADIUS_STEP;
}

/** A point's zone and safe radius: what build stores, and what check expects to find again. */
export function resolve(find: Find, lat: number, lng: number, max: number): [zone: string | undefined, radius: number] {
  const zone = find(lat, lng);
  return [zone, zone === undefined ? 0 : safeRadius(find, lat, lng, zone, max)];
}
