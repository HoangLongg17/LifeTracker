import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateSeed } from '../scripts/import-foods';
import { foodPage, InvalidCatalogCursor, normalizeFood, publishedFood } from '../src/services/foodCatalog';

const rows = validateSeed(JSON.parse(readFileSync(join(__dirname, '../data/foodCatalog.json'), 'utf8')));
const foods = rows.map(row => publishedFood(row.foodId, row)!);

test('100 foods with stable IDs, source links, dates and canonical names', () => {
  assert.equal(foods.length, 100);
  assert.ok(foods.every(f => f.sourceUrl && f.retrievedAt));
  assert.equal(normalizeFood('  ĐẬU   HŨ '), 'dau hu');
  assert.throws(() => validateSeed([rows[0], rows[0]]));
});
test('search Vietnamese aliases, sources and original IDs; retain distinct variants', () => {
  const search = (term: string) => foodPage(foods, 'u', normalizeFood(term), 100).items;
  assert.ok(search('đậu phụ').some(f => f.foodId === 'usda-sr-172475'));
  assert.deepEqual(new Set(search('chuối').map(f => f.foodSource)), new Set(['USDA FoodData Central','U.S. FDA']));
  assert.equal(search('bún gạo').length, 2);
  assert.equal(search('169757')[0].foodName, 'Cơm trắng hạt dài');
  assert.equal(search('không có món xyz').length, 0);
});
test('cursor pages are disjoint, stable and bound to user, filters and revision', () => {
  const first = foodPage(foods, 'a', '', 20);
  const second = foodPage(foods, 'a', '', 20, first.nextCursor!);
  assert.equal(new Set([...first.items, ...second.items].map(f => f.foodId)).size, 40);
  assert.throws(() => foodPage(foods, 'b', '', 20, first.nextCursor!), InvalidCatalogCursor);
  assert.throws(() => foodPage(foods, 'a', 'com', 20, first.nextCursor!), InvalidCatalogCursor);
  assert.throws(() => foodPage(foods.slice(1), 'a', '', 20, first.nextCursor!), InvalidCatalogCursor);
});
test('unknown is nullable for each nutrient, source zero is complete, invalid records are hidden', () => {
  const a = rows[0];
  const f = publishedFood(a.foodId, { ...a, proteinGrams: undefined, energyKcal: 0 })!;
  assert.equal(f.proteinGrams, null);
  assert.equal(f.completeness.proteinGrams, 'unknown');
  assert.equal(f.energyKcal, 0);
  assert.equal(f.completeness.energyKcal, 'complete');
  for (const changes of [{ foodId: 'different' }, { status: 'draft' }, { status: 'inactive' }, { referenceAmount: 1 },
    { referenceUnit: 'mL' }, { foodSource: '' }, { energyKcal: -1 }, { densityGramsPerMl: 0 },
    { servingSize: 0, servingUnit: 'g' }, { sourceUrl: 'javascript:foo' }]) {
    assert.equal(publishedFood(a.foodId, { ...a, ...changes }), null);
  }
});
