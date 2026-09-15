import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsFromCsv, pointsFromJson } from '../src/points.ts';

test('JSON objects and tuples, extra fields ignored', () => {
  assert.deepEqual(pointsFromJson([{ name: 'a', lat: 1.5, lng: 2 }, [3, 4]]), [{ lat: 1.5, lng: 2 }, { lat: 3, lng: 4 }]);
});

test('CSV with columns in any order, quoted commas, CRLF and a byte-order mark', () => {
  const csv = '﻿name,lng,lat\r\n"Wembley, London",-0.2794,51.5561\n\nCeuta,-5.3279,35.8854\r\n';
  assert.deepEqual(pointsFromCsv(csv), [{ lat: 51.5561, lng: -0.2794 }, { lat: 35.8854, lng: -5.3279 }]);
});

test('a bad row is an error naming the row', () => {
  for (const rows of [[[1, 2], { lat: '1', lng: 2 }], [[1, 2], [95, 0]], [[1, 2], null], [[1, 2], [1, 2, 3]]]) {
    assert.throws(() => pointsFromJson(rows), /row 2/, JSON.stringify(rows));
  }
  for (const csv of ['lat,lng\n1,2\n,3\n', 'lat,lng\n1,2\n1,abc\n', 'lat,lng\n1,2\n0x1A,5\n', 'lat,lng\n1,2\n1e1,5\n']) {
    assert.throws(() => pointsFromCsv(csv), /line 3/, csv);
  }
  assert.throws(() => pointsFromCsv('lat,lng,name\n1,2,"a\n3,4"\n'), /line 2.*quote/);
});

test('shape errors', () => {
  assert.throws(() => pointsFromJson({ lat: 1 }), /array/);
  assert.throws(() => pointsFromCsv('name,x\na,1\n'), /lat and lng/);
});
