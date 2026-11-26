import { Router } from 'express';
import type { Auth } from 'firebase-admin/auth';
import {
  FieldValue,
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';
import { verifyAccount, type AccountHandler } from '../middlewares/verifyAccount';
import {
  compareWeightLogs,
  getLatestWeightKgInTransaction,
  getWeightLogReference,
  weightLogIsValid,
  weightLogLocalDate,
  weightLogResponse,
  type WeightLog,
} from '../services/weightHistory';

const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const entryIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

type WeightInput = {
  weightKg?: number;
  measuredAt?: Date;
  timeZone?: string;
  warningConfirmed?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDate(value: string) {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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

function localDate(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseMeasuredAt(value: unknown) {
  if (typeof value !== 'string' || !dateTimePattern.test(value)
      || !validDate(value.slice(0, 10))) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 5 * 60 * 1000) return null;
  return date;
}

function validateInput(input: unknown, mode: 'create' | 'update') {
  if (!isRecord(input)) return { errors: { form: 'INVALID_BODY' }, input: null };
  const allowed = mode === 'create'
    ? new Set(['entryId', 'weightKg', 'measuredAt', 'timeZone', 'warningConfirmed'])
    : new Set(['version', 'weightKg', 'measuredAt', 'timeZone', 'warningConfirmed']);
  const errors: Record<string, string> = {};
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors[key] = 'FIELD_NOT_ALLOWED';
  }

  if (mode === 'create'
      && (typeof input.entryId !== 'string' || !entryIdPattern.test(input.entryId))) {
    errors.entryId = 'INVALID_ENTRY_ID';
  }
  if (mode === 'update'
      && (!Number.isSafeInteger(input.version) || (input.version as number) < 1)) {
    errors.version = 'INVALID_VERSION';
  }
  if (mode === 'create' || 'weightKg' in input) {
    if (typeof input.weightKg !== 'number' || !Number.isFinite(input.weightKg) || input.weightKg <= 0) {
      errors.weightKg = 'INVALID_WEIGHT';
    } else if ((input.weightKg < 20 || input.weightKg > 300)
        && input.warningConfirmed !== true) {
      errors.weightKg = 'WARNING_CONFIRMATION_REQUIRED';
    }
  }
  let measuredAt: Date | undefined;
  if (mode === 'create' || 'measuredAt' in input) {
    const parsed = parseMeasuredAt(input.measuredAt);
    if (!parsed) errors.measuredAt = 'INVALID_MEASURED_AT';
    else measuredAt = parsed;
  }
  if (mode === 'create' || 'timeZone' in input) {
    if (!validTimeZone(input.timeZone)) errors.timeZone = 'INVALID_TIME_ZONE';
  }
  if ('warningConfirmed' in input && typeof input.warningConfirmed !== 'boolean') {
    errors.warningConfirmed = 'INVALID_WARNING_CONFIRMATION';
  }
  const updateFields = ['weightKg', 'measuredAt', 'timeZone', 'warningConfirmed'];
  if (mode === 'update' && !updateFields.some(key => key in input)) {
    errors.form = 'EMPTY_UPDATE';
  }
  if (Object.keys(errors).length > 0) return { errors, input: null };

  return {
    errors,
    input: {
      ...(mode === 'create' ? { entryId: input.entryId as string } : {}),
      ...(mode === 'update' ? { version: input.version as number } : {}),
      ...(mode === 'create' || 'weightKg' in input ? { weightKg: input.weightKg as number } : {}),
      ...(measuredAt ? { measuredAt } : {}),
      ...(mode === 'create' || 'timeZone' in input ? { timeZone: input.timeZone as string } : {}),
      ...(mode === 'create' || 'warningConfirmed' in input
        ? { warningConfirmed: input.warningConfirmed === true } : {}),
    } as WeightInput & { entryId?: string; version?: number },
  };
}

function accessError(status: unknown) {
  if (status === 'active') return null;
  return status === 'deleting' ? 'ACCOUNT_DELETING' : 'ACCOUNT_DISABLED';
}

function logFailure(operation: string, error: unknown) {
  const code = isRecord(error) && 'code' in error ? String(error.code) : 'UNKNOWN';
  console.error(`[weights] ${operation} failed (${code})`);
}

function serializeWeight(snapshot: FirebaseFirestore.DocumentSnapshot, fallbackTimeZone?: unknown) {
  return weightLogResponse(snapshot.data() as Record<string, unknown>, snapshot.id, fallbackTimeZone);
}

export function weightsRouter(auth: Pick<Auth, 'verifyIdToken'>, db: Firestore) {
  const router = Router();
  const verify = verifyAccount(auth);

  const listWeights: AccountHandler = async (req, res) => {
    const queryParams = isRecord(req.query) ? req.query : {};
    const rawLimit = queryParams.limit;
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: { limit: 'INVALID_LIMIT' } });
      return;
    }
    const rawCursor = queryParams.cursor;
    if (rawCursor !== undefined
        && (typeof rawCursor !== 'string' || !entryIdPattern.test(rawCursor))) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: { cursor: 'INVALID_CURSOR' } });
      return;
    }
    const rawDate = queryParams.date;
    if (rawDate !== undefined
        && (typeof rawDate !== 'string' || !validDate(rawDate))) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: { date: 'INVALID_DATE' } });
      return;
    }

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

      const weights = await userRef.collection('weightLogs').orderBy('measuredAt', 'desc').get();
      const timeZone = profile.get('timeZone');
      const records: WeightLog[] = weights.docs
        .map(document => ({ id: document.id, data: document.data() }))
        .filter(log => weightLogIsValid(log.data)
          && (typeof rawDate !== 'string' || weightLogLocalDate(log.data, timeZone) === rawDate))
        .sort(compareWeightLogs);
      let start = 0;
      if (typeof rawCursor === 'string') {
        const cursorIndex = records.findIndex(log => log.id === rawCursor || log.data.entryId === rawCursor);
        if (cursorIndex === -1) {
          res.status(400).json({ code: 'VALIDATION_ERROR', fields: { cursor: 'INVALID_CURSOR' } });
          return;
        }
        start = cursorIndex + 1;
      }
      const found = records.slice(start, start + limit + 1);
      const hasMore = found.length > limit;
      const page = hasMore ? found.slice(0, limit) : found;
      res.json({
        items: page.map(log => weightLogResponse(log.data, log.id, timeZone)),
        nextCursor: hasMore ? page[page.length - 1].id : null,
      });
    } catch (error) {
      logFailure('list', error);
      res.status(503).json({ code: 'WEIGHTS_UNAVAILABLE' });
    }
  };
  router.get('/me/weights', verify, listWeights);

  const createWeight: AccountHandler = async (req, res) => {
    const { errors, input } = validateInput(req.body, 'create');
    if (!input || !input.entryId) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: errors });
      return;
    }

    const { uid } = res.locals.identity;
    const userRef = db.collection('users').doc(uid);
    const profileRef = userRef.collection('profiles').doc('main');
    const weightRef = getWeightLogReference(db, uid, input.entryId);
    const measuredAt = input.measuredAt!;
    const now = Timestamp.now();
    const record = {
      entryId: input.entryId,
      userId: uid,
      weightKg: input.weightKg!,
      measuredAt: Timestamp.fromDate(measuredAt),
      timeZone: input.timeZone!,
      localDate: localDate(measuredAt, input.timeZone!),
      warningConfirmed: input.warningConfirmed === true,
      validationStatus: 'valid',
      version: 1,
      source: 'manual',
      createdAt: now,
      updatedAt: now,
    };

    try {
      const result = await db.runTransaction(async transaction => {
        const [account, profile, existing] = await Promise.all([
          transaction.get(userRef),
          transaction.get(profileRef),
          transaction.get(weightRef),
        ]);
        const denied = account.exists && accessError(account.get('status'));
        if (denied) return { status: denied };
        if (!account.exists || !profile.exists) return { status: 'ACCOUNT_NOT_INITIALIZED' };
        if (existing.exists) {
          const same = existing.get('weightKg') === record.weightKg
            && existing.get('measuredAt') instanceof Timestamp
            && existing.get('measuredAt').toMillis() === record.measuredAt.toMillis()
            && existing.get('timeZone') === record.timeZone
            && (existing.get('warningConfirmed') === true) === record.warningConfirmed;
          if (!same) return { status: 'ENTRY_ID_CONFLICT' };
          const currentWeightKg = await getLatestWeightKgInTransaction(transaction, userRef);
          if (profile.get('currentWeightKg') !== currentWeightKg) {
            transaction.update(profileRef, {
              currentWeightKg,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
          return { status: 'existing' };
        }
        const currentWeightKg = await getLatestWeightKgInTransaction(transaction, userRef, undefined, record);
        transaction.create(weightRef, record);
        transaction.update(profileRef, {
          currentWeightKg,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { status: 'created' };
      });
      if (result.status === 'ENTRY_ID_CONFLICT') {
        res.status(409).json({ code: result.status });
        return;
      }
      if (result.status !== 'created' && result.status !== 'existing') {
        const denied = accessError(result.status);
        res.status(denied ? 403 : 404).json({ code: denied ?? result.status });
        return;
      }
      res.status(result.status === 'created' ? 201 : 200).json(weightLogResponse(record));
    } catch (error) {
      logFailure('create', error);
      res.status(503).json({ code: 'WEIGHTS_UNAVAILABLE' });
    }
  };
  router.post('/me/weights', verify, createWeight);

  const readWeight: AccountHandler = async (req, res) => {
    if (!entryIdPattern.test(req.params.entryId)) {
      res.status(400).json({ code: 'INVALID_ENTRY_ID' });
      return;
    }
    const { uid } = res.locals.identity;
    const userRef = db.collection('users').doc(uid);
    const weightRef = getWeightLogReference(db, uid, req.params.entryId);
    try {
      const [account, profile, weight] = await db.getAll(
        userRef,
        userRef.collection('profiles').doc('main'),
        weightRef,
      );
      const denied = account.exists && accessError(account.get('status'));
      if (denied) {
        res.status(403).json({ code: denied });
        return;
      }
      if (!account.exists || !profile.exists) {
        res.status(404).json({ code: 'ACCOUNT_NOT_INITIALIZED' });
        return;
      }
      if (!weight.exists) {
        res.status(404).json({ code: 'ENTRY_NOT_FOUND' });
        return;
      }
      res.json(serializeWeight(weight, profile.get('timeZone')));
    } catch (error) {
      logFailure('read', error);
      res.status(503).json({ code: 'WEIGHTS_UNAVAILABLE' });
    }
  };
  router.get('/me/weights/:entryId', verify, readWeight);

  const updateWeight: AccountHandler = async (req, res) => {
    const { entryId } = req.params;
    if (!entryIdPattern.test(entryId)) {
      res.status(400).json({ code: 'INVALID_ENTRY_ID' });
      return;
    }
    const { errors, input } = validateInput(req.body, 'update');
    if (!input || input.version === undefined) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: errors });
      return;
    }
    const expectedVersion = input.version;
    const { uid } = res.locals.identity;
    const userRef = db.collection('users').doc(uid);
    const profileRef = userRef.collection('profiles').doc('main');
    const weightRef = getWeightLogReference(db, uid, entryId);
    const now = Timestamp.now();
    try {
      const result = await db.runTransaction(async transaction => {
        const [account, profile, existing] = await Promise.all([
          transaction.get(userRef),
          transaction.get(profileRef),
          transaction.get(weightRef),
        ]);
        const denied = account.exists && accessError(account.get('status'));
        if (denied) return { status: denied };
        if (!account.exists || !profile.exists) return { status: 'ACCOUNT_NOT_INITIALIZED' };
        if (!existing.exists) return { status: 'ENTRY_NOT_FOUND' };
        const current = existing.data() as Record<string, unknown>;
        const currentVersion = Number.isSafeInteger(current.version) && (current.version as number) >= 1
          ? current.version as number
          : 1;
        if (currentVersion !== expectedVersion) return { status: 'VERSION_CONFLICT' };
        const weightKg = input.weightKg ?? current.weightKg;
        const warningConfirmed = input.warningConfirmed ?? current.warningConfirmed === true;
        if ((typeof weightKg !== 'number' || weightKg < 20 || weightKg > 300) && !warningConfirmed) {
          return { status: 'VALIDATION_ERROR', fields: { weightKg: 'WARNING_CONFIRMATION_REQUIRED' } };
        }
        const measuredAt = input.measuredAt ?? (current.measuredAt as Timestamp).toDate();
        const timeZone = input.timeZone ?? String(current.timeZone ?? profile.get('timeZone') ?? 'Asia/Ho_Chi_Minh');
        const next = {
          ...current,
          ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
          measuredAt: Timestamp.fromDate(measuredAt),
          timeZone,
          localDate: localDate(measuredAt, timeZone),
          warningConfirmed,
          version: expectedVersion + 1,
          entryId,
          validationStatus: current.validationStatus ?? 'valid',
          updatedAt: now,
        };
        const currentWeightKg = await getLatestWeightKgInTransaction(
          transaction,
          userRef,
          entryId,
          next,
        );
        transaction.update(weightRef, {
          weightKg: next.weightKg,
          measuredAt: next.measuredAt,
          timeZone: next.timeZone,
          localDate: next.localDate,
          warningConfirmed: next.warningConfirmed,
          version: next.version,
          updatedAt: next.updatedAt,
        });
        transaction.update(profileRef, {
          currentWeightKg,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { status: 'updated', next };
      });
      if (result.status === 'VERSION_CONFLICT') {
        res.status(409).json({ code: result.status });
        return;
      }
      if (result.status === 'VALIDATION_ERROR') {
        res.status(400).json({ code: result.status, fields: result.fields });
        return;
      }
      if (result.status !== 'updated' || !result.next) {
        const denied = accessError(result.status);
        res.status(denied ? 403 : 404).json({ code: denied ?? result.status });
        return;
      }
      res.json(weightLogResponse(result.next, entryId));
    } catch (error) {
      logFailure('update', error);
      res.status(503).json({ code: 'WEIGHTS_UNAVAILABLE' });
    }
  };
  router.patch('/me/weights/:entryId', verify, updateWeight);

  const deleteWeight: AccountHandler = async (req, res) => {
    const { entryId } = req.params;
    if (!entryIdPattern.test(entryId)) {
      res.status(400).json({ code: 'INVALID_ENTRY_ID' });
      return;
    }
    const queryParams = isRecord(req.query) ? req.query : {};
    const rawVersion = queryParams.version;
    const version = typeof rawVersion === 'string' ? Number(rawVersion) : Number.NaN;
    if (!Number.isSafeInteger(version) || version < 1) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: { version: 'INVALID_VERSION' } });
      return;
    }

    const { uid } = res.locals.identity;
    const userRef = db.collection('users').doc(uid);
    const profileRef = userRef.collection('profiles').doc('main');
    const weightRef = getWeightLogReference(db, uid, entryId);
    try {
      const result = await db.runTransaction(async transaction => {
        const [account, profile, existing] = await Promise.all([
          transaction.get(userRef),
          transaction.get(profileRef),
          transaction.get(weightRef),
        ]);
        const denied = account.exists && accessError(account.get('status'));
        if (denied) return { status: denied };
        if (!account.exists || !profile.exists) return { status: 'ACCOUNT_NOT_INITIALIZED' };
        if (!existing.exists) return { status: 'ENTRY_NOT_FOUND' };
        const currentVersion = existing.get('version');
        const storedVersion = Number.isSafeInteger(currentVersion) && (currentVersion as number) >= 1
          ? currentVersion
          : 1;
        if (storedVersion !== version) return { status: 'VERSION_CONFLICT' };
        const currentWeightKg = await getLatestWeightKgInTransaction(transaction, userRef, entryId);
        transaction.delete(weightRef);
        transaction.update(profileRef, {
          currentWeightKg,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { status: 'deleted' };
      });
      if (result.status === 'VERSION_CONFLICT') {
        res.status(409).json({ code: result.status });
        return;
      }
      if (result.status !== 'deleted') {
        const denied = accessError(result.status);
        res.status(denied ? 403 : 404).json({ code: denied ?? result.status });
        return;
      }
      res.status(204).end();
    } catch (error) {
      logFailure('delete', error);
      res.status(503).json({ code: 'WEIGHTS_UNAVAILABLE' });
    }
  };
  router.delete('/me/weights/:entryId', verify, deleteWeight);

  return router;
}
