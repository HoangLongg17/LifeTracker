import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { readPortion, permittedUnits, basisText, nutrientText } from '../src/utils/food.ts';

const data = JSON.parse(readFileSync(new URL('../../backend/data/foodCatalog.json', import.meta.url), 'utf8'));
const pick = id => data.find(row => row.foodId === id);
test('input accepts Vietnamese decimals and binds only one physical or serving field', () => {
  const rice = pick('usda-sr-169757');
  assert.deepEqual(readPortion('150,5', 'g', rice), { consumedGrams: 150.5 });
  assert.deepEqual(readPortion('2', 'serving', rice), { quantity: 2 });
  for (const text of ['', '0', '0,0', '-1', 'abc', '2.', '1e3', '1.000,3', 'Infinity']) assert.equal(readPortion(text, 'g', rice), null);
});
test('allow mL for direct volume basis or known density; no extrapolation across foods', () => {
  const flavored = pick('usda-sr-171926');
  assert.deepEqual(readPortion('100', 'mL', flavored), { consumedMl: 100 });
  assert.equal(readPortion('100', 'mL', pick('usda-sr-169757')), null);
  const byVolume = { ...flavored, referenceUnit: 'mL', referenceBasis: '100mL', densityGramsPerMl: null };
  assert.deepEqual(permittedUnits(byVolume), ['mL']);
  assert.deepEqual(permittedUnits({ ...byVolume, servingUnit: 'g', servingSize: 100 }), ['mL']);
  assert.deepEqual(permittedUnits({ ...byVolume, servingUnit: 'mL', servingSize: 100 }), ['mL','serving']);
});
test('reference serving and nutrients keep the original base, including unknown and zero', () => {
  const banana = pick('fda-fruit-banana');
  assert.equal(basisText(banana), '1 phần (126 g mỗi phần)');
  assert.equal(nutrientText(null, 'g'), 'Chưa có dữ liệu');
  assert.equal(nutrientText(0, 'g'), '0 g');
  assert.equal(readPortion('1', 'serving', pick('usda-sr-168193')), null);
});

test('preview formatting uses Vietnamese decimals with one digit and keeps actual zero and unknown distinct', async () => {
  const { portionText } = await import('../src/utils/food.ts');
  assert.equal(portionText(195, 'kcal'), '195 kcal');
  assert.equal(portionText(410.8, 'kcal'), '410,8 kcal');
  assert.equal(portionText(4.035, 'g'), '4 g');
  assert.equal(portionText(0.129, 'g'), '0,1 g');
  assert.equal(portionText(0, 'mg'), '0 mg');
  assert.equal(portionText(null, 'g'), 'Chưa có dữ liệu');
});

test('journal keeps entered portions and the equivalent weight, partial totals, zero and unknown', async () => {
  const { savedAmountText, savedNutrientText } = await import('../src/utils/food.ts');
  assert.equal(savedAmountText({ amount: 2, unit: 'serving', converted: { amount: 64, unit: 'g' } }), '2 phần (64 g)');
  assert.equal(savedAmountText({ amount: 159, unit: 'g' }), '159 g');
  assert.equal(savedAmountText({ amount: null, unit: null }), 'Chưa rõ lượng');
  const meal = { totals: { fiberGrams: 0, sodiumMg: null }, nutrientCompleteness: { fiberGrams: 'partial', sodiumMg: 'unknown' } };
  assert.equal(savedNutrientText(meal, 'fiberGrams', 'g'), '0 g (phần đã biết)');
  assert.equal(savedNutrientText(meal, 'sodiumMg', 'mg'), 'Chưa có dữ liệu');
});
