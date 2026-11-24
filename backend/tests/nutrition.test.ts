import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Food, PortionInput, PortionItem } from '../../shared/food';
import { publishedFood } from '../src/services/foodCatalog';
import { calculatePortions, PortionError, readPortionItems } from '../src/services/nutrition';

// Synthetic reference values from SRS §7.4; production records have their own source values.
function reference(id: string, changes: Record<string, unknown> = {}): Food {
  const food = publishedFood(id, {
    foodId: id, foodName: id, foodSource: 'SRS fixture', sourceVersion: '1.2',
    status: 'active', version: 1, referenceBasis: '100g', referenceUnit: 'g', referenceAmount: 100,
    energyKcal: 260, proteinGrams: 8, carbsGrams: 45, fatGrams: 6, ...changes,
  });
  assert.ok(food);
  return food;
}
function single(food: Food, input: PortionInput) {
  return calculatePortions([{ foodId: food.foodId, ...input }], new Map([[food.foodId, food]]));
}
function approx(actual: number | null, expected: number) {
  assert.ok(actual !== null && Math.abs(actual - expected) <= 1e-6, String(actual) + ' vs ' + expected);
}
function fails(code: PortionError['code'], fn: () => unknown) {
  assert.throws(fn, (e: unknown) => e instanceof PortionError && e.code === code);
}
const solid = reference('solid');
const liquid = reference('liquid', { referenceBasis: '100mL', referenceUnit: 'mL', energyKcal: 60 });

