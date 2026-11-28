import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { importFoods, validateSeed } from '../scripts/import-foods';
import { logsRouter } from '../src/routes/logs';

const local = /^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '');
test('Edit and delete a meal through its journal actions', { skip: !local }, async t => {
  const projectId = 'demo-meal-edit-' + process.pid + '-' + Date.now().toString(36);
  const app = initializeApp({ projectId }, projectId);
  const db = getFirestore(app);
  const auth = { verifyIdToken: async (token: string) => ({
    uid: token, email: 'local@example.invalid', firebase: { sign_in_provider: 'password' },
  }) as DecodedIdToken };
  const server = express().use(express.json()).use(logsRouter(auth, db)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/me/logs/meal';
  const call = (method: string, path: string, body?: unknown, uid = 'a') => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(uid && { Authorization: 'Bearer ' + uid }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const account = db.collection('users').doc('a');
  const ref = account.collection('mealLogs').doc('meal-edit');
  const summary = account.collection('dailySummaries').doc('2026-01-15');
  const cabbageId = 'usda-sr-169975', breadId = 'usda-sr-172688';
  const cabbage = { foodId: cabbageId, consumedGrams: 159 }, bread = { foodId: breadId, quantity: 2 };
  const common = { mealType: 'snack', timeZone: 'Asia/Ho_Chi_Minh', loggedAt: '2026-01-15T09:04:47.123Z' };
  const seed = { ...common, entryId: ref.id, note: 'Ghi chú ban đầu', items: [cabbage, bread] };
  const path = '/' + ref.id;
  const edited = { ...common, version: 1, mealType: 'lunch', items: [{ foodId: cabbageId, consumedGrams: 200 }, bread] };
  try {
    const foods = validateSeed(JSON.parse(readFileSync(join(__dirname, '../data/foodCatalog.json'), 'utf8')));
    await importFoods(db, foods.filter(row => [cabbageId, breadId].includes(row.foodId)));
    for (const uid of ['a','b','blocked']) {
      const owner = db.collection('users').doc(uid);
      await owner.set({ status: uid === 'blocked' ? 'disabled' : 'active', dataRevision: 0 });
      await owner.collection('profiles').doc('main').set({ timeZone: common.timeZone });
    }
    assert.equal((await call('POST','',seed)).status, 201);
    await t.test('opens a previously saved meal with its amount, serving, clock and date', async () => {
      const reply = await call('GET',path); assert.equal(reply.status, 200);
      const result = await reply.json();
      assert.equal(result.entryId, ref.id); assert.equal(result.version, 1); assert.equal(result.localDate, '2026-01-15');
      assert.equal(result.loggedAt, common.loggedAt); assert.equal(result.mealType, 'snack');
      assert.deepEqual(result.lines.map((line: { input: unknown }) => line.input), seed.items);
      assert.equal(result.lines[1].food.servingSize, 32);
    });
    await t.test('rejects edits and deletes by other accounts or without a current version', async () => {
      for (const [uid, status] of [['',401],['b',404],['blocked',403]] as const) {
        assert.equal((await call('GET',path,undefined,uid)).status, status);
        assert.equal((await call('PATCH',path,edited,uid)).status, status);
        assert.equal((await call('DELETE',path,{version:1},uid)).status, status);
      }
      for (const bad of [{ ...edited,version:0 },{ ...edited,totals:{} },{ ...edited,items:[{foodId:cabbageId,consumedGrams:0}] }]) {
        assert.equal((await call('PATCH',path,bad)).status, 400);
      }
      assert.equal((await call('DELETE',path,{})).status,400);
      assert.equal((await ref.get()).get('version'),1);
    });
    await t.test('a changed line uses its current source, untouched lines keep their exact historical snapshot', async () => {
      const before = (await ref.get()).data()!;
      await db.collection('foodCatalog').doc(breadId).update({ status:'inactive' });
      const preview = await (await call('POST',path+'/preview',{ version:1, items:edited.items })).json();
      assert.equal(preview.data.totals.energyKcal, 211.28);
      const source = db.collection('foodCatalog').doc(cabbageId);
      await source.update({ version:2, energyKcal:26 });
      assert.equal((await call('PATCH',path,{ ...edited,previewTag:preview.meta.previewTag })).status,409);
      assert.equal((await ref.get()).get('version'),1);
      const fresh = await (await call('POST',path+'/preview',{ version:1, items:edited.items })).json();
      const body = { ...edited, previewTag:fresh.meta.previewTag };
      const simultaneous = await Promise.all([call('PATCH',path,body), call('PATCH',path,body)]);
      assert.deepEqual(simultaneous.map(r => r.status), [200,200]);
      const after = (await ref.get()).data()!;
      assert.equal(after.version,2); assert.equal(after.totals.energyKcal,213.28);
      assert.equal(after.items[0].consumedGrams,200); assert.equal(after.items[0].referenceSnapshot.version,2);
      assert.deepEqual(after.items[1],before.items[1]); assert.equal(after.note,before.note);
      assert.ok(after.createdAt.isEqual(before.createdAt)); assert.ok(after.loggedAt.isEqual(before.loggedAt));
      assert.equal((await account.get()).get('dataRevision'),2); assert.equal((await summary.get()).get('sourceRevision'),2);
      assert.equal((await call('PATCH',path,{...body,mealType:'dinner'})).status,409);
      const list = await (await call('GET','?date=2026-01-15')).json(); assert.equal(list.items.length,1);
      assert.equal(list.items[0].entryId,ref.id); assert.equal(list.items[0].mealType,'lunch');
    });
    await t.test('changing just the meal or clock keeps existing items, even when the catalog has changed', async () => {
      const before = (await ref.get()).data()!;
      await db.collection('foodCatalog').doc(cabbageId).update({status:'inactive'});
      const change = { ...edited,version:2,mealType:'breakfast',loggedAt:'2026-01-15T00:30:00Z' };
      assert.equal((await call('PATCH',path,change)).status,200);
      const after = (await ref.get()).data()!;
      assert.deepEqual(after.items,before.items); assert.deepEqual(after.totals,before.totals);
      assert.equal(after.loggedAt.toDate().toISOString(),'2026-01-15T00:30:00.000Z');
    });
    await t.test('a confirmed delete removes only that entry; duplicate deletion is safe', async () => {
      const other = { ...seed,entryId:'neighbour',items:[cabbage] };
      await db.collection('foodCatalog').doc(cabbageId).update({status:'active'});
      assert.equal((await call('POST','',other)).status,201);
      assert.equal((await call('DELETE',path,{version:1})).status,409);
      assert.equal((await ref.get()).exists,true);
      const rev = (await account.get()).get('dataRevision');
      assert.equal((await call('DELETE',path,{version:3})).status,200);
      assert.equal((await call('DELETE',path,{version:3})).status,200);
      assert.equal((await ref.get()).exists,false);
      assert.equal((await ref.parent.doc('neighbour').get()).exists,true);
      assert.equal((await account.get()).get('dataRevision'),rev+1);
      assert.equal((await account.collection('logTombstones').doc('meal_'+ref.id).get()).get('deletedVersion'),3);
      assert.equal((await call('GET',path)).status,404);
      assert.equal((await call('POST','',seed)).status,409);
    });
    await t.test('removing an earlier item preserves the remaining item snapshot after catalog updates', async () => {
      const cabbageRef = db.collection('foodCatalog').doc(cabbageId);
      const breadRef = db.collection('foodCatalog').doc(breadId);
      await cabbageRef.update({status:'active'});
      await breadRef.update({status:'active'});
      const entryId = 'shifted-items';
      const loggedAt = '2026-01-16T09:04:47.123Z';
      const items = [cabbage, bread];
      assert.equal((await call('POST','',{
        entryId, loggedAt, timeZone:common.timeZone, mealType:'snack', items,
      })).status,201);
      const original = (await account.collection('mealLogs').doc(entryId).get()).data()!;
      const retainedItem = original.items[1];
      const catalogCabbage = (await cabbageRef.get()).data()!;
      await cabbageRef.update({energyKcal:catalogCabbage.energyKcal + 100, version:catalogCabbage.version + 1});
      assert.equal((await call('PATCH','/'+entryId,{
        version:1, loggedAt, timeZone:common.timeZone, mealType:'snack', items:[bread],
      })).status,200);
      const updated = (await account.collection('mealLogs').doc(entryId).get()).data()!;
      assert.equal(updated.items.length,1);
      assert.deepEqual(updated.items[0],retainedItem);
      assert.equal(updated.totals.energyKcal,retainedItem.energyKcal);
    });
    await t.test('a changed duplicate line uses the current source while an unchanged line keeps its snapshot', async () => {
      const cabbageRef = db.collection('foodCatalog').doc(cabbageId);
      const entryId = 'duplicate-items';
      const loggedAt = '2026-01-17T09:04:47.123Z';
      const servings = [
        { foodId:cabbageId, consumedGrams:100 },
        { foodId:cabbageId, consumedGrams:200 },
      ];
      assert.equal((await call('POST','',{
        entryId, loggedAt, timeZone:common.timeZone, mealType:'snack', items:servings,
      })).status,201);
      const original = (await account.collection('mealLogs').doc(entryId).get()).data()!;
      const catalogCabbage = (await cabbageRef.get()).data()!;
      await cabbageRef.update({energyKcal:catalogCabbage.energyKcal + 10, version:catalogCabbage.version + 1});
      assert.equal((await call('PATCH','/'+entryId,{
        version:1, loggedAt, timeZone:common.timeZone, mealType:'snack',
        items:[{foodId:cabbageId,consumedGrams:200},servings[1]],
      })).status,200);
      const updated = (await account.collection('mealLogs').doc(entryId).get()).data()!;
      assert.equal(updated.items[0].referenceSnapshot.nutrients.energyKcal,catalogCabbage.energyKcal + 10);
      assert.deepEqual(updated.items[1],original.items[1]);

      const equalEntryId = 'duplicate-equal-portions';
      const equalLoggedAt = '2026-01-19T09:04:47.123Z';
      const equalServings = [
        { foodId:cabbageId, consumedGrams:100 },
        { foodId:cabbageId, consumedGrams:100 },
      ];
      assert.equal((await call('POST','',{
        entryId:equalEntryId, loggedAt:equalLoggedAt, timeZone:common.timeZone, mealType:'snack', items:equalServings,
      })).status,201);
      const equalOriginal = (await account.collection('mealLogs').doc(equalEntryId).get()).data()!;
      assert.equal((await call('PATCH','/'+equalEntryId,{
        version:1, loggedAt:equalLoggedAt, timeZone:common.timeZone, mealType:'snack',
        items:[equalServings[0],{foodId:cabbageId,consumedGrams:150}],
      })).status,200);
      const equalUpdated = (await account.collection('mealLogs').doc(equalEntryId).get()).data()!;
      assert.deepEqual(equalUpdated.items[0],equalOriginal.items[0]);
      assert.equal(equalUpdated.items[1].referenceSnapshot.nutrients.energyKcal,catalogCabbage.energyKcal + 10);
    });
    await t.test('reordering duplicate-food lines retains each line snapshot by food and portion', async () => {
      const entryId = 'reordered-items';
      const loggedAt = '2026-01-18T09:04:47.123Z';
      const portions = [
        { foodId:cabbageId, consumedGrams:100 },
        { foodId:cabbageId, consumedGrams:200 },
      ];
      assert.equal((await call('POST','',{
        entryId, loggedAt, timeZone:common.timeZone, mealType:'snack', items:portions,
      })).status,201);
      const original = (await account.collection('mealLogs').doc(entryId).get()).data()!;
      assert.equal((await call('PATCH','/'+entryId,{
        version:1, loggedAt, timeZone:common.timeZone, mealType:'snack', items:[...portions].reverse(),
      })).status,200);
      const updated = (await account.collection('mealLogs').doc(entryId).get()).data()!;
      assert.deepEqual(updated.items,[...original.items].reverse());
      assert.equal(updated.totals.energyKcal,original.totals.energyKcal);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.terminate(); await deleteApp(app);
  }
});
