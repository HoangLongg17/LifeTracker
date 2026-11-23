
import type { Firestore } from 'firebase-admin/firestore';

// Các loại nhật ký được hỗ trợ trong Sprint 4
export const LOG_COLLECTIONS = {
  water: 'waterLogs',
  activity: 'activityLogs',
  sleep: 'sleepLogs',
  meal: 'mealLogs',
} as const;

export type LogType = keyof typeof LOG_COLLECTIONS;

// Kiểm tra dữ liệu có phải object hợp lệ
export function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

// Kiểm tra entryId để chống ID không hợp lệ
export function validEntryId(
  value: unknown
): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(value)
  );
}

// Kiểm tra múi giờ theo chuẩn IANA
export function validTimeZone(
  value: unknown
): value is string {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: value,
    });
    return true;
  } catch {
    return false;
  }
}

export function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Tính ngày địa phương từ thời điểm sự kiện
export function localDate(
  date: Date,
  timeZone: string
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

// Xác định đường dẫn Firestore của nhật ký
export function getLogCollection(
  db: Firestore,
  uid: string,
  type: LogType
) {
  return db
    .collection('users')
    .doc(uid)
    .collection(LOG_COLLECTIONS[type]);
}

// Xác định document nhật ký
export function getLogDocument(
  db: Firestore,
  uid: string,
  type: LogType,
  entryId: string
) {
  return getLogCollection(db, uid, type).doc(entryId);
}

// Kiểm tra trạng thái tài khoản
export function accessError(
  status: unknown
): string | null {
  if (status === 'active') {
    return null;
  }

  return status === 'deleting'
    ? 'ACCOUNT_DELETING'
    : 'ACCOUNT_DISABLED';
}

/**
 * Lưu dấu vết các entryId đã bị xóa để
 * request POST cũ không thể tạo lại nhật ký.
 */
export function getLogTombstoneDocument(
  db: Firestore,
  uid: string,
  type: LogType,
  entryId: string
) {
  return db
    .collection('users')
    .doc(uid)
    .collection('logTombstones')
    .doc(`${type}_${entryId}`);
}
