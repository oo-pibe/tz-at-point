/** True when `lat`/`lng` are finite numbers on the globe. */
export function isLatLng(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

const fixed = (v: number): string => {
  const s = v.toFixed(4);
  // Rounding, not the input, produces negative zero: -0.000004 must key the same as 0.000004.
  return s === '-0.0000' ? '0.0000' : s;
};

/** The table key for a coordinate: rounded to 4 decimals (~11m), or null if it is not a coordinate. */
export function pointKey(lat: unknown, lng: unknown): string | null {
  if (!isLatLng(lat, lng)) return null;
  const lngKey = fixed(lng as number);
  // -180 and 180 are one meridian; give it one key.
  return `${fixed(lat)},${lngKey === '-180.0000' ? '180.0000' : lngKey}`;
}
