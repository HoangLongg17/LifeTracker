import { Router } from 'express';
import type { Auth } from 'firebase-admin/auth';
import {
  verifyAccount,
  type AccountHandler
} from '../middlewares/verifyAccount';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getLatestWeightKg } from '../services/weightHistory';
type ProfileData = {
  displayName?: string;
  birthDate?: string | null;
  birthYear?: number | null;
  heightCm?: number | null;
  activityLevel?: string | null;
  preferredUnits?: { weight?: string; height?: string; water?: string };
  timeZone?: string;
  version?: number;
};

const defaultUnits = { weight: 'kg', height: 'cm', water: 'mL' };
const activityLevels = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validCalendarDate(value: string) {
  if (!isoDatePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validDate(value: string) {
  return validCalendarDate(value) && new Date(`${value}T00:00:00.000Z`).getTime() <= Date.now();
}

function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function profileResponse(uid: string, data: ProfileData, currentWeightKg: number | null) {
  return {
    uid,
    version: data.version ?? 1,
    displayName: data.displayName ?? '',
    birthDate: data.birthDate ?? null,
    birthYear: data.birthYear ?? null,
    heightCm: data.heightCm ?? null,
    currentWeightKg,
    activityLevel: data.activityLevel ?? null,
    preferredUnits: { ...defaultUnits, ...data.preferredUnits },
    timeZone: data.timeZone ?? 'Asia/Ho_Chi_Minh',
  };
}

function validateProfilePatch(input: unknown) {
  const errors: Record<string, string> = {};
  if (!isRecord(input)) return { errors: { form: 'INVALID_BODY' }, patch: null };
  const allowed = new Set([
    'version', 'displayName', 'birthDate', 'birthYear', 'heightCm',
    'activityLevel', 'preferredUnits', 'timeZone', 'warningConfirmed',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors[key] = 'FIELD_NOT_ALLOWED';
  }
  if (!Number.isSafeInteger(input.version) || (input.version as number) < 1) {
    errors.version = 'INVALID_VERSION';
  }
  const fields = Object.keys(input).filter(key => key !== 'version' && key !== 'warningConfirmed');
  if (fields.length === 0) errors.form = 'NO_PROFILE_FIELDS';

  if ('displayName' in input) {
    const name = input.displayName;
    const length = typeof name === 'string' ? Array.from(name.trim()).length : 0;
    if (typeof name !== 'string' || length < 1 || length > 100) {
      errors.displayName = 'INVALID_DISPLAY_NAME';
    }
  }
  if ('birthDate' in input && input.birthDate !== null
      && (typeof input.birthDate !== 'string' || !validDate(input.birthDate))) {
    errors.birthDate = 'INVALID_BIRTH_DATE';
  }
  if ('birthYear' in input && input.birthYear !== null
      && (typeof input.birthYear !== 'number' || !Number.isInteger(input.birthYear)
        || input.birthYear < 1 || input.birthYear > new Date().getFullYear())) {
    errors.birthYear = 'INVALID_BIRTH_YEAR';
  }
  if ('heightCm' in input && input.heightCm !== null
      && (typeof input.heightCm !== 'number' || !Number.isFinite(input.heightCm) || input.heightCm <= 0)) {
    errors.heightCm = 'INVALID_HEIGHT';
  } else if ('heightCm' in input && typeof input.heightCm === 'number'
      && (input.heightCm < 50 || input.heightCm > 250)
      && input.warningConfirmed !== true) {
    errors.heightCm = 'WARNING_CONFIRMATION_REQUIRED';
  }
  if ('warningConfirmed' in input && typeof input.warningConfirmed !== 'boolean') {
    errors.warningConfirmed = 'INVALID_WARNING_CONFIRMATION';
  }
  if ('activityLevel' in input && input.activityLevel !== null
      && (typeof input.activityLevel !== 'string' || !activityLevels.includes(input.activityLevel))) {
    errors.activityLevel = 'INVALID_ACTIVITY_LEVEL';
  }
  if ('timeZone' in input && !validTimeZone(input.timeZone)) errors.timeZone = 'INVALID_TIME_ZONE';
  if ('preferredUnits' in input) {
    const units = input.preferredUnits;
    const allowedUnits = { weight: ['kg', 'lb'], height: ['cm', 'in'], water: ['mL', 'L'] };
    if (!isRecord(units) || Object.keys(units).length === 0) {
      errors.preferredUnits = 'INVALID_UNITS';
    } else {
      for (const [key, value] of Object.entries(units)) {
        if (!(key in allowedUnits)
            || !allowedUnits[key as keyof typeof allowedUnits].includes(value as string)) {
          errors[`preferredUnits.${key}`] = 'INVALID_UNIT';
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) return { errors, patch: null };
  return { errors, patch: input as unknown as ProfileData & { warningConfirmed?: boolean } };
}
function accessError(status: unknown) {
  if (status === 'active') return null;
  return status === 'deleting' ? 'ACCOUNT_DELETING' : 'ACCOUNT_DISABLED';
}

function logStorageFailure(operation: string, error: unknown) {
  const code = isRecord(error) && 'code' in error ? String(error.code) : 'UNKNOWN';
  console.error(`[profile] ${operation} failed (${code})`);
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
    } catch (error) {
      logStorageFailure('account-read', error);
      res.status(503).json({ code: 'PROFILE_UNAVAILABLE' });
    }
  };
  router.get('/me', verify, getAccount);

  const getProfile: AccountHandler = async (_req, res) => {
    const { uid } = res.locals.identity;
    const userRef = db.collection('users').doc(uid);
    const profileRef = userRef.collection('profiles').doc('main');
    try {
      const [account, profile] = await db.getAll(userRef, profileRef);
      const denied = account.exists && accessError(account.get('status'));
      if (denied) {
        res.status(403).json({ code: denied });
        return;
      }
      if (!account.exists || !profile.exists) {
        res.status(404).json({ code: 'ACCOUNT_NOT_INITIALIZED' });
        return;
      }
      res.json(profileResponse(uid, profile.data() as ProfileData, await getLatestWeightKg(userRef)));
    } catch (error) {
      logStorageFailure('profile-read', error);
      res.status(503).json({ code: 'PROFILE_UNAVAILABLE' });
    }
  };
  router.get('/me/profile', verify, getProfile);

  const updateProfile: AccountHandler = async (req, res) => {
    const { errors, patch } = validateProfilePatch(req.body);
    if (!patch) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: errors });
      return;
    }

    const { uid } = res.locals.identity;
    const userRef = db.collection('users').doc(uid);
    const profileRef = userRef.collection('profiles').doc('main');
    try {
      const result = await db.runTransaction(async transaction => {
        const account = await transaction.get(userRef);
        const denied = account.exists && accessError(account.get('status'));
        if (denied) return { status: denied };
        const profile = await transaction.get(profileRef);
        if (!account.exists || !profile.exists) return { status: 'ACCOUNT_NOT_INITIALIZED' };

        const current = profile.data() as ProfileData;
        if (current.version !== patch.version) return { status: 'PROFILE_VERSION_CONFLICT' };
        if (patch.birthDate && patch.birthYear
            && Number(patch.birthDate.slice(0, 4)) !== patch.birthYear) {
          return { status: 'VALIDATION_ERROR', fields: { birthDate: 'BIRTH_YEAR_MISMATCH' } };
        }

        const changes: Record<string, unknown> = {};
        const next: ProfileData = { ...current };
        for (const key of ['displayName', 'birthDate', 'birthYear', 'heightCm', 'activityLevel', 'timeZone'] as const) {
          if (key in patch) {
            const value = patch[key];
            changes[key] = key === 'displayName' && typeof value === 'string' ? value.trim() : value;
            Object.assign(next, { [key]: changes[key] });
          }
        }
        if (patch.birthDate && !('birthYear' in patch)) {
          changes.birthYear = null;
          next.birthYear = null;
        } else if (patch.birthYear && !('birthDate' in patch)) {
          changes.birthDate = null;
          next.birthDate = null;
        }
        if (patch.preferredUnits) {
          const units = { ...defaultUnits, ...current.preferredUnits, ...patch.preferredUnits };
          changes.preferredUnits = units;
          next.preferredUnits = units;
        }
        next.version = (current.version ?? 1) + 1;
        changes.version = next.version;
        changes.updatedAt = FieldValue.serverTimestamp();
        transaction.update(profileRef, changes);
        return { status: 'updated', profile: next };
      });

      if (result.status === 'PROFILE_VERSION_CONFLICT') {
        res.status(409).json({ code: result.status });
        return;
      }
      if (result.status === 'VALIDATION_ERROR') {
        res.status(400).json({ code: result.status, fields: result.fields });
        return;
      }
      const updatedProfile = result.status === 'updated' ? result.profile : undefined;
      if (!updatedProfile) {
        const denied = accessError(result.status);
        res.status(denied ? 403 : 404).json({ code: denied ?? result.status });
        return;
      }
      res.json(profileResponse(uid, updatedProfile, await getLatestWeightKg(userRef)));
    } catch (error) {
      logStorageFailure('profile-update', error);
      res.status(503).json({ code: 'PROFILE_UNAVAILABLE' });
    }
  };
  router.patch('/me/profile', verify, updateProfile);

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
            currentWeightKg: null,
            notificationSettings: {
              enabled: false,
            },
            preferredUnits: defaultUnits,
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
