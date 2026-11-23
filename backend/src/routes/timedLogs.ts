import { Router, type RequestHandler } from 'express';
import { AggregateField, FieldPath, Timestamp, type DocumentReference, type Firestore, type Query, type Transaction } from 'firebase-admin/firestore';
import { accessError, getLogCollection, isRecord, localDate, validDay, validEntryId } from '../services/logCommon';
import { createLog } from '../services/logCreate';
import { updateLog } from '../services/logUpdate';
import { deleteLog } from '../services/logDelete';
import { intervalChanges, type TimedLog } from '../services/sessionIntervals';
import { parseTimedLog, TimedLogInputError } from '../services/timedLogInput';
import { respondWithResult, serialize, storageError } from './logResponse';

class JournalReadError extends Error {
  constructor(readonly status: number, code: string) { super(code); }
}

async function readAccount(db: Firestore, uid: string, record?: DocumentReference) {
  const account = db.collection('users').doc(uid);
  const profile = account.collection('profiles').doc('main');
  const [owner, personal, entry] = await db.getAll(account, profile, ...(record ? [record] : []));
  if (!owner.exists || !personal.exists) throw new JournalReadError(404, 'ACCOUNT_NOT_INITIALIZED');
  const denial = accessError(owner.get('status'));
  if (denial) throw new JournalReadError(403, denial);
  if (record && !entry?.exists) throw new JournalReadError(404, 'ENTRY_NOT_FOUND');
  return { entry: entry?.data() };
}

async function dayTotals(tx: Transaction, query: Query) {
  try {
    return (await tx.get(query.aggregate({ total: AggregateField.sum('countedMinutes'), count: AggregateField.count() }))).data();
  } catch (error) {
    if (!(error instanceof Error) || !/requires an index|index.*building/i.test(error.message)) throw error;
    const rows = await tx.get(query.select('countedMinutes'));
    return { total: rows.docs.reduce((sum, doc) => sum + (doc.get('countedMinutes') ?? 0), 0), count: rows.size };
  }
}

function route(handler: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      if (err instanceof TimedLogInputError) {
        res.status(err.code === 'CONFIRM_LONG_SESSION' ? 422 : 400).json({ code: err.code, field: err.field });
      } else if (err instanceof JournalReadError) {
        res.status(err.status).json({ code: err.message });
      } else storageError(res, 'session', err);
    }
  };
}

function version(input: unknown): number {
  if (!isRecord(input) || !Number.isSafeInteger(input.version) || Number(input.version) < 1) {
    throw new TimedLogInputError('version', 'INVALID_VERSION');
  }
  return input.version as number;
}

// The parent router verifies the Firebase token for every /me/logs route.
export function timedLogRouter(type: TimedLog, db: Firestore) {
  const router = Router();
  router.param('id', (_req, res, next, id: string) => {
    if (validEntryId(id)) next();
    else res.status(400).json({ code: 'INVALID_ENTRY_ID' });
  });

  router.get('/', route(async (req, res) => {
    const { date, cursor } = req.query;
    if (!validDay(date)) throw new TimedLogInputError('date', 'INVALID_DATE');
    if (cursor !== undefined && !validEntryId(cursor)) throw new TimedLogInputError('cursor', 'INVALID_CURSOR');
    const uid = res.locals.identity.uid;
    await readAccount(db, uid);
    const all = getLogCollection(db, uid, type).where('localDate', '==', date);
    let page = all.orderBy(FieldPath.documentId());
    if (cursor) page = page.startAfter(cursor);
    const [rows, stats] = await db.runTransaction(async tx => Promise.all([
      tx.get(page.limit(51)), dayTotals(tx, all),
    ]), { readOnly: true });
    const documents = rows.docs.slice(0, 50);
    const { total, count } = stats;
    res.json({ dateKey: date, totalMinutes: count ? total : null, items: documents.map(doc => serialize(doc.data())),
      nextCursor: rows.size > documents.length ? documents[documents.length - 1].id : null });
  }));

  if (type === 'activity') router.post('/preview', route(async (req, res) => {
    if (!isRecord(req.body) || !validEntryId(req.body.entryId)) throw new TimedLogInputError('entryId', 'INVALID_ENTRY_ID');
    const uid = res.locals.identity.uid;
    await readAccount(db, uid);
    const { fields, eventAt, timeZone } = parseTimedLog(type, { ...req.body, warningConfirmed: true });
    const day = localDate(eventAt, timeZone);
    const collection = getLogCollection(db, uid, type);
    const ref = collection.doc(req.body.entryId);
    const totalMinutes = await db.runTransaction(async tx => {
      const [previous, stats] = await Promise.all([tx.get(ref), dayTotals(tx, collection.where('localDate', '==', day))]);
      const before = previous.data() ?? null;
      const after = { ...fields, localDate: day, startedAt: Timestamp.fromDate(eventAt) };
      const changes = await intervalChanges(tx, ref, type, before, after);
      const delta = changes.updates.filter(item => item.day === day).reduce((sum, item) => sum + item.delta, 0);
      return stats.total + (changes.current?.countedMinutes ?? 0) + delta - (before?.localDate === day ? before.countedMinutes : 0);
    }, { readOnly: true });
    res.json({ totalMinutes });
  }));

  router.get('/:id', route(async (req, res) => {
    const uid = res.locals.identity.uid;
    const ref = getLogCollection(db, uid, type).doc(req.params.id as string);
    const { entry } = await readAccount(db, uid, ref);
    res.json(serialize(entry));
  }));

  router.post('/', route(async (req, res) => {
    if (!isRecord(req.body) || !validEntryId(req.body.entryId)) throw new TimedLogInputError('entryId', 'INVALID_ENTRY_ID');
    const input = parseTimedLog(type, req.body);
    respondWithResult(res, await createLog({ db, uid: res.locals.identity.uid, type, entryId: req.body.entryId, ...input }));
  }));

  router.patch('/:id', route(async (req, res) => {
    const expectedVersion = version(req.body);
    const uid = res.locals.identity.uid;
    const entryId = req.params.id as string;
    const { entry } = await readAccount(db, uid, getLogCollection(db, uid, type).doc(entryId));
    if (entry!.version !== expectedVersion) throw new JournalReadError(409, 'VERSION_CONFLICT');
    const input = parseTimedLog(type, req.body, entry);
    respondWithResult(res, await updateLog({ db, uid, type, entryId, expectedVersion, ...input }));
  }));

  router.delete('/:id', route(async (req, res) => {
    const expectedVersion = version(req.body);
    if (Object.keys(req.body).some(key => key !== 'version')) throw new TimedLogInputError('form', 'FIELD_NOT_ALLOWED');
    respondWithResult(res, await deleteLog({ db, uid: res.locals.identity.uid, type, entryId: req.params.id as string, expectedVersion }));
  }));
  return router;
}
