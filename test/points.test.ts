import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePoints } from '../src/points.ts';

test('JSON objects and tuples, extra fields ignored', () => {
  assert.deepEqual(parsePoints('[{"name":"a","lat":1.5,"lng":2},[3,4]]', 'p.json'), [{ lat: 1.5, lng: 2 }, { lat: 3, lng: 4 }]);
});

test('CSV with columns in any order, quoted commas and CRLF', () => {
  const csv = 'name,lng,lat\r\n"Wembley, London",-0.2794,51.5561\n\nCeuta,-5.3279,35.8854\r\n';
  assert.deepEqual(parsePoints(csv, 'p.csv'), [{ lat: 51.5561, lng: -0.2794 }, { lat: 35.8854, lng: -5.3279 }]);
});

test('a bad row is an error naming the row', () => {
  assert.throws(() => parsePoints('[[1,2],{"lat":"1","lng":2}]', 'p.json'), /row 2/);
  assert.throws(() => parsePoints('[[1,2],[95,0]]', 'p.json'), /row 2/);
  assert.throws(() => parsePoints('[[1,2],null]', 'p.json'), /row 2/);
  assert.throws(() => parsePoints('lat,lng\n1,2\n,3\n', 'p.csv'), /line 3/);
  assert.throws(() => parsePoints('lat,lng\n1,abc\n', 'p.csv'), /line 2/);
});

test('shape errors', () => {
  assert.throws(() => parsePoints('{"lat":1}', 'p.json'), /array/);
  assert.throws(() => parsePoints('name,x\na,1\n', 'p.csv'), /lat and lng/);
  assert.throws(() => parsePoints('1,2', 'p.txt'), /\.json or \.csv/);
});
