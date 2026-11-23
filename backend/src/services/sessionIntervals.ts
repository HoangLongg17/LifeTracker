import { FieldValue, Timestamp, type CollectionReference, type DocumentData, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import type { LogType } from './logCommon';
import { markSummaryStale } from './logSummary';

export type TimedLog = 'activity' | 'sleep';
export type SessionInterval = { id: string; begin: number; end: number };

const columns = {
  activity: { begin: 'startedAt', end: 'endedAt' },
  sleep: { begin: 'sleepStart', end: 'sleepEnd' },
} as const;

function interval(type: TimedLog, id: string, data: DocumentData): SessionInterval {
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

async function inRange(tx: Transaction, collection: CollectionReference, type: TimedLog, begin: number, end: number) {
  const keys = columns[type];
  const afterStart = collection.where(keys.end, '>', Timestamp.fromMillis(begin));
  try {
    return (await tx.get(afterStart.where(keys.begin, '<', Timestamp.fromMillis(end)).orderBy(keys.end).orderBy(keys.begin))).docs;
  } catch (error) {
    // A new environment can serve journals while Firestore builds its composite index.
    if (!(error instanceof Error) || !/requires an index|index.*building/i.test(error.message)) throw error;
    return (await tx.get(afterStart)).docs.filter(doc => doc.get(keys.begin).toMillis() < end);
  }
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
