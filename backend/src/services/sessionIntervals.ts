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
  const end = data[columns[type].end]?.toMillis() ?? begin + data.durationMinutes * 60000;
  return { id, begin, end };
}

function intersects(left: SessionInterval, right: SessionInterval) {
  return left.begin < right.end && right.begin < left.end;
}

// Each minute belongs to the earliest-starting session covering it, including across assigned dates.
function contribution(current: SessionInterval, sessions: SessionInterval[]) {
  let coveredUntil = current.begin;
  let overlap = false;
  for (const other of sessions) {
    if (other.id === current.id || !intersects(current, other)) continue;
    overlap = true;
    if (other.begin < current.begin || other.begin === current.begin && other.id < current.id) {
      coveredUntil = Math.max(coveredUntil, other.end);
    }
  }
  return {
    countedMinutes: Math.max(0, current.end - coveredUntil) / 60000,
    overlapStatus: overlap ? 'needs_review' : 'clear',
  };
}

async function inRange(tx: Transaction, collection: CollectionReference, type: TimedLog, begin: number, end: number, firstOnly = false) {
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

async function activityCandidates(tx: Transaction, collection: CollectionReference, begin: number, end: number) {
  // endedAt is optional on older activity records. Use the longest recorded duration to bound the start-time scan.
  const longest = await tx.get(collection.orderBy('durationMinutes', 'desc').limit(1).select('durationMinutes'));
  if (longest.empty) return [];
  const earliest = begin - Math.ceil(longest.docs[0].get('durationMinutes') * 60_000) - ACTIVITY_END_TOLERANCE_MS;
  let query = collection.where('startedAt', '<', Timestamp.fromMillis(end));
  if (earliest >= Date.parse('0001-01-01T00:00:00Z')) query = query.where('startedAt', '>=', Timestamp.fromMillis(earliest));
  return (await tx.get(query)).docs;
}

// Search by instants across assigned journal dates. Touching endpoints have no overlap.
export async function findCrossTypeOverlaps(tx: Transaction, collection: CollectionReference, type: TimedLog, sessions: SessionInterval[]) {
  const conflicts = new Map<string, SessionInterval>();
  if (!sessions.length) return conflicts;
  const other = otherType(type);
  const otherCollection = collection.parent!.collection(LOG_COLLECTIONS[other]);
  const first = Math.min(...sessions.map(item => item.begin));
  const last = Math.max(...sessions.map(item => item.end));
  const docs = other === 'activity' ? await activityCandidates(tx, otherCollection, first, last)
    : await inRange(tx, otherCollection, other, first, last, sessions.length === 1);
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

export async function intervalChanges(tx: Transaction, ref: DocumentReference, type: TimedLog,
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
  const sessions = [...surrounding.values()];
  const dates = new Map<string, string>();
  const updates = [];
  for (const neighbor of neighbors) {
    const data = affected.get(neighbor.id)!;
    const next = contribution(neighbor, sessions);
    if (data.overlapStatus === next.overlapStatus && data.countedMinutes === next.countedMinutes) continue;
    updates.push({ ref: ref.parent.doc(neighbor.id), values: next, day: data.localDate, delta: next.countedMinutes - (data.countedMinutes ?? 0) });
    if (data.localDate !== before?.localDate && data.localDate !== after?.localDate) dates.set(data.localDate, data.timeZone);
  }
  return { updates, dates, current: current ? contribution(current, sessions) : null };
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
