import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { validateSeed, importFoods } from '../scripts/import-foods';
import { foodsRouter } from '../src/routes/foods';

const local = /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '');
test('LIFE-43 HTTP routes and atomic, repeatable seed on local Firestore', { skip: !local }, async t => {
  const id = 'demo-food-' + process.pid + '-' + Date.now().toString(36);
  const firebase = initializeApp({ projectId: id }, id);
  const db = getFirestore(firebase);
  const rows = validateSeed(JSON.parse(readFileSync(join(__dirname, '../data/foodCatalog.json'), 'utf8')));
  const auth = { verifyIdToken: async (token: string) => {
    if (token === 'bad') throw Object.assign(new Error(), { code: 'auth/invalid-id-token' });
    return { uid: token, email: 'test@example.invalid', firebase: { sign_in_provider: 'password' } } as DecodedIdToken;
  } };
  const server = express().use(express.json()).use(foodsRouter(auth, db)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const get = (path: string, token = 'a') => fetch('http://127.0.0.1:' + (server.address() as AddressInfo).port + path,
    { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  try {
    const users = db.collection('users');
    for (const uid of ['a','b','disabled']) await users.doc(uid).set({ status: uid === 'disabled' ? 'disabled' : 'active' });
    const coll = db.collection('foodCatalog');
    await t.test('repeat import preserves all documents and the original timestamps', async () => {
      assert.deepEqual(await importFoods(db, rows), { created: 100, skipped: 0 });
      const before = await coll.doc(rows[0].foodId).get();
      assert.deepEqual(await importFoods(db, rows), { created: 0, skipped: 100 });
      const after = await before.ref.get();
      assert.ok(before.updateTime!.isEqual(after.updateTime!));
      assert.ok(after.get('retrievedAt') instanceof Timestamp);
    });
    await t.test('authenticated search/detail, invalid queries, paging and no matches', async () => {
      for (const [token, code] of [['',401],['bad',401],['disabled',403],['new',404]] as const) assert.equal((await get('/foods', token)).status, code);
      for (const path of ['/foods?limit=101','/foods?q=x&q=y','/foods?cursor=broken']) assert.equal((await get(path)).status, 400);
      const page = await (await get('/foods')).json();
      assert.equal(page.items.length, 20);
      const next = '/foods?cursor=' + page.nextCursor;
      assert.equal((await get(next, 'b')).status, 400);
      assert.equal((await (await get(next)).json()).items.length, 20);
      assert.deepEqual(await (await get('/foods?q=xyzzz')).json(), { items: [], nextCursor: null });
      assert.equal((await (await get('/foods?q=chuoi')).json()).items.length, 2);
      assert.equal((await (await get('/foods/usda-sr-168193')).json()).fiberGrams, null);
      assert.equal((await (await get('/foods/usda-sr-174158')).json()).energyKcal, 0);
      assert.equal((await get('/foods/missing')).status, 404);
      await coll.doc('zz-page-two').set({ ...rows[0], foodId: 'zz-page-two', foodName: 'Second page item' });
      assert.equal((await (await get('/foods?q=second%20page%20item')).json()).items[0].foodId, 'zz-page-two');
    });
    const post = (body: unknown, token = 'a') => fetch('http://127.0.0.1:' + (server.address() as AddressInfo).port + '/nutrition/calculate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body),
    });
    const rice = { foodId: 'usda-sr-169757', consumedGrams: 150 };
    const water = { foodId: 'usda-sr-174158', consumedMl: 250 };
    await t.test('LIFE-44 enforces authentication, active accounts, item limits and authoritative units', async () => {
      for (const [token, code] of [['',401],['bad',401],['disabled',403],['new',404]] as const) {
        assert.equal((await post({ items: [rice] }, token)).status, code);
      }
      for (const [body, code] of [
        [{ items: [] }, 'INVALID_ITEMS'], [{ items: Array(51).fill(rice) }, 'INVALID_ITEMS'],
        [{ items: [{ ...rice, energyKcal: 1 }] }, 'INVALID_PORTION'],
        [{ items: [{ foodId: rice.foodId, consumedMl: 100 }] }, 'MISSING_DENSITY'],
        [{ items: [{ foodId: water.foodId, quantity: 2 }] }, 'MISSING_SERVING_SIZE'],
      ] as const) {
        const response = await post(body);
        assert.equal(response.status, 400);
        const data = await response.json();
        assert.equal(data.error.code, 'VALIDATION_ERROR');
        assert.equal(data.error.fieldErrors[0].code, code);
        assert.equal(data.error.requestId, response.headers.get('X-Request-Id'));
      }
    });
    await t.test('LIFE-44 reads the current source, counts repeated items once each and writes no journal or user data', async () => {
      const uref = users.doc('a');
      const bref = coll.doc(rice.foodId);
      const beforeUser = await uref.get();
      const beforeRice = await bref.get();
      const inputs = [rice, { foodId: 'usda-sr-168193', consumedGrams: 100 }, water, rice];
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await post({ items: inputs });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        const envelope = await response.json();
        assert.equal(envelope.meta.requestId, response.headers.get('X-Request-Id'));
        assert.deepEqual(envelope.data.items.map((i: { foodId: string }) => i.foodId), inputs.map(i => i.foodId));
        assert.equal(envelope.data.items[0].energyKcal, 195);
        assert.equal(envelope.data.items[2].energyKcal, 0);
        assert.equal(envelope.data.totals.energyKcal, 435);
        assert.equal(envelope.data.nutrientCompleteness.fiberGrams, 'partial');
      }
      assert.ok((await uref.get()).updateTime!.isEqual(beforeUser.updateTime!));
      assert.ok((await bref.get()).updateTime!.isEqual(beforeRice.updateTime!));
      assert.equal((await uref.listCollections()).length, 0);
      await bref.update({ energyKcal: 150, version: 2 });
      const revised = await (await post({ items: [rice] })).json();
      assert.equal(revised.data.totals.energyKcal, 225);
      assert.equal(revised.data.items[0].foodVersion, 2);
    });
    await t.test('LIFE-44 rejects a whole preview if any item is unpublished, invalid or missing', async () => {
      for (const [foodId, change] of [['demo-hidden', { status: 'draft' }], ['demo-invalid', { proteinGrams: -1 }]] as const) {
        await coll.doc(foodId).set({ ...rows[0], foodId, ...change });
      }
      for (const id of ['demo-hidden', 'demo-invalid', 'demo-absent']) {
        const response = await post({ items: [rice, { foodId: id, consumedGrams: 100 }] });
        const error = await response.json();
        assert.equal(response.status, 404);
        assert.equal(error.error.code, 'FOOD_NOT_FOUND');
        assert.equal(error.error.fieldErrors[0].field, 'items[1].foodId');
        assert.equal(error.data, undefined);
      }
    });
    await t.test('unpublishing takes effect immediately, invalid active records stay hidden, conflicts abort all creates', async () => {
      await coll.doc('usda-sr-173944').update({ status: 'inactive' });
      await coll.doc('bad-basis').set({ ...rows[0], foodId: 'bad-basis', referenceAmount: -1 });
      assert.equal((await get('/foods/usda-sr-173944')).status, 404);
      assert.equal((await get('/foods/bad-basis')).status, 404);
      assert.equal((await (await get('/foods?q=chuoi')).json()).items.length, 1);
      const removed = coll.doc('usda-sr-169757');
      await removed.delete();
      await assert.rejects(importFoods(db, rows), /Xung đột/);
      assert.equal((await removed.get()).exists, false);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.terminate(); await deleteApp(firebase);
  }
});
