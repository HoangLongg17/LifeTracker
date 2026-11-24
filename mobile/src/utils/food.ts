import type { Food, FoodUnit, Nutrient, PortionInput, MealType, MealJournalEntry, MealJournalItem } from '../../../shared/food';
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
const portionDecimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1, useGrouping: false });
export function portionText(value: number | null, unit: string) {
  return value === null ? 'Chưa có dữ liệu' : portionDecimal.format(value) + ' ' + unit;
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
export function readPortion(input: string, unit: FoodUnit, food: Food): PortionInput | null {
  const text = input.trim();
  if (!permittedUnits(food).includes(unit) || !/^\d+(?:[.,]\d+)?$/.test(text)) return null;
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit === 'g') return { consumedGrams: value };
  if (unit === 'mL') return { consumedMl: value };
  return { quantity: value };
}

export const mealLabels: Record<MealType, string> = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' };
export function savedNutrientText(meal: MealJournalEntry, key: Nutrient, unit: string) {
  const text = portionText(meal.totals[key], unit);
  return meal.nutrientCompleteness[key] === 'partial' ? text + ' (phần đã biết)' : text;
}

export function savedAmountText(item: MealJournalItem) {
  if (item.amount === null || item.unit === null) return 'Chưa rõ lượng';
  const entered = numberText(item.amount) + ' ' + (item.unit === 'serving' ? 'phần' : item.unit);
  return item.converted ? entered + ' (' + numberText(item.converted.amount) + ' ' + item.converted.unit + ')' : entered;
}
