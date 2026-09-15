/** `[lat, lng]` if both are finite numbers on the globe, otherwise null. */
export function latLng(lat: unknown, lng: unknown): [number, number] | null {
  return typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

const fixed = (v: number) => {
  const s = v.toFixed(4);
  // Rounding, not the input, produces negative zero: -0.000004 must key the same as 0.000004.
  return s === '-0.0000' ? '0.0000' : s;
};

/** The table key for a valid coordinate: rounded to 4 decimals (~11m), with -180 and 180 as one meridian. */
export function keyOf(lat: number, lng: number): string {
  const lngKey = fixed(lng);
  return `${fixed(lat)},${lngKey === '-180.0000' ? '180.0000' : lngKey}`;
}

/** The coordinate a key was made from (NaN parts if it is not a key). */
export const parseKey = (key: string) => key.split(',').map(Number) as [number, number];

/**
 * The table key for a coordinate: latitude and longitude rounded to 4 decimals, or `null` if either is
 * not a finite number in range. Use it to check whether a point is already in a table.
 *
 * @example
 * pointKey(51.55614, -0.27936); // '51.5561,-0.2794'
 * pointKey('51.5', 0);          // null
 */
export function pointKey(lat: unknown, lng: unknown): string | null {
  const point = latLng(lat, lng);
  return point && keyOf(...point);
}
