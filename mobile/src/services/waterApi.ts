
import type { User } from 'firebase/auth';

import { apiRequest } from '@/services/session';

export type WaterUnit = 'mL' | 'L';

export type WaterRecordStatus =
  | 'missing'
  | 'partial'
  | 'confirmed';

export interface WaterEntry {
  entryId: string;
  volumeMl: number;
  loggedAt: string;
  localDate: string;
  timeZone: string;
  note: string | null;
  version: number;
}

export interface WaterDayResponse {
  dateKey: string;
  totalWaterMl: number | null;
  recordStatus: WaterRecordStatus;
  items: WaterEntry[];
}

export interface CreateWaterInput {
  entryId: string;
  amount: number;
  unit: WaterUnit;
  loggedAt: string;
  timeZone: string;
  note?: string;
}

export interface UpdateWaterInput {
  version: number;
  amount?: number;
  unit?: WaterUnit;
  loggedAt?: string;
  timeZone?: string;
  note?: string;
}

// Lấy các lần uống nước và tổng theo ngày.
export async function getWaterDay(
  dateKey: string,
  user: User
): Promise<WaterDayResponse> {
  const result = await apiRequest(
    user,
    `/me/logs/water?date=${encodeURIComponent(dateKey)}`,
    'GET'
  );

  if (
    !result ||
    typeof result !== 'object' ||
    !('items' in result) ||
    !Array.isArray(result.items) ||
    !('dateKey' in result) ||
    result.dateKey !== dateKey
  ) {
    throw new Error('INVALID_WATER_RESPONSE');
  }

  return result as WaterDayResponse;
}

// Thêm một lần uống nước.
export function createWaterEntry(
  user: User,
  input: CreateWaterInput
) {
  return apiRequest(
    user,
    '/me/logs/water',
    'POST',
    input
  );
}

// Sửa một lần uống nước.
export function updateWaterEntry(
  user: User,
  entryId: string,
  input: UpdateWaterInput
) {
  return apiRequest(
    user,
    `/me/logs/water/${encodeURIComponent(entryId)}`,
    'PATCH',
    input
  );
}

// Xóa một lần uống nước.
export function deleteWaterEntry(
  user: User,
  entryId: string,
  version: number
) {
  return apiRequest(
    user,
    `/me/logs/water/${encodeURIComponent(entryId)}`,
    'DELETE',
    { version }
  );
}
