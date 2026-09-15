const R = 6_371_008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const h = Math.sin(((bLat - aLat) * RAD) / 2) ** 2
    + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(((bLng - aLng) * RAD) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** The point `distance` metres from `lat,lng` along `bearing` degrees, longitude wrapped to [-180, 180). */
export function destination(lat: number, lng: number, distance: number, bearing: number): [number, number] {
  const d = distance / R;
  const b = bearing * RAD;
  const p1 = lat * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = lng * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / RAD, ((((l2 / RAD + 180) % 360) + 360) % 360) - 180];
}
