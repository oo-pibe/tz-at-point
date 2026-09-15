import { isLatLng } from './key.ts';

export interface Point {
  lat: number;
  lng: number;
}

/** Parse a `.json` array of `{lat, lng}` or `[lat, lng]`, or a `.csv` with `lat` and `lng` header columns. */
export function parsePoints(text: string, filename: string): Point[] {
  if (filename.endsWith('.json')) return fromJson(text);
  if (filename.endsWith('.csv')) return fromCsv(text);
  throw new Error(`${filename}: points must be a .json or .csv file`);
}

function fromJson(text: string): Point[] {
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error('JSON points must be an array');
  return rows.map((row, i) => {
    const [lat, lng] = Array.isArray(row) ? row : [row?.lat, row?.lng];
    if (!isLatLng(lat, lng)) throw new Error(`row ${i + 1}: expected [lat, lng] or { lat, lng } with numbers in range`);
    return { lat, lng };
  });
}

function fromCsv(text: string): Point[] {
  const [header = '', ...lines] = text.split(/\r?\n/);
  const columns = splitCsv(header).map((h) => h.trim().toLowerCase());
  const latAt = columns.indexOf('lat');
  const lngAt = columns.indexOf('lng');
  if (latAt < 0 || lngAt < 0) throw new Error('CSV header must have lat and lng columns');

  const points: Point[] = [];
  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    const cells = splitCsv(line);
    const [lat, lng] = [cells[latAt], cells[lngAt]].map((c) => (c?.trim() ? Number(c) : NaN));
    if (!isLatLng(lat, lng)) throw new Error(`line ${i + 2}: lat and lng must be numbers in range`);
    points.push({ lat, lng });
  });
  return points;
}

/** One CSV record: comma-separated, fields optionally in double quotes, "" for a literal quote. */
function splitCsv(line: string): string[] {
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
  return cells;
}
