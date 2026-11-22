import { markSummaryStale } from './logSummary';
import { createHash } from 'node:crypto';
import {
  FieldValue,
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';

import {
  accessError,
  getLogDocument,
    getLogTombstoneDocument,
  isRecord,
  localDate,
  validEntryId,
  validTimeZone,
  type LogType,
} from './logCommon';

type CreateLogInput = {
  db: Firestore;
  uid: string;
  type: LogType;
  entryId: string;
  eventAt: Date;
  timeZone: string;
  fields: Record<string, unknown>;
};

// Trường thời gian dùng để xác định ngày nhật ký.
const eventFields: Record<LogType, string> = {
  water: 'loggedAt',
  meal: 'loggedAt',
  activity: 'startedAt',
  sleep: 'sleepEnd',
};

// Các trường chỉ được Backend quản lý.
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

// Chuẩn hóa thứ tự khóa để so sánh nội dung khi retry.
function canonicalize(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalize(value[key]),
        ])
    );
  }

  return value;
}

// Tạo fingerprint từ nội dung nghiệp vụ đã chuẩn hóa.
function fingerprint(value: unknown): string {
  const normalized = JSON.stringify(canonicalize(value));

  if (typeof normalized !== 'string') {
    throw new Error('INVALID_LOG_CONTENT');
  }

  return createHash('sha256')
    .update(normalized)
    .digest('hex');
}

export async function createLog(input: CreateLogInput) {
  const {
    db,
    uid,
    type,
    entryId,
    eventAt,
    timeZone,
    fields,
  } = input;

  if (!uid || !validEntryId(entryId)) {
    throw new Error('INVALID_LOG_IDENTITY');
  }

  if (
    !(eventAt instanceof Date) ||
    !Number.isFinite(eventAt.getTime()) ||
    !validTimeZone(timeZone)
  ) {
    throw new Error('INVALID_LOG_TIME');
  }

  const eventField = eventFields[type];

  if (!eventField || !isRecord(fields)) {
    throw new Error('INVALID_LOG_TYPE_OR_FIELDS');
  }

  for (const field of Object.keys(fields)) {
    if (
      protectedFields.has(field) ||
      field === eventField
    ) {
      throw new Error(`PROTECTED_FIELD: ${field}`);
    }
  }

  // fields phải được route nghiệp vụ kiểm tra và chuẩn hóa
  // trước khi chuyển vào service này.
  const day = localDate(eventAt, timeZone);

  const requestFingerprint = fingerprint({
    type,
    timeZone,
    eventAt: eventAt.toISOString(),
    fields,
  });

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

  const summaryRef = userRef
    .collection('dailySummaries')
    .doc(day);

  return db.runTransaction(async (transaction) => {
    // Firestore yêu cầu đọc trước khi ghi.
    const account = await transaction.get(userRef);
    const profile = await transaction.get(profileRef);
    const existing = await transaction.get(logRef);
    const tombstone = await transaction.get(tombstoneRef);
    const summary = await transaction.get(summaryRef);

    if (!account.exists || !profile.exists) {
      return { status: 'ACCOUNT_NOT_INITIALIZED' };
    }

    const denied = accessError(account.get('status'));

    if (denied) {
      return { status: denied };
    }
    // ID đã từng bị xóa không được sử dụng lại.
    if (tombstone.exists) {
    return {
        status: 'ENTRY_ALREADY_DELETED',
        entryId,
    };
    }
    // Kiểm tra entryId đã được sử dụng chưa.
    if (existing.exists) {
      const sameRequest =
        existing.get('requestFingerprint') ===
        requestFingerprint;

      if (sameRequest) {
        return {
          status: 'existing',
          entryId,
          localDate: day,
        };
      }

      return { status: 'ENTRY_ID_CONFLICT' };
    }

    const timestamp = FieldValue.serverTimestamp();

    // Chỉ tạo document nếu entryId chưa tồn tại.
    transaction.create(logRef, {
      ...fields,
      entryId,
      userId: uid,
      [eventField]: Timestamp.fromDate(eventAt),
      timeZone,
      localDate: day,
      source: 'manual',
      version: 1,
      requestFingerprint,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

// Đánh dấu tổng hợp cần tính lại,
// kể cả khi chưa có document dailySummaries.
markSummaryStale(
  transaction,
  summaryRef,
  summary,
  day,
  timeZone,
  type
);

    return {
      status: 'created',
      entryId,
      localDate: day,
    };
  });
}
