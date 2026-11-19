import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { Auth } from 'firebase-admin/auth';
import { type Firestore } from 'firebase-admin/firestore';
import { profileRouter } from '../src/routes/profile';

type StoredDoc = Record<string, unknown>;

function createTestServer() {
  const docs = new Map<string, StoredDoc>();
  const emptyQueryResult = async () => ({ empty: true, docs: [] as { id: string; get: (key: string) => unknown }[] });

  const collection = (path: string) => ({
    doc: (id: string) => ref(`${path}/${id}`),
    where: () => ({
      orderBy: () => ({
        orderBy: () => ({
          orderBy: () => ({
            limit: () => ({ get: emptyQueryResult }),
          }),
        }),
      }),
      get: emptyQueryResult,
    }),
    orderBy: () => ({
      limit: () => ({ get: emptyQueryResult }),
    }),
  });

  const ref = (path: string) => ({
    path,
    collection: (name: string) => collection(`${path}/${name}`),
  });

  const snapshot = (r: { path: string }) => ({
    exists: docs.has(r.path),
    get: (key: string) => docs.get(r.path)?.[key],
    data: () => docs.get(r.path),
  });

  const db = {
    getAll: async (...refs: { path: string }[]) => refs.map(snapshot),
    collection,
    runTransaction: async (fn: (tx: unknown) => unknown) => {
      const pending = new Map<string, StoredDoc>();
      const result = await fn({
        get: async (r: { path: string }) => snapshot(r),
        create: (r: { path: string }, value: StoredDoc) => {
          pending.set(r.path, value);
        },
        update: (r: { path: string }, value: StoredDoc) => {
          pending.set(r.path, { ...docs.get(r.path), ...value });
        },
      });
      for (const [p, v] of pending) docs.set(p, v);
      return result;
    },
  } as unknown as Firestore;

  const auth = {
    verifyIdToken: async (token: string) => {
      if (token === 'token-user-a') {
        return { uid: 'uid-a', email: 'applon@gmail.com', firebase: { sign_in_provider: 'password' } };
      }
      if (token === 'token-google-provider') {
        return { uid: 'uid-google', email: 'google@gmail.com', firebase: { sign_in_provider: 'google.com' } };
      }
      throw Object.assign(new Error('Invalid token'), { code: 'auth/argument-error' });
    },
  } as unknown as Auth;

  const app = express();
  app.use(express.json());
  app.use(profileRouter(auth, db));
  return { app, docs };
}

test('F01 - Kiểm tra hồ sơ tối thiểu, ca biên dữ liệu, cảnh báo và xung đột entryId', async () => {
  const { app } = createTestServer();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Từ chối 403 nếu tài khoản không đăng nhập bằng email/password (FR-01.01)
    const nonPasswordRes = await fetch(`${baseUrl}/users/bootstrap`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-google-provider', 'Content-Type': 'application/json' },
    });
    assert.equal(nonPasswordRes.status, 403);
    assert.deepEqual(await nonPasswordRes.json(), { code: 'EMAIL_ACCOUNT_REQUIRED' });

    // 2. Khởi tạo tài khoản tối thiểu qua /me/bootstrap (FR-01.06)
    const bootRes = await fetch(`${baseUrl}/me/bootstrap`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-user-a', 'Content-Type': 'application/json' },
    });
    assert.equal(bootRes.status, 201);

    // 3. Chặn chiều cao <= 0 và cập nhật rỗng (NFR-11)
    const emptyPatch = await fetch(`${baseUrl}/me/profile`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer token-user-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    assert.equal(emptyPatch.status, 400);

    const negativeHeight = await fetch(`${baseUrl}/me/profile`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer token-user-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, heightCm: -170 }),
    });
    assert.equal(negativeHeight.status, 400);
    assert.equal((await negativeHeight.json()).fields.heightCm, 'INVALID_HEIGHT');

    // 4. Cập nhật birthYear trước, sau đó chuyển sang birthDate -> tự động xóa birthYear cũ
    const setYear = await fetch(`${baseUrl}/me/profile`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer token-user-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, birthYear: 2004 }),
    });
    assert.equal(setYear.status, 200);
    assert.equal((await setYear.json()).birthYear, 2004);

    const setDate = await fetch(`${baseUrl}/me/profile`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer token-user-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 2, birthDate: '2004-08-20' }),
    });
    assert.equal(setDate.status, 200);
    const dateProfile = await setDate.json();
    assert.equal(dateProfile.birthDate, '2004-08-20');
    assert.equal(dateProfile.birthYear, null);

    // 5. Ghi cân nặng ngoài dải 20-300kg: chặn nếu thiếu warningConfirmed, cho phép nếu đã xác nhận (AT-35)
    const weightPayload = {
      entryId: 'w-extreme-01',
      weightKg: 350,
      measuredAt: '2026-11-18T10:00:00.000Z',
      timeZone: 'Asia/Ho_Chi_Minh',
    };
    const unconfirmedWeight = await fetch(`${baseUrl}/me/weights`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-user-a', 'Content-Type': 'application/json' },
      body: JSON.stringify(weightPayload),
    });
    assert.equal(unconfirmedWeight.status, 400);
    assert.equal((await unconfirmedWeight.json()).fields.weightKg, 'WARNING_CONFIRMATION_REQUIRED');

    const confirmedWeight = await fetch(`${baseUrl}/me/weights`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-user-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...weightPayload, warningConfirmed: true }),
    });
    assert.equal(confirmedWeight.status, 201);

    // 6. Retry cùng entryId nhưng khác weightKg -> trả 409 ENTRY_ID_CONFLICT (AT-14)
    const conflictWeight = await fetch(`${baseUrl}/me/weights`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-user-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...weightPayload, weightKg: 65, warningConfirmed: false }),
    });
    assert.equal(conflictWeight.status, 409);
    assert.deepEqual(await conflictWeight.json(), { code: 'ENTRY_ID_CONFLICT' });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  }
});