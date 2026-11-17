import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { Auth } from 'firebase-admin/auth';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { profileRouter } from '../src/routes/profile';

test('bootstrap creates the group schema atomically and repairs only missing documents', async () => {
  const docs = new Map<string, Record<string, unknown>>();
  let unavailable = false;
  let failCommit = false;
  let compositeIndexUnavailable = false;
  let writes = 0;
  const userPath = 'users/owner-123';
  const profilePath = `${userPath}/profiles/main`;
  type MemoryQuery = {
    where: (field: string, operator: '==', value: unknown) => MemoryQuery;
    orderBy: (field: string, direction: 'asc' | 'desc') => MemoryQuery;
    get: () => Promise<{ empty: boolean; docs: { id: string; get: (key: string) => unknown }[] }>;
    limit: (count: number) => { get: () => Promise<{ empty: boolean; docs: { id: string; get: (key: string) => unknown }[] }> };
  };
  const query = (path: string, orders: [string, 'asc' | 'desc'][] = [], filters: [string, unknown][] = []): MemoryQuery => ({
    where: (field, _operator, expected) => query(path, orders, [...filters, [field, expected]]),
    orderBy: (field, direction) => query(path, [...orders, [field, direction]], filters),
    get: () => query(path, orders, filters).limit(Number.MAX_SAFE_INTEGER).get(),
    limit: count => ({
      get: async () => {
        if (compositeIndexUnavailable && filters.some(([field]) => field === 'validationStatus') && orders.length > 1) {
          throw Object.assign(new Error('The query requires an index.'), { code: 9 });
        }
        const prefix = `${path}/`;
        const docsInCollection = [...docs.entries()]
          .filter(([docPath]) => docPath.startsWith(prefix) && !docPath.slice(prefix.length).includes('/'))
          .map(([docPath, data]) => ({ id: docPath.slice(prefix.length), data }))
          .filter(({ data }) => filters.every(([field, expected]) => data[field] === expected));
        const value = (data: Record<string, unknown>, id: string, field: string) => {
          const item = field === 'entryId' ? id : data[field];
          if (item instanceof Timestamp) return item.toMillis();
          if (item instanceof Date) return item.getTime();
          if (typeof item === 'number' || typeof item === 'string') return item;
          return null;
        };
        docsInCollection.sort((a, b) => {
          for (const [field, direction] of orders) {
            const left = value(a.data, a.id, field);
            const right = value(b.data, b.id, field);
            if (left === null || right === null || left === right) continue;
            const comparison = left < right ? -1 : 1;
            if (comparison !== 0) return direction === 'desc' ? -comparison : comparison;
          }
          return 0;
        });
        const selected = docsInCollection.slice(0, count).map(({ id, data }) => ({
          id,
          get: (key: string) => data[key],
        }));
        return { empty: selected.length === 0, docs: selected };
      },
    }),
  });
  const collection = (path: string) => ({
    doc: (id: string) => ref(`${path}/${id}`),
    where: (field: string, operator: '==', expected: unknown) => query(path).where(field, operator, expected),
    orderBy: (field: string, direction: 'asc' | 'desc') => query(path, [[field, direction]]),
  });
  const ref = (path: string): { path: string; collection: (name: string) => ReturnType<typeof collection> } => ({
    path,
    collection: (name: string) => collection(`${path}/${name}`),
  });
  const snapshot = (r: { path: string }) => ({
    exists: docs.has(r.path),
    get: (key: string) => docs.get(r.path)?.[key],
    data: () => docs.get(r.path),
  });
  const db = {
    getAll: async (...refs: { path: string }[]) => {
      if (unavailable) throw new Error('offline');
      return refs.map(snapshot);
    },
    collection,
    runTransaction: async (fn: (tx: unknown) => unknown) => {
      if (unavailable) throw new Error('offline');
      const pending = new Map<string, Record<string, unknown>>();
      const result = await fn({
        get: async (r: { path: string }) => {
          assert.equal(pending.size, 0, 'All reads must precede writes');
          return snapshot(r);
        },
        create: (r: { path: string }, value: Record<string, unknown>) => {
          assert.ok(!docs.has(r.path), 'Existing data must not be overwritten');
          pending.set(r.path, value);
        },
        update: (r: { path: string }, value: Record<string, unknown>) => {
          pending.set(r.path, { ...docs.get(r.path), ...value });
        },
      });
      if (failCommit) throw new Error('commit failed');
      for (const [path, value] of pending) { docs.set(path, value); writes++; }
      return result;
    },
  } as unknown as Firestore;
  const auth = { verifyIdToken: async (token: string, revoked: boolean) => {
    assert.equal(revoked, true);
    if (token === 'expired' || token === 'revoked') throw Object.assign(new Error(token), { code: `auth/id-token-${token}` });
    if (token === 'other') return { uid: 'owner-456', email: 'other@example.com', firebase: { sign_in_provider: 'password' } };
    if (token !== 'valid') throw Object.assign(new Error('invalid'), { code: 'auth/argument-error' });
    return { uid: 'owner-123', email: 'owner@example.com', firebase: { sign_in_provider: 'password' } };
  } } as unknown as Auth;
  const app = express();
  app.use(express.json());
  app.use(profileRouter(auth, db));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const request = (token?: string) => fetch(`http://127.0.0.1:${address.port}/users/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ uid: 'victim', password: 'never-store', role: 'admin', birthYear: 2000, heightCm: 165.5 }),
  });
  const me = (token?: string) => fetch(`http://127.0.0.1:${address.port}/me?uid=victim`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const profileApi = (token: string, method: 'GET' | 'PATCH' = 'GET', body?: unknown) => fetch(
    `http://127.0.0.1:${address.port}/me/profile`,
    {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const weightApi = (token: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}/me/weights`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await me()).status, 401);
    assert.equal((await me('invalid')).status, 401);
    assert.deepEqual(await (await me('expired')).json(), { code: 'TOKEN_EXPIRED' });
    assert.deepEqual(await (await me('revoked')).json(), { code: 'TOKEN_REVOKED' });
    assert.deepEqual(await (await me('valid')).json(), { code: 'ACCOUNT_NOT_INITIALIZED' });
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
    assert.deepEqual(Object.keys(profile).sort(), ['birthYear', 'displayName', 'heightCm', 'notificationSettings', 'preferredUnits', 'timeZone', 'updatedAt', 'version']);
    assert.equal(profile.birthYear, null);
    assert.equal(profile.heightCm, null);
    assert.equal(profile.displayName, '');
    assert.equal(profile.timeZone, 'Asia/Ho_Chi_Minh');
    assert.deepEqual(profile.preferredUnits, { weight: 'kg', height: 'cm', water: 'mL' });
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
    const session = await me('valid');
    assert.equal(session.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await session.json(), { uid: 'owner-123', role: 'user', status: 'active', ready: true, displayName: null });
    const initialProfile = await profileApi('valid');
    assert.equal(initialProfile.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await initialProfile.json(), {
      uid: 'owner-123',
      version: 1,
      displayName: '',
      birthDate: null,
      birthYear: null,
      heightCm: null,
      currentWeightKg: null,
      activityLevel: null,
      preferredUnits: { weight: 'kg', height: 'cm', water: 'mL' },
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    assert.equal((await profileApi('invalid')).status, 401);
    assert.equal((await profileApi('valid', 'PATCH', { version: 1, heightCm: 260 })).status, 400);
    const updated = await profileApi('valid', 'PATCH', {
      version: 1,
      displayName: '  Huy  ',
      birthYear: 2000,
      heightCm: 170,
      activityLevel: 'moderate',
      preferredUnits: { weight: 'lb', height: 'cm', water: 'L' },
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    assert.equal(updated.status, 200);
    const updatedData = await updated.json();
    assert.equal(updatedData.displayName, 'Huy');
    assert.equal(updatedData.version, 2);
    assert.equal(updatedData.birthYear, 2000);
    assert.equal(updatedData.heightCm, 170);
    assert.equal(updatedData.activityLevel, 'moderate');
    assert.deepEqual(updatedData.preferredUnits, { weight: 'lb', height: 'cm', water: 'L' });
    assert.equal((await profileApi('valid', 'PATCH', { version: 1, displayName: 'Stale' })).status, 409);
    assert.equal((await profileApi('valid', 'PATCH', { version: 2, birthDate: '2099-01-01' })).status, 400);
    assert.equal((await profileApi('valid', 'PATCH', { version: 2, activityLevel: 'extreme' })).status, 400);
    assert.equal((await profileApi('valid', 'PATCH', { version: 2, timeZone: 'Mars/Nowhere' })).status, 400);
    assert.equal((await profileApi('valid', 'PATCH', { version: 2, preferredUnits: { weight: 'stones' } })).status, 400);
    assert.equal((await profileApi('valid', 'PATCH', { version: 2, birthDate: '2000-01-01', birthYear: 2001 })).status, 400);
    assert.equal((await profileApi('valid', 'PATCH', { version: 2, heightCm: 260, warningConfirmed: true, role: 'admin' })).status, 400);
    assert.equal((await profileApi('valid', 'PATCH', { version: 2, userId: 'owner-456', displayName: 'Other' })).status, 400);
    const confirmedHeight = await profileApi('valid', 'PATCH', { version: 2, heightCm: 260, warningConfirmed: true });
    assert.equal(confirmedHeight.status, 200);
    assert.equal((await confirmedHeight.json()).heightCm, 260);
    compositeIndexUnavailable = true;
    const savedWithoutIndex = await profileApi('valid', 'PATCH', { version: 3, displayName: 'Saved without index' });
    assert.equal(savedWithoutIndex.status, 200);
    assert.equal((await savedWithoutIndex.json()).displayName, 'Saved without index');

    docs.set('users/owner-456', { uid: 'owner-456', status: 'active', role: 'user' });
    docs.set('users/owner-456/profiles/main', { displayName: 'Private', timeZone: 'UTC', version: 1 });
    const otherProfile = await profileApi('other');
    assert.equal((await otherProfile.json()).uid, 'owner-456');
    const ownProfileDespiteQuery = await fetch(`http://127.0.0.1:${address.port}/me/profile?uid=owner-456`, {
      headers: { Authorization: 'Bearer valid' },
    });
    assert.equal((await ownProfileDespiteQuery.json()).uid, 'owner-123');

    const newWeight = {
      entryId: 'latest-weight',
      weightKg: 70,
      measuredAt: '2025-06-01T10:00:00.000Z',
      timeZone: 'Asia/Ho_Chi_Minh',
    };
    assert.equal((await weightApi('valid', { ...newWeight, weightKg: 0 })).status, 400);
    assert.equal((await weightApi('valid', { ...newWeight, weightKg: 310 })).status, 400);
    assert.equal((await weightApi('valid', { ...newWeight, entryId: 'future-weight', measuredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })).status, 400);
    assert.equal((await weightApi('valid', newWeight)).status, 201);
    assert.equal((await weightApi('valid', newWeight)).status, 200);
    assert.equal((await weightApi('other', { ...newWeight, entryId: 'private-weight' })).status, 201);
    assert.equal(docs.get('users/owner-456/weightLogs/private-weight')?.userId, 'owner-456');
    assert.equal((await weightApi('valid', { ...newWeight, entryId: 'older-weight', weightKg: 68, measuredAt: '2024-06-01T10:00:00.000Z' })).status, 201);
    docs.set('users/owner-123/weightLogs/unreviewed-weight', {
      entryId: 'unreviewed-weight',
      weightKg: 99,
      measuredAt: Timestamp.fromDate(new Date('2026-01-01T10:00:00.000Z')),
      updatedAt: Timestamp.fromDate(new Date('2026-01-01T10:00:00.000Z')),
      validationStatus: 'needs_review',
    });
    const withWeight = await profileApi('valid');
    assert.equal((await withWeight.json()).currentWeightKg, 70);
    assert.equal((await me('other')).status, 200);
    docs.get(profilePath)!.displayName = 'Minh';
    assert.equal((await (await me('valid')).json()).displayName, 'Minh');
    for (const status of ['deleting', 'disabled']) {
      docs.get(userPath)!.status = status;
      const denied = await me('valid');
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).code, status === 'deleting' ? 'ACCOUNT_DELETING' : 'ACCOUNT_DISABLED');
      assert.equal((await request('valid')).status, 403);
      assert.equal((await profileApi('valid')).status, 403);
      assert.equal((await profileApi('valid', 'PATCH', { version: 3, displayName: 'Huy' })).status, 403);
      assert.equal((await weightApi('valid', { ...newWeight, entryId: `blocked-${status}` })).status, 403);
    }
    assert.equal(writes, 10);
    unavailable = true;
    assert.equal((await me('valid')).status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
