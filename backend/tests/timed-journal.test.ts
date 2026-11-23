import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Query, Timestamp } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { parseTimedLog, TimedLogInputError } from '../src/services/timedLogInput';

const zone = 'Asia/Ho_Chi_Minh';
const activity = { entryId: 'one', timeZone: zone, activityType: 'walking', startedAt: '2025-01-01T09:00:00+07:00', durationMinutes: 60 };
const sleep = { entryId: 'night', timeZone: zone, sleepStart: '2025-01-01T23:30:00+07:00', sleepEnd: '2025-01-02T06:30:00+07:00' };

test('validates calendar dates, duration, future times and explicit long-session confirmation', () => {
  const invalid = (input: object, code: string) => assert.throws(() => parseTimedLog('activity', { ...activity, ...input }),
    err => err instanceof TimedLogInputError && err.code === code);
  invalid({ durationMinutes: -1 }, 'INVALID_VALUE');
  invalid({ startedAt: '2025-02-30T09:00:00+07:00' }, 'INVALID_DATE_TIME');
  invalid({ startedAt: '2099-01-01T09:00:00+07:00' }, 'FUTURE_TIME');
  invalid({ endedAt: '2025-01-01T11:00:00+07:00' }, 'DURATION_MISMATCH');
  invalid({ durationMinutes: 361 }, 'CONFIRM_LONG_SESSION');
  assert.equal(parseTimedLog('activity', { ...activity, durationMinutes: 361, warningConfirmed: true }).fields.durationMinutes, 361);
  const night = parseTimedLog('sleep', sleep);
  assert.equal(night.fields.sessionMinutes, 420);
  assert.equal(night.fields.actualSleepMinutes, null);
  assert.equal(parseTimedLog('sleep', { ...sleep, awakeMinutes: 15 }).fields.actualSleepMinutes, 405);
  assert.throws(() => parseTimedLog('sleep', { ...sleep, sleepEnd: sleep.sleepStart }), /END_BEFORE_START/);
  const long = { ...sleep, sleepEnd: '2025-01-03T06:30:00+07:00' };
  assert.throws(() => parseTimedLog('sleep', long), /CONFIRM_LONG_SESSION/);
  assert.equal(parseTimedLog('sleep', { ...long, warningConfirmed: true }).fields.sessionMinutes, 1860);
});

const emulator = /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '');
async function startJournal(t: TestContext) {
  const name = randomUUID();
  const firebase = initializeApp({ projectId: 'demo-life-journal' }, name);
  const db = getFirestore(firebase);
  const account = db.collection('users').doc(name);
  const second = db.collection('users').doc(name + '-other');
  for (const ref of [account, second]) {
    await ref.set({ status: 'active' });
    await ref.collection('profiles').doc('main').set({ timeZone: zone });
  }
  const app = express();
  app.use(express.json());
  const { logsRouter } = await import('../src/routes/logs');
  const fakeAuth = { verifyIdToken: async (token: string) => ({ uid: token === 'other' ? second.id : account.id,
    email: 'journal@example.test', firebase: { sign_in_provider: 'password' } }) } as unknown as Auth;
  app.use(logsRouter(fakeAuth, db));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await Promise.all([db.recursiveDelete(account), db.recursiveDelete(second)]);
    await deleteApp(firebase);
  });
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/me/logs/';
  async function request(path: string, method = 'GET', input?: object, token = 'owner') {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: input ? JSON.stringify(input) : undefined });
    return { status: response.status, body: await response.json() };
  }
  return { account, db, request };
}

