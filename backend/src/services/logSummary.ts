
import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';

import type { LogType } from './logCommon';

// Xác định ngày tiếp theo trong lịch.
function nextDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);

  date.setUTCDate(date.getUTCDate() + 1);

  return date.toISOString().slice(0, 10);
}

/**
 * Đánh dấu tổng hợp ngày cần tính lại.
 *
 * Hàm phải được gọi bên trong Firestore Transaction
 * sau khi đã đọc summaryRef.
 *
 * Không tự gán các tổng bằng 0.
 */
export function markSummaryStale(
  transaction: Transaction,
  summaryRef: DocumentReference,
  summary: DocumentSnapshot,
  dateKey: string,
  timeZone: string,
  type: LogType
): void {
  const timestamp = FieldValue.serverTimestamp();

  // Trường hợp document tổng hợp đã tồn tại.
  if (summary.exists) {
    transaction.update(summaryRef, {
      sourceRevision: FieldValue.increment(1),
      recomputeStatus: 'stale',
      [`userConfirmedByCategory.${type}`]: false,
      updatedAt: timestamp,
    });

    return;
  }

  // Trường hợp document tổng hợp chưa tồn tại.
  // Chỉ tạo metadata cần tính lại, chưa tính totals.
  transaction.create(summaryRef, {
    dateKey,
    timeZone,
    periodStart: dateKey,
    periodEnd: nextDate(dateKey),
    sourceRevision: 1,
    recomputeStatus: 'stale',
    userConfirmedByCategory: {
      [type]: false,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
