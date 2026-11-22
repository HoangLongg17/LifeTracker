
import { Router, type Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import {
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';

import { verifyAccount } from '../middlewares/verifyAccount';
import {
  accessError,
  getLogDocument,
  isRecord,
  validEntryId,
  validTimeZone,
} from '../services/logCommon';
import { createLog } from '../services/logCreate';
import { updateLog } from '../services/logUpdate';
import { deleteLog } from '../services/logDelete';

const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

type ParsedBody = {
  ok: true;
  fields: Record<string, unknown>;
  entryId?: string;
  version?: number;
  eventAt?: Date;
  timeZone?: string;
};

type InvalidBody = {
  ok: false;
  errors: Record<string, string>;
};

function parseDateTime(value: unknown): Date | null {
  if (
    typeof value !== 'string' ||
    !dateTimePattern.test(value)
  ) {
    return null;
  }

  const date = new Date(value);

  return Number.isFinite(date.getTime())
    ? date
    : null;
}

function validateWaterBody(
  input: unknown,
  mode: 'create' | 'update'
): ParsedBody | InvalidBody {
  const errors: Record<string, string> = {};

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: { form: 'INVALID_BODY' },
    };
  }

  const allowed = new Set(
    mode === 'create'
      ? ['entryId', 'loggedAt', 'timeZone', 'volumeMl', 'note']
      : ['version', 'loggedAt', 'timeZone', 'volumeMl', 'note']
  );

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      errors[key] = 'FIELD_NOT_ALLOWED';
    }
  }

  let entryId: string | undefined;
  let version: number | undefined;
  let eventAt: Date | undefined;
  let timeZone: string | undefined;

  const fields: Record<string, unknown> = {};

  if (mode === 'create') {
    if (!validEntryId(input.entryId)) {
      errors.entryId = 'INVALID_ENTRY_ID';
    } else {
      entryId = input.entryId;
    }
  } else {
    if (
      !Number.isSafeInteger(input.version) ||
      (input.version as number) < 1
    ) {
      errors.version = 'INVALID_VERSION';
    } else {
      version = input.version as number;
    }
  }

  if (mode === 'create' || 'loggedAt' in input) {
    const parsed = parseDateTime(input.loggedAt);

    if (!parsed) {
      errors.loggedAt = 'INVALID_LOGGED_AT';
    } else {
      eventAt = parsed;
    }
  }

  if (mode === 'create' || 'timeZone' in input) {
    if (!validTimeZone(input.timeZone)) {
      errors.timeZone = 'INVALID_TIME_ZONE';
    } else {
      timeZone = input.timeZone;
    }
  }

  if (mode === 'create' || 'volumeMl' in input) {
    if (
      typeof input.volumeMl !== 'number' ||
      !Number.isFinite(input.volumeMl) ||
      input.volumeMl <= 0
    ) {
      errors.volumeMl = 'INVALID_VOLUME';
    } else {
      fields.volumeMl = input.volumeMl;
    }
  }

  if ('note' in input) {
    if (
      typeof input.note !== 'string' ||
      input.note.length > 500
    ) {
      errors.note = 'INVALID_NOTE';
    } else {
      fields.note = input.note.trim();
    }
  }

  if (
    mode === 'update' &&
    Object.keys(fields).length === 0 &&
    !eventAt &&
    !timeZone
  ) {
    errors.form = 'EMPTY_UPDATE';
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    entryId,
    version,
    eventAt,
    timeZone,
    fields,
  };
}

function respondWithResult(
  res: Response,
  result: { status: string }
): void {
  const statusCodes: Record<string, number> = {
    created: 201,
    existing: 200,
    updated: 200,
    deleted: 200,
    ENTRY_ID_CONFLICT: 409,
    ENTRY_ALREADY_DELETED: 409,
    VERSION_CONFLICT: 409,
    ENTRY_NOT_FOUND: 404,
    ACCOUNT_NOT_INITIALIZED: 404,
    ACCOUNT_DELETING: 403,
    ACCOUNT_DISABLED: 403,
  };

  res.status(statusCodes[result.status] ?? 500).json(result);
}

