
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  initializeApp,
  deleteApp,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { createLog } from './logCreate';
import { updateLog } from './logUpdate';
import { deleteLog } from './logDelete';
import {
  getLogDocument,
  getLogTombstoneDocument,
} from './logCommon';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_REQUIRED');
}

const app = initializeApp(
  { projectId: 'demo-life39-tests' },
  'life39-concurrency-test'
);

const db = getFirestore(app);

test('LIFE-39 concurrent transactions', async () => {
  const uid = 'life39_concurrent_user';
  const entryId = 'life39_concurrent_water_001';

  const userRef = db.collection('users').doc(uid);

  try {
    await userRef.set({
      uid,
      role: 'user',
      status: 'active',
      version: 1,
    });

    await userRef
      .collection('profiles')
      .doc('main')
      .set({
        version: 1,
        timeZone: 'Asia/Ho_Chi_Minh',
      });

    const input = {
      db,
      uid,
      type: 'water' as const,
      entryId,
      eventAt: new Date('2026-11-22T08:00:00Z'),
      timeZone: 'Asia/Ho_Chi_Minh',
      fields: { volumeMl: 250 },
    };

    // TEST 1: Hai yêu cầu tạo cùng lúc.
    const created = await Promise.all([
      createLog(input),
      createLog(input),
    ]);

    assert.deepEqual(
      created.map(x => x.status).sort(),
      ['created', 'existing'].sort()
    );

    const logRef = getLogDocument(
      db, uid, 'water', entryId
    );

    const first = await logRef.get();

    assert.equal(first.exists, true);
    assert.equal(first.get('version'), 1);

    // TEST 2: Hai yêu cầu sửa cùng version.
    const updated = await Promise.all([
      updateLog({
        db, uid, type: 'water', entryId,
        expectedVersion: 1,
        fields: { volumeMl: 300 },
      }),
      updateLog({
        db, uid, type: 'water', entryId,
        expectedVersion: 1,
        fields: { volumeMl: 400 },
      }),
    ]);

    assert.deepEqual(
      updated.map(x => x.status).sort(),
      ['updated', 'VERSION_CONFLICT'].sort()
    );

    const latest = await logRef.get();

    assert.equal(latest.get('version'), 2);
    assert.ok(
      [300, 400].includes(latest.get('volumeMl'))
    );

    // TEST 3: Hai yêu cầu xóa cùng lúc.
    const deleted = await Promise.all([
      deleteLog({
        db, uid, type: 'water', entryId,
        expectedVersion: 2,
      }),
      deleteLog({
        db, uid, type: 'water', entryId,
        expectedVersion: 2,
      }),
    ]);

    assert.deepEqual(
      deleted.map(x => x.status).sort(),
      ['deleted', 'ENTRY_ALREADY_DELETED'].sort()
    );

    assert.equal((await logRef.get()).exists, false);

    // TEST 4: Kiểm tra tombstone.
    const tombstone = await getLogTombstoneDocument(
      db, uid, 'water', entryId
    ).get();

    assert.equal(tombstone.exists, true);

    // TEST 5: POST cũ không được tạo lại bản ghi.
    const retry = await createLog(input);

    assert.equal(
      retry.status,
      'ENTRY_ALREADY_DELETED'
    );

    assert.equal((await logRef.get()).exists, false);

    // TEST 6: Tổng ngày được đánh dấu stale.
    const summary = await userRef
      .collection('dailySummaries')
      .doc('2026-11-22')
      .get();

    assert.equal(
      summary.get('recomputeStatus'),
      'stale'
    );

    assert.ok(
      Number(summary.get('sourceRevision')) >= 3
    );
  } finally {
    await db.recursiveDelete(userRef);
    await db.terminate();
    await deleteApp(app);
  }
});
