import { createHash } from 'node:crypto';
import BigNumber from 'bignumber.js';
import type { Food, Nutrient, NutrientValues, NutritionPreview, PortionItem } from '../../../shared/food';
import { nutrients, validFoodId } from './foodCatalog';
import { isRecord } from './logCommon';

// Use source decimals until the JSON boundary. 350 places also cover subnormal JSON numbers.
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 350 });
const physicalMax = 99_999.9;
const servingMax = 999.9;
const portionWarning = 5_000;
const amountKeys = ['consumedGrams', 'consumedMl', 'quantity'] as const;
const messages = {
  INVALID_PORTION: 'Mỗi món cần một lượng hữu hạn lớn hơn 0 và một đơn vị duy nhất.',
  PORTION_PRECISION: 'Chỉ nhập tối đa một chữ số thập phân.',
  GRAM_LIMIT: 'Khối lượng phải từ 0,1 đến 99.999,9 g.',
  ML_LIMIT: 'Thể tích phải từ 0,1 đến 99.999,9 mL.',
  SERVING_LIMIT: 'Số phần phải từ 0,1 đến 999,9 phần.',
  CONVERTED_MASS_LIMIT: 'Khối lượng sau quy đổi của bữa ăn không được vượt 99.999,9 g.',
  INVALID_ITEMS: 'Gửi từ 1 đến 50 món trong trường items.',
  INVALID_FOOD_ID: 'Mã thực phẩm không hợp lệ.',
  FOOD_NOT_FOUND: 'Thực phẩm hiện không có trong danh mục.',
  MISSING_DENSITY: 'Nguồn chưa có khối lượng riêng để đổi giữa g và mL.',
  MISSING_SERVING_SIZE: 'Nguồn chưa có định lượng cho một phần.',
  PORTION_OUT_OF_RANGE: 'Khẩu phần vượt phạm vi số có thể tính.',
} as const;

export class PortionError extends Error {
  constructor(readonly code: keyof typeof messages, readonly field: string) {
    super(messages[code]);
  }
}

function checkAmount(amount: unknown, key: typeof amountKeys[number], field: string): asserts amount is number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw new PortionError('INVALID_PORTION', field);
  if (amount < 0.1 || amount > (key === 'quantity' ? servingMax : physicalMax)) {
    const code = key === 'quantity' ? 'SERVING_LIMIT' : key === 'consumedMl' ? 'ML_LIMIT' : 'GRAM_LIMIT';
    throw new PortionError(code, field);
  }
  if (new Decimal(amount).decimalPlaces()! > 1) throw new PortionError('PORTION_PRECISION', field);
}

export function readPortionItems(body: unknown): PortionItem[] {
  if (!isRecord(body) || Object.keys(body).length !== 1 || !Array.isArray(body.items)
      || body.items.length < 1 || body.items.length > 50) {
    throw new PortionError('INVALID_ITEMS', 'items');
  }
  return body.items.map((row: unknown, index: number): PortionItem => {
    const field = 'items[' + index + ']';
    if (!isRecord(row) || !validFoodId(row.foodId)) throw new PortionError('INVALID_FOOD_ID', field + '.foodId');
    const key = amountKeys.find(name => Object.hasOwn(row, name));
    if (!key || Object.keys(row).length !== 2) throw new PortionError('INVALID_PORTION', field);
    const amount = row[key];
    checkAmount(amount, key, field + '.' + key);
    if (key === 'consumedGrams') return { foodId: row.foodId, consumedGrams: amount };
    if (key === 'consumedMl') return { foodId: row.foodId, consumedMl: amount };
    return { foodId: row.foodId, quantity: amount };
  });
}

function jsonNumber(decimal: BigNumber, field: string) {
  const value = decimal.toNumber();
  if (!Number.isFinite(value) || (value === 0 && !decimal.isZero())) throw new PortionError('PORTION_OUT_OF_RANGE', field);
  return value;
}

