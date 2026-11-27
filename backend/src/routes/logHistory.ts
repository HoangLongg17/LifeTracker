import { Router } from 'express';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  accessError,
  getLogCollection,
  localDate,
  validDay,
  validEntryId,
  validTimeZone,
  type LogType,
} from '../services/logCommon';
import { getDayRecordStatus, type DayRecordStatusPayload } from '../services/dayRecordStatus';
import { mealJournalEntry } from '../services/mealLog';
import { weightLogIsValid, weightLogLocalDate, weightLogResponse } from '../services/weightHistory';
import { storageError } from './logResponse';

type HistoryKind = LogType | 'weight';

const ALL_KINDS: readonly HistoryKind[] = [
  'water',
  'meal',
  'activity',
  'sleep',
  'weight',
] as const;

type HistoryItem = {
  entryId: string;
  kind: HistoryKind;
  localDate: string;
  occurredAt: string;
  timeZone: string;
  version: number;
  summary: Record<string, unknown>;
};

type CursorToken = {
  uid: string;
  localDate: string;
  occurredMs: number;
  kind: HistoryKind;
  entryId: string;
};

function isHistoryKind(value: unknown): value is HistoryKind | 'all' {
  return (
    value === 'all' ||
    (typeof value === 'string' &&
      (ALL_KINDS as readonly string[]).includes(value))
  );
}

function encodeCursor(token: CursorToken): string {
  return Buffer.from(JSON.stringify(token)).toString('base64url');
}

function decodeCursor(raw: unknown, uid: string): CursorToken | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1500) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8')
    ) as Partial<CursorToken>;
    if (
      parsed.uid !== uid ||
   !validDay(parsed.localDate) ||
   typeof parsed.occurredMs !== 'number' ||
   !Number.isFinite(parsed.occurredMs) ||
   typeof parsed.kind !== 'string' ||
   !(ALL_KINDS as readonly string[]).includes(parsed.kind) ||
   !validEntryId(parsed.entryId)
    ) {
      return null;
    }
    return parsed as CursorToken;
  } catch {
    return null;
  }
}

