
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import express from 'express';

import type {
  Auth,
  DecodedIdToken,
} from 'firebase-admin/auth';

import {
  initializeApp,
  deleteApp,
} from 'firebase-admin/app';

import { getFirestore } from 'firebase-admin/firestore';

import { logsRouter } from './logs';
import { waterReadRouter } from './waterRead';

// Chỉ được chạy với Firestore Emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_REQUIRED');
}

const firebaseApp = initializeApp(
  { projectId: 'demo-life39-tests' },
  'life40-water-integration'
);

const db = getFirestore(firebaseApp);

const uidA = 'life40_water_user_a';
const uidB = 'life40_water_user_b';

const authMock = {
  async verifyIdToken(token: string) {
    if (token !== 'TOKEN_A' && token !== 'TOKEN_B') {
      throw Object.assign(
        new Error('Invalid token'),
        { code: 'auth/invalid-id-token' }
      );
    }

    return {
      uid: token === 'TOKEN_A' ? uidA : uidB,
      email: 'test@example.com',
      firebase: {
        sign_in_provider: 'password',
      },
    } as DecodedIdToken;
  },
} as Pick<Auth, 'verifyIdToken'>;

async function prepareAccount(uid: string) {
  const userRef = db.collection('users').doc(uid);

  await userRef.set({
    uid,
    role: 'user',
    status: 'active',
    version: 1,
  });

  await userRef
    .collection('profiles')
    .doc('main')
    .set({
      version: 1,
      timeZone: 'Asia/Ho_Chi_Minh',
    });
}

