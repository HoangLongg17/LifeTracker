import { Router, type RequestHandler } from 'express';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

type AccountHandler = RequestHandler<Record<string, never>, unknown, unknown, unknown, { identity: DecodedIdToken }>;

function verifyAccount(auth: Pick<Auth, 'verifyIdToken'>): AccountHandler {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const bearer = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '');
    if (!bearer) {
      res.status(401).json({ code: 'TOKEN_INVALID' });
      return;
    }
    let identity: DecodedIdToken;
    try {
      identity = await auth.verifyIdToken(bearer[1], true);
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === 'auth/user-disabled') {
        res.status(403).json({ code: 'ACCOUNT_DISABLED' });
      } else if (code === 'auth/id-token-expired') {
        res.status(401).json({ code: 'TOKEN_EXPIRED' });
      } else if (code === 'auth/id-token-revoked') {
        res.status(401).json({ code: 'TOKEN_REVOKED' });
      } else if (code === 'auth/argument-error' || code === 'auth/invalid-id-token' || code === 'auth/user-not-found') {
        res.status(401).json({ code: 'TOKEN_INVALID' });
      } else {
        res.status(503).json({ code: 'AUTH_UNAVAILABLE' });
      }
      return;
    }
    if (!identity.email || identity.firebase.sign_in_provider !== 'password') {
      res.status(403).json({ code: 'EMAIL_ACCOUNT_REQUIRED' });
      return;
    }
    res.locals.identity = identity;
    next();
  };
}

function accessError(status: unknown) {
  if (status === 'active') return null;
  return status === 'deleting' ? 'ACCOUNT_DELETING' : 'ACCOUNT_DISABLED';
}

export function profileRouter(auth: Pick<Auth, 'verifyIdToken'>, db: Firestore) {
  const router = Router();
  const verify = verifyAccount(auth);

  const getAccount: AccountHandler = async (_req, res) => {
    const { uid } = res.locals.identity;
    const ref = db.collection('users').doc(uid);
    try {
      const [account, profile] = await db.getAll(ref, ref.collection('profiles').doc('main'));
      const denied = account.exists && accessError(account.get('status'));
      if (denied) {
        res.status(403).json({ code: denied });
        return;
      }
      if (!account.exists || !profile.exists) {
        res.status(404).json({ code: 'ACCOUNT_NOT_INITIALIZED' });
        return;
      }
      res.json({
        uid,
        role: account.get('role'),
        status: 'active',
        ready: true,
        displayName: profile.get('displayName') || null,
      });
    } catch {
      res.status(503).json({ code: 'PROFILE_UNAVAILABLE' });
    }
  };
  router.get('/me', verify, getAccount);

  const bootstrap: AccountHandler = async (_req, res) => {
    const { uid } = res.locals.identity;
    try {
      const ref = db.collection('users').doc(uid);
      const profileRef = ref.collection('profiles').doc('main');
      const result = await db.runTransaction(async (transaction) => {
        // Read before writing so retries can repair a partial account without resetting it.
        const existing = await transaction.get(ref);
        const denied = existing.exists && accessError(existing.get('status'));
        if (denied) return { denied };
        const profile = await transaction.get(profileRef);
        const timestamp = FieldValue.serverTimestamp();
        if (!existing.exists) {
          transaction.create(ref, {
            uid,
            role: 'user',
            status: 'active',
            dataRevision: 0,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
        if (!profile.exists) {
          transaction.create(profileRef, {
            displayName: '',
            birthYear: null,
            heightCm: null,
            notificationSettings: {
              enabled: false,
              observedDevicePermission: 'not_checked',
            },
            timeZone: 'Asia/Ho_Chi_Minh',
            updatedAt: timestamp,
            version: 1,
          });
        }
        return { created: !existing.exists || !profile.exists };
      });
      if (result.denied) {
        res.status(403).json({ code: result.denied });
        return;
      }
      res.status(result.created ? 201 : 200).json({ uid, ready: true });
    } catch {
      res.status(503).json({ code: 'PROFILE_UNAVAILABLE' });
    }
  };
  router.post(['/users/bootstrap', '/me/bootstrap'], verify, bootstrap);
  return router;
}
