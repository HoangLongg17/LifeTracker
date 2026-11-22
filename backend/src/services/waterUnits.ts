
export type WaterUnit = 'mL' | 'L';

export type WaterConversionResult =
  | { ok: true; volumeMl: number }
  | { ok: false; error: string };

export function convertWaterToMl(
  amount: unknown,
  unit: unknown
): WaterConversionResult {
  if (unit !== 'mL' && unit !== 'L') {
    return {
      ok: false,
      error: 'INVALID_WATER_UNIT',
    };
  }

  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return {
      ok: false,
      error: 'INVALID_WATER_AMOUNT',
    };
  }

  const volumeMl =
    unit === 'L' ? amount * 1000 : amount;

  if (
    !Number.isFinite(volumeMl) ||
    volumeMl <= 0
  ) {
    return {
      ok: false,
      error: 'INVALID_WATER_VOLUME',
    };
  }

  return { ok: true, volumeMl };
}