test('LIFE-40 - Water API integration', async t => {
  const api = express();

  api.use(express.json());
  api.use(logsRouter(authMock, db));
  api.use(waterReadRouter(authMock, db));

  const server = api.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      if (server.listening) {
        resolve();
        return;
      }

      server.once('listening', resolve);
      server.once('error', reject);
    });

    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('TEST_SERVER_UNAVAILABLE');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const path = '/me/logs/water';

    await prepareAccount(uidA);
    await prepareAccount(uidB);

    async function request(
      method: string,
      endpoint: string,
      token: string,
      body?: Record<string, unknown>
    ) {
      const response = await fetch(
        `${baseUrl}${endpoint}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: body
            ? JSON.stringify(body)
            : undefined,
        }
      );

      return {
        status: response.status,
        body: await response.json() as
          Record<string, unknown>,
      };
    }

    const date22 = `${path}?date=2026-11-22`;
    const date23 = `${path}?date=2026-11-23`;

    await t.test(
      'Ngày chưa có dữ liệu không được tính là 0 mL',
      async () => {
        const result = await request(
          'GET',
          date22,
          'TOKEN_A'
        );

        assert.equal(result.status, 200);
        assert.equal(result.body.totalWaterMl, null);
        assert.equal(result.body.recordStatus, 'missing');
        assert.deepEqual(result.body.items, []);
      }
    );

    await t.test(
      'Tạo lần uống 250 mL',
      async () => {
        const result = await request(
          'POST',
          path,
          'TOKEN_A',
          {
            entryId: 'life40_water_001',
            amount: 250,
            unit: 'mL',
            loggedAt: '2026-11-22T08:00:00.000Z',
            timeZone: 'Asia/Ho_Chi_Minh',
          }
        );

        assert.equal(result.status, 201);
        assert.equal(result.body.status, 'created');
      }
    );

    await t.test(
      'Tạo lần uống 0,5 L',
      async () => {
        const result = await request(
          'POST',
          path,
          'TOKEN_A',
          {
            entryId: 'life40_water_002',
            amount: 0.5,
            unit: 'L',
            loggedAt: '2026-11-22T09:00:00.000Z',
            timeZone: 'Asia/Ho_Chi_Minh',
          }
        );

        assert.equal(result.status, 201);
      }
    );

    await t.test(
      'Tổng hai lần uống bằng 750 mL',
      async () => {
        const result = await request(
          'GET',
          date22,
          'TOKEN_A'
        );

        assert.equal(result.status, 200);
        assert.equal(result.body.totalWaterMl, 750);
        assert.equal(result.body.recordStatus, 'partial');

        const items = result.body.items;

        assert.ok(Array.isArray(items));
        assert.equal(items.length, 2);
      }
    );

    await t.test(
      'Không tính dữ liệu của tài khoản khác',
      async () => {
        const result = await request(
          'GET',
          date22,
          'TOKEN_B'
        );

        assert.equal(result.status, 200);
        assert.equal(result.body.totalWaterMl, null);
        assert.equal(result.body.recordStatus, 'missing');
        assert.deepEqual(result.body.items, []);
      }
    );

    await t.test(
      'Không tính dữ liệu của ngày khác',
      async () => {
        const created = await request(
          'POST',
          path,
          'TOKEN_A',
          {
            entryId: 'life40_water_yesterday',
            volumeMl: 1000,
            loggedAt: '2026-11-21T08:00:00.000Z',
            timeZone: 'Asia/Ho_Chi_Minh',
          }
        );

        assert.equal(created.status, 201);

        const result = await request(
          'GET',
          date22,
          'TOKEN_A'
        );

        assert.equal(result.body.totalWaterMl, 750);
      }
    );

    await t.test(
      'Từ chối lượng nước bằng 0',
      async () => {
        const result = await request(
          'POST',
          path,
          'TOKEN_A',
          {
            entryId: 'life40_invalid_zero',
            amount: 0,
            unit: 'mL',
            loggedAt: '2026-11-22T08:00:00.000Z',
            timeZone: 'Asia/Ho_Chi_Minh',
          }
        );

        assert.equal(result.status, 400);
      }
    );

    await t.test(
      'Từ chối lượng nước âm',
      async () => {
        const result = await request(
          'POST',
          path,
          'TOKEN_A',
          {
            entryId: 'life40_invalid_negative',
            amount: -100,
            unit: 'mL',
            loggedAt: '2026-11-22T08:00:00.000Z',
            timeZone: 'Asia/Ho_Chi_Minh',
          }
        );

        assert.equal(result.status, 400);
      }
    );

    await t.test(
      'Sửa lượng nước và chuyển sang ngày khác',
      async () => {
        const updated = await request(
          'PATCH',
          `${path}/life40_water_002`,
          'TOKEN_A',
          {
            version: 1,
            amount: 0.3,
            unit: 'L',
            loggedAt: '2026-11-23T09:00:00.000Z',
          }
        );

        assert.equal(updated.status, 200);
        assert.equal(updated.body.status, 'updated');

        const oldDay = await request(
          'GET',
          date22,
          'TOKEN_A'
        );

        const newDay = await request(
          'GET',
          date23,
          'TOKEN_A'
        );

        assert.equal(oldDay.body.totalWaterMl, 250);
        assert.equal(newDay.body.totalWaterMl, 300);
      }
    );

    await t.test(
      'Xóa lần uống làm thay đổi tổng ngày',
      async () => {
        const deleted = await request(
          'DELETE',
          `${path}/life40_water_001`,
          'TOKEN_A',
          { version: 1 }
        );

        assert.equal(deleted.status, 200);

        const result = await request(
          'GET',
          date22,
          'TOKEN_A'
        );

        assert.equal(result.body.totalWaterMl, null);
        assert.equal(result.body.recordStatus, 'missing');
        assert.deepEqual(result.body.items, []);
      }
    );

    await t.test(
      'Ngày xác nhận không uống nước có tổng 0',
      async () => {
        const userRef = db.collection('users').doc(uidA);

        // Seed trạng thái xác nhận để kiểm tra API đọc.
        // LIFE-47 sẽ triển khai API xác nhận ngày.
        await userRef
          .collection('dailySummaries')
          .doc('2026-11-24')
          .set({
            dateKey: '2026-11-24',
            timeZone: 'Asia/Ho_Chi_Minh',
            userConfirmedByCategory: {
              water: true,
            },
            recomputeStatus: 'fresh',
          });

        const result = await request(
          'GET',
          `${path}?date=2026-11-24`,
          'TOKEN_A'
        );

        assert.equal(result.status, 200);
        assert.equal(result.body.totalWaterMl, 0);
        assert.equal(result.body.recordStatus, 'confirmed');
      }
    );

    await t.test(
      'Từ chối định dạng ngày không hợp lệ',
      async () => {
        const result = await request(
          'GET',
          `${path}?date=2026-02-30`,
          'TOKEN_A'
        );

        assert.equal(result.status, 400);
      }
    );

    await t.test(
    'Không sử dụng xác nhận cũ khi tổng hợp đang stale',
    async () => {
        const summaryRef = db
        .collection('users')
        .doc(uidA)
        .collection('dailySummaries')
        .doc('2026-11-25');

        await summaryRef.set({
        dateKey: '2026-11-25',
        timeZone: 'Asia/Ho_Chi_Minh',
        userConfirmedByCategory: {
            water: true,
        },
        recomputeStatus: 'stale',
        });

        const result = await request(
        'GET',
        `${path}?date=2026-11-25`,
        'TOKEN_A'
        );

        assert.equal(result.status, 200);
        assert.equal(result.body.totalWaterMl, null);
        assert.equal(result.body.recordStatus, 'missing');
    }
    );

  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });

    await db.recursiveDelete(
      db.collection('users').doc(uidA)
    );

    await db.recursiveDelete(
      db.collection('users').doc(uidB)
    );

    await db.terminate();
    await deleteApp(firebaseApp);
  }
});