function normalizedPortion(food: Food, input: PortionItem, field: string) {
  const unit = food.referenceUnit === 'serving' ? food.servingUnit : food.referenceUnit;
  const key = input.quantity !== undefined ? 'quantity' : input.consumedMl !== undefined ? 'consumedMl' : 'consumedGrams';
  const entered = input[key];
  checkAmount(entered, key, field + '.' + key);
  let enteredUnit: 'g' | 'mL' = key === 'consumedMl' ? 'mL' : 'g';
  let physical = new Decimal(entered);
  if (key === 'quantity') {
    if (food.servingSize === null || food.servingUnit === null) throw new PortionError('MISSING_SERVING_SIZE', field);
    enteredUnit = food.servingUnit;
    physical = physical.times(food.servingSize);
  }
  // Measure from the entered unit once. A round trip through density can change a boundary comparison.
  const density = food.densityGramsPerMl;
  const grams = enteredUnit === 'g' ? physical : density === null ? null : physical.times(density);
  const ml = enteredUnit === 'mL' ? physical : density === null ? null : physical.div(density);
  if (unit === null) throw new PortionError('MISSING_SERVING_SIZE', field);
  const amount = unit === 'g' ? grams : ml;
  if (amount === null) throw new PortionError('MISSING_DENSITY', field);
  // On a serving basis the reference amount counts servings, while amount records physical g or mL.
  const inReferenceUnits = food.referenceUnit === 'serving'
    ? (input.quantity === undefined ? amount.div(food.servingSize!) : new Decimal(input.quantity)) : amount;
  const factor = inReferenceUnits.div(food.referenceAmount);
  if (!factor.isPositive() || factor.isZero() || amount.isZero()) throw new PortionError('PORTION_OUT_OF_RANGE', field);
  return { amount, unit, factor, grams, ml };
}

// Bind the preview to the exact source used for each input, including its portion and density.
export function mealPreviewTag(inputs: PortionItem[], catalog: ReadonlyMap<string, Food>, historical: readonly (Food | undefined)[] = []) {
  return createHash('sha256').update(JSON.stringify(inputs.map((input, i) => [input, historical[i] ?? catalog.get(input.foodId)]))).digest('hex');
}

export function calculatePortions(inputs: PortionItem[], catalog: ReadonlyMap<string, Food>, historical: readonly (Food | undefined)[] = []): NutritionPreview {
  let knownMass = new Decimal(0);
  let knownVolume = new Decimal(0);
  const sums = new Map<Nutrient, { amount: BigNumber; known: number }>();
  const items = inputs.map((input, index): NutritionPreview['items'][number] => {
    const field = 'items[' + index + ']';
    const food = historical[index] ?? catalog.get(input.foodId);
    if (!food) throw new PortionError('FOOD_NOT_FOUND', field + '.foodId');
    const { amount, unit, factor, grams, ml } = normalizedPortion(food, input, field);
    if (grams) {
      knownMass = knownMass.plus(grams);
      if (knownMass.gt(physicalMax)) throw new PortionError('CONVERTED_MASS_LIMIT', grams.gt(physicalMax) ? field : 'items');
    }
    if (ml) knownVolume = knownVolume.plus(ml);
    const values = {} as NutrientValues;
    for (const key of nutrients) {
      const value = food[key];
      if (value === null) { values[key] = null; continue; }
      const scaled = factor.times(value);
      values[key] = jsonNumber(scaled, field);
      const previous = sums.get(key);
      sums.set(key, { amount: scaled.plus(previous?.amount ?? 0), known: (previous?.known ?? 0) + 1 });
    }
    return { foodId: food.foodId, foodName: food.foodName, foodSource: food.foodSource, foodVersion: food.version,
      amount: jsonNumber(amount, field), unit, calculationMethod: 'source_scaled', formulaVersion: 1, ...values };
  });

  const totals = {} as NutrientValues;
  const nutrientCompleteness = {} as NutritionPreview['nutrientCompleteness'];
  for (const key of nutrients) {
    const sum = sums.get(key);
    totals[key] = sum ? jsonNumber(sum.amount, 'items') : null;
    nutrientCompleteness[key] = !sum ? 'unknown' : sum.known === items.length ? 'complete' : 'partial';
  }
  const warnings: NutritionPreview['warnings'] = [];
  if (knownMass.gt(portionWarning)) warnings.push('HIGH_PORTION_MASS');
  if (knownVolume.gt(portionWarning)) warnings.push('HIGH_PORTION_VOLUME');
  if (sums.get('energyKcal')?.amount.gt(3500)) warnings.push('HIGH_MEAL_ENERGY');
  return { items, totals, nutrientCompleteness, warnings };
}
