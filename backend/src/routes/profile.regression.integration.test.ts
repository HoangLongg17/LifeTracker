
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import express from 'express';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';

import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { profileRouter } from './profile';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_REQUIRED');
}

const firebaseApp = initializeApp(
  { projectId: 'demo-life39-tests' },
  'life39-f01-regression'
);

const db = getFirestore(firebaseApp);
const uid = 'life39_f01_regression_user';

const authMock = {
  async verifyIdToken(token: string) {
    if (token !== 'VALID_TEST_TOKEN') {
      throw Object.assign(
        new Error('Invalid token'),
        { code: 'auth/invalid-id-token' }
      );
    }

    return {
      uid,
      email: 'test@example.com',
      firebase: { sign_in_provider: 'password' },
    } as DecodedIdToken;
  },
} as Pick<Auth, 'verifyIdToken'>;

test('LIFE-39 - F01 regression smoke test', async () => {
  const api = express();
  api.use(express.json());
  api.use(profileRouter(authMock, db));

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

    async function request(
      method: string,
      path: string,
      body?: Record<string, unknown>,
      token = 'VALID_TEST_TOKEN'
    ) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      return {
        status: response.status,
        body: await response.json() as Record<string, unknown>,
      };
    }

    // Chuẩn bị dữ liệu tài khoản và hồ sơ trên Emulator.
    const userRef = db.collection('users').doc(uid);

    await userRef.set({
      uid,
      role: 'user',
      status: 'active',
      dataRevision: 0,
      version: 1,
    });

    await userRef.collection('profiles').doc('main').set({
      displayName: 'Test User',
      heightCm: null,
      timeZone: 'Asia/Ho_Chi_Minh',
      version: 1,
    });

    // 1. Token không hợp lệ bị từ chối.
    const unauthorized = await request(
      'GET',
      '/me',
      undefined,
      'INVALID_TOKEN'
    );
    assert.equal(unauthorized.status, 401);

    // 2. Đọc thông tin tài khoản.
    const account = await request('GET', '/me');

    assert.equal(account.status, 200);
    assert.equal(account.body.uid, uid);

    // 3. Đọc hồ sơ.
    const profile = await request('GET', '/me/profile');

    assert.equal(profile.status, 200);
    assert.equal(profile.body.version, 1);
    assert.equal(profile.body.currentWeightKg, null);

    // 4. Cập nhật hồ sơ.
    const updated = await request(
      'PATCH',
      '/me/profile',
      { version: 1, heightCm: 170 }
    );

    assert.equal(updated.status, 200);
    assert.equal(updated.body.version, 2);
    assert.equal(updated.body.heightCm, 170);

    // 5. Cập nhật bằng version cũ.
    const conflict = await request(
      'PATCH',
      '/me/profile',
      { version: 1, heightCm: 175 }
    );

    assert.equal(conflict.status, 409);

    // 6. Ghi cân nặng thuộc F01.
    const weightInput = {
      entryId: 'f01_regression_weight_001',
      weightKg: 60,
      measuredAt: '2026-11-15T08:00:00.000Z',
      timeZone: 'Asia/Ho_Chi_Minh',
    };

    const weightCreated = await request(
      'POST',
      '/me/weights',
      weightInput
    );

    assert.equal(weightCreated.status, 201);

    // 7. Retry cân nặng không tạo bản ghi trùng.
    const weightRetry = await request(
      'POST',
      '/me/weights',
      weightInput
    );

    assert.equal(weightRetry.status, 200);

    // 8. Hồ sơ đọc được cân nặng mới nhất.
    const finalProfile = await request('GET', '/me/profile');

    assert.equal(finalProfile.status, 200);
    assert.equal(finalProfile.body.currentWeightKg, 60);
    assert.equal(finalProfile.body.heightCm, 170);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });

    await db.recursiveDelete(
      db.collection('users').doc(uid)
    );

    await db.terminate();
    await deleteApp(firebaseApp);
  }
});
