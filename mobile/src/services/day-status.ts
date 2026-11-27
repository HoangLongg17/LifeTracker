import type { User } from 'firebase/auth';
import { apiRequest } from './session';

export type RecordCategory = 'water' | 'meal' | 'activity' | 'sleep';
export type RecordStatusValue = 'missing' | 'partial' | 'confirmed';
export type HistoryKind = RecordCategory | 'weight';

export type CategoryRecordState = {
  category: RecordCategory;
  status: RecordStatusValue;
  confirmed: boolean;
  total: number | null;
  count: number;
};

export type DayRecordStatusResponse = {
  dateKey: string;
  timeZone: string;
  canConfirm: boolean;
  recomputeStatus: 'fresh';
  categories: Record<RecordCategory, CategoryRecordState>;
};

export type HistoryEntryItem = {
  entryId: string;
  kind: HistoryKind;
  localDate: string;
  occurredAt: string;
  timeZone: string;
  version: number;
  summary: Record<string, unknown>;
};

export type LogHistoryResponse = {
  items: HistoryEntryItem[];
  nextCursor: string | null;
  dayStatuses: Record<string, DayRecordStatusResponse>;
};

export function getDayRecordStatus(
  user: User,
  dateKey: string
): Promise<DayRecordStatusResponse> {
  return apiRequest(
    user,
    `/me/days/${encodeURIComponent(dateKey)}/record-status`,
    'GET'
  ) as Promise<DayRecordStatusResponse>;
}

export function updateCategoryRecordStatus(
  user: User,
  dateKey: string,
  category: RecordCategory,
  confirmed: boolean
): Promise<DayRecordStatusResponse> {
  return apiRequest(
    user,
    `/me/days/${encodeURIComponent(dateKey)}/record-status`,
    'PUT',
    { category, confirmed }
  ) as Promise<DayRecordStatusResponse>;
}

export function getLogHistory(
  user: User,
  params: {
    type?: HistoryKind | 'all';
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string | null;
  } = {}
): Promise<LogHistoryResponse> {
  const query = new URLSearchParams();
  if (params.type && params.type !== 'all') query.set('type', params.type);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);

  const suffix = query.toString();
  return apiRequest(
    user,
    `/me/logs/history${suffix ? `?${suffix}` : ''}`,
    'GET'
  ) as Promise<LogHistoryResponse>;
}