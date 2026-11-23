import type { User } from 'firebase/auth';
import { AccountRequestError, apiRequest } from '@/services/session';
import { wallTime } from '@/utils/journal-time';

export const activities = { walking: 'Đi bộ', running: 'Chạy bộ', cycling: 'Đạp xe', swimming: 'Bơi lội', gym: 'Tập gym', other: 'Khác' };
export type ActivityType = keyof typeof activities;
export type Kind = 'activity' | 'sleep';
type BaseEntry = { entryId: string; localDate: string; timeZone: string; version: number; countedMinutes: number; overlapStatus: 'clear' | 'needs_review'; crossTypeOverlap?: boolean };
export type ActivityEntry = BaseEntry & { activityType: ActivityType; startedAt: string; endedAt?: string; durationMinutes: number };
export type SleepEntry = BaseEntry & { sleepStart: string; sleepEnd: string; sessionMinutes: number; awakeMinutes: number | null; subjectiveQuality: number | null };
type Entries = { activity: ActivityEntry; sleep: SleepEntry };
export type TimedEntry = Entries[Kind];
export type Day<T> = { items: T[]; totalMinutes: number | null };
export type TimedInput = { timeZone: string; warningConfirmed?: boolean } & (
  { activityType: ActivityType; startedAt: string; durationMinutes: number } | { sleepStart: string; sleepEnd: string }
);

export async function getTimedDay<K extends Kind>(user: User, kind: K, date: string): Promise<Day<Entries[K]>> {
  const items: Entries[K][] = [];
  let cursor: string | null = null;
  let totalMinutes: number | null = null;
  const seen = new Set<string>();
  do {
    const path: string = '/me/logs/' + kind + '?date=' + encodeURIComponent(date) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const page = await apiRequest(user, path, 'GET') as Day<Entries[K]> & { dateKey: string; nextCursor: string | null };
    if (page?.dateKey !== date || !Array.isArray(page.items)) throw new Error('INVALID_JOURNAL_RESPONSE');
    if (!cursor) totalMinutes = page.totalMinutes;
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('INVALID_JOURNAL_CURSOR');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { items, totalMinutes };
}

export async function readTimedEntry<K extends Kind>(user: User, kind: K, id: string) {
  const item = await apiRequest(user, '/me/logs/' + kind + '/' + encodeURIComponent(id), 'GET') as Entries[K];
  if (item?.entryId !== id) throw new Error('INVALID_JOURNAL_RESPONSE');
  return item;
}

export async function saveTimedEntry(user: User, kind: Kind, id: string, data: TimedInput, version?: number) {
  const path = '/me/logs/' + kind;
  const response = version === undefined
    ? await apiRequest(user, path, 'POST', { ...data, entryId: id })
    : await apiRequest(user, path + '/' + encodeURIComponent(id), 'PATCH', { ...data, version });
  const result = response as { entryId: string; localDate: string };
  if (result?.entryId !== id || typeof result.localDate !== 'string') throw new Error('INVALID_JOURNAL_RESPONSE');
  return result.localDate;
}

export function deleteTimedEntry(user: User, kind: Kind, id: string, version: number) {
  return apiRequest(user, '/me/logs/' + kind + '/' + encodeURIComponent(id), 'DELETE', { version });
}

export function isCrossTypeOverlap(error: unknown) {
  return error instanceof AccountRequestError && error.code === 'SLEEP_ACTIVITY_OVERLAP';
}

export function journalError(error: unknown, zone?: string) {
  if (error instanceof AccountRequestError) {
    if (isCrossTypeOverlap(error)) {
      const overlap = (error.body as { overlap?: { kind: Kind; start: string; end: string } } | null)?.overlap;
      if (zone && overlap && Number.isFinite(Date.parse(overlap.start)) && Number.isFinite(Date.parse(overlap.end))) {
        const start = wallTime(overlap.start, zone);
        const end = wallTime(overlap.end, zone);
        const period = start.time + (start.date === end.date ? '' : ' ngày ' + start.date) + ' đến ' + end.time + ' ngày ' + end.date;
        const label = overlap.kind === 'sleep' ? 'phiên ngủ' : 'buổi vận động';
        return 'Trùng với ' + label + ' từ ' + period + '. Hãy điều chỉnh khung giờ.';
      }
      return 'Giấc ngủ và vận động trùng thời gian. Hãy điều chỉnh khung giờ.';
    }
    if (error.status === 409) return 'Bản ghi đã thay đổi. Hãy tải lại trước khi tiếp tục.';
    if (error.code === 'ENTRY_NOT_FOUND') return 'Bản ghi này đã được xóa.';
    if (error.code === 'FUTURE_TIME') return 'Thời điểm ghi nhận không được ở tương lai.';
    if (error.status === 403) return 'Tài khoản hiện không thể truy cập nhật ký.';
    if (error.status === 400) return 'Thông tin chưa hợp lệ. Hãy kiểm tra ngày, giờ và thời lượng.';
  }
  return 'Chưa thể kết nối để cập nhật nhật ký. Vui lòng thử lại.';
}
