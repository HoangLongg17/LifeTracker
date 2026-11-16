import { Router } from 'express';
import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

// No client UID/email/password is accepted: identity comes from the verified token.
export function profileRouter(auth: Pick<Auth, 'verifyIdToken'>, db: Firestore) {
  const router = Router();
  router.post('/bootstrap', async (req, res) => {
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match) {
      res.status(401).json({ code: 'UNAUTHORIZED' });
      return;
    }
    let identity;
    try {
      identity = await auth.verifyIdToken(match[1], true);
    } catch {
      res.status(401).json({ code: 'UNAUTHORIZED' });
      return;
    }
    if (!identity.email || identity.firebase.sign_in_provider !== 'password') {
      res.status(403).json({ code: 'EMAIL_ACCOUNT_REQUIRED' });
      return;
    }
    try {
      const ref = db.collection('users').doc(identity.uid);
      const profileRef = ref.collection('profiles').doc('main');
      const created = await db.runTransaction(async (transaction) => {
        // Read both documents before writing. Create only missing documents so a
        // retry (including an old user without a profile) never resets user data.
        const existing = await transaction.get(ref);
        const profile = await transaction.get(profileRef);
        const timestamp = FieldValue.serverTimestamp();
        if (!existing.exists) {
          transaction.create(ref, {
            uid: identity.uid,
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
        return !existing.exists || !profile.exists;
      });
      res.status(created ? 201 : 200).json({ uid: identity.uid, ready: true });
    } catch {
      res.status(503).json({ code: 'PROFILE_UNAVAILABLE' });
    }
  });
  return router;
}
