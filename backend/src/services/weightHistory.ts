import {
  Timestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

export type WeightLog = { id: string; data: Record<string, unknown> };

function millis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function localDateFrom(value: unknown, timeZone: string) {
  const timestamp = millis(value);
  if (timestamp === null) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function weightLogIsValid(data: Record<string, unknown>) {
  const status = data.validationStatus;
  return (status === undefined || status === null || status === 'valid')
    && typeof data.weightKg === 'number'
    && Number.isFinite(data.weightKg)
    && data.weightKg > 0
    && millis(data.measuredAt) !== null;
}

export function weightLogLocalDate(data: Record<string, unknown>, fallbackTimeZone?: unknown) {
  const storedDate = data.localDate;
  if (typeof storedDate === 'string' && validDate(storedDate)) return storedDate;
  const timeZone = validTimeZone(data.timeZone)
    ? data.timeZone
    : validTimeZone(fallbackTimeZone) ? fallbackTimeZone : 'Asia/Ho_Chi_Minh';
  return localDateFrom(data.measuredAt, timeZone);
}

function logEntryId(log: WeightLog) {
  return typeof log.data.entryId === 'string' ? log.data.entryId : log.id;
}

export function compareWeightLogs(left: WeightLog, right: WeightLog) {
  const leftMeasuredMinute = Math.floor((millis(left.data.measuredAt) ?? 0) / 60_000);
  const rightMeasuredMinute = Math.floor((millis(right.data.measuredAt) ?? 0) / 60_000);
  const measuredDifference = rightMeasuredMinute - leftMeasuredMinute;
  if (measuredDifference !== 0) return measuredDifference;
  const updatedDifference = (millis(right.data.updatedAt) ?? 0) - (millis(left.data.updatedAt) ?? 0);
  if (updatedDifference !== 0) return updatedDifference;
  const leftId = logEntryId(left);
  const rightId = logEntryId(right);
  return leftId === rightId ? 0 : rightId > leftId ? 1 : -1;
}

export function weightTimestamp(value: unknown) {
  const timestamp = millis(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

export function weightLogResponse(
  data: Record<string, unknown>,
  documentId?: string,
  fallbackTimeZone?: unknown,
) {
  const timeZone = validTimeZone(data.timeZone)
    ? data.timeZone
    : validTimeZone(fallbackTimeZone) ? fallbackTimeZone : 'Asia/Ho_Chi_Minh';
  const version = Number.isSafeInteger(data.version) && (data.version as number) >= 1
    ? data.version as number
    : 1;
  return {
    entryId: typeof data.entryId === 'string' ? data.entryId : documentId,
    weightKg: data.weightKg,
    measuredAt: weightTimestamp(data.measuredAt),
    timeZone,
    localDate: weightLogLocalDate(data, timeZone),
    createdAt: weightTimestamp(data.createdAt),
    updatedAt: weightTimestamp(data.updatedAt),
    version,
    warningConfirmed: data.warningConfirmed === true,
  };
}

function latestWeight(logs: WeightLog[], excludedEntryId?: string, replacement?: Record<string, unknown>) {
  const candidates = logs.filter(log => log.id !== excludedEntryId && weightLogIsValid(log.data));
  if (replacement && weightLogIsValid(replacement)) {
    const replacementId = typeof replacement.entryId === 'string' ? replacement.entryId : '';
    candidates.push({ id: replacementId, data: replacement });
  }
  candidates.sort(compareWeightLogs);
  const weight = candidates[0]?.data.weightKg;
  return typeof weight === 'number' && Number.isFinite(weight) ? weight : null;
}

export async function getLatestWeightKg(userRef: DocumentReference) {
  const result = await userRef.collection('weightLogs').orderBy('measuredAt', 'desc').get();
  return latestWeight(result.docs.map(document => ({ id: document.id, data: document.data() })));
}

export async function getLatestWeightKgInTransaction(
  transaction: Transaction,
  userRef: DocumentReference,
  excludedEntryId?: string,
  replacement?: Record<string, unknown>,
) {
  const result = await transaction.get(
    userRef.collection('weightLogs').orderBy('measuredAt', 'desc'),
  );
  const logs = result.docs.map(document => ({ id: document.id, data: document.data() }));
  return latestWeight(logs, excludedEntryId, replacement);
}

export function getWeightLogReference(db: Firestore, uid: string, entryId: string) {
  return db.collection('users').doc(uid).collection('weightLogs').doc(entryId);
}
