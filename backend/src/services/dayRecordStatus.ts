import {
  FieldValue,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import {
  accessError,
  getLogCollection,
  localDate,
  validDay,
  validTimeZone,
  type LogType,
} from './logCommon';
import { activitySummary } from './sessionIntervals';

export const RECORD_CATEGORIES: readonly LogType[] = [
  'water',
  'meal',
  'activity',
  'sleep',
] as const;

export type RecordStatusValue = 'missing' | 'partial' | 'confirmed';

export type CategoryRecordState = {
  category: LogType;
  status: RecordStatusValue;
  confirmed: boolean;
  total: number | null;
  count: number;
};

export type DayRecordStatusPayload = {
  dateKey: string;
  timeZone: string;
  canConfirm: boolean;
  recomputeStatus: 'fresh';
  categories: Record<LogType, CategoryRecordState>;
};

export function isRecordCategory(value: unknown): value is LogType {
  return (
    typeof value === 'string' &&
    (RECORD_CATEGORIES as readonly string[]).includes(value)
  );
}

function nextDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function readConfirmedMap(raw: unknown): Record<LogType, boolean> {
  const obj =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    water: obj.water === true,
    meal: obj.meal === true,
    activity: obj.activity === true,
    sleep: obj.sleep === true,
  };
}

async function computeCategoryStats(
  tx: Transaction,
  db: Firestore,
  uid: string,
  dateKey: string
): Promise<Record<LogType, { count: number; rawTotal: number }>> {
  const waterCol = getLogCollection(db, uid, 'water');
  const mealCol = getLogCollection(db, uid, 'meal');
  const activityCol = getLogCollection(db, uid, 'activity');
  const sleepCol = getLogCollection(db, uid, 'sleep');

  const [waterSnap, mealSnap, activitySnap, sleepSnap] = await Promise.all([
    tx.get(waterCol.where('localDate', '==', dateKey)),
    tx.get(mealCol.where('localDate', '==', dateKey)),
    tx.get(
      activityCol
        .where('localDate', '==', dateKey)
        .select('startedAt', 'endedAt', 'durationMinutes', 'countedMinutes')
    ),
    tx.get(sleepCol.where('localDate', '==', dateKey)),
  ]);

  const waterTotal = waterSnap.docs.reduce((sum, doc) => {
    const vol = doc.get('volumeMl');
    return typeof vol === 'number' && Number.isFinite(vol) ? sum + vol : sum;
  }, 0);

  const mealTotal = mealSnap.docs.reduce((sum, doc) => {
    const totals = doc.get('totals');
    const kcal =
      typeof totals === 'object' && totals !== null
        ? (totals as Record<string, unknown>).energyKcal
        : doc.get('energyKcal');
    return typeof kcal === 'number' && Number.isFinite(kcal) ? sum + kcal : sum;
  }, 0);

  const activityRecords = new Map(
    activitySnap.docs.map((doc) => [doc.id, doc.data()])
  );
  const activityStats =
    activityRecords.size > 0
      ? await activitySummary(tx, activityCol, activityRecords)
      : { totalMinutes: 0 };

  const sleepTotal = sleepSnap.docs.reduce((sum, doc) => {
    const mins = doc.get('countedMinutes') ?? doc.get('sessionMinutes');
    return typeof mins === 'number' && Number.isFinite(mins) ? sum + mins : sum;
  }, 0);

  return {
    water: { count: waterSnap.size, rawTotal: Math.round(waterTotal * 1000) / 1000 },
    meal: { count: mealSnap.size, rawTotal: Math.round(mealTotal * 100) / 100 },
    activity: {
      count: activitySnap.size,
      rawTotal: activityStats.totalMinutes ?? 0,
    },
    sleep: { count: sleepSnap.size, rawTotal: sleepTotal },
  };
}

function buildCategories(
  stats: Record<LogType, { count: number; rawTotal: number }>,
  confirmedMap: Record<LogType, boolean>
): Record<LogType, CategoryRecordState> {
  const result = {} as Record<LogType, CategoryRecordState>;
  for (const category of RECORD_CATEGORIES) {
    const { count, rawTotal } = stats[category];
    const confirmed = confirmedMap[category] === true;
    const status: RecordStatusValue = confirmed
      ? 'confirmed'
      : count > 0
        ? 'partial'
        : 'missing';
    const total = count > 0 ? rawTotal : confirmed ? 0 : null;
    result[category] = { category, status, confirmed, total, count };
  }
  return result;
}

export async function getDayRecordStatus(
  db: Firestore,
  uid: string,
  dateKey: string,
  now = new Date()
): Promise<
  | { ok: true; data: DayRecordStatusPayload }
  | { ok: false; status: number; code: string }
