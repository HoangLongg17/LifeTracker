
import { after, test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  initializeApp,
  deleteApp,
} from 'firebase-admin/app';

import { getFirestore } from 'firebase-admin/firestore';

import { createLog } from './logCreate';
import { updateLog } from './logUpdate';
import { deleteLog } from './logDelete';
import { getLogDocument } from './logCommon';

// Tuyệt đối không chạy test này trên Firestore thật.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'FIRESTORE_EMULATOR_REQUIRED: Integration tests must use Firestore Emulator.'
  );
}

const app = initializeApp(
  { projectId: 'demo-life39-tests' },
  'life39-test'
);

const db = getFirestore(app);

const uidA = 'life39_test_user_A';
const uidB = 'life39_test_user_B';

async function prepareUser(uid: string) {
  const userRef = db.collection('users').doc(uid);

  await userRef.set({
    uid,
    status: 'active',
    role: 'user',
    version: 1,
  });

  await userRef.collection('profiles').doc('main').set({
    timeZone: 'Asia/Ho_Chi_Minh',
    version: 1,
  });
}

after(async () => {
  await db.recursiveDelete(db.collection('users').doc(uidA));
  await db.recursiveDelete(db.collection('users').doc(uidB));
  await db.terminate();
  await deleteApp(app);
});

test('LIFE-39: create, retry, version and day changes', async () => {
  await prepareUser(uidA);
  await prepareUser(uidB);

  const entryId = 'life39_water_test_001';

  const firstDay = new Date('2026-11-21T08:00:00.000Z');
  const secondDay = new Date('2026-11-22T08:00:00.000Z');

  const baseInput = {
    db,
    uid: uidA,
    type: 'water' as const,
    entryId,
    eventAt: firstDay,
    timeZone: 'Asia/Ho_Chi_Minh',
    fields: { volumeMl: 250 },
  };

  // 1. Tạo lần đầu.
  const created = await createLog(baseInput);

  assert.equal(created.status, 'created');

  // 2. Retry cùng entryId, cùng nội dung.
  const retried = await createLog(baseInput);

  assert.equal(retried.status, 'existing');

  // 3. Cùng entryId nhưng khác nội dung.
  const conflict = await createLog({
    ...baseInput,
    fields: { volumeMl: 500 },
  });

  assert.equal(conflict.status, 'ENTRY_ID_CONFLICT');

  // 4. Tài khoản B không có bản ghi của A.
  const otherUserLog = await getLogDocument(
    db,
    uidB,
    'water',
    entryId
  ).get();

  assert.equal(otherUserLog.exists, false);

  // 5. Tài khoản B không thể sửa bản ghi của A.
  const otherUserUpdate = await updateLog({
    db,
    uid: uidB,
    type: 'water',
    entryId,
    expectedVersion: 1,
    fields: { volumeMl: 999 },
  });

  assert.equal(otherUserUpdate.status, 'ENTRY_NOT_FOUND');

  // 6. Cập nhật bản ghi của A sang ngày khác.
  const updated = await updateLog({
    db,
    uid: uidA,
    type: 'water',
    entryId,
    expectedVersion: 1,
    eventAt: secondDay,
    fields: { volumeMl: 350 },
  });

  assert.equal(updated.status, 'updated');

  // 7. Sửa lại bằng version cũ.
  const outdatedUpdate = await updateLog({
    db,
    uid: uidA,
    type: 'water',
    entryId,
    expectedVersion: 1,
    fields: { volumeMl: 400 },
  });

  assert.equal(
    outdatedUpdate.status,
    'VERSION_CONFLICT'
  );

  // 8. Kiểm tra ngày cũ và ngày mới đều stale.
  const userRef = db.collection('users').doc(uidA);

  const oldSummary = await userRef
    .collection('dailySummaries')
    .doc('2026-11-21')
    .get();

  const newSummary = await userRef
    .collection('dailySummaries')
    .doc('2026-11-22')
    .get();

  assert.equal(
    oldSummary.get('recomputeStatus'),
    'stale'
  );

  assert.equal(
    newSummary.get('recomputeStatus'),
    'stale'
  );

  // 9. Xóa bằng version cũ.
  const outdatedDelete = await deleteLog({
    db,
    uid: uidA,
    type: 'water',
    entryId,
    expectedVersion: 1,
  });

  assert.equal(
    outdatedDelete.status,
    'VERSION_CONFLICT'
    );
  // 10. Xóa bằng version hiện tại.
  const deleted = await deleteLog({
    db,
    uid: uidA,
    type: 'water',
    entryId,
    expectedVersion: 2,
  });

  assert.equal(deleted.status, 'deleted');

  const afterDelete = await getLogDocument(
    db,
    uidA,
    'water',
    entryId
  ).get();

  assert.equal(afterDelete.exists, false);

  // 11. Retry POST sau khi nhật ký đã bị xóa.
  // Không được tự tạo lại nhật ký.
  const retryAfterDelete = await createLog(baseInput);

  assert.equal(
    retryAfterDelete.status,
    'ENTRY_ALREADY_DELETED'
  );

  // Đảm bảo document không được tạo lại.
  const stillDeleted = await getLogDocument(
    db,
    uidA,
    'water',
    entryId
  ).get();

  assert.equal(stillDeleted.exists, false);
});
