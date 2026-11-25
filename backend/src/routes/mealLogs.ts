import { Router, type Response } from 'express';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { accessError, getLogCollection, isRecord, validDay, validEntryId } from '../services/logCommon';
import { createMeal, loadMealEditor, MealError, mealJournalEntry, previewMealEdit, readMealChange, readMealDraft, updateMeal } from '../services/mealLog';
import { deleteLog } from '../services/logDelete';
import { PortionError, readPortionItems } from '../services/nutrition';
import { respondWithResult, storageError } from './logResponse';

function mealError(res: Response, error: unknown) {
  if (error instanceof MealError) res.status(error.status).json({ code: error.code, field: error.field, warnings: error.warnings });
  else if (error instanceof PortionError) res.status(error.code === 'FOOD_NOT_FOUND' ? 404 : 400).json({ code: error.code, field: error.field, message: error.message });
  else storageError(res, 'meal', error);
}

function versionIn(body: unknown, allowed: string[]) {
  if (!isRecord(body) || !Number.isSafeInteger(body.version) || Number(body.version) < 1 || Object.keys(body).some(k => !allowed.includes(k))) {
    throw new MealError(400, 'VALIDATION_ERROR');
  }
  return Number(body.version);
}

export function mealLogsRouter(db: Firestore) {
  const router = Router();
  router.post('/', async (req, res) => {
    try {
      const result = await createMeal(db, res.locals.identity.uid, readMealDraft(req.body));
      respondWithResult(res, result);
    } catch (error) { mealError(res, error); }
  });
  router.param('entryId', (_req, res, next, id: string) => {
    if (validEntryId(id)) next();
    else res.status(400).json({ code: 'INVALID_ENTRY_ID' });
  });
  router.get('/:entryId', async (req, res) => {
    try { res.json(await loadMealEditor(db, res.locals.identity.uid, req.params.entryId)); }
    catch (error) { mealError(res, error); }
  });
  router.post('/:entryId/preview', async (req, res) => {
    try {
      const version = versionIn(req.body, ['version', 'items']);
      const items = readPortionItems({ items: req.body.items });
      res.json(await previewMealEdit(db, res.locals.identity.uid, req.params.entryId, version, items));
    } catch (error) { mealError(res, error); }
  });
  router.patch('/:entryId', async (req, res) => {
    try {
      const change = readMealChange(req.params.entryId, req.body);
      respondWithResult(res, await updateMeal(db, res.locals.identity.uid, change));
    } catch (error) { mealError(res, error); }
  });
  router.delete('/:entryId', async (req, res) => {
    try {
      const version = versionIn(req.body, ['version']);
      const result = await deleteLog({ db, uid: res.locals.identity.uid, type: 'meal', entryId: req.params.entryId, expectedVersion: version });
      // The tombstone proves a repeated delete reached its intended result.
      if (result.status === 'ENTRY_ALREADY_DELETED') { res.json({ status: 'deleted', entryId: req.params.entryId }); return; }
      respondWithResult(res, result);
    } catch (error) { mealError(res, error); }
  });
  router.get('/', async (req, res) => {
    const { date, cursor } = req.query;
    if (!validDay(date) || Object.keys(req.query).some(k => k !== 'date' && k !== 'cursor')) { res.status(400).json({ code: 'INVALID_DATE' }); return; }
    const uid = res.locals.identity.uid;
    let lastId: string | undefined;
    if (cursor !== undefined) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 1500) throw new Error();
        const [account, day, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (account !== uid || day !== date || !validEntryId(id)) throw new Error();
        lastId = id;
      } catch { res.status(400).json({ code: 'INVALID_CURSOR' }); return; }
    }
    try {
      const result = await db.runTransaction(async tx => {
        const account = db.collection('users').doc(uid);
        const [owner, profile] = await tx.getAll(account, account.collection('profiles').doc('main'));
        if (!owner.exists || !profile.exists) throw new MealError(404, 'ACCOUNT_NOT_INITIALIZED');
        const denied = accessError(owner.get('status'));
        if (denied) throw new MealError(403, denied);
        let query = getLogCollection(db, uid, 'meal').where('localDate', '==', date).orderBy(FieldPath.documentId());
        if (lastId) query = query.startAfter(lastId);
        const rows = await tx.get(query.limit(51));
        const docs = rows.docs.slice(0, 50);
        const nextCursor = rows.size > docs.length
          ? Buffer.from(JSON.stringify([uid, date, docs[docs.length - 1].id])).toString('base64url') : null;
        return { date, items: docs.map(mealJournalEntry), nextCursor };
      }, { readOnly: true });
      res.json(result);
    } catch (error) {
      if (error instanceof MealError) res.status(error.status).json({ code: error.code });
      else storageError(res, 'read meals', error);
    }
  });
  return router;
}
