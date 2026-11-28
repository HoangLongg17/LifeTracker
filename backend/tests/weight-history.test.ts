import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { compareWeightLogs, type WeightLog } from '../src/services/weightHistory';

test('weight ordering uses exact measuredAt, then updatedAt, then entryId', () => {
  const logs: WeightLog[] = [
    { id: 'later-id', data: { entryId: 'later-id', measuredAt: new Timestamp(100, 1), updatedAt: new Timestamp(200, 1) } },
    { id: 'earlier-measurement', data: { entryId: 'earlier-measurement', measuredAt: new Timestamp(100, 0), updatedAt: new Timestamp(300, 0) } },
    { id: 'tie-a', data: { entryId: 'tie-a', measuredAt: new Timestamp(100, 1), updatedAt: new Timestamp(200, 1) } },
    { id: 'tie-b', data: { entryId: 'tie-b', measuredAt: new Timestamp(100, 1), updatedAt: new Timestamp(200, 1) } },
    { id: 'updated-newer', data: { entryId: 'updated-newer', measuredAt: new Timestamp(100, 1), updatedAt: new Timestamp(200, 2) } },
  ];

  assert.deepEqual(logs.sort(compareWeightLogs).map(log => log.id), [
    'updated-newer',
    'tie-b',
    'tie-a',
    'later-id',
    'earlier-measurement',
  ]);
});
