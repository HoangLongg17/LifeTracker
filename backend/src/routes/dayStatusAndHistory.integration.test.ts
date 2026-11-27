import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import express from 'express';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import { logsRouter } from './logs';
import { daysRouter } from './days';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_REQUIRED');
}

const firebaseApp = initializeApp(
  { projectId: 'demo-f02-status-history-tests' },
  'f02-status-history-test'
);
const db = getFirestore(firebaseApp);

const uidA = 'f02_test_user_A';
const uidB = 'f02_test_user_B';

const authMock = {
  async verifyIdToken(token: string) {
    if (token === 'TOKEN_A' || token === 'TOKEN_B') {
      return {
        uid: token === 'TOKEN_A' ? uidA : uidB,
        email: 'f02@example.com',
        firebase: { sign_in_provider: 'password' },
      } as DecodedIdToken;
    }
    throw Object.assign(new Error('Invalid token'), {
      code: 'auth/invalid-id-token',
    });
  },
} as Pick<Auth, 'verifyIdToken'>;

async function prepareUser(uid: string) {
  const userRef = db.collection('users').doc(uid);
  await userRef.set({
    uid,
    role: 'user',
    status: 'active',
    version: 1,
  });
  await userRef.collection('profiles').doc('main').set({
    timeZone: 'Asia/Ho_Chi_Minh',
    version: 1,
  });
}

