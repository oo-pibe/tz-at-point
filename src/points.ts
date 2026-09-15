import { latLng } from './key.ts';

export interface Point {
  lat: number;
  lng: number;
}

/** A plain decimal: no hex, exponents or blanks, which Number() would otherwise accept. */
const DECIMAL = /^\s*-?\d+(\.\d+)?\s*$/;

/** Points from parsed JSON: an array of `[lat, lng]` or `{ lat, lng }`. */
export function pointsFromJson(rows: unknown): Point[] {
  if (!Array.isArray(rows)) throw new Error('JSON points must be an array');
  return rows.map((row, i) => {
    const point = Array.isArray(row) ? row.length === 2 && latLng(row[0], row[1]) : latLng(row?.lat, row?.lng);
    if (!point) throw new Error(`row ${i + 1}: expected [lat, lng] or { lat, lng } with numbers in range`);
    return { lat: point[0], lng: point[1] };
  });
}

/** Points from CSV text with `lat` and `lng` header columns, in any order. */
export function pointsFromCsv(text: string): Point[] {
  const [header, ...lines] = text.split(/\r?\n/);
  const columns = (splitCsv(header) ?? []).map((h) => h.trim().toLowerCase());
  const latAt = columns.indexOf('lat');
  const lngAt = columns.indexOf('lng');
  if (latAt < 0 || lngAt < 0) throw new Error('CSV header must have lat and lng columns');

  const points: Point[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.trim() === '') continue;
    const cells = splitCsv(line);
    if (!cells) throw new Error(`line ${i + 2}: unterminated quote (quoted line breaks are not supported)`);
    const [lat, lng] = [cells[latAt], cells[lngAt]].map((c) => (DECIMAL.test(c) ? Number(c) : NaN));
    const point = latLng(lat, lng);
    if (!point) throw new Error(`line ${i + 2}: lat and lng must be decimal numbers in range`);
    points.push({ lat: point[0], lng: point[1] });
  }
  return points;
}

/** One CSV record: comma-separated, fields optionally in double quotes, "" for a literal quote. Null if a quote is left open. */
function splitCsv(line: string): string[] | null {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '"' && line[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  return quoted ? null : cells;
}
