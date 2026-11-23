import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { isRecord, validDay, validTimeZone } from './logCommon';
import type { TimedLog } from './sessionIntervals';

const activityTypes = ['walking', 'running', 'cycling', 'swimming', 'gym', 'other'];
export class TimedLogInputError extends Error {
  constructor(readonly field: string, readonly code: string) { super(code); }
}
function invalid(field: string, code = 'INVALID_VALUE'): never { throw new TimedLogInputError(field, code); }

function parseTime(value: unknown, field: string, now: number) {
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value !== 'string' || !validDay(value.slice(0, 10)) ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) {
    invalid(field, 'INVALID_DATE_TIME');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) invalid(field, 'INVALID_DATE_TIME');
  if (date.getTime() > now + 5 * 60000) invalid(field, 'FUTURE_TIME');
  return date;
}

function positive(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid(field);
  return value;
}

// PATCH validates the merged record. updateLog checks the same version again inside its transaction.
export function parseTimedLog(type: TimedLog, input: unknown, existing?: DocumentData, now = Date.now()) {
  if (!isRecord(input)) invalid('form', 'INVALID_BODY');
  const fields = type === 'activity' ? ['activityType', 'startedAt', 'durationMinutes', 'endedAt'] :
    ['sleepStart', 'sleepEnd', 'awakeMinutes', 'subjectiveQuality'];
  const allowed = new Set([...fields, existing ? 'version' : 'entryId', 'timeZone', 'warningConfirmed']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) invalid(key, 'FIELD_NOT_ALLOWED');
  if (existing && !Object.keys(input).some(key => fields.includes(key) || key === 'timeZone')) invalid('form', 'EMPTY_UPDATE');
  if ('warningConfirmed' in input && typeof input.warningConfirmed !== 'boolean') invalid('warningConfirmed');
  const data = { ...existing, ...input };
  if (!validTimeZone(data.timeZone)) invalid('timeZone', 'INVALID_TIME_ZONE');

  const values: DocumentData = {};
  let eventAt: Date;
  let minutes: number;
  if (type === 'activity') {
    if (!activityTypes.includes(data.activityType)) invalid('activityType');
    const start = parseTime(data.startedAt, 'startedAt', now);
    minutes = positive(data.durationMinutes, 'durationMinutes');
    const computedEnd = start.getTime() + Math.round(minutes * 60000);
    if (!Number.isSafeInteger(computedEnd) || computedEnd <= start.getTime() || !Number.isFinite(new Date(computedEnd).getTime())) invalid('durationMinutes');
    const end = 'endedAt' in input ? parseTime(input.endedAt, 'endedAt', now)
      : existing?.endedAt && !('durationMinutes' in input || 'startedAt' in input) ? (existing.endedAt as Timestamp).toDate()
      : new Date(computedEnd);
    if (end <= start || Math.abs(end.getTime() - computedEnd) > 60000) invalid('endedAt', 'DURATION_MISMATCH');
    if (end.getTime() > now + 300000) invalid('durationMinutes', 'FUTURE_TIME');
    eventAt = start;
    Object.assign(values, { activityType: data.activityType, durationMinutes: minutes, endedAt: Timestamp.fromDate(end) });
  } else {
    const start = parseTime(data.sleepStart, 'sleepStart', now);
    const end = parseTime(data.sleepEnd, 'sleepEnd', now);
    if (end <= start) invalid('sleepEnd', 'END_BEFORE_START');
    minutes = (end.getTime() - start.getTime()) / 60000;
    const awake = data.awakeMinutes ?? null;
    if (awake !== null && (typeof awake !== 'number' || !Number.isFinite(awake) || awake < 0 || awake > minutes)) invalid('awakeMinutes');
    const quality = data.subjectiveQuality ?? null;
    if (quality !== null && (!Number.isInteger(quality) || quality < 1 || quality > 5)) invalid('subjectiveQuality');
    eventAt = end;
    Object.assign(values, { sleepStart: Timestamp.fromDate(start), sessionMinutes: minutes, awakeMinutes: awake,
      actualSleepMinutes: awake === null ? null : minutes - awake, subjectiveQuality: quality });
  }
  if (minutes > (type === 'activity' ? 360 : 1440)) {
    const previousDuration = existing?.[type === 'activity' ? 'durationMinutes' : 'sessionMinutes'];
    if (input.warningConfirmed !== true && !(existing?.durationWarningConfirmed === true && minutes === previousDuration)) {
      invalid(type === 'activity' ? 'durationMinutes' : 'sleepEnd', 'CONFIRM_LONG_SESSION');
    }
    values.durationWarningConfirmed = true;
  } else {
    values.durationWarningConfirmed = false;
  }
  return { fields: values, eventAt, timeZone: data.timeZone };
}
