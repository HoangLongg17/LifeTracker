import { BigNumber } from 'bignumber.js';
import type { Food, FoodUnit, Nutrient, PortionInput, PortionItem, NutritionPreview, MealType, MealJournalEntry, MealJournalItem } from '../../../shared/food';
export type { Food, FoodPage, FoodUnit, Nutrient, NutritionPreview, PortionInput } from '../../../shared/food';

export const nutrientLabels: readonly [Nutrient, string, string][] = [
  ['energyKcal', 'Năng lượng', 'kcal'], ['proteinGrams', 'Chất đạm', 'g'],
  ['carbsGrams', 'Carbohydrate', 'g'], ['fatGrams', 'Chất béo', 'g'],
  ['fiberGrams', 'Chất xơ', 'g'], ['sodiumMg', 'Natri', 'mg'],
];
const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 8, useGrouping: false });
export function numberText(value: number) { return decimal.format(value); }
export function nutrientText(value: number | null, unit: string) {
  return value == null ? 'Chưa có dữ liệu' : numberText(value) + ' ' + unit;
}
const physicalMax = 99_999.9;
const servingMax = 999.9;
const portionWarning = 5_000;
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 350 });
const viFormat = { decimalSeparator: ',', groupSeparator: '.', groupSize: 3 };
function journalNumber(value: BigNumber | number) {
  return new Decimal(value).toFormat(1, BigNumber.ROUND_HALF_UP, viFormat).replace(/,0$/, '');
}
export function portionText(value: number | null, unit: string) {
  return value === null || !Number.isFinite(value) ? 'Chưa có dữ liệu' : journalNumber(value) + ' ' + unit;
}
export function basisText(food: Food) {
  if (food.referenceBasis !== 'serving') return numberText(food.referenceAmount) + ' ' + food.referenceUnit;
  return numberText(food.referenceAmount) + ' phần (' + numberText(food.servingSize!) + ' ' + food.servingUnit + ' mỗi phần)';
}
export function permittedUnits(food: Food): FoodUnit[] {
  const basis = food.referenceUnit === 'serving' ? food.servingUnit : food.referenceUnit;
  const hasDensity = food.densityGramsPerMl != null && food.densityGramsPerMl > 0;
  const units: FoodUnit[] = [];
  if (basis === 'g' || hasDensity) units.push('g');
  if (basis === 'mL' || hasDensity) units.push('mL');
  if (food.servingSize != null && food.servingSize > 0 && food.servingUnit != null
      && (food.servingUnit === basis || hasDensity)) units.push('serving');
  return units;
}
const rangeMessage: Record<FoodUnit, string> = {
  g: 'Khối lượng phải từ 0,1 đến 99.999,9 g.',
  mL: 'Thể tích phải từ 0,1 đến 99.999,9 mL.',
  serving: 'Số phần phải từ 0,1 đến 999,9 phần.',
};
const massError = 'Khối lượng sau quy đổi của bữa ăn không được vượt 99.999,9 g.';
type PortionField = { text: string; unit: FoodUnit; food: Food };
type CheckedField = { error: string } | { input: PortionInput; grams: BigNumber | null; ml: BigNumber | null };

function checkField({ text, unit, food }: PortionField): CheckedField {
  const raw = text.trim();
  if (!permittedUnits(food).includes(unit)) return { error: 'Thực phẩm này chưa có hệ số quy đổi cho đơn vị đã chọn.' };
  if (!/^-?\d+(?:[.,]\d+)?$/.test(raw)) return { error: rangeMessage[unit] };
  if (/[.,]\d{2,}$/.test(raw)) return { error: 'Chỉ nhập tối đa một chữ số thập phân.' };
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0.1 || value > (unit === 'serving' ? servingMax : physicalMax)) {
    return { error: rangeMessage[unit] };
  }
  const physicalUnit = unit === 'serving' ? food.servingUnit : unit;
  const physical = unit === 'serving' ? new Decimal(value).times(food.servingSize!) : new Decimal(value);
  const density = food.densityGramsPerMl;
  const grams = physicalUnit === 'g' ? physical : density ? physical.times(density) : null;
  const ml = physicalUnit === 'mL' ? physical : density ? physical.div(density) : null;
  if (grams?.gt(physicalMax)) return { error: massError };
  const input: PortionInput = unit === 'serving' ? { quantity: value } : unit === 'g' ? { consumedGrams: value } : { consumedMl: value };
  return { input, grams, ml };
}

export function readPortion(text: string, unit: FoodUnit, food: Food): PortionInput | null {
  const field = checkField({ text, unit, food });
  return 'error' in field ? null : field.input;
}

export function checkMealPortions(rows: PortionField[]) {
  let grams = new Decimal(0);
  let ml = new Decimal(0);
  const items: PortionItem[] = [];
  const errors = rows.map(row => {
    const checked = checkField(row);
    if ('error' in checked) return checked.error;
    if (checked.grams) grams = grams.plus(checked.grams);
    if (checked.ml) ml = ml.plus(checked.ml);
    items.push({ foodId: row.food.foodId, ...checked.input });
    return '';
  });
  const mealError = grams.gt(physicalMax) ? massError : '';
  const valid = items.length > 0 && items.length === rows.length && !mealError;
  const warnings: NutritionPreview['warnings'] = [];
  if (valid && grams.gt(portionWarning)) warnings.push('HIGH_PORTION_MASS');
  if (valid && ml.gt(portionWarning)) warnings.push('HIGH_PORTION_VOLUME');
  return { items: valid ? items : null, errors, mealError, warnings };
}

export const mealLabels: Record<MealType, string> = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' };
export function savedNutrientText(meal: MealJournalEntry, key: Nutrient, unit: string) {
  const text = portionText(meal.totals[key], unit);
  return meal.nutrientCompleteness[key] === 'partial' ? text + ' (phần đã biết)' : text;
}

export function savedAmountText(item: MealJournalItem) {
  if (item.amount === null || !Number.isFinite(item.amount) || item.unit === null) return 'Chưa rõ lượng';
  const entered = journalNumber(item.amount) + ' ' + (item.unit === 'serving' ? 'phần' : item.unit);
  return item.converted && Number.isFinite(item.converted.amount) ? entered + ' (' + journalNumber(item.converted.amount) + ' ' + item.converted.unit + ')' : entered;
}

export function dailyMealEnergyText(meals: readonly MealJournalEntry[] | null): string {
  if (meals === null) return 'Chưa tải được dữ liệu';
  if (!meals.length) return 'Chưa ghi bữa ăn';
  let total = new Decimal(0);
  let known = 0;
  let partial = false;
  for (const meal of meals) {
    const kcal = meal.totals.energyKcal;
    if (kcal === null || !Number.isFinite(kcal) || kcal < 0) continue;
    total = total.plus(kcal);
    known++;
    if (meal.nutrientCompleteness.energyKcal !== 'complete') partial = true;
  }
  if (known === 0) return 'Chưa có dữ liệu';
  return journalNumber(total) + ' kcal' + (partial || known < meals.length ? ' (phần đã biết)' : '');
}

// Give Android and the web line-break opportunities inside long historical numbers.
// Keep the original label for screen readers.
export function wrapJournalNumbers(text: string) {
  return text.replace(/\d{1,3}(?:\.\d{3}){4,}/g, n => n.replaceAll('.', '.\u200b'));
}
