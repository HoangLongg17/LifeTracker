import { FieldValue, Timestamp, type CollectionReference, type DocumentData, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { LOG_COLLECTIONS, type LogType } from './logCommon';
import { markSummaryStale } from './logSummary';

export type TimedLog = 'activity' | 'sleep';
export type SessionInterval = { id: string; begin: number; end: number };
export const ACTIVITY_END_TOLERANCE_MS = 60_000;

const columns = {
  activity: { begin: 'startedAt', end: 'endedAt' },
  sleep: { begin: 'sleepStart', end: 'sleepEnd' },
} as const;

export function interval(type: TimedLog, id: string, data: DocumentData): SessionInterval {
  const begin = (data[columns[type].begin] as Timestamp).toMillis();
  const end = data[columns[type].end]?.toMillis() ?? begin + Math.round(data.durationMinutes * 60000);
  return { id, begin, end };
}

function intersects(left: SessionInterval, right: SessionInterval) {
  return left.begin < right.end && right.begin < left.end;
}

type Contribution = { countedMinutes: number; overlapStatus: 'needs_review' | 'clear' };

// Each minute belongs to the earliest-starting session covering it, with document ID breaking ties.
function contributions(sessions: Iterable<SessionInterval>) {
  const ordered = Array.from(sessions).sort((a, b) => {
    if (a.begin !== b.begin) return a.begin - b.begin;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
  const values = new Map<string, Contribution>();
  let coveredUntil = -Infinity;
  for (const [index, current] of ordered.entries()) {
    const next = ordered[index + 1];
    const overlaps = coveredUntil > current.begin || (next && next.begin < current.end);
    values.set(current.id, {
      countedMinutes: Math.max(0, current.end - Math.max(current.begin, coveredUntil)) / 60000,
      overlapStatus: overlaps ? 'needs_review' : 'clear',
    });
    coveredUntil = Math.max(coveredUntil, current.end);
  }
  return values;
}

async function inRange(tx: Transaction, collection: CollectionReference, type: TimedLog, begin: number, end: number, firstOnly = false) {
  if (type === 'activity') return activitiesInRange(tx, collection, begin, end);
  const keys = columns[type];
  const afterStart = collection.where(keys.end, '>', Timestamp.fromMillis(begin));
  try {
    const query = afterStart.where(keys.begin, '<', Timestamp.fromMillis(end)).orderBy(keys.end).orderBy(keys.begin);
    return (await tx.get(firstOnly ? query.limit(1) : query)).docs;
  } catch (error) {
    // A new environment can serve journals while Firestore builds its composite index.
    if (!(error instanceof Error) || !/requires an index|index.*building/i.test(error.message)) throw error;
    return (await tx.get(afterStart)).docs.filter(doc => doc.get(keys.begin).toMillis() < end);
  }
}

export class CrossTypeOverlapError extends Error {
  constructor(readonly conflictingType: TimedLog, readonly conflict: SessionInterval) {
    super('SLEEP_ACTIVITY_OVERLAP');
  }
}

function otherType(type: TimedLog): TimedLog {
  return type === 'sleep' ? 'activity' : 'sleep';
}

async function activitiesInRange(tx: Transaction, collection: CollectionReference, begin: number, end: number) {
  // endedAt is optional on older activity records. Use the longest recorded duration to bound the start-time scan.
  const longest = await tx.get(collection.orderBy('durationMinutes', 'desc').limit(1).select('durationMinutes'));
  if (longest.empty) return [];
  const earliest = begin - Math.ceil(longest.docs[0].get('durationMinutes') * 60_000) - ACTIVITY_END_TOLERANCE_MS;
  let query = collection.where('startedAt', '<', Timestamp.fromMillis(end));
  if (earliest >= Date.parse('0001-01-01T00:00:00Z')) query = query.where('startedAt', '>=', Timestamp.fromMillis(earliest));
  return (await tx.get(query)).docs.filter(doc => interval('activity', doc.id, doc.data()).end > begin);
}

// Rebuild the requested entries' contributions on read as older records can hold totals calculated without their neighbors.
export async function activitySummary(tx: Transaction, collection: CollectionReference, records: ReadonlyMap<string, DocumentData>) {
  const sessions = new Map<string, SessionInterval>();
  let first = Infinity;
  let last = -Infinity;
  let total = 0;
  for (const [id, data] of records) {
    if (data.startedAt instanceof Timestamp) {
      const session = interval('activity', id, data);
      if (session.end > session.begin) {
        sessions.set(id, session);
        first = Math.min(first, session.begin);
        last = Math.max(last, session.end);
        continue;
      }
    }
    total += data.countedMinutes ?? 0;
  }
  if (sessions.size) {
    // Other journal dates can cover the same instants. A draft in records supersedes the stored version of its ID.
    for (const doc of await activitiesInRange(tx, collection, first, last)) {
      if (!records.has(doc.id)) sessions.set(doc.id, interval('activity', doc.id, doc.data()));
    }
  }
  const entries = contributions(sessions.values());
  for (const id of records.keys()) total += entries.get(id)?.countedMinutes ?? 0;
  return { totalMinutes: records.size ? total : null, entries };
}

// Search by instants across assigned journal dates. Touching endpoints have no overlap.
export async function findCrossTypeOverlaps(tx: Transaction, collection: CollectionReference, type: TimedLog, sessions: SessionInterval[]) {
  const conflicts = new Map<string, SessionInterval>();
  if (!sessions.length) return conflicts;
  const other = otherType(type);
  const otherCollection = collection.parent!.collection(LOG_COLLECTIONS[other]);
  const first = Math.min(...sessions.map(item => item.begin));
  const last = Math.max(...sessions.map(item => item.end));
  const docs = await inRange(tx, otherCollection, other, first, last, sessions.length === 1);
  const candidates = docs.map(doc => interval(other, doc.id, doc.data()));
  for (const session of sessions) {
    const conflict = candidates.find(item => intersects(session, item));
    if (conflict) conflicts.set(session.id, conflict);
  }
  return conflicts;
}

export async function checkCrossTypeOverlap(tx: Transaction, ref: DocumentReference, type: TimedLog, proposed: DocumentData) {
  const matches = await findCrossTypeOverlaps(tx, ref.parent, type, [interval(type, ref.id, proposed)]);
  const conflict = matches.get(ref.id);
  if (conflict) throw new CrossTypeOverlapError(otherType(type), conflict);
}

async function intervalChanges(tx: Transaction, ref: DocumentReference, type: TimedLog,
  before: DocumentData | null, after: DocumentData | null) {
  const changed = [before, after].filter((d): d is DocumentData => d !== null).map(d => interval(type, ref.id, d));
  const affected = new Map<string, DocumentData>();
  // Separate queries keep an edit from reading every session between two distant dates.
  for (const [index, range] of changed.entries()) {
    if (index > 0 && range.begin === changed[0].begin && range.end === changed[0].end) continue;
    for (const doc of await inRange(tx, ref.parent, type, range.begin, range.end)) {
      if (doc.id !== ref.id) affected.set(doc.id, doc.data());
    }
  }
  const neighbors = [...affected].map(([id, data]) => interval(type, id, data));
  const surrounding = new Map(neighbors.map(item => [item.id, item]));
  // A neighbor may still overlap a third session after the edited one moves or is deleted.
  const clusters: { begin: number; end: number }[] = [];
  for (const item of [...neighbors].sort((a, b) => a.begin - b.begin)) {
    const last = clusters[clusters.length - 1];
    if (last && item.begin <= last.end) last.end = Math.max(last.end, item.end);
    else clusters.push({ begin: item.begin, end: item.end });
  }
  for (const cluster of clusters) {
    for (const doc of await inRange(tx, ref.parent, type, cluster.begin, cluster.end)) {
      if (doc.id !== ref.id) surrounding.set(doc.id, interval(type, doc.id, doc.data()));
    }
  }
  const current = after && interval(type, ref.id, after);
  if (current) surrounding.set(ref.id, current);
  const values = contributions(surrounding.values());
  const dates = new Map<string, string>();
  const updates = [];
  for (const neighbor of neighbors) {
    const data = affected.get(neighbor.id)!;
    const next = values.get(neighbor.id)!;
    if (data.overlapStatus === next.overlapStatus && data.countedMinutes === next.countedMinutes) continue;
    updates.push({ ref: ref.parent.doc(neighbor.id), values: next });
    if (data.localDate !== before?.localDate && data.localDate !== after?.localDate) dates.set(data.localDate, data.timeZone);
  }
  return { updates, dates, current: values.get(ref.id) };
}

export async function reconcileIntervals(tx: Transaction, ref: DocumentReference, type: LogType,
  before: DocumentData | null, after: DocumentData | null) {
  if (type !== 'activity' && type !== 'sleep') return {};
  if (after) await checkCrossTypeOverlap(tx, ref, type, after);
  const { updates, dates, current } = await intervalChanges(tx, ref, type, before, after);
  const user = ref.parent.parent!;
  const summaries = await Promise.all([...dates].map(async ([day, zone]) => ({
    day, zone, snapshot: await tx.get(user.collection('dailySummaries').doc(day)),
  })));
  for (const item of updates) tx.update(item.ref, item.values);
  for (const { day, zone, snapshot } of summaries) markSummaryStale(tx, snapshot.ref, snapshot, day, zone, type);
  // All interval writers also read this account. Its revision serializes concurrent inserts into empty ranges.
  tx.update(user, { dataRevision: FieldValue.increment(1) });
  return current ?? {};
}