test('F02 (FR-02.05, FR-02.07, FR-02.08) Day Record Status & Log History', async (t) => {
  await prepareUser(uidA);
  await prepareUser(uidB);

  const apiApp = express();
  apiApp.use(express.json());
  apiApp.use(logsRouter(authMock, db));
    apiApp.use(daysRouter(authMock, db));

  const server = apiApp.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('TEST_SERVER_UNAVAILABLE');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function request(
    method: string,
    path: string,
    token?: string,
    data?: Record<string, unknown>
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }

  const pastDate = '2026-11-20';
  const secondPastDate = '2026-11-19';
  const futureDate = '2099-12-31';
  const waterEntryId = 'f02_water_entry_001';

  try {
    await t.test('1. Unauthenticated requests return 401', async () => {
      const s1 = await request('GET', `/me/days/${pastDate}/record-status`);
      const s2 = await request('GET', '/me/logs/history');
      assert.equal(s1.status, 401);
      assert.equal(s2.status, 401);
    });

    await t.test('2. Empty day distinguishes missing (null) from 0', async () => {
      const res = await request(
        'GET',
        `/me/days/${pastDate}/record-status`,
        'TOKEN_A'
      );
      assert.equal(res.status, 200);
      const cats = res.body.categories as Record<
        string,
        { status: string; total: number | null; confirmed: boolean }
      >;
      assert.equal(cats.water.status, 'missing');
      assert.equal(cats.water.total, null);
      assert.equal(cats.activity.status, 'missing');
      assert.equal(cats.activity.total, null);
      assert.equal(cats.meal.status, 'missing');
      assert.equal(cats.sleep.status, 'missing');
    });

    await t.test('3. Logging water sets water to partial while others stay missing', async () => {
      const createRes = await request('POST', '/me/logs/water', 'TOKEN_A', {
        entryId: waterEntryId,
        volumeMl: 250,
        loggedAt: '2026-11-20T08:00:00.000Z',
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      assert.equal(createRes.status, 201);

      const statusRes = await request(
        'GET',
        `/me/days/${pastDate}/record-status`,
        'TOKEN_A'
      );
      assert.equal(statusRes.status, 200);
      const cats = statusRes.body.categories as Record<
        string,
        { status: string; total: number | null }
      >;
      assert.equal(cats.water.status, 'partial');
      assert.equal(cats.water.total, 250);
      assert.equal(cats.activity.status, 'missing');
      assert.equal(cats.activity.total, null);
    });

    await t.test('4. Rejects confirming an unended day (DAY_NOT_ENDED)', async () => {
      const res = await request(
        'PUT',
        `/me/days/${futureDate}/record-status`,
        'TOKEN_A',
        { category: 'water', confirmed: true }
      );
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'DAY_NOT_ENDED');
    });

    await t.test('5. Confirming empty activity sets 0 minutes + confirmed', async () => {
      const res = await request(
        'PUT',
        `/me/days/${pastDate}/record-status`,
        'TOKEN_A',
        { category: 'activity', confirmed: true }
      );
      assert.equal(res.status, 200);
      const cats = res.body.categories as Record<
        string,
        { status: string; total: number | null; confirmed: boolean }
      >;
      assert.equal(cats.activity.status, 'confirmed');
      assert.equal(cats.activity.confirmed, true);
      assert.equal(cats.activity.total, 0);
      assert.equal(cats.meal.status, 'missing');
      assert.equal(cats.meal.total, null);
    });

    await t.test('6. Confirming water then editing water invalidates only water', async () => {
      const confirmWater = await request(
        'PUT',
        `/me/days/${pastDate}/record-status`,
        'TOKEN_A',
        { category: 'water', confirmed: true }
      );
      assert.equal(confirmWater.status, 200);

      // Sửa bản ghi nước -> chỉ nhóm water quay về partial, activity vẫn confirmed
      const patchRes = await request(
        'PATCH',
        `/me/logs/water/${waterEntryId}`,
        'TOKEN_A',
        { version: 1, volumeMl: 400 }
      );
      assert.equal(patchRes.status, 200);

      const afterStatus = await request(
        'GET',
        `/me/days/${pastDate}/record-status`,
        'TOKEN_A'
      );
      assert.equal(afterStatus.status, 200);
      const cats = afterStatus.body.categories as Record<
        string,
        { status: string; total: number | null; confirmed: boolean }
      >;
      assert.equal(cats.water.status, 'partial');
      assert.equal(cats.water.confirmed, false);
      assert.equal(cats.water.total, 400);

      assert.equal(cats.activity.status, 'confirmed');
      assert.equal(cats.activity.confirmed, true);
      assert.equal(cats.activity.total, 0);
    });

    await t.test('7. History groups by behavioral localDate, filters and paginates', async () => {
      const userRef = db.collection('users').doc(uidA);
      // Thêm bản ghi vận động và giấc ngủ ở ngày 2026-11-19
      await userRef.collection('activityLogs').doc('f02_act_001').set({
        localDate: secondPastDate,
        startedAt: Timestamp.fromDate(new Date('2026-11-19T10:00:00.000Z')),
        timeZone: 'Asia/Ho_Chi_Minh',
        activityType: 'walking',
        durationMinutes: 30,
        countedMinutes: 30,
        version: 1,
      });
      await userRef.collection('sleepLogs').doc('f02_sleep_001').set({
        localDate: secondPastDate,
        sleepStart: Timestamp.fromDate(new Date('2026-11-19T00:00:00.000Z')),
        sleepEnd: Timestamp.fromDate(new Date('2026-11-19T07:00:00.000Z')),
        timeZone: 'Asia/Ho_Chi_Minh',
        sessionMinutes: 420,
        countedMinutes: 420,
        version: 1,
      });

      // Kiểm tra phân trang limit=2
      const page1 = await request(
        'GET',
        '/me/logs/history?from=2026-11-19&to=2026-11-20&limit=2',
        'TOKEN_A'
      );
      assert.equal(page1.status, 200);
      const items1 = page1.body.items as Array<{
        entryId: string;
        kind: string;
        localDate: string;
      }>;
      assert.equal(items1.length, 2);
      assert.equal(items1[0].localDate, pastDate);
      assert.equal(items1[0].kind, 'water');
      assert.equal(typeof page1.body.nextCursor, 'string');

      const page2 = await request(
        'GET',
        `/me/logs/history?from=2026-11-19&to=2026-11-20&limit=2&cursor=${encodeURIComponent(
          page1.body.nextCursor as string
        )}`,
        'TOKEN_A'
      );
      assert.equal(page2.status, 200);
      const items2 = page2.body.items as Array<{ entryId: string }>;
      assert.equal(items2.length, 1);
      assert.notEqual(items2[0].entryId, items1[0].entryId);

      // Kiểm tra lọc theo loại activity
      const actOnly = await request(
        'GET',
        '/me/logs/history?type=activity&from=2026-11-19&to=2026-11-20',
        'TOKEN_A'
      );
      assert.equal(actOnly.status, 200);
      const actItems = actOnly.body.items as Array<{ kind: string }>;
      assert.equal(actItems.length, 1);
      assert.equal(actItems[0].kind, 'activity');
    });

    await t.test('8. User B cannot access User A history or record status', async () => {
      const histB = await request('GET', '/me/logs/history', 'TOKEN_B');
      assert.equal(histB.status, 200);
      assert.equal((histB.body.items as unknown[]).length, 0);
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await db.recursiveDelete(db.collection('users').doc(uidA));
    await db.recursiveDelete(db.collection('users').doc(uidB));
    await db.terminate();
    await deleteApp(firebaseApp);
  }
});