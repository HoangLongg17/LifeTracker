import { createHash } from 'node:crypto';
import BigNumber from 'bignumber.js';
import { FieldValue, Timestamp, type DocumentData, type Firestore, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import type { Food, MealDraft, MealEditor, PortionItem, MealJournalEntry, MealJournalItem, MealType, MealWarning, NutrientValues, NutritionPreview } from '../../../shared/food';
import { firestoreCatalog, nutrients, publishedFood } from './foodCatalog';
import { accessError, getLogCollection, isRecord, parseLogInstant, validEntryId, validTimeZone } from './logCommon';
import { createLog } from './logCreate';
import { updateLog } from './logUpdate';
import { calculatePortions, mealPreviewTag, readPortionItems } from './nutrition';

const types: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const keys = new Set(['entryId', 'loggedAt', 'timeZone', 'mealType', 'items', 'note', 'warningConfirmed', 'previewTag']);
export class MealError extends Error {
  constructor(readonly status: number, readonly code: string, readonly field?: string, readonly warnings?: MealWarning[]) {
    super(code);
  }
}

export function readMealDraft(body: unknown): MealDraft {
  if (!isRecord(body)) throw new MealError(400, 'VALIDATION_ERROR', 'body');
  const unexpected = Object.keys(body).find(key => !keys.has(key));
  if (unexpected) throw new MealError(400, 'VALIDATION_ERROR', unexpected);
  if (!validEntryId(body.entryId)) throw new MealError(400, 'INVALID_ENTRY_ID', 'entryId');
  const at = parseLogInstant(body.loggedAt);
  if (!at) throw new MealError(400, 'VALIDATION_ERROR', 'loggedAt');
  if (at.getTime() > Date.now() + 300_000) throw new MealError(400, 'FUTURE_TIME', 'loggedAt');
  if (!validTimeZone(body.timeZone)) throw new MealError(400, 'VALIDATION_ERROR', 'timeZone');
  if (!types.includes(body.mealType as MealType)) throw new MealError(400, 'VALIDATION_ERROR', 'mealType');
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500)) throw new MealError(400, 'VALIDATION_ERROR', 'note');
  if (body.warningConfirmed !== undefined && typeof body.warningConfirmed !== 'boolean') throw new MealError(400, 'VALIDATION_ERROR', 'warningConfirmed');
  if (body.previewTag !== undefined && (typeof body.previewTag !== 'string' || !/^[0-9a-f]{64}$/.test(body.previewTag))) {
    throw new MealError(400, 'VALIDATION_ERROR', 'previewTag');
  }
  return { entryId: body.entryId, timeZone: body.timeZone, loggedAt: at.toISOString(), mealType: body.mealType as MealType,
    items: readPortionItems({ items: body.items }), note: body.note?.trim(), previewTag: body.previewTag, warningConfirmed: body.warningConfirmed };
}

type MealChange = { version: number; draft: MealDraft };

export function readMealChange(entryId: string, body: unknown): MealChange {
  if (!isRecord(body) || 'entryId' in body || 'note' in body || typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 1) {
    throw new MealError(400, 'VALIDATION_ERROR');
  }
  const { version, ...fields } = body;
  return { version, draft: readMealDraft({ entryId, ...fields }) };
}

function recordedInput(row: DocumentData): PortionItem {
  const source = row.portionInput ?? row;
  for (const key of ['quantity', 'consumedGrams', 'consumedMl'] as const) {
    if (typeof source[key] === 'number' && Number.isFinite(source[key]) && source[key] > 0) {
      return { foodId: row.foodId, [key]: source[key] } as PortionItem;
    }
  }
  throw new MealError(409, 'MEAL_SOURCE_UNAVAILABLE');
}

function recordedFood(item: DocumentData): Food {
  const snapshot = item.referenceSnapshot;
  const food = snapshot && publishedFood(item.foodId, {
    ...snapshot, ...snapshot.nutrients, foodName: item.foodName, foodId: item.foodId, status: 'active',
  });
  if (!food) throw new MealError(409, 'MEAL_SOURCE_UNAVAILABLE');
  return food;
}

