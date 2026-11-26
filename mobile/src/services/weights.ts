import type { User } from 'firebase/auth';
import { apiRequest } from '@/services/session';
import type { WeightMeasurement } from '@/services/profile';

export type WeightEntry = WeightMeasurement & {
  localDate: string;
  createdAt: string | null;
  updatedAt: string | null;
  version: number;
};

export type WeightHistoryPage = {
  items: WeightEntry[];
  nextCursor: string | null;
};

export type WeightUnit = 'kg' | 'lb';

export function weightValueInUnit(weightKg: number, unit: WeightUnit) {
  return unit === 'lb' ? weightKg * 2.2046226218 : weightKg;
}

export function weightToKg(value: number, unit: WeightUnit) {
  return unit === 'lb' ? value / 2.2046226218 : value;
}

export function formatWeight(weightKg: number, unit: WeightUnit) {
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
    .format(weightValueInUnit(weightKg, unit))} ${unit}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readWeight(value: unknown): WeightEntry {
  if (!isRecord(value) || typeof value.entryId !== 'string'
      || typeof value.weightKg !== 'number' || !Number.isFinite(value.weightKg)
      || typeof value.measuredAt !== 'string' || typeof value.timeZone !== 'string'
      || typeof value.localDate !== 'string' || !Number.isInteger(value.version)
      || (value.createdAt !== null && typeof value.createdAt !== 'string')
      || (value.updatedAt !== null && typeof value.updatedAt !== 'string')) {
    throw new Error('Invalid weight response');
  }
  return {
    entryId: value.entryId,
    weightKg: value.weightKg,
    measuredAt: value.measuredAt,
    timeZone: value.timeZone,
    localDate: value.localDate,
    createdAt: value.createdAt as string | null,
    updatedAt: value.updatedAt as string | null,
    version: value.version as number,
    warningConfirmed: value.warningConfirmed === true,
  };
}

export async function getWeightHistory(
  user: User,
  options: { cursor?: string; date?: string; limit?: number } = {},
): Promise<WeightHistoryPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 30) });
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.date) query.set('date', options.date);
  const result = await apiRequest(user, `/me/weights?${query.toString()}`, 'GET');
  if (!isRecord(result) || !Array.isArray(result.items)
      || (result.nextCursor !== null && typeof result.nextCursor !== 'string')) {
    throw new Error('Invalid weight history response');
  }
  return {
    items: result.items.map(readWeight),
    nextCursor: result.nextCursor as string | null,
  };
}

export async function getWeight(user: User, entryId: string) {
  return readWeight(await apiRequest(user, `/me/weights/${encodeURIComponent(entryId)}`, 'GET'));
}

export async function createWeight(user: User, input: WeightMeasurement) {
  return readWeight(await apiRequest(user, '/me/weights', 'POST', input));
}

export async function updateWeight(
  user: User,
  entryId: string,
  input: Partial<Omit<WeightMeasurement, 'entryId'>> & { version: number },
) {
  return readWeight(await apiRequest(user, `/me/weights/${encodeURIComponent(entryId)}`, 'PATCH', input));
}

export async function deleteWeight(user: User, entryId: string, version: number) {
  return apiRequest(
    user,
    `/me/weights/${encodeURIComponent(entryId)}?version=${encodeURIComponent(String(version))}`,
    'DELETE',
  );
}
