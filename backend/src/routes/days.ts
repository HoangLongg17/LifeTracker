import { Router } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyAccount } from '../middlewares/verifyAccount';
import { isRecord, validDay, type LogType } from '../services/logCommon';
import {
  getDayRecordStatus,
  isRecordCategory,
  updateDayRecordStatus,
} from '../services/dayRecordStatus';
import { storageError } from './logResponse';

export function daysRouter(
  auth: Pick<Auth, 'verifyIdToken'>,
  db: Firestore
) {
  const router = Router();

  router.use('/me/days', verifyAccount(auth));

  router.get('/me/days/:date/record-status', async (req, res) => {
    const { date } = req.params;
    if (!validDay(date)) {
      res.status(400).json({ code: 'INVALID_DATE' });
      return;
    }

    try {
      const result = await getDayRecordStatus(
        db,
        res.locals.identity.uid,
        date
      );
      if (!result.ok) {
        res.status(result.status).json({ code: result.code });
        return;
      }
      res.json(result.data);
    } catch (error) {
      storageError(res, 'read day record status', error);
    }
  });

  router.put('/me/days/:date/record-status', async (req, res) => {
    const { date } = req.params;
    if (!validDay(date)) {
      res.status(400).json({ code: 'INVALID_DATE' });
      return;
    }

    if (!isRecord(req.body)) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: { form: 'INVALID_BODY' } });
      return;
    }

    const updates: Partial<Record<LogType, boolean>> = {};

    if ('category' in req.body || 'confirmed' in req.body) {
      if (
        !isRecordCategory(req.body.category) ||
        typeof req.body.confirmed !== 'boolean' ||
        Object.keys(req.body).some((k) => k !== 'category' && k !== 'confirmed')
      ) {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          fields: { category: 'INVALID_RECORD_STATUS_INPUT' },
        });
        return;
      }
      updates[req.body.category] = req.body.confirmed;
    } else if ('categories' in req.body && isRecord(req.body.categories)) {
      if (Object.keys(req.body).some((k) => k !== 'categories')) {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          fields: { form: 'FIELD_NOT_ALLOWED' },
        });
        return;
      }
      const entries = Object.entries(req.body.categories);
      if (entries.length === 0) {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          fields: { categories: 'EMPTY_UPDATE' },
        });
        return;
      }
      for (const [key, val] of entries) {
        if (!isRecordCategory(key) || typeof val !== 'boolean') {
          res.status(400).json({
            code: 'VALIDATION_ERROR',
            fields: { [key]: 'INVALID_CATEGORY_VALUE' },
          });
          return;
        }
        updates[key] = val;
      }
    } else {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        fields: { form: 'INVALID_RECORD_STATUS_INPUT' },
      });
      return;
    }

    try {
      const result = await updateDayRecordStatus({
        db,
        uid: res.locals.identity.uid,
        dateKey: date,
        updates,
      });

      if (!result.ok) {
        res
          .status(result.status)
          .json({ code: result.code, ...(result.details ?? {}) });
        return;
      }

      res.json(result.data);
    } catch (error) {
      storageError(res, 'update day record status', error);
    }
  });

  return router;
}