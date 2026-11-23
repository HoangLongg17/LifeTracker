
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import express from 'express';

import {
  initializeApp,
  deleteApp,
} from 'firebase-admin/app';

import {
  getFirestore,
} from 'firebase-admin/firestore';

import type {
  Auth,
  DecodedIdToken,
} from 'firebase-admin/auth';

import { logsRouter } from './logs';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'FIRESTORE_EMULATOR_REQUIRED'
  );
}

const firebaseApp = initializeApp(
  { projectId: 'demo-life39-tests' },
  'life39-http-test'
);

const db = getFirestore(firebaseApp);

const uidA = 'life39_http_user_A';
const uidB = 'life39_http_user_B';

const authMock = {
  async verifyIdToken(token: string) {
    if (token === 'TOKEN_A' || token === 'TOKEN_B') {
      return {
        uid: token === 'TOKEN_A' ? uidA : uidB,
        email: 'test@example.com',
        firebase: {
          sign_in_provider: 'password',
        },
      } as DecodedIdToken;
    }

    throw Object.assign(
      new Error('Invalid token'),
      { code: 'auth/invalid-id-token' }
    );
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

test('LIFE-39 HTTP API integration', async (t) => {
  await prepareUser(uidA);
  await prepareUser(uidB);

  const apiApp = express();
  apiApp.use(express.json());
  apiApp.use(logsRouter(authMock, db));

  const server = apiApp.listen(
    0,
    '127.0.0.1'
  );

  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('TEST_SERVER_UNAVAILABLE');
  }

  const baseUrl =
    `http://127.0.0.1:${address.port}`;

  async function request(
    method: string,
    path: string,
    token?: string,
    data?: Record<string, unknown>
  ) {
    const response = await fetch(
      `${baseUrl}${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token
            ? { Authorization: `Bearer ${token}` }
            : {}),
        },
        body:
          data === undefined
            ? undefined
            : JSON.stringify(data),
      }
    );

    return {
      status: response.status,
      body: await response.json() as
        Record<string, unknown>,
    };
  }

  const path = '/me/logs/water';
  const entryId = 'life39_http_water_001';

  const original = {
    entryId,
    volumeMl: 250,
    loggedAt: '2026-11-21T08:00:00.000Z',
    timeZone: 'Asia/Ho_Chi_Minh',
  };

  try {
    await t.test('No token returns 401', async () => {
      const result = await request(
        'POST',
        path,
        undefined,
        original
      );

      assert.equal(result.status, 401);
    });

    await t.test('Invalid token returns 401', async () => {
      const result = await request(
        'POST',
        path,
        'INVALID_TOKEN',
        original
      );

      assert.equal(result.status, 401);
    });

    await t.test('Rejects invalid fields', async () => {
      const result = await request(
        'POST',
        path,
        'TOKEN_A',
        {
          ...original,
          volumeMl: 0,
          userId: uidB,
        }
      );

      assert.equal(result.status, 400);
    });

    await t.test('Create returns 201', async () => {
      const result = await request(
        'POST',
        path,
        'TOKEN_A',
        original
      );

      assert.equal(result.status, 201);
      assert.equal(result.body.status, 'created');
    });

    await t.test('Retry returns 200', async () => {
      const result = await request(
        'POST',
        path,
        'TOKEN_A',
        original
      );

      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'existing');
    });

    await t.test('Different body returns 409', async () => {
      const result = await request(
        'POST',
        path,
        'TOKEN_A',
        {
          ...original,
          volumeMl: 500,
        }
      );

      assert.equal(result.status, 409);
    });

    await t.test('User B cannot read user A log', async () => {
      const result = await request(
        'GET',
        `${path}/${entryId}`,
        'TOKEN_B'
      );

      assert.equal(result.status, 404);
    });

    await t.test('User B cannot modify user A log', async () => {
      const result = await request(
        'PATCH',
        `${path}/${entryId}`,
        'TOKEN_B',
        {
          version: 1,
          volumeMl: 999,
        }
      );

      assert.equal(result.status, 404);
    });

    await t.test('Owner can read log', async () => {
      const result = await request(
        'GET',
        `${path}/${entryId}`,
        'TOKEN_A'
      );

      assert.equal(result.status, 200);
      assert.equal(result.body.volumeMl, 250);
      assert.equal(result.body.version, 1);
      assert.equal(
        'requestFingerprint' in result.body,
        false
      );
    });

    await t.test('PATCH changes day and version', async () => {
      const result = await request(
        'PATCH',
        `${path}/${entryId}`,
        'TOKEN_A',
        {
          version: 1,
          volumeMl: 350,
          loggedAt: '2026-11-22T08:00:00.000Z',
        }
      );

      assert.equal(result.status, 200);
      assert.equal(result.body.version, 2);
      assert.equal(
        result.body.localDate,
        '2026-11-22'
      );
    });

    await t.test('Old PATCH version returns 409', async () => {
      const result = await request(
        'PATCH',
        `${path}/${entryId}`,
        'TOKEN_A',
        {
          version: 1,
          volumeMl: 400,
        }
      );

      assert.equal(result.status, 409);
    });

    await t.test('Both days are stale', async () => {
      const userRef = db.collection('users').doc(uidA);

      const oldSummary = await userRef
        .collection('dailySummaries')
        .doc('2026-11-21')
        .get();

      const newSummary = await userRef
        .collection('dailySummaries')
        .doc('2026-11-22')
        .get();

      assert.equal(
        oldSummary.get('recomputeStatus'),
        'stale'
      );

      assert.equal(
        newSummary.get('recomputeStatus'),
        'stale'
      );
    });

    await t.test('Old DELETE version returns 409', async () => {
      const result = await request(
        'DELETE',
        `${path}/${entryId}`,
        'TOKEN_A',
        { version: 1 }
      );

      assert.equal(result.status, 409);
    });



    await t.test(
      'User B cannot delete user A log',
      async () => {
        const result = await request(
          'DELETE',
          `${path}/${entryId}`,
          'TOKEN_B',
          { version: 2 }
        );

        assert.equal(result.status, 404);
      }
    );

    await t.test('Owner DELETE succeeds', async () => {
      const result = await request(
        'DELETE',
        `${path}/${entryId}`,
        'TOKEN_A',
        { version: 2 }
      );

      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'deleted');
    });

    await t.test('Deleted log returns 404', async () => {
      const result = await request(
        'GET',
        `${path}/${entryId}`,
        'TOKEN_A'
      );

      assert.equal(result.status, 404);
    });

    await t.test(
    'Retry after deletion returns 409',
    async () => {
        const result = await request(
        'POST',
        path,
        'TOKEN_A',
        original
        );

        assert.equal(result.status, 409);
        assert.equal(
        result.body.status,
        'ENTRY_ALREADY_DELETED'
        );
    }
    );

    await t.test(
    'Deleted entryId cannot be reused',
    async () => {
        const result = await request(
        'POST',
        path,
        'TOKEN_A',
        {
            ...original,
            volumeMl: 500,
        }
        );

        assert.equal(result.status, 409);
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