function storageError(
  res: Response,
  operation: string,
  error: unknown
): void {
  console.error(`[logs] ${operation} failed`, {
    code:
      isRecord(error) && 'code' in error
        ? String(error.code)
        : 'UNKNOWN',
  });

  res.status(503).json({
    code: 'LOG_UNAVAILABLE',
  });
}

function serialize(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serialize);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'requestFingerprint')
        .map(([key, item]) => [key, serialize(item)])
    );
  }

  return value;
}

export function logsRouter(
  auth: Pick<Auth, 'verifyIdToken'>,
  db: Firestore
) {
  const router = Router();

  // Mọi endpoint phía dưới đều phải xác thực.
  router.use('/me/logs', verifyAccount(auth));

  // TẠO NHẬT KÝ NƯỚC
  router.post('/me/logs/water', async (req, res) => {
    const body = validateWaterBody(req.body, 'create');

    if (!body.ok) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        fields: body.errors,
      });
      return;
    }

    try {
      const result = await createLog({
        db,
        uid: res.locals.identity.uid,
        type: 'water',
        entryId: body.entryId!,
        eventAt: body.eventAt!,
        timeZone: body.timeZone!,
        fields: body.fields,
      });

      respondWithResult(res, result);
    } catch (error) {
      storageError(res, 'create', error);
    }
  });

  // ĐỌC MỘT NHẬT KÝ NƯỚC
  router.get('/me/logs/water/:entryId', async (req, res) => {
    const entryId = req.params.entryId;

    if (!validEntryId(entryId)) {
      res.status(400).json({ code: 'INVALID_ENTRY_ID' });
      return;
    }

    const uid = res.locals.identity.uid;
    const userRef = db.collection('users').doc(uid);
    const profileRef = userRef.collection('profiles').doc('main');
    const logRef = getLogDocument(db, uid, 'water', entryId);

    try {
      const [account, profile, log] = await db.getAll(
        userRef,
        profileRef,
        logRef
      );

      if (!account.exists || !profile.exists) {
        res.status(404).json({
          code: 'ACCOUNT_NOT_INITIALIZED',
        });
        return;
      }

      const denied = accessError(account.get('status'));

      if (denied) {
        res.status(403).json({ code: denied });
        return;
      }

      if (!log.exists) {
        res.status(404).json({ code: 'ENTRY_NOT_FOUND' });
        return;
      }

      res.json(serialize(log.data()));
    } catch (error) {
      storageError(res, 'read', error);
    }
  });

  // CẬP NHẬT NHẬT KÝ NƯỚC
  router.patch('/me/logs/water/:entryId', async (req, res) => {
    const entryId = req.params.entryId;

    if (!validEntryId(entryId)) {
      res.status(400).json({ code: 'INVALID_ENTRY_ID' });
      return;
    }

    const body = validateWaterBody(req.body, 'update');

    if (!body.ok) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        fields: body.errors,
      });
      return;
    }

    try {
      const result = await updateLog({
        db,
        uid: res.locals.identity.uid,
        type: 'water',
        entryId,
        expectedVersion: body.version!,
        eventAt: body.eventAt,
        timeZone: body.timeZone,
        fields: body.fields,
      });

      respondWithResult(res, result);
    } catch (error) {
      storageError(res, 'update', error);
    }
  });

  // XÓA NHẬT KÝ NƯỚC
  router.delete('/me/logs/water/:entryId', async (req, res) => {
    const entryId = req.params.entryId;

    if (!validEntryId(entryId)) {
      res.status(400).json({ code: 'INVALID_ENTRY_ID' });
      return;
    }

    if (
      !isRecord(req.body) ||
      Object.keys(req.body).some(key => key !== 'version') ||
      !Number.isSafeInteger(req.body.version) ||
      (req.body.version as number) < 1
    ) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        fields: { version: 'INVALID_VERSION' },
      });
      return;
    }

    try {
      const result = await deleteLog({
        db,
        uid: res.locals.identity.uid,
        type: 'water',
        entryId,
        expectedVersion: req.body.version as number,
      });

      respondWithResult(res, result);
    } catch (error) {
      storageError(res, 'delete', error);
    }
  });

  return router;
}
