import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { profileRouter } from '../src/routes/profile';

test('bootstrap creates the group schema atomically and repairs only missing documents', async () => {
  const docs = new Map<string, Record<string, unknown>>();
  let unavailable = false;
  let failCommit = false;
  let writes = 0;
  const userPath = 'users/owner-123';
  const profilePath = `${userPath}/profiles/main`;
  const ref = (path: string): unknown => ({ path, collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }) });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: unknown) => unknown) => {
      if (unavailable) throw new Error('offline');
      const pending = new Map<string, Record<string, unknown>>();
      const result = await fn({
        get: async (r: { path: string }) => {
          assert.equal(pending.size, 0, 'All reads must precede writes');
          return { exists: docs.has(r.path) };
        },
        create: (r: { path: string }, value: Record<string, unknown>) => {
          assert.ok(!docs.has(r.path), 'Existing data must not be overwritten');
          pending.set(r.path, value);
        },
      });
      if (failCommit) throw new Error('commit failed');
      for (const [path, value] of pending) { docs.set(path, value); writes++; }
      return result;
    },
  } as unknown as Firestore;
  const auth = { verifyIdToken: async (token: string, revoked: boolean) => {
    assert.equal(revoked, true);
    if (token !== 'valid') throw new Error('invalid');
    return { uid: 'owner-123', email: 'owner@example.com', firebase: { sign_in_provider: 'password' } };
  } } as unknown as Auth;
  const app = express();
  app.use(express.json());
  app.use('/users', profileRouter(auth, db));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const request = (token?: string) => fetch(`http://127.0.0.1:${address.port}/users/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ uid: 'victim', password: 'never-store', role: 'admin', birthYear: 2000, heightCm: 165.5 }),
  });
  try {
    assert.equal((await request()).status, 401);
    assert.equal((await request('invalid')).status, 401);
    assert.equal(writes, 0);
    unavailable = true;
    assert.equal((await request('valid')).status, 503);
    unavailable = false;
    failCommit = true;
    assert.equal((await request('valid')).status, 503);
    assert.equal(docs.size, 0);
    failCommit = false;
    const created = await request('valid');
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { uid: 'owner-123', ready: true });
    const user = docs.get(userPath)!;
    const profile = docs.get(profilePath)!;
    assert.deepEqual(Object.keys(user).sort(), ['createdAt', 'dataRevision', 'role', 'status', 'uid', 'updatedAt', 'version']);
    assert.equal(user.uid, 'owner-123');
    assert.equal(user.role, 'user');
    assert.equal(user.status, 'active');
    assert.equal(user.dataRevision, 0);
    assert.equal(user.version, 1);
    assert.equal(user.createdAt, user.updatedAt);
    assert.deepEqual(Object.keys(profile).sort(), ['birthYear', 'displayName', 'heightCm', 'notificationSettings', 'timeZone', 'updatedAt', 'version']);
    assert.equal(profile.birthYear, null);
    assert.equal(profile.heightCm, null);
    assert.equal(profile.displayName, '');
    assert.equal(profile.timeZone, 'Asia/Ho_Chi_Minh');
    assert.deepEqual(profile.notificationSettings, { enabled: false, observedDevicePermission: 'not_checked' });
    profile.displayName = 'Huy';
    user.dataRevision = 7;
    assert.equal((await request('valid')).status, 200);
    assert.equal(writes, 2);
    assert.equal(docs.get(profilePath)?.displayName, 'Huy');
    docs.delete(profilePath);
    assert.equal((await request('valid')).status, 201);
    assert.equal(docs.get(userPath), user);
    assert.equal(user.dataRevision, 7);
    assert.equal(writes, 3);
    const restoredProfile = docs.get(profilePath);
    docs.delete(userPath);
    assert.equal((await request('valid')).status, 201);
    assert.equal(docs.get(profilePath), restoredProfile);
    assert.equal(writes, 4);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