async function mealSources(db: Firestore, tx: Transaction, items: PortionItem[], previous?: DocumentData) {
  const previousItems: DocumentData[] = Array.isArray(previous?.items) ? previous.items : [];
  const matched = new Set<number>();
  const previousMatches: (DocumentData | undefined)[] = new Array(items.length);
  const historical: (Food | undefined)[] = new Array(items.length);
  const unchanged = (item: PortionItem, old: DocumentData) => {
    if (old.foodId !== item.foodId) return false;
    const input = recordedInput(old);
    return input.quantity === item.quantity && input.consumedGrams === item.consumedGrams &&
      input.consumedMl === item.consumedMl;
  };
  items.forEach((item, i) => {
    const index = previousItems.findIndex((old, oldIndex) => {
      if (matched.has(oldIndex)) return false;
      return unchanged(item, old);
    });
    if (index >= 0) {
      matched.add(index);
      previousMatches[i] = previousItems[index];
      historical[i] = recordedFood(previousItems[index]);
    }
  });
  const ids = [...new Set(items.filter((_, i) => !historical[i]).map(item => item.foodId))];
  const foods = ids.length ? await firestoreCatalog(db).byIds(ids, tx) : new Map<string, Food>();
  const estimate = calculatePortions(items, foods, historical);
  return { previousMatches, historical, foods, estimate, previewTag: mealPreviewTag(items, foods, historical) };
}

async function mealFields(db: Firestore, tx: Transaction, uid: string, day: string, draft: MealDraft, previous?: DocumentData) {
  const { items } = draft;
  const { previousMatches, historical, foods, estimate, previewTag } = await mealSources(db, tx, items, previous);
  if (draft.previewTag && draft.previewTag !== previewTag) throw new MealError(409, 'FOOD_CHANGED');
  const warnings: MealWarning[] = [...estimate.warnings];
  if (estimate.totals.energyKcal !== null) {
    const rows = await tx.get(getLogCollection(db, uid, 'meal').where('localDate', '==', day).select('totals.energyKcal'));
    const energy = rows.docs.reduce((sum, row) => {
      const kcal: unknown = row.get('totals.energyKcal');
      return row.id !== draft.entryId && typeof kcal === 'number' && Number.isFinite(kcal) && kcal >= 0 ? sum.plus(kcal) : sum;
    }, new BigNumber(estimate.totals.energyKcal));
    if (energy.gt(15000)) warnings.push('HIGH_DAY_ENERGY');
  }
  if (warnings.length && !draft.warningConfirmed) throw new MealError(400, 'WARNING_CONFIRMATION_REQUIRED', undefined, warnings);
  const stored = estimate.items.map((calculated, i) => {
    if (previousMatches[i]) return previousMatches[i];
    const food = foods.get(calculated.foodId)!;
    const requested = items[i];
    const { amount, unit, ...values } = calculated;
    const { foodId: _id, ...portionInput } = requested;
    return { ...values, portionInput,
      ...(requested.quantity !== undefined ? { quantity: requested.quantity, servingSize: food.servingSize, servingUnit: food.servingUnit } : {}),
      ...(unit === 'g' ? { consumedGrams: amount } : { consumedMl: amount }),
      nutrientCompleteness: food.completeness,
      referenceSnapshot: {
        foodSource: food.foodSource, sourceFoodId: food.sourceFoodId, sourceVersion: food.sourceVersion, sourceUrl: food.sourceUrl,
        retrievedAt: food.retrievedAt ? Timestamp.fromDate(new Date(food.retrievedAt)) : null,
        version: food.version, foodState: food.foodState, referenceBasis: food.referenceBasis,
        referenceAmount: food.referenceAmount, referenceUnit: food.referenceUnit,
        servingSize: food.servingSize, servingUnit: food.servingUnit, servingLabel: food.servingLabel,
        densityGramsPerMl: food.densityGramsPerMl, densitySourcePortionId: food.densitySourcePortionId,
        nutrients: Object.fromEntries(nutrients.map(key => [key, food[key]])),
      },
    };
  });
  return { items: stored, totals: estimate.totals, nutrientCompleteness: estimate.nutrientCompleteness,
    ...(warnings.length ? { warnings, warningConfirmed: true }
      : previous ? { warnings: FieldValue.delete(), warningConfirmed: FieldValue.delete() } : {}) };
}

export function createMeal(db: Firestore, uid: string, draft: MealDraft) {
  const { entryId, mealType, items, loggedAt, timeZone, note } = draft;
  return createLog({ db, uid, type: 'meal', entryId, timeZone, eventAt: new Date(loggedAt),
    fields: { mealType, items, ...(note ? { note } : {}) },
    deriveForCreate: (tx, day) => mealFields(db, tx, uid, day, draft),
  });
}

