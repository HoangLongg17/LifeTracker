import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { readPortion, permittedUnits, basisText, nutrientText, checkMealPortions, dailyMealEnergyText, savedAmountText, wrapJournalNumbers } from '../src/utils/food.ts';

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

test('mobile blocks invalid raw input in g, mL and servings without rounding or truncating', () => {
  const solid = pick('usda-sr-169975');
  const volume = { ...solid, referenceBasis:'100mL', referenceUnit:'mL', densityGramsPerMl:null };
  const served = { ...solid, servingSize:0.75, servingUnit:'g' };
  for (const [unit,food,upper,over] of [['g',solid,'99999,9','100000'],['mL',volume,'99999.9','100000'],['serving',served,'999,9','1000']]) {
    for (const text of ['0,1','0.1',upper]) {
      const result = checkMealPortions([{ text, unit, food }]);
      assert.equal(result.items.length,1); assert.equal(result.errors[0],'');
    }
    for (const text of [over,'-1','0','0,09','3.14','1,00','10000000000000000000', '1e8']) {
      const result = checkMealPortions([{text,unit,food}]);
      assert.equal(result.items,null,text); assert.ok(result.errors[0]); assert.deepEqual(result.warnings,[]);
    }
  }
});
test('mobile checks exact converted weight and separates volume warnings from hard limits', () => {
  const base=pick('usda-sr-169975');
  const food={ ...base, densityGramsPerMl:3, servingSize:37.5, servingUnit:'mL' };
  const run=(text,unit)=>checkMealPortions([{food,text,unit}]);
  assert.ok(run('33333,3','mL').items); assert.equal(run('33333,4','mL').items,null);
  assert.equal(run('900','serving').items,null);
  assert.equal(run('5000','g').warnings.length,0);
  assert.deepEqual(run('5000,1','g').warnings,['HIGH_PORTION_MASS']);
  const row={food:{...base,referenceUnit:'mL',referenceBasis:'100mL',densityGramsPerMl:null},unit:'mL',text:'5000,1'};
  assert.deepEqual(checkMealPortions([row]).warnings,['HIGH_PORTION_VOLUME']);
  assert.deepEqual(checkMealPortions([{...row,text:'5000'}]).warnings,[]);
  const pair=[{food:base,text:'99997,8',unit:'g'},{food,text:'0,7',unit:'mL'}];
  assert.ok(checkMealPortions(pair).items);
  const large=checkMealPortions([...pair,{food:base,text:'0,1',unit:'g'}]); assert.equal(large.items,null); assert.match(large.mealError,/99\.999,9 g/);
});
test('journal localizes long amounts and sums a full day before rounding, preserving unknown and zero', () => {
  const meal=(kcal,state='complete')=>({totals:{energyKcal:kcal},nutrientCompleteness:{energyKcal:state}});
  assert.equal(savedAmountText({amount:12500.5,unit:'g'}),'12.500,5 g');
  assert.equal(savedAmountText({amount:1.235,unit:'serving',converted:{amount:12500.55,unit:'g'}}),'1,2 phần (12.500,6 g)');
  assert.equal(dailyMealEnergyText([meal(39.75),meal(161.28)]),'201 kcal');
  assert.equal(dailyMealEnergyText([meal(1.15),meal(2.3)]),'3,5 kcal');
  assert.equal(dailyMealEnergyText([meal(15.25),meal(15.25)]),'30,5 kcal');
  assert.equal(dailyMealEnergyText([meal(0)]),'0 kcal'); assert.equal(dailyMealEnergyText([]),'Chưa ghi bữa ăn');
  assert.equal(dailyMealEnergyText(null),'Chưa tải được dữ liệu'); assert.equal(dailyMealEnergyText([meal(null,'unknown')]),'Chưa có dữ liệu');
  assert.equal(dailyMealEnergyText([meal(0),meal(null,'unknown')]),'0 kcal (phần đã biết)');
  assert.equal(dailyMealEnergyText([meal(12500.5,'partial')]),'12.500,5 kcal (phần đã biết)');
  const historic=dailyMealEnergyText([meal(Number.MAX_VALUE),meal(Number.MAX_VALUE)]);
  assert.doesNotMatch(historic,/Infinity|NaN|e\+/);assert.match(historic,/^359\.538\./);
  const wrapped=wrapJournalNumbers(historic);assert.ok(wrapped.includes('\u200b'));assert.equal(wrapped.replaceAll('\u200b',''),historic);
  assert.equal(wrapJournalNumbers('12.500,5 g'),'12.500,5 g');
});
