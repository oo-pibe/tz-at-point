import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTable, readTable } from '../src/table.ts';

test('reads entries sorted by latitude', () => {
  const entries = readTable({ v: 1, points: { '51.5561,-0.2794': ['Europe/London', 500], '35.8854,-5.3279': ['Africa/Ceuta', 0] } });
  assert.deepEqual(entries.map((e) => e.zone), ['Africa/Ceuta', 'Europe/London']);
  assert.deepEqual(entries[0], { key: '35.8854,-5.3279', lat: 35.8854, lng: -5.3279, zone: 'Africa/Ceuta', radius: 0 });
});

test('rejects a malformed table with a TypeError that names the problem', () => {
  const bad: [unknown, RegExp][] = [
    [null, /table/], [{ v: 2, points: {} }, /version/], [{ v: 1 }, /points/], [{ v: 1, points: [] }, /points/],
    [{ v: 1, points: { '51.55614,-0.2794': ['Europe/London', 0] } }, /51\.55614/],
    [{ v: 1, points: { 'x,y': ['Europe/London', 0] } }, /x,y/],
    [{ v: 1, points: { '1.0000,1.0000': ['', 0] } }, /1\.0000,1\.0000/],
    [{ v: 1, points: { '1.0000,1.0000': ['Europe/London', -1] } }, /radius/],
    [{ v: 1, points: { '1.0000,1.0000': ['Europe/London', 1001] } }, /radius/],
    [{ v: 1, points: { '1.0000,1.0000': ['Europe/London', 2.5] } }, /radius/],
    [{ v: 1, points: { '1.0000,1.0000': 'Europe/London' } }, /1\.0000,1\.0000/],
  ];
  for (const [table, message] of bad) assert.throws(() => readTable(table), { name: 'TypeError', message }, JSON.stringify(table));
});

test('a __proto__ key is just an invalid key, not a prototype', () => {
  const table = JSON.parse('{"v":1,"points":{"__proto__":["Europe/London",0]}}');
  assert.throws(() => readTable(table), TypeError);
});

test('formats one sorted entry per line and round-trips', () => {
  const text = formatTable(new Map([['51.5561,-0.2794', ['Europe/London', 500]], ['35.8854,-5.3279', ['Africa/Ceuta', 0]]]));
  assert.equal(text, '{\n  "v": 1,\n  "points": {\n    "35.8854,-5.3279": ["Africa/Ceuta",0],\n    "51.5561,-0.2794": ["Europe/London",500]\n  }\n}\n');
  assert.equal(readTable(JSON.parse(text)).length, 2);
  assert.deepEqual(readTable(JSON.parse(formatTable(new Map()))), []);
});