test('Firestore CRUD, retries, cross-day overlap, preview, stale days and user isolation', { skip: !emulator }, async t => {
  const { account, db, request } = await startJournal(t);
  assert.equal((await request('activity?date=2025-01-01', 'GET', undefined, '')).status, 401);
  assert.equal((await request('activity?date=2025-01-01')).body.totalMinutes, null);
  assert.equal((await request('activity', 'POST', activity)).status, 201);
  assert.equal((await request('activity', 'POST', activity)).body.status, 'existing');
  assert.equal((await request('activity/one', 'GET', undefined, 'other')).status, 404);
  const another = { ...activity, entryId: 'two', startedAt: '2025-01-01T09:30:00+07:00' };
  assert.equal((await request('activity/preview', 'POST', another)).body.totalMinutes, 90);
  assert.equal((await request('activity', 'POST', another)).status, 201);
  assert.equal((await request('activity?date=2025-01-01')).body.totalMinutes, 90);
  assert.equal((await request('activity/one')).body.overlapStatus, 'needs_review');
  assert.equal((await request('activity/two', 'PATCH', { version: 1, startedAt: '2025-01-02T09:30:00+07:00' })).status, 200);
  assert.equal((await request('activity/two', 'PATCH', { version: 1, durationMinutes: 90 })).status, 409);
  assert.equal((await request('activity/one')).body.overlapStatus, 'clear');
  assert.equal((await request('activity?date=2025-01-01')).body.totalMinutes, 60);
  assert.equal((await request('activity?date=2025-01-02')).body.totalMinutes, 60);
  assert.equal((await account.collection('dailySummaries').doc('2025-01-02').get()).get('recomputeStatus'), 'stale');
  assert.equal((await request('activity/two', 'DELETE', { version: 2 })).status, 200);
  assert.equal((await request('activity', 'POST', another)).body.status, 'ENTRY_ALREADY_DELETED');
  assert.equal((await request('sleep', 'POST', sleep)).body.localDate, '2025-01-02');
  const earlier = { ...sleep, entryId: 'before', sleepStart: '2025-01-01T22:30:00+07:00', sleepEnd: '2025-01-01T23:55:00+07:00' };
  assert.equal((await request('sleep', 'POST', earlier)).status, 201);
  assert.equal((await request('sleep?date=2025-01-01')).body.totalMinutes, 85);
  assert.equal((await request('sleep?date=2025-01-02')).body.totalMinutes, 395);
  assert.equal((await request('sleep/before', 'DELETE', { version: 1 })).status, 200);
  assert.equal((await request('sleep?date=2025-01-02')).body.totalMinutes, 420);
  const pair = ['parallel-a', 'parallel-b'].map(entryId => request('activity', 'POST', {
    ...activity, entryId, startedAt: '2025-01-03T10:00:00+07:00',
  }));
  assert.deepEqual((await Promise.all(pair)).map(r => r.status), [201, 201]);
  const together = (await request('activity?date=2025-01-03')).body;
  assert.equal(together.totalMinutes, 60);
  assert.ok(together.items.every((item: { overlapStatus: string }) => item.overlapStatus === 'needs_review'));
  const batch = db.batch();
  for (let index = 0; index < 52; index++) {
    const id = 'page-' + String(index).padStart(2, '0');
    batch.set(account.collection('activityLogs').doc(id), { entryId: id, localDate: '2025-02-01', countedMinutes: 1 });
  }
  await batch.commit();
  const firstPage = (await request('activity?date=2025-02-01')).body;
  const secondPage = (await request('activity?date=2025-02-01&cursor=' + firstPage.nextCursor)).body;
  assert.equal(firstPage.totalMinutes, 52);
  assert.equal(firstPage.items.length, 50);
  assert.equal(secondPage.items.length, 2);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(secondPage.items[0].entryId, 'page-50');
});

test('activity preview works before the sleep interval index is ready', { skip: !emulator }, async t => {
  const { account, request } = await startJournal(t);
  const draft = { ...activity, entryId: 'draft', startedAt: '2025-11-23T23:18:00+07:00', durationMinutes: 20 };
  const start = Date.parse(draft.startedAt);
  const missingIndex = account.collection('sleepLogs')
    .where('sleepEnd', '>', Timestamp.fromMillis(start))
    .where('sleepStart', '<', Timestamp.fromMillis(start + draft.durationMinutes * 60_000))
    .orderBy('sleepEnd').orderBy('sleepStart').limit(1);

  // The emulator serves every composite query. Fail only this query's RPC to exercise the SDK's real transaction startup.
  const queries = Query.prototype as unknown as { _get(this: Query, options: unknown): Promise<unknown> };
  const get = queries._get;
  let indexErrors = 0;
  t.mock.method(queries, '_get', async function (this: Query, options: unknown) {
    if (this.isEqual(missingIndex)) {
      indexErrors++;
      throw Object.assign(new Error('The query requires an index.'), { code: 9 });
    }
    return get.call(this, options);
  });

  assert.deepEqual(await request('activity/preview', 'POST', draft), { status: 200, body: { totalMinutes: 20 } });
  assert.ok(indexErrors > 0);
  assert.equal((await request('activity', 'POST', { ...draft, entryId: 'saved', startedAt: '2025-11-23T23:10:00+07:00' })).status, 201);
  assert.deepEqual(await request('activity/preview', 'POST', draft), { status: 200, body: { totalMinutes: 28 } });
  assert.equal((await request('activity?date=2025-11-23')).body.totalMinutes, 20);
  assert.equal((await request('sleep', 'POST', { ...sleep, sleepStart: '2025-11-23T23:35:00+07:00', sleepEnd: '2025-11-24T06:00:00+07:00' })).status, 201);
  const conflicting = await request('activity/preview', 'POST', draft);
  assert.equal(conflicting.status, 409);
  assert.equal(conflicting.body.code, 'SLEEP_ACTIVITY_OVERLAP');
});

