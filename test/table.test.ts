import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTable, readTable } from '../src/table.ts';

test('reads every entry with its parsed coordinate', () => {
  const entries = readTable({ v: 1, points: { '51.5561,-0.2794': ['Europe/London', 500], '35.8854,-5.3279': ['Africa/Ceuta', 0] } });
  assert.deepEqual(entries.find((e) => e.zone === 'Africa/Ceuta'), { key: '35.8854,-5.3279', lat: 35.8854, lng: -5.3279, zone: 'Africa/Ceuta', radius: 0 });
  assert.equal(entries.length, 2);
});

test('accepts every shape of IANA name', () => {
  for (const zone of ['America/Argentina/Buenos_Aires', 'Etc/GMT+12', 'Etc/GMT-14', 'America/Port-au-Prince', 'EST5EDT', 'UTC']) {
    assert.equal(readTable({ v: 1, points: { '1.0000,1.0000': [zone, 0] } })[0].zone, zone);
  }
});

test('rejects a malformed table with a TypeError that names the problem', () => {
  const bad: [unknown, RegExp][] = [
    [null, /table/], [[], /table/], [{ v: 2, points: {} }, /version/], [{ v: 1 }, /points/], [{ v: 1, points: [] }, /points/],
    [{ v: 1, points: new Map([['1.0000,1.0000', ['Europe/London', 0]]]) }, /points/],
    [{ v: 1, points: { '51.55614,-0.2794': ['Europe/London', 0] } }, /51\.55614/],
    [{ v: 1, points: { 'x,y': ['Europe/London', 0] } }, /x,y/],
    [{ v: 1, points: { '0.0000,-180.0000': ['Pacific/Fiji', 0] } }, /canonical/],
    [{ v: 1, points: { '1.0000,1.0000': ['', 0] } }, /zone/],
    [{ v: 1, points: { '1.0000,1.0000': ['<img src=x onerror=alert(1)>', 0] } }, /zone/],
    [{ v: 1, points: { '1.0000,1.0000': ['Europe/London', 0, 'junk'] } }, /\[zone, radius\]/],
    [{ v: 1, points: { '1.0000,1.0000': ['Europe/London', -1] } }, /radius/],
    [{ v: 1, points: { '1.0000,1.0000': ['Europe/London', 1001] } }, /radius/],
    [{ v: 1, points: { '1.0000,1.0000': ['Europe/London', 2.5] } }, /radius/],
    [{ v: 1, points: { '1.0000,1.0000': ['Europe/London', 255] } }, /radius/],
    [JSON.parse('{"v":1,"points":{"__proto__":["Europe/London",0]}}'), /canonical/],
    [{ v: 1, points: { '1.0000,1.0000': 'Europe/London' } }, /\[zone, radius\]/],
  ];
  for (const [table, message] of bad) assert.throws(() => readTable(table), { name: 'TypeError', message }, String(message));
});

test('a caller can name the table in its errors', () => {
  assert.throws(() => readTable({ v: 1, points: { nope: ['UTC', 0] } }, 'zones.json'), /^TypeError: zones\.json: entry "nope"/);
});

test('error messages escape what the table contains, so a table cannot write into CI logs', () => {
  const table = { v: 1, points: { 'x\n::error title=injected::boom': ['Europe/London', 0] } };
  assert.throws(() => readTable(table), (err: Error) => !err.message.includes('\n'));
});

test('formats one sorted entry per line and round-trips', () => {
  const text = formatTable(new Map([['51.5561,-0.2794', ['Europe/London', 500]], ['35.8854,-5.3279', ['Africa/Ceuta', 0]]]));
  assert.equal(text, '{\n  "v": 1,\n  "points": {\n    "35.8854,-5.3279": ["Africa/Ceuta",0],\n    "51.5561,-0.2794": ["Europe/London",500]\n  }\n}\n');
  assert.equal(readTable(JSON.parse(text)).length, 2);
  assert.deepEqual(readTable(JSON.parse(formatTable(new Map()))), []);
});