export function updateMeal(db: Firestore, uid: string, change: MealChange) {
  const { draft, version } = change;
  const { entryId, loggedAt, timeZone, mealType, items } = draft;
  const fingerprint = createHash('sha256').update(JSON.stringify([version, entryId, loggedAt, timeZone, mealType, items])).digest('hex');
  return updateLog({ db, uid, type: 'meal', entryId, expectedVersion: version, eventAt: new Date(loggedAt), timeZone, fields: { mealType },
    mealEdit: { fingerprint, derive: (tx, before, day) => mealFields(db, tx, uid, day, draft, before) },
  });
}

async function ownedMeal(db: Firestore, tx: Transaction, uid: string, id: string) {
  const account = db.collection('users').doc(uid);
  const [owner, profile, meal] = await tx.getAll(account, account.collection('profiles').doc('main'), account.collection('mealLogs').doc(id));
  if (!owner.exists || !profile.exists) throw new MealError(404, 'ACCOUNT_NOT_INITIALIZED');
  const denied = accessError(owner.get('status'));
  if (denied) throw new MealError(403, denied);
  if (!meal.exists) throw new MealError(404, 'ENTRY_NOT_FOUND');
  return meal.data()!;
}

export function loadMealEditor(db: Firestore, uid: string, id: string): Promise<MealEditor> {
  return db.runTransaction(async tx => {
    const meal = await ownedMeal(db, tx, uid, id);
    const ids = [...new Set<string>(meal.items.map((line: DocumentData) => line.foodId))];
    const catalog = await firestoreCatalog(db).byIds(ids, tx);
    const lines = meal.items.map((line: DocumentData) => ({
      food: recordedFood(line), currentFood: catalog.get(line.foodId) ?? null, input: recordedInput(line),
    }));
    return { entryId: id, version: meal.version, localDate: meal.localDate, loggedAt: meal.loggedAt.toDate().toISOString(),
      timeZone: meal.timeZone, mealType: meal.mealType, lines };
  }, { readOnly: true });
}

export function previewMealEdit(db: Firestore, uid: string, id: string, version: number, items: PortionItem[]) {
  return db.runTransaction(async tx => {
    const before = await ownedMeal(db, tx, uid, id);
    if (before.version !== version) throw new MealError(409, 'VERSION_CONFLICT');
    const { estimate, previewTag } = await mealSources(db, tx, items, before);
    return { data: estimate, meta: { previewTag } };
  }, { readOnly: true });
}

function displayItem(item: DocumentData): MealJournalItem {
  // Older entries may have only the canonical consumed quantity.
  const source = isRecord(item.portionInput) ? item.portionInput : item;
  const foodName = typeof item.foodName === 'string' ? item.foodName : item.foodId || 'Thực phẩm';
  for (const [field, unit] of [['quantity', 'serving'], ['consumedGrams', 'g'], ['consumedMl', 'mL']] as const) {
    const amount = source[field];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) continue;
    if (unit !== 'g' && typeof item.consumedGrams === 'number') {
      return { foodName, amount, unit, converted: { amount: item.consumedGrams, unit: 'g' } };
    }
    if (unit !== 'mL' && typeof item.consumedMl === 'number') {
      return { foodName, amount, unit, converted: { amount: item.consumedMl, unit: 'mL' } };
    }
    return { foodName, amount, unit };
  }
  return { foodName, amount: null, unit: null };
}

export function mealJournalEntry(doc: QueryDocumentSnapshot): MealJournalEntry {
  const data = doc.data();
  const loggedAt = data.loggedAt instanceof Timestamp ? data.loggedAt.toDate() : parseLogInstant(data.loggedAt);
  if (!loggedAt || !validTimeZone(data.timeZone) || !types.includes(data.mealType) || !Array.isArray(data.items)) {
    throw new MealError(500, 'INVALID_STORED_MEAL');
  }
  const totals = {} as NutrientValues;
  const nutrientCompleteness = {} as NutritionPreview['nutrientCompleteness'];
  for (const key of nutrients) {
    const value = data.totals?.[key];
    totals[key] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    nutrientCompleteness[key] = totals[key] === null ? 'unknown' : data.nutrientCompleteness?.[key] === 'partial' ? 'partial' : 'complete';
  }
  return { entryId: doc.id, mealType: data.mealType, timeZone: data.timeZone, version: data.version,
    loggedAt: loggedAt.toISOString(), items: data.items.map(displayItem), totals, nutrientCompleteness };
}
