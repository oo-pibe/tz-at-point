import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLatLng, pointKey } from '../src/key.ts';

test('rounds to four decimals', () => {
  assert.equal(pointKey(51.55614, -0.27936), '51.5561,-0.2794');
});

test('negative zero keys the same as zero', () => {
  assert.equal(pointKey(-0.000004, -0.00001), '0.0000,0.0000');
});

test('anything that is not a coordinate has no key', () => {
  for (const [lat, lng] of [[null, 1], [undefined, 1], ['51.5', '0'], [{}, 1], [NaN, 1],
    [Infinity, 1], [91, 0], [-90.5, 0], [0, 180.01], [0, -181]]) {
    assert.equal(pointKey(lat, lng), null, JSON.stringify([lat, lng]));
    assert.equal(isLatLng(lat, lng), false);
  }
});

test('the edges of the globe are coordinates', () => {
  assert.equal(pointKey(90, 180), '90.0000,180.0000');
  assert.equal(pointKey(-90, -180), '-90.0000,180.0000');
});

test('longitude 180 and -180 are the same meridian, so they key the same', () => {
  assert.equal(pointKey(0, -180), '0.0000,180.0000');
  assert.equal(pointKey(0, -179.99999), '0.0000,180.0000');
});
