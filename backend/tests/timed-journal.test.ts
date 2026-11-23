import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
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
test('Firestore CRUD, retries, cross-day overlap, preview, stale days and user isolation', { skip: !emulator }, async t => {
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
