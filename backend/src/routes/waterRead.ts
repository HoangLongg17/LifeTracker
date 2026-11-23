
import { Router } from 'express';
import type { Auth } from 'firebase-admin/auth';
import {
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';

import { verifyAccount } from '../middlewares/verifyAccount';
import {
  accessError,
  getLogCollection,
} from '../services/logCommon';

function isValidDateKey(
  value: unknown
): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(
    `${value}T00:00:00.000Z`
  );

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export function waterReadRouter(
  auth: Pick<Auth, 'verifyIdToken'>,
  db: Firestore
) {
  const router = Router();

  router.get(
    '/me/logs/water',
    verifyAccount(auth),
    async (req, res) => {

    const rawQuery = req.query;

    const dateKey =
    rawQuery !== null &&
    typeof rawQuery === 'object' &&
    'date' in rawQuery
        ? rawQuery.date
        : undefined;

    if (!isValidDateKey(dateKey)) {
    res.status(400).json({
        code: 'INVALID_DATE',
    });
    return;
    }


      const uid = res.locals.identity.uid;

      const userRef = db
        .collection('users')
        .doc(uid);

      const profileRef = userRef
        .collection('profiles')
        .doc('main');

      const summaryRef = userRef
        .collection('dailySummaries')
        .doc(dateKey);

      try {
        const [account, profile, summary] =
          await db.getAll(
            userRef,
            profileRef,
            summaryRef
          );

        if (!account.exists || !profile.exists) {
          res.status(404).json({
            code: 'ACCOUNT_NOT_INITIALIZED',
          });
          return;
        }

        const denied = accessError(
          account.get('status')
        );

        if (denied) {
          res.status(403).json({ code: denied });
          return;
        }

        const snapshot = await getLogCollection(
          db,
          uid,
          'water'
        )
          .where('localDate', '==', dateKey)
          .get();

        for (const doc of snapshot.docs) {
          const volume = doc.get('volumeMl');

          if (
            typeof volume !== 'number' ||
            !Number.isFinite(volume) ||
            volume <= 0 ||
            !(doc.get('loggedAt') instanceof Timestamp)
          ) {
            res.status(500).json({
              code: 'INVALID_STORED_WATER_LOG',
            });
            return;
          }
        }

        const documents = [...snapshot.docs].sort(
          (a, b) => {
            const aTime =
              a.get('loggedAt') as Timestamp;
            const bTime =
              b.get('loggedAt') as Timestamp;

            return bTime.toMillis() - aTime.toMillis();
          }
        );

        const items = documents.map(doc => {
          const data = doc.data();

          return {
            entryId: doc.id,
            volumeMl: data.volumeMl as number,
            loggedAt:
              (data.loggedAt as Timestamp)
                .toDate()
                .toISOString(),
            timeZone: data.timeZone,
            localDate: data.localDate,
            note: data.note ?? null,
            version: data.version,
          };
        });


        const confirmed =
        summary.exists &&
        summary.get('recomputeStatus') === 'fresh' &&
        summary.get('userConfirmedByCategory.water') === true;


        const recordStatus = confirmed
          ? 'confirmed'
          : items.length > 0
            ? 'partial'
            : 'missing';

        const totalWaterMl =
          items.length > 0
            ? items.reduce(
                (total, item) =>
                  total + item.volumeMl,
                0
              )
            : confirmed
              ? 0
              : null;

        res.json({
          dateKey,
          totalWaterMl,
          recordStatus,
          items,
        });
      } catch (error) {
        console.error(
          '[water] Read error',
          error
        );

        res.status(503).json({
          code: 'WATER_LOG_UNAVAILABLE',
        });
      }
    }
  );

  return router;
}
