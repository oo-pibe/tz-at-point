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

test('error messages are short and printable, whatever the table holds', () => {
  const long = 'x'.repeat(5000) + '\u202e\u2028\u009b';
  for (const table of [{ v: long, points: {} }, { v: 1, points: { [long]: ['UTC', 0] } }, { v: 1, points: { '1.0000,1.0000': ['UTC', long] } }]) {
    assert.throws(() => readTable(table), (err: Error) => err.message.length < 200 && /^[\x20-\x7e]*$/.test(err.message));
  }
});

test('inherited properties are not a table', () => {
  assert.throws(() => readTable(Object.create({ v: 1, points: {} })), TypeError);
});

test('the table says where its data came from, and still validates', () => {
  const text = formatTable(new Map([['51.5561,-0.2794', ['Europe/London', 250]]]), 250);
  assert.match(text, /"attribution": "Timezone boundaries from OpenStreetMap \(https:\/\/www\.openstreetmap\.org\/copyright\), ODbL 1\.0\./);
  assert.match(text, /IANA tz database, public domain\."/);
  assert.equal(readTable(JSON.parse(text)).length, 1);
});

test('formats one sorted entry per line and round-trips', () => {
  const text = formatTable(new Map([['51.5561,-0.2794', ['Europe/London', 500]], ['35.8854,-5.3279', ['Africa/Ceuta', 0]]]), 250);
  assert.match(text, /"points": \{\n    "35\.8854,-5\.3279": \["Africa\/Ceuta",0\],\n    "51\.5561,-0\.2794": \["Europe\/London",500\]\n  \}\n\}\n$/);
  assert.equal(readTable(JSON.parse(text)).length, 2);
  assert.deepEqual(readTable(JSON.parse(formatTable(new Map(), 250))), []);
});

test('attribution is optional, but if present it must be text, as the type says', () => {
  assert.equal(readTable({ v: 1, attribution: 'ODbL, see README', points: {} }).length, 0);
  assert.equal(readTable({ v: 1, points: {} }).length, 0);
  for (const bad of [42, null, { a: 1 }, ['x']]) {
    assert.throws(() => readTable({ v: 1, attribution: bad, points: {} }), /attribution must be a string/, JSON.stringify(bad));
  }
});

test('a zone name that is also an Object.prototype property is refused, so it never reaches a consumer', () => {
  // `at(...).zone` ends up as a key in callers' caches. "__proto__" would pollute Object.prototype there,
  // and no honest table carries it: Intl rejects every one of these names.
  for (const zone of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.throws(() => readTable({ v: 1, points: { '0.0000,0.0000': [zone, 250] } }), /has an invalid zone name/, zone);
  }
  assert.equal(readTable({ v: 1, points: { '0.0000,0.0000': ['Etc/UTC', 250] } })[0].zone, 'Etc/UTC');
});
