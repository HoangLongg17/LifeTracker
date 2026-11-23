import assert from 'node:assert/strict';
import { test } from 'node:test';
import { instant, normalizeTime } from '../src/utils/journal-time.ts';

test('journal inputs accept one- or two-digit hours and require valid two-digit minutes', () => {
  for (const [input, expected] of [['7:30', '07:30'], ['07:30', '07:30'], ['0:05', '00:05'], ['23:59', '23:59']]) {
    assert.equal(normalizeTime(input), expected);
  }
  for (const input of ['24:00', '7:60', '7:3', '7:', '', 'abc']) {
    assert.equal(normalizeTime(input), null);
    assert.equal(instant({ date: '23/11/2026', time: input }, 'Asia/Ho_Chi_Minh'), null);
  }
});

test('saving directly from a short-hour input uses the local instant and preserves an unchanged edit', () => {
  const wall = { date: '23/11/2026', time: '7:30' };
  assert.equal(instant(wall, 'Asia/Ho_Chi_Minh'), '2026-11-23T00:30:00.000Z');
  const original = '2026-11-23T00:30:25.123Z';
  assert.equal(instant(wall, 'Asia/Ho_Chi_Minh', original), original);
});