test('150 g at 260 kcal/100 g gives 390 kcal from the source even when Atwater would give 399', () => {
  const preview = single(solid, { consumedGrams: 150 });
  assert.deepEqual(preview.totals, { energyKcal: 390, proteinGrams: 12, carbsGrams: 67.5, fatGrams: 9, fiberGrams: null, sodiumMg: null });
  assert.equal(preview.items[0].calculationMethod, 'source_scaled');
  assert.equal(preview.items[0].formulaVersion, 1);
  assert.equal(preview.items[0].amount, 150);
  assert.equal(preview.items[0].unit, 'g');
  assert.deepEqual(preview.warnings, []);
});
test('decimal inputs keep the right side of the display rounding boundary', () => {
  const rice = reference('rice', { energyKcal: 130 });
  assert.equal(single(rice, { consumedGrams: 150.5 }).totals.energyKcal, 195.65);
  const fractional = reference('fractional', { proteinGrams: 0.7 });
  assert.equal(single(fractional, { consumedGrams: 150 }).totals.proteinGrams, 1.05);
});
test('2 servings at 150 g each and 200 kcal/100 g is 300 g and 600 kcal, counted once', () => {
  const food = reference('served', { energyKcal: 200, servingSize: 150, servingUnit: 'g' });
  const preview = single(food, { quantity: 2 });
  assert.equal(preview.items[0].amount, 300);
  assert.deepEqual(preview.totals, single(food, { consumedGrams: 300 }).totals);
  assert.equal(preview.totals.energyKcal, 600);
  approx(single(food, { quantity: 0.25 }).totals.energyKcal, 75);
});
test('250 mL at 60 kcal/100 mL gives 150 kcal; directly measured volume needs no density', () => {
  const preview = single(liquid, { consumedMl: 250 });
  assert.equal(preview.items[0].unit, 'mL');
  assert.equal(preview.totals.energyKcal, 150);
});
test('density is applied in the right direction, including when a serving uses a different unit', () => {
  const thick = reference('thick', { densityGramsPerMl: 1.25, servingSize: 80, servingUnit: 'mL', energyKcal: 200 });
  assert.equal(single(thick, { consumedMl: 80 }).totals.energyKcal, 200);
  assert.equal(single(thick, { quantity: 2 }).totals.energyKcal, 400);
  const drink = { ...liquid, densityGramsPerMl: 1.25, servingSize: 125, servingUnit: 'g' as const };
  assert.equal(single(drink, { consumedGrams: 125 }).totals.energyKcal, 60);
  assert.equal(single(drink, { quantity: 2 }).totals.energyKcal, 120);
});
test('missing density blocks cross-unit arithmetic and missing serving definitions block quantity', () => {
  fails('MISSING_DENSITY', () => single(solid, { consumedMl: 100 }));
  fails('MISSING_DENSITY', () => single(liquid, { consumedGrams: 100 }));
  fails('MISSING_SERVING_SIZE', () => single(solid, { quantity: 1 }));
  fails('MISSING_DENSITY', () => single({ ...solid, servingSize: 25, servingUnit: 'mL' }, { quantity: 2 }));
});
test('source quoted for TWO servings supports grams, mL with density and fractional servings', () => {
  const pair = reference('pair', { referenceBasis: 'serving', referenceAmount: 2, referenceUnit: 'serving',
    servingSize: 150, servingUnit: 'g', densityGramsPerMl: 1.2, energyKcal: 300 });
  for (const input of [{ quantity: 0.5 }, { consumedGrams: 75 }, { consumedMl: 62.5 }]) {
    const preview = single(pair, input);
    approx(preview.items[0].amount, 75);
    approx(preview.totals.energyKcal, 75);
  }
  const byCup = { ...pair, servingUnit: 'mL' as const };
  approx(single(byCup, { consumedGrams: 180 }).totals.energyKcal, 150);
});
test('each nutrient has separate unknown/partial/complete; zero is both known and summable', () => {
  const less = reference('less', { energyKcal: null, proteinGrams: null, carbsGrams: 0, fatGrams: 0, sodiumMg: null });
  const more = reference('more', { energyKcal: 10, proteinGrams: 0, carbsGrams: 3, fatGrams: null, sodiumMg: 0 });
  const inputs = [less, more].map(f => ({ foodId: f.foodId, consumedGrams: 100 }));
  const preview = calculatePortions(inputs, new Map([[less.foodId, less], [more.foodId, more]]));
  assert.deepEqual(preview.nutrientCompleteness, { energyKcal: 'partial', proteinGrams: 'partial', carbsGrams: 'complete',
    fatGrams: 'partial', fiberGrams: 'unknown', sodiumMg: 'partial' });
  assert.deepEqual(preview.totals, { energyKcal: 10, proteinGrams: 0, carbsGrams: 3, fatGrams: 0, fiberGrams: null, sodiumMg: 0 });
  assert.equal(single(less, { consumedGrams: 100 }).totals.energyKcal, null);
  assert.equal(single(less, { consumedGrams: 100 }).nutrientCompleteness.energyKcal, 'unknown');
});
test('repeated IDs preserve order; aggregate retains precision before rounding for display', () => {
  const food = reference('a', { proteinGrams: 0.044 });
  const other = reference('b', { proteinGrams: 0.041 });
  const inputs = [food, other, food].map(f => ({ foodId: f.foodId, consumedGrams: 100 }));
  const result = calculatePortions(inputs, new Map([['a', food], ['b', other]]));
  assert.deepEqual(result.items.map(i => i.foodId), ['a', 'b', 'a']);
  approx(result.totals.proteinGrams, 0.129);
});
test('rejects missing, malformed, ambiguous or spoofed inputs before reading catalog values', () => {
  const item = { foodId: 'a', consumedGrams: 100 };
  for (const body of [null, [], {}, { items: [] }, { items: Array(51).fill(item) }, { items: [item], uid: 'x' }]) {
    fails('INVALID_ITEMS', () => readPortionItems(body));
  }
  for (const bad of [null, 'x', [], ...['', '  ', 'a/b', '.', '..', '__id__', 'a'.repeat(1501)].map(foodId => ({ foodId, quantity: 2 }))]) {
    fails('INVALID_FOOD_ID', () => readPortionItems({ items: [bad] }));
  }
  for (const bad of [{ foodId: 'a' }, { ...item, consumedMl: null }, { ...item, quantity: 3 },
    { ...item, energyKcal: 0 }, { foodId: 'a', source: 'client' },
    ...[null, false, '25', 0, -1.1, NaN, Infinity].map(quantity => ({ foodId: 'a', quantity }))]) {
    fails('INVALID_PORTION', () => readPortionItems({ items: [bad] }));
  }
  const valid = { foodId: 'a', consumedMl: 5.25 };
  assert.deepEqual(readPortionItems({ items: [valid, item] }), [valid, item]);
  assert.equal(readPortionItems({ items: Array(50).fill(item) }).length, 50);
  fails('FOOD_NOT_FOUND', () => calculatePortions([valid], new Map()));
});
test('reports numerical overflow per portion or in totals; extreme valid meal amounts are flagged for review', () => {
  fails('PORTION_OUT_OF_RANGE', () => single(solid, { consumedGrams: Number.MAX_VALUE }));
  fails('PORTION_OUT_OF_RANGE', () => single(solid, { consumedGrams: Number.MIN_VALUE }));
  const big = reference('big', { energyKcal: Number.MAX_VALUE });
  const amounts: PortionItem[] = [{ foodId: 'big', consumedGrams: 100 }, { foodId: 'big', consumedGrams: 100 }];
  fails('PORTION_OUT_OF_RANGE', () => calculatePortions(amounts, new Map([['big', big]])));
  assert.deepEqual(single(solid, { consumedGrams: 6000 }).warnings, ['HIGH_PORTION_MASS', 'HIGH_MEAL_ENERGY']);
  assert.deepEqual(single({ ...solid, energyKcal: 70 }, { consumedGrams: 5000 }).warnings, []);
});
