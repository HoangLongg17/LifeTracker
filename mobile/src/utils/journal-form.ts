import type { ActivityType, Kind, TimedEntry, TimedInput } from '@/services/timed-journal';
import { dayKey, displayDate, instant, wallTime, type WallTime } from '@/utils/journal-time';

export type Draft = { activity: ActivityType; start: WallTime; end: WallTime; duration: string };
export type Evaluation = { startError?: string; endError?: string; durationError?: string; input?: TimedInput; minutes?: number; day?: string };

export function initialDraft(kind: Kind, date: string | null, zone: string, entry?: TimedEntry): Draft {
  const now = Math.floor(Date.now() / 60000) * 60000;
  let end = wallTime(now, zone);
  if (date && date !== dayKey(end.date)) end = { date: displayDate(date), time: kind === 'sleep' ? '07:00' : '14:20' };
  const endMs = Date.parse(instant(end, zone) ?? new Date(now).toISOString());
  if (entry && 'startedAt' in entry) return { activity: entry.activityType, start: wallTime(entry.startedAt, zone),
    end: wallTime(entry.endedAt ?? Date.parse(entry.startedAt) + entry.durationMinutes * 60_000, zone),
    duration: String(entry.durationMinutes).replace('.', ',') };
  if (entry && 'sleepStart' in entry) return { activity: 'walking', start: wallTime(entry.sleepStart, zone),
    end: wallTime(entry.sleepEnd, zone), duration: '' };
  return { activity: 'walking', start: wallTime(endMs - (kind === 'sleep' ? 30 : 20) * 60000, zone), end, duration: '20' };
}
export function evaluate(kind: Kind, draft: Draft, zone: string, entry?: TimedEntry, now = Date.now()): Evaluation {
  const result: Evaluation = {};
  const start = instant(draft.start, zone, entry && ('startedAt' in entry ? entry.startedAt : entry.sleepStart));
  const limit = now + 5 * 60000;
  if (!start) result.startError = 'Nhập ngày và giờ bắt đầu hợp lệ (DD/MM/YYYY, HH:mm).';
  else if (Date.parse(start) > limit) result.startError = 'Thời gian bắt đầu không được ở tương lai.';
  if (kind === 'activity') {
    const raw = draft.duration.trim().replace(',', '.');
    const minutes = Number(raw);
    if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(minutes) || minutes <= 0) result.durationError = 'Nhập số phút vận động lớn hơn 0.';
    else if (start && Date.parse(start) + minutes * 60000 > limit) result.durationError = 'Thời gian kết thúc vận động không được ở tương lai.';
    if (!result.startError && !result.durationError && start) return {
      minutes, day: dayKey(draft.start.date)!, input: { timeZone: zone, activityType: draft.activity, startedAt: start, durationMinutes: minutes },
    };
  } else {
    const end = instant(draft.end, zone, entry && 'sleepEnd' in entry ? entry.sleepEnd : undefined);
    if (!end) result.endError = 'Nhập ngày và giờ thức dậy hợp lệ (DD/MM/YYYY, HH:mm).';
    else if (start && Date.parse(end) <= Date.parse(start)) result.endError = 'Giờ thức dậy phải sau giờ bắt đầu. Nếu ngủ qua đêm, hãy chọn ngày hôm sau.';
    else if (Date.parse(end) > limit) result.endError = 'Giờ thức dậy không được ở tương lai.';
    if (!result.startError && !result.endError && start && end) return {
      minutes: (Date.parse(end) - Date.parse(start)) / 60000, day: dayKey(draft.end.date)!, input: { timeZone: zone, sleepStart: start, sleepEnd: end },
    };
  }
  return result;
}
