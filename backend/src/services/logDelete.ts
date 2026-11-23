
import {
  FieldValue,
  type Firestore,
} from 'firebase-admin/firestore';

import {
  accessError,
  getLogDocument,
  getLogTombstoneDocument,
  validEntryId,
  validTimeZone,
  LOG_COLLECTIONS,
  type LogType,
} from './logCommon';

import { markSummaryStale } from './logSummary';

type DeleteLogInput = {
  db: Firestore;
  uid: string;
  type: LogType;
  entryId: string;
  expectedVersion: number;
};

export async function deleteLog(input: DeleteLogInput) {
  const {
    db,
    uid,
    type,
    entryId,
    expectedVersion,
  } = input;

  // 1. Kiểm tra dữ liệu đầu vào.
  if (!uid || !validEntryId(entryId)) {
    throw new Error('INVALID_LOG_IDENTITY');
  }

  if (!(type in LOG_COLLECTIONS)) {
    throw new Error('INVALID_LOG_TYPE');
  }

  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    throw new Error('INVALID_VERSION');
  }

  // 2. Xác định các document liên quan.
  const userRef = db.collection('users').doc(uid);

  const profileRef = userRef
    .collection('profiles')
    .doc('main');

  const logRef = getLogDocument(
    db,
    uid,
    type,
    entryId
  );
  const tombstoneRef = getLogTombstoneDocument(
  db,
  uid,
  type,
  entryId
);

  // 3. Thực hiện Firestore Transaction.
  return db.runTransaction(async (transaction) => {
    const account = await transaction.get(userRef);
    const profile = await transaction.get(profileRef);
    const existing = await transaction.get(logRef);
    const tombstone = await transaction.get(tombstoneRef);

    // 4. Kiểm tra trạng thái tài khoản.
    if (!account.exists || !profile.exists) {
      return {
        status: 'ACCOUNT_NOT_INITIALIZED',
      };
    }

    const denied = accessError(account.get('status'));

    if (denied) {
      return { status: denied };
    }
    if (tombstone.exists) {
    return {
        status: 'ENTRY_ALREADY_DELETED',
    };
    }
    // 5. Kiểm tra nhật ký có tồn tại không.
    if (!existing.exists) {
      return { status: 'ENTRY_NOT_FOUND' };
    }

    // 6. Kiểm tra version.
    const currentVersion = existing.get('version');

    if (currentVersion !== expectedVersion) {
      return {
        status: 'VERSION_CONFLICT',
        currentVersion,
      };
    }

    // 7. Lấy ngày và múi giờ của nhật ký.
    const oldDay = existing.get('localDate');
    const timeZone = existing.get('timeZone');

    if (
      typeof oldDay !== 'string' ||
      !validTimeZone(timeZone)
    ) {
      throw new Error('INVALID_EXISTING_LOG');
    }

    const summaryRef = userRef
      .collection('dailySummaries')
      .doc(oldDay);

    // Firestore Transaction phải đọc trước khi ghi.
    const summary = await transaction.get(summaryRef);
// 8. Lưu dấu vết entryId đã bị xóa.
transaction.create(tombstoneRef, {
  entryId,
  userId: uid,
  type,
  requestFingerprint:
    existing.get('requestFingerprint') ?? null,
  deletedVersion: currentVersion,
  deletedAt: FieldValue.serverTimestamp(),
});

// 9. Xóa document nhật ký gốc.
    transaction.delete(logRef);
    markSummaryStale(
      transaction,
      summaryRef,
      summary,
      oldDay,
      timeZone,
      type
    );

    return {
      status: 'deleted',
      entryId,
      previousVersion: currentVersion,
      localDate: oldDay,
    };
  });
}
