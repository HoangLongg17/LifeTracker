import { Router, type RequestHandler } from 'express';
import {
  AggregateField, FieldPath, Timestamp, type CollectionReference, type DocumentData, type DocumentReference,
  type Firestore, type Query, type QueryDocumentSnapshot, type Transaction,
} from 'firebase-admin/firestore';
import { accessError, getLogCollection, isRecord, localDate, validDay, validEntryId } from '../services/logCommon';
import { createLog } from '../services/logCreate';
import { updateLog } from '../services/logUpdate';
import { deleteLog } from '../services/logDelete';
import {
  activitySummary, checkCrossTypeOverlap, CrossTypeOverlapError, findCrossTypeOverlaps, interval, type TimedLog,
} from '../services/sessionIntervals';
import { parseTimedLog, TimedLogInputError } from '../services/timedLogInput';
import { respondWithResult, serialize, storageError } from './logResponse';

class JournalReadError extends Error {
  constructor(readonly status: number, code: string) { super(code); }
}

async function readAccount(db: Firestore, uid: string, { record, transaction }: {
  record?: DocumentReference;
  transaction?: Transaction;
} = {}) {
  const account = db.collection('users').doc(uid);
  const profile = account.collection('profiles').doc('main');
  const [owner, personal, entry] = await (transaction ?? db).getAll(account, profile, ...(record ? [record] : []));
  if (!owner.exists || !personal.exists) throw new JournalReadError(404, 'ACCOUNT_NOT_INITIALIZED');
  const denial = accessError(owner.get('status'));
  if (denial) throw new JournalReadError(403, denial);
  if (record && !entry?.exists) throw new JournalReadError(404, 'ENTRY_NOT_FOUND');
  return { entry: entry?.data() };
}

async function activityDay(tx: Transaction, collection: CollectionReference, date: string, options: {
  completePage?: QueryDocumentSnapshot[];
  draft?: { id: string; data: DocumentData };
}) {
  const rows = options.completePage ?? (await tx.get(collection.where('localDate', '==', date)
    .select('startedAt', 'endedAt', 'durationMinutes', 'countedMinutes'))).docs;
  const records = new Map(rows.map(doc => [doc.id, doc.data()]));
  if (options.draft) records.set(options.draft.id, options.draft.data);
  return activitySummary(tx, collection, records);
}

async function sleepDayTotal(tx: Transaction, query: Query) {
  try {
    const stats = (await tx.get(query.aggregate({ total: AggregateField.sum('countedMinutes'), count: AggregateField.count() }))).data();
    return stats.count ? stats.total : null;
  } catch (error) {
    if (!(error instanceof Error) || !/requires an index|index.*building/i.test(error.message)) throw error;
    const rows = await tx.get(query.select('countedMinutes'));
    return rows.empty ? null : rows.docs.reduce((sum, doc) => sum + (doc.get('countedMinutes') ?? 0), 0);
  }
}

function route(handler: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      if (err instanceof TimedLogInputError) {
        res.status(err.code === 'CONFIRM_LONG_SESSION' ? 422 : 400).json({ code: err.code, field: err.field });
      } else if (err instanceof CrossTypeOverlapError) {
        res.status(409).json({ code: err.message, overlap: {
          kind: err.conflictingType,
          start: new Date(err.conflict.begin).toISOString(),
          end: new Date(err.conflict.end).toISOString(),
        } });
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
    const collection = getLogCollection(db, uid, type);
    const all = collection.where('localDate', '==', date);
    let page = all.orderBy(FieldPath.documentId());
    if (cursor) page = page.startAfter(cursor);
    const result = await db.runTransaction(async tx => {
      const rows = await tx.get(page.limit(51));
      const documents = rows.docs.slice(0, 50);
      const startField = type === 'activity' ? 'startedAt' : 'sleepStart';
      const sessions = documents.filter(doc => doc.get(startField) instanceof Timestamp)
        .map(doc => interval(type, doc.id, doc.data())).filter(session => session.end > session.begin);
      const summary = type === 'activity'
        ? activityDay(tx, collection, date, { completePage: !cursor && rows.size <= 50 ? documents : undefined })
        : sleepDayTotal(tx, all).then(totalMinutes => ({ totalMinutes, entries: undefined }));
      const [stats, conflicts] = await Promise.all([summary, findCrossTypeOverlaps(tx, collection, type, sessions)]);
      return {
        dateKey: date, totalMinutes: stats.totalMinutes,
        items: documents.map(doc => serialize({ ...doc.data(), ...stats.entries?.get(doc.id), crossTypeOverlap: conflicts.has(doc.id) })),
        nextCursor: rows.size > documents.length ? documents[documents.length - 1].id : null,
      };
    }, { readOnly: true });
    res.json(result);
  }));

  router.post('/preview', route(async (req, res) => {
    if (!isRecord(req.body) || !validEntryId(req.body.entryId)) throw new TimedLogInputError('entryId', 'INVALID_ENTRY_ID');
    const uid = res.locals.identity.uid;
    const collection = getLogCollection(db, uid, type);
    const ref = collection.doc(req.body.entryId);
    const preview = await db.runTransaction(async tx => {
      // Firestore starts the transaction on its first read. A missing index on that read would also break the fallback.
      await readAccount(db, uid, { transaction: tx });
      const { fields, eventAt, timeZone } = parseTimedLog(type, { ...req.body, warningConfirmed: true });
      const day = localDate(eventAt, timeZone);
      const eventField = type === 'activity' ? 'startedAt' : 'sleepEnd';
      const after = { ...fields, localDate: day, [eventField]: Timestamp.fromDate(eventAt) };
      await checkCrossTypeOverlap(tx, ref, type, after);
      if (type === 'sleep') return { sessionMinutes: fields.sessionMinutes };
      const { totalMinutes, entries } = await activityDay(tx, collection, day, { draft: { id: ref.id, data: after } });
      return { totalMinutes, overlapStatus: entries.get(ref.id)!.overlapStatus };
    }, { readOnly: true });
    res.json(preview);
  }));

  router.get('/:id', route(async (req, res) => {
    const uid = res.locals.identity.uid;
    const ref = getLogCollection(db, uid, type).doc(req.params.id as string);
    const result = await db.runTransaction(async tx => {
      const { entry } = await readAccount(db, uid, { record: ref, transaction: tx });
      if (type !== 'activity') return entry;
      const summary = await activitySummary(tx, ref.parent, new Map([[ref.id, entry!]]));
      return { ...entry, ...summary.entries.get(ref.id) };
    }, { readOnly: true });
    res.json(serialize(result));
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
    const { entry } = await readAccount(db, uid, { record: getLogCollection(db, uid, type).doc(entryId) });
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