> {
  if (!validDay(dateKey)) {
    return { ok: false, status: 400, code: 'INVALID_DATE' };
  }

  const userRef = db.collection('users').doc(uid);
  const profileRef = userRef.collection('profiles').doc('main');
  const summaryRef = userRef.collection('dailySummaries').doc(dateKey);

  return db.runTransaction(
    async (tx) => {
      const [account, profile, summary] = await tx.getAll(
        userRef,
        profileRef,
        summaryRef
      );

      if (!account.exists || !profile.exists) {
        return {
          ok: false as const,
          status: 404,
          code: 'ACCOUNT_NOT_INITIALIZED',
        };
      }

      const denied = accessError(account.get('status'));
      if (denied) {
        return { ok: false as const, status: 403, code: denied };
      }

      const rawZone = summary.exists
        ? summary.get('timeZone')
        : profile.get('timeZone');
      const timeZone = validTimeZone(rawZone)
        ? rawZone
        : validTimeZone(profile.get('timeZone'))
          ? (profile.get('timeZone') as string)
          : 'Asia/Ho_Chi_Minh';

      const confirmedMap = summary.exists
        ? readConfirmedMap(summary.get('userConfirmedByCategory'))
        : { water: false, meal: false, activity: false, sleep: false };

      const stats = await computeCategoryStats(tx, db, uid, dateKey);
      const categories = buildCategories(stats, confirmedMap);
      const todayInZone = localDate(now, timeZone);
      const canConfirm = dateKey < todayInZone;

      return {
        ok: true as const,
        data: {
          dateKey,
          timeZone,
          canConfirm,
          recomputeStatus: 'fresh',
          categories,
        },
      };
    },
    { readOnly: true }
  );
}

export async function updateDayRecordStatus(input: {
  db: Firestore;
  uid: string;
  dateKey: string;
  updates: Partial<Record<LogType, boolean>>;
  now?: Date;
}): Promise<
  | { ok: true; data: DayRecordStatusPayload }
  | {
      ok: false;
      status: number;
      code: string;
      details?: Record<string, unknown>;
    }
> {
  const { db, uid, dateKey, updates, now = new Date() } = input;

  if (!validDay(dateKey)) {
    return { ok: false, status: 400, code: 'INVALID_DATE' };
  }

  const userRef = db.collection('users').doc(uid);
  const profileRef = userRef.collection('profiles').doc('main');
  const summaryRef = userRef.collection('dailySummaries').doc(dateKey);

  return db.runTransaction(async (tx) => {
    const [account, profile, summary] = await tx.getAll(
      userRef,
      profileRef,
      summaryRef
    );

    if (!account.exists || !profile.exists) {
      return {
        ok: false as const,
        status: 404,
        code: 'ACCOUNT_NOT_INITIALIZED',
      };
    }

    const denied = accessError(account.get('status'));
    if (denied) {
      return { ok: false as const, status: 403, code: denied };
    }

    const rawZone = summary.exists
      ? summary.get('timeZone')
      : profile.get('timeZone');
    const timeZone = validTimeZone(rawZone)
      ? rawZone
      : validTimeZone(profile.get('timeZone'))
        ? (profile.get('timeZone') as string)
        : 'Asia/Ho_Chi_Minh';

    const todayInZone = localDate(now, timeZone);
    const hasPositiveConfirm = Object.values(updates).some((v) => v === true);

    if (hasPositiveConfirm && dateKey >= todayInZone) {
      return {
        ok: false as const,
        status: 400,
        code: 'DAY_NOT_ENDED',
        details: { dateKey, today: todayInZone, timeZone },
      };
    }

    const currentConfirmed = summary.exists
      ? readConfirmedMap(summary.get('userConfirmedByCategory'))
      : { water: false, meal: false, activity: false, sleep: false };

    const nextConfirmed: Record<LogType, boolean> = {
      ...currentConfirmed,
      ...updates,
    };

    const stats = await computeCategoryStats(tx, db, uid, dateKey);
    const categories = buildCategories(stats, nextConfirmed);
    const timestamp = FieldValue.serverTimestamp();

    const payload = {
      dateKey,
      timeZone,
      periodStart: dateKey,
      periodEnd: nextDate(dateKey),
      recomputeStatus: 'fresh',
      userConfirmedByCategory: nextConfirmed,
      totals: {
        waterMl: categories.water.total,
        mealEnergyKcal: categories.meal.total,
        activityMinutes: categories.activity.total,
        sleepMinutes: categories.sleep.total,
      },
      counts: {
        water: categories.water.count,
        meal: categories.meal.count,
        activity: categories.activity.count,
        sleep: categories.sleep.count,
      },
      updatedAt: timestamp,
    };

    if (summary.exists) {
      tx.update(summaryRef, {
        ...payload,
        sourceRevision: FieldValue.increment(1),
      });
    } else {
      tx.create(summaryRef, {
        ...payload,
        sourceRevision: 1,
        createdAt: timestamp,
      });
    }

    return {
      ok: true as const,
      data: {
        dateKey,
        timeZone,
        canConfirm: dateKey < todayInZone,
        recomputeStatus: 'fresh',
        categories,
      },
    };
  });
}