export function logHistoryRouter(db: Firestore) {
  const router = Router();

  router.get('/history', async (req, res) => {
    const rawType = req.query.type ?? 'all';
    const rawFrom = req.query.from;
    const rawTo = req.query.to;
    const rawLimit = req.query.limit ?? '20';
    const rawCursor = req.query.cursor;

    const allowedKeys = new Set(['type', 'from', 'to', 'limit', 'cursor']);
    if (Object.keys(req.query).some((k) => !allowedKeys.has(k))) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: { query: 'FIELD_NOT_ALLOWED' } });
      return;
    }

    if (!isHistoryKind(rawType)) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: { type: 'INVALID_TYPE' } });
      return;
    }

    if (rawFrom !== undefined && !validDay(rawFrom)) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: { from: 'INVALID_DATE' } });
      return;
    }

    if (rawTo !== undefined && !validDay(rawTo)) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: { to: 'INVALID_DATE' } });
      return;
    }

    if (
      typeof rawFrom === 'string' &&
      typeof rawTo === 'string' &&
      rawFrom > rawTo
    ) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        fields: { from: 'FROM_AFTER_TO' },
      });
      return;
    }

    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      res.status(400).json({ code: 'VALIDATION_ERROR', fields: { limit: 'INVALID_LIMIT' } });
      return;
    }

    const uid = res.locals.identity.uid;
    let cursorToken: CursorToken | null = null;
    if (rawCursor !== undefined) {
      cursorToken = decodeCursor(rawCursor, uid);
      if (!cursorToken) {
        res.status(400).json({ code: 'INVALID_CURSOR' });
        return;
      }
    }

    const userRef = db.collection('users').doc(uid);
    const profileRef = userRef.collection('profiles').doc('main');

    try {
      const [account, profile] = await db.getAll(userRef, profileRef);
      if (!account.exists || !profile.exists) {
        res.status(404).json({ code: 'ACCOUNT_NOT_INITIALIZED' });
        return;
      }

      const denied = accessError(account.get('status'));
      if (denied) {
        res.status(403).json({ code: denied });
        return;
      }

      const rawProfileTz = profile.get('timeZone');
      const profileTimeZone = validTimeZone(rawProfileTz)
        ? rawProfileTz
        : 'Asia/Ho_Chi_Minh';
      const today = localDate(new Date(), profileTimeZone);
      const effectiveTo = typeof rawTo === 'string' ? rawTo : today;
      const effectiveFrom = typeof rawFrom === 'string' ? rawFrom : undefined;

      const selectedKinds: HistoryKind[] =
        rawType === 'all' ? [...ALL_KINDS] : [rawType];

      const collected: Array<HistoryItem & { occurredMs: number }> = [];

      await Promise.all(
        selectedKinds.map(async (kind) => {
          if (kind === 'weight') {
            const snap = await userRef.collection('weightLogs').get();
            for (const doc of snap.docs) {
              const data = doc.data();
              if (!weightLogIsValid(data)) continue;
              const day = weightLogLocalDate(data, profileTimeZone);
              if (!validDay(day) || day > effectiveTo) continue;
              if (effectiveFrom && day < effectiveFrom) continue;
              const resp = weightLogResponse(data, doc.id, profileTimeZone);
           if (!resp.measuredAt) continue;
           const occurredMs = Date.parse(resp.measuredAt);
           if (!Number.isFinite(occurredMs)) continue;
              collected.push({
                entryId: doc.id,
                kind: 'weight',
                localDate: day,
                occurredAt: resp.measuredAt,
                occurredMs,
                timeZone: validTimeZone(resp.timeZone) ? resp.timeZone : profileTimeZone,
                version: resp.version,
                summary: {
                  weightKg: resp.weightKg,
                },
              });
            }
            return;
          }

          let query = getLogCollection(db, uid, kind).where(
            'localDate',
            '<=',
            effectiveTo
          );
          if (effectiveFrom) {
            query = query.where('localDate', '>=', effectiveFrom);
          }

          const snap = await query.get();
          for (const doc of snap.docs) {
            const data = doc.data();
            const day = data.localDate as string;
            if (!validDay(day)) continue;
            const zone = validTimeZone(data.timeZone) ? data.timeZone : profileTimeZone;

            if (kind === 'water') {
              const ts = data.loggedAt as Timestamp | undefined;
              if (!(ts instanceof Timestamp)) continue;
              collected.push({
                entryId: doc.id,
                kind: 'water',
                localDate: day,
                occurredAt: ts.toDate().toISOString(),
                occurredMs: ts.toMillis(),
                timeZone: zone,
                version: typeof data.version === 'number' ? data.version : 1,
                summary: {
                  volumeMl: data.volumeMl,
                  note: data.note ?? null,
                },
              });
            } else if (kind === 'meal') {
           const entry = mealJournalEntry(doc);
           const occurredMs = Date.parse(entry.loggedAt);
           if (!Number.isFinite(occurredMs)) continue;
           collected.push({
             entryId: entry.entryId || doc.id,
             kind: 'meal',
             localDate: day,
             occurredAt: entry.loggedAt,
             occurredMs,
             timeZone: validTimeZone(entry.timeZone) ? entry.timeZone : zone,
             version: typeof entry.version === 'number' ? entry.version : 1,
             summary: {
               mealType: entry.mealType,
               items: entry.items,
               totals: entry.totals,
             },
           });
            } else if (kind === 'activity') {
              const ts = data.startedAt as Timestamp | undefined;
              if (!(ts instanceof Timestamp)) continue;
              collected.push({
                entryId: doc.id,
                kind: 'activity',
                localDate: day,
                occurredAt: ts.toDate().toISOString(),
                occurredMs: ts.toMillis(),
                timeZone: zone,
                version: typeof data.version === 'number' ? data.version : 1,
                summary: {
                  activityType: data.activityType,
                  durationMinutes: data.durationMinutes,
                  countedMinutes: data.countedMinutes ?? data.durationMinutes,
                },
              });
            } else if (kind === 'sleep') {
              const startTs = data.sleepStart as Timestamp | undefined;
              const endTs = data.sleepEnd as Timestamp | undefined;
              if (!(endTs instanceof Timestamp)) continue;
              collected.push({
                entryId: doc.id,
                kind: 'sleep',
                localDate: day,
                occurredAt: endTs.toDate().toISOString(),
                occurredMs: endTs.toMillis(),
                timeZone: zone,
                version: typeof data.version === 'number' ? data.version : 1,
                summary: {
                  sleepStart:
                    startTs instanceof Timestamp
                      ? startTs.toDate().toISOString()
                      : null,
                  sleepEnd: endTs.toDate().toISOString(),
                  sessionMinutes: data.sessionMinutes,
                  countedMinutes: data.countedMinutes ?? data.sessionMinutes,
                },
              });
            }
          }
        })
      );

      collected.sort(
        (a, b) =>
          b.localDate.localeCompare(a.localDate) ||
          b.occurredMs - a.occurredMs ||
          a.kind.localeCompare(b.kind) ||
          a.entryId.localeCompare(b.entryId)
      );

      const filtered = cursorToken
        ? collected.filter((item) => {
            if (item.localDate !== cursorToken!.localDate) {
              return item.localDate < cursorToken!.localDate;
            }
            if (item.occurredMs !== cursorToken!.occurredMs) {
              return item.occurredMs < cursorToken!.occurredMs;
            }
            if (item.kind !== cursorToken!.kind) {
              return item.kind.localeCompare(cursorToken!.kind) > 0;
            }
            return item.entryId.localeCompare(cursorToken!.entryId) > 0;
          })
        : collected;

      const page = filtered.slice(0, limit);
      const hasMore = filtered.length > limit;
      const lastItem = page[page.length - 1];
      const nextCursor =
        hasMore && lastItem
          ? encodeCursor({
              uid,
              localDate: lastItem.localDate,
              occurredMs: lastItem.occurredMs,
              kind: lastItem.kind,
              entryId: lastItem.entryId,
            })
          : null;

      const uniqueDays = [...new Set(page.map((item) => item.localDate))];
      const dayStatuses: Record<string, DayRecordStatusPayload> = {};
      for (const day of uniqueDays) {
        const statusRes = await getDayRecordStatus(db, uid, day);
        if (statusRes.ok) {
          dayStatuses[day] = statusRes.data;
        }
      }

      res.json({
        items: page.map(({ occurredMs: _ms, ...rest }) => rest),
        nextCursor,
        dayStatuses,
      });
    } catch (error) {
      storageError(res, 'read log history', error);
    }
  });

  return router;
}