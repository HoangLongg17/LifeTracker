import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { importFoods, validateSeed } from '../scripts/import-foods';
import { foodsRouter } from '../src/routes/foods';
import { logsRouter } from '../src/routes/logs';

const local = /^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '');
test('Meal save and day journal over HTTP with Firestore', { skip: !local }, async t => {
  const projectId = 'demo-meals-' + process.pid + '-' + Date.now().toString(36);
  const app = initializeApp({ projectId }, projectId);
  const db = getFirestore(app);
  const auth = { verifyIdToken: async (token: string) =>
    ({ uid: token, email: 'test@example.invalid', firebase: { sign_in_provider: 'password' } }) as DecodedIdToken };
  const server = express().use(express.json()).use(foodsRouter(auth, db)).use(logsRouter(auth, db)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const call = (url: string, payload?: unknown, uid = 'a') => fetch(base + url, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: 'Bearer ' + uid } : {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const route = '/me/logs/meal';
  const profile = (uid: string) => db.collection('users').doc(uid);
  const log = (uid: string) => profile(uid).collection('mealLogs');
  const cabbage = { foodId: 'usda-sr-169975', consumedGrams: 159 };
  const bread = { foodId: 'usda-sr-172688', quantity: 2 };
  const date = '2024-03-02';
  const dish = { entryId: 'cabbage', loggedAt: '2024-03-01T17:15:00Z', timeZone: 'Asia/Ho_Chi_Minh', mealType: 'snack', items: [cabbage] };
  const getDay = (uid = 'a') => call(route + '?date=' + date, undefined, uid);
  try {
    const rows = validateSeed(JSON.parse(readFileSync(join(__dirname, '../data/foodCatalog.json'), 'utf8')));
    await importFoods(db, rows);
    for (const uid of ['a','b','blocked','no-profile']) {
      await profile(uid).set({ status: uid === 'blocked' ? 'disabled' : 'active', dataRevision: 0 });
      if (uid !== 'no-profile') await profile(uid).collection('profiles').doc('main').set({ timeZone: dish.timeZone });
    }
    await t.test('token, active account and initialized profile are required for reads and writes', async () => {
      for (const [uid, status] of [['',401], ['blocked',403], ['absent',404], ['no-profile',404]] as const) {
        assert.equal((await call(route, dish, uid)).status, status);
        assert.equal((await getDay(uid)).status, status);
      }
      assert.equal((await log('blocked').get()).size, 0);
    });
    await t.test('rejects invalid events, ambiguous portions, client totals and unrelated user IDs', async () => {
      const cases = [{ entryId: '../x' }, { loggedAt: '2024-02-31T00:00:00Z' }, { loggedAt: '2024-03-02' },
        { loggedAt: new Date(Date.now() + 600000).toISOString() }, { timeZone: 'Mars' }, { mealType: 'unknown' },
        { uid: 'b' }, { userId: 'b' }, { totals: { energyKcal: 0 } }, { previewTag: false }, { warningConfirmed: 'yes' },
        { items: [{ ...cabbage, quantity: 2 }] }, { items: [{ foodId: cabbage.foodId, consumedMl: 120 }] },
        { items: [{ ...cabbage, referenceSnapshot: {} }] }, { items: [] }];
      for (const change of cases) assert.equal((await call(route, { ...dish, ...change })).status, 400, JSON.stringify(change));
      assert.equal((await log('a').get()).size, 0);
      assert.equal((await profile('a').get()).get('dataRevision'), 0);
    });
    await t.test('concurrent saves create one 159 g cabbage record, one summary revision, and the correct local date', async () => {
      const preview = await (await call('/nutrition/calculate', { items: [cabbage] })).json();
      const payload = { ...dish, previewTag: preview.meta.previewTag };
      const responses = await Promise.all([call(route, payload), call(route, payload)]);
      const codes = responses.map(r => r.status).sort();
      assert.deepEqual(codes, [200,201]);
      for (const r of responses) assert.equal((await r.json()).localDate, date);
      const stored = await log('a').doc('cabbage').get();
      assert.equal(stored.get('userId'), 'a'); assert.equal(stored.get('source'), 'manual');
      assert.equal(stored.get('version'), 1); assert.equal(stored.get('localDate'), date);
      assert.equal(stored.get('loggedAt').toDate().toISOString(), '2024-03-01T17:15:00.000Z');
      const item = stored.get('items')[0];
      assert.equal(item.foodName, 'Bắp cải'); assert.equal(item.calculationMethod, 'source_scaled');
      assert.equal(item.referenceSnapshot.nutrients.energyKcal, 25); assert.equal(item.referenceSnapshot.referenceUnit, 'g');
      assert.equal(item.referenceSnapshot.sourceFoodId, '169975'); assert.ok(item.referenceSnapshot.retrievedAt instanceof Timestamp);
      assert.deepEqual(item.portionInput, { consumedGrams: 159 }); assert.equal(item.consumedGrams, 159);
      assert.equal(stored.get('totals.energyKcal'), 39.75); assert.equal(stored.get('totals.sodiumMg'), 28.62);
      assert.equal((await profile('a').get()).get('dataRevision'), 1);
      const summary = await profile('a').collection('dailySummaries').doc(date).get();
      assert.equal(summary.get('sourceRevision'), 1); assert.equal(summary.get('recomputeStatus'), 'stale');
      assert.equal((await (await getDay()).json()).items[0].totals.energyKcal, 39.75);
      assert.equal((await (await getDay('b')).json()).items.length, 0);
      assert.equal((await (await call(route + '?date=2024-03-01')).json()).items.length, 0);
    });
    await t.test('preview change is reported before commit; accepted retries ignore later source updates and keep snapshot', async () => {
      const doc = db.collection('foodCatalog').doc(cabbage.foodId);
      const before = await log('a').doc('cabbage').get();
      const estimate = await (await call('/nutrition/calculate', { items: [cabbage] })).json();
      await doc.update({ energyKcal: 77, version: 2 });
      const newPayload = { ...dish, entryId: 'new-cabbage', previewTag: estimate.meta.previewTag };
      const stale = await call(route, newPayload);
      assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'FOOD_CHANGED');
      assert.equal((await log('a').doc('new-cabbage').get()).exists, false);
      await doc.update({ status: 'inactive' });
      assert.equal((await call(route, { ...dish, previewTag: estimate.meta.previewTag })).status, 200);
      assert.equal((await call(route, newPayload)).status, 404);
      assert.equal((await call(route, { ...dish, mealType: 'lunch' })).status, 409);
      const after = await before.ref.get();
      assert.ok(before.updateTime!.isEqual(after.updateTime!)); assert.equal(after.get('totals.energyKcal'), 39.75);
      assert.equal((await profile('a').get()).get('dataRevision'), 1);
    });
    await t.test('two servings of bread preserve original portions and 64 g, including on a second account with the same ID', async () => {
      const payload = { ...dish, items: [bread], mealType: 'breakfast' };
      assert.equal((await call(route, payload, 'b')).status, 201);
      const item = (await log('b').doc(dish.entryId).get()).get('items')[0];
      assert.equal(item.quantity, 2); assert.equal(item.servingSize, 32); assert.equal(item.consumedGrams, 64);
      assert.equal(item.energyKcal, 161.28); assert.deepEqual(item.portionInput, { quantity: 2 });
      const dayB = await (await getDay('b')).json();
      assert.deepEqual(dayB.items[0].items[0], { foodName: 'Bánh mì nguyên cám', amount: 2, unit: 'serving', converted: { amount: 64, unit: 'g' } });
      assert.equal(dayB.items[0].mealType, 'breakfast');
      assert.equal((await (await getDay()).json()).items[0].items[0].foodName, 'Bắp cải');
    });
    await t.test('multi-food snapshot keeps missing, partial and genuine zero; mL input with a known density round-trips', async () => {
      const water = { foodId: 'usda-sr-174158', consumedMl: 250 };
      const pineapple = { foodId: 'usda-sr-168193', consumedGrams: 100 };
      assert.equal((await call(route, { ...dish, entryId: 'mixed', items: [pineapple, water] })).status, 201);
      const saved = (await log('a').doc('mixed').get()).data()!;
      assert.equal(saved.items[0].fiberGrams, null); assert.equal(saved.items[1].fiberGrams, 0);
      assert.equal(saved.totals.fiberGrams, 0); assert.equal(saved.nutrientCompleteness.fiberGrams, 'partial');
      assert.equal(saved.totals.energyKcal, 45);
      const drink = { foodId: 'usda-sr-171926', consumedMl: 100 };
      assert.equal((await call(route, { ...dish, entryId: 'volume', items: [drink] })).status, 201);
      const storedDrink = (await log('a').doc('volume').get()).get('items')[0];
      assert.deepEqual(storedDrink.portionInput, { consumedMl: 100 });
      assert.equal(storedDrink.consumedGrams, 110); assert.equal(storedDrink.energyKcal, 1.1);
    });
    await t.test('large meal or accumulated daily energy requires confirmation and never writes on warning', async () => {
      const huge = { ...dish, entryId: 'large', items: [{ foodId: bread.foodId, consumedGrams: 6000 }] };
      const warn = await call(route, huge); assert.equal(warn.status, 400);
      assert.deepEqual((await warn.json()).warnings, ['HIGH_PORTION_MASS','HIGH_MEAL_ENERGY','HIGH_DAY_ENERGY']);
      assert.equal((await log('a').doc('large').get()).exists, false);
      assert.equal((await call(route, { ...huge, warningConfirmed: true })).status, 201);
      assert.equal((await call(route, huge)).status, 200);
      const small = { ...dish, entryId: 'follow-up', items: [bread] };
      const blocked = await call(route, small); assert.equal(blocked.status, 400);
      assert.deepEqual((await blocked.json()).warnings, ['HIGH_DAY_ENERGY']);
      assert.equal((await call(route, { ...small, warningConfirmed: true })).status, 201);
    });
    await t.test('deleted IDs cannot be resurrected and day pages cannot cross users or dates', async () => {
      await profile('b').collection('logTombstones').doc('meal_removed').set({ deletedAt: Timestamp.now() });
      assert.equal((await call(route, { ...dish, entryId: 'removed', items: [bread] }, 'b')).status, 409);
      const sample = (await log('b').doc(dish.entryId).get()).data()!;
      const batch = db.batch();
      for (let n = 0; n < 52; n++) batch.set(log('b').doc('older-' + n), { ...sample, entryId: 'older-' + n, localDate: '2024-02-28' });
      await batch.commit();
      const path = route + '?date=2024-02-28';
      const first = await (await call(path, undefined, 'b')).json(); assert.equal(first.items.length, 50);
      const next = '&cursor=' + encodeURIComponent(first.nextCursor);
      const second = await (await call(path + next, undefined, 'b')).json();
      assert.equal(second.items.length, 2); assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.items, ...second.items].map(i => i.entryId)).size, 52);
      assert.equal((await call(path + next)).status, 400);
      assert.equal((await call(route + '?date=' + date + next, undefined, 'b')).status, 400);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.terminate(); await deleteApp(app);
  }
});
