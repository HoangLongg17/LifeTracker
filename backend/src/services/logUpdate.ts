import { markSummaryStale } from './logSummary';
import {
  FieldValue,
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';

import {
  accessError,
  getLogDocument,
  isRecord,
  localDate,
  validEntryId,
  validTimeZone,
  type LogType,
} from './logCommon';

type UpdateLogInput = {
  db: Firestore;
  uid: string;
  type: LogType;
  entryId: string;
  expectedVersion: number;
  eventAt?: Date;
  timeZone?: string;
  fields?: Record<string, unknown>;
};

const eventFields: Record<LogType, string> = {
  water: 'loggedAt',
  meal: 'loggedAt',
  activity: 'startedAt',
  sleep: 'sleepEnd',
};

const protectedFields = new Set([
  'entryId',
  'userId',
  'version',
  'source',
  'timeZone',
  'localDate',
  'createdAt',
  'updatedAt',
  'requestFingerprint',
]);

export async function updateLog(input: UpdateLogInput) {
  const {
    db,
    uid,
    type,
    entryId,
    expectedVersion,
    eventAt,
    timeZone,
  } = input;

  const fields = input.fields ?? {};

  if (!uid || !validEntryId(entryId)) {
    throw new Error('INVALID_LOG_IDENTITY');
  }

  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    throw new Error('INVALID_VERSION');
  }

  if (!isRecord(fields)) {
    throw new Error('INVALID_LOG_FIELDS');
  }

  if (
    eventAt !== undefined &&
    (
      !(eventAt instanceof Date) ||
      !Number.isFinite(eventAt.getTime())
    )
  ) {
    throw new Error('INVALID_LOG_TIME');
  }

  if (
    timeZone !== undefined &&
    !validTimeZone(timeZone)
  ) {
    throw new Error('INVALID_TIME_ZONE');
  }

  const eventField = eventFields[type];

  if (!eventField) {
    throw new Error('INVALID_LOG_TYPE');
  }

  for (const field of Object.keys(fields)) {
    if (
      protectedFields.has(field) ||
      field === eventField
    ) {
      throw new Error(`PROTECTED_FIELD: ${field}`);
    }
  }

  if (
    Object.keys(fields).length === 0 &&
    eventAt === undefined &&
    timeZone === undefined
  ) {
    throw new Error('EMPTY_LOG_UPDATE');
  }

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

  return db.runTransaction(async (transaction) => {
    // 1. Đọc tài khoản, hồ sơ và nhật ký.
    const account = await transaction.get(userRef);
    const profile = await transaction.get(profileRef);
    const existing = await transaction.get(logRef);

    if (!account.exists || !profile.exists) {
      return { status: 'ACCOUNT_NOT_INITIALIZED' };
    }

    const denied = accessError(account.get('status'));

    if (denied) {
      return { status: denied };
    }

    if (!existing.exists) {
      return { status: 'ENTRY_NOT_FOUND' };
    }

    // 2. Kiểm tra version hiện tại.
    const currentVersion = existing.get('version');

    if (currentVersion !== expectedVersion) {
      return {
        status: 'VERSION_CONFLICT',
        currentVersion,
      };
    }

    // 3. Lấy thời điểm và múi giờ hiện tại.
    const oldTimestamp = existing.get(eventField);
    const oldTimeZone = existing.get('timeZone');
    const oldDay = existing.get('localDate');

    if (
      !(oldTimestamp instanceof Timestamp) ||
      !validTimeZone(oldTimeZone) ||
      typeof oldDay !== 'string'
    ) {
      throw new Error('INVALID_EXISTING_LOG');
    }

    const nextEventAt =
      eventAt ?? oldTimestamp.toDate();

    const nextTimeZone =
      timeZone ?? oldTimeZone;

    const newDay = localDate(
      nextEventAt,
      nextTimeZone
    );

    // 4. Đọc dữ liệu tổng hợp trước khi ghi.
    const oldSummaryRef = userRef
      .collection('dailySummaries')
      .doc(oldDay);

    const newSummaryRef = userRef
      .collection('dailySummaries')
      .doc(newDay);

    const oldSummary =
      await transaction.get(oldSummaryRef);

    const newSummary =
      oldDay === newDay
        ? oldSummary
        : await transaction.get(newSummaryRef);

    const timestamp = FieldValue.serverTimestamp();

    // 5. Tạo dữ liệu thay đổi.
    const changes: Record<string, unknown> = {
      ...fields,
      localDate: newDay,
      version: expectedVersion + 1,
      updatedAt: timestamp,
    };

    if (eventAt !== undefined) {
      changes[eventField] =
        Timestamp.fromDate(nextEventAt);
    }

    if (timeZone !== undefined) {
      changes.timeZone = nextTimeZone;
    }

    // 6. Cập nhật nhật ký.
    transaction.update(logRef, changes);
    // 7. Đánh dấu ngày cũ cần tính lại.
markSummaryStale(
  transaction,
  oldSummaryRef,
  oldSummary,
  oldDay,
  oldTimeZone,
  type
);

// 8. Nếu nhật ký chuyển ngày,
// đánh dấu cả ngày mới cần tính lại.
if (oldDay !== newDay) {
  markSummaryStale(
    transaction,
    newSummaryRef,
    newSummary,
    newDay,
    nextTimeZone,
    type
  );
}


    return {
      status: 'updated',
      entryId,
      version: expectedVersion + 1,
      previousLocalDate: oldDay,
      localDate: newDay,
    };
  });
}