test('sleep and activity reject intersecting intervals in either direction, including edits across midnight', { skip: !emulator }, async t => {
  const { request } = await startJournal(t);
  const night = { ...sleep, entryId: 'night', sleepStart: '2025-04-01T22:10:00+07:00', sleepEnd: '2025-04-02T06:30:00+07:00' };
  const walk = { ...activity, entryId: 'night', startedAt: '2025-04-01T22:30:00+07:00', durationMinutes: 20 };
  const expectOverlap = (response: { status: number; body: unknown }, kind: string, start: string, end: string) => {
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { code: 'SLEEP_ACTIVITY_OVERLAP', overlap: {
      kind, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    } });
  };
  assert.equal((await request('sleep', 'POST', night)).status, 201);
  for (const path of ['activity/preview', 'activity']) {
    expectOverlap(await request(path, 'POST', walk), 'sleep', night.sleepStart, night.sleepEnd);
  }
  assert.equal((await request('activity', 'POST', walk, 'other')).status, 201);
  assert.equal((await request('activity?date=2025-04-01')).body.totalMinutes, null);
  const adjoining = { ...walk, startedAt: night.sleepEnd };
  assert.equal((await request('activity', 'POST', adjoining)).status, 201);
  const end = '2025-04-02T06:50:00+07:00';
  const extendSleep = { ...night, entryId: 'second-night', sleepEnd: '2025-04-02T06:40:00+07:00' };
  for (const path of ['sleep/preview', 'sleep']) {
    expectOverlap(await request(path, 'POST', extendSleep), 'activity', adjoining.startedAt, end);
  }
  expectOverlap(await request('sleep/night', 'PATCH', { version: 1, sleepEnd: extendSleep.sleepEnd }),
    'activity', adjoining.startedAt, end);
  expectOverlap(await request('activity/night', 'PATCH', { version: 1, startedAt: '2025-04-02T06:20:00+07:00' }),
    'sleep', night.sleepStart, night.sleepEnd);
  assert.equal((await request('sleep/night')).body.version, 1);
  assert.equal((await request('activity/night')).body.version, 1);
  assert.equal((await request('sleep', 'POST', night)).body.status, 'existing');
  assert.equal((await request('activity', 'POST', { ...walk, entryId: 'before', startedAt: '2025-04-01T21:50:00+07:00' })).status, 201);
  assert.equal((await request('activity/night', 'DELETE', { version: 1 })).status, 200);
  assert.equal((await request('sleep/night', 'PATCH', { version: 1, sleepEnd: extendSleep.sleepEnd })).status, 200);
});

test('existing cross-type overlaps are visible on both assigned dates and can be corrected', { skip: !emulator }, async t => {
  const { account, request } = await startJournal(t);
  assert.equal((await request('sleep', 'POST', sleep)).status, 201);
  const legacy = { ...activity, entryId: 'legacy', userId: account.id, localDate: '2025-01-01', version: 1, countedMinutes: 20,
    startedAt: Timestamp.fromDate(new Date('2025-01-01T23:45:00+07:00')), durationMinutes: 20, overlapStatus: 'clear' };
  await account.collection('activityLogs').doc(legacy.entryId).set(legacy);
  const marked = async (kind: string, day: string) => (await request(kind + '?date=' + day)).body.items[0].crossTypeOverlap;
  assert.equal(await marked('activity', '2025-01-01'), true);
  assert.equal(await marked('sleep', '2025-01-02'), true);
  assert.equal((await request('sleep/preview', 'POST', sleep)).body.code, 'SLEEP_ACTIVITY_OVERLAP');
  assert.equal((await request('activity/legacy', 'PATCH', { version: 1, startedAt: '2025-01-01T22:00:00+07:00' })).status, 200);
  assert.equal(await marked('activity', '2025-01-01'), false);
  assert.equal(await marked('sleep', '2025-01-02'), false);
});

test('simultaneous sleep and activity writes can commit only one of two conflicting intervals', { skip: !emulator }, async t => {
  const { request } = await startJournal(t);
  const walk = { ...activity, startedAt: sleep.sleepStart, durationMinutes: 20 };
  const results = await Promise.all([request('sleep', 'POST', sleep), request('activity', 'POST', walk)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(results.find(r => r.status === 409)?.body.code, 'SLEEP_ACTIVITY_OVERLAP');
  const stored = await Promise.all([request('sleep?date=2025-01-02'), request('activity?date=2025-01-01')]);
  assert.equal(stored[0].body.items.length + stored[1].body.items.length, 1);
});
