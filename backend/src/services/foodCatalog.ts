import { createHash } from 'node:crypto';
import { FieldPath, Timestamp, type Firestore, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import type { Food, FoodPage, Nutrient } from '../../../shared/food';

export const nutrients = ['energyKcal', 'proteinGrams', 'carbsGrams', 'fatGrams', 'fiberGrams', 'sodiumMg'] as const;
export function validFoodId(id: unknown): id is string {
  return typeof id === 'string' && !!id.trim() && !id.includes('/') && id !== '.' && id !== '..'
    && !/^__.*__$/.test(id) && Buffer.byteLength(id) <= 1500;
}
export function normalizeFood(text: string) {
  return text.normalize('NFD').toLowerCase().replace(/đ/g, 'd').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function label(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function dateString(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return null;
}

// Whitelist public fields. A missing nutrient remains null. Bad units or values
// make a record ineligible even when its publication status was set to active.
export function publishedFood(id: string, row?: DocumentData): Food | null {
  if (!row || row.status !== 'active' || row.foodId !== id || !label(row.foodName) || !label(row.foodSource)
      || !Number.isSafeInteger(row.version) || row.version < 1) return null;
  const basis = row.referenceBasis;
  if (!['100g', '100mL', 'serving'].includes(basis)) return null;
  const expectedUnit = basis === '100g' ? 'g' : basis === '100mL' ? 'mL' : 'serving';
  if (row.referenceUnit !== expectedUnit || !positive(row.referenceAmount)
      || (basis !== 'serving' && row.referenceAmount !== 100)) return null;
  const servingSize = row.servingSize ?? null;
  const servingUnit = row.servingUnit ?? null;
  const density = row.densityGramsPerMl ?? null;
  if (servingSize !== null || servingUnit !== null || basis === 'serving') {
    if (!positive(servingSize) || !['g', 'mL'].includes(servingUnit)) return null;
  }
  if (density !== null && !positive(density)) return null;
  const retrievedAt = dateString(row.retrievedAt);
  if (row.retrievedAt != null && !retrievedAt) return null;
  if (!label(row.sourceVersion) && !retrievedAt) return null;
  const sourceUrl = label(row.sourceUrl);
  if (sourceUrl && !URL.canParse(sourceUrl)) return null;
  if (sourceUrl && new URL(sourceUrl).protocol !== 'https:') return null;
  const values = {} as Record<Nutrient, number | null>;
  const completeness = {} as Food['completeness'];
  for (const key of nutrients) {
    const value = row[key] ?? null;
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return null;
    values[key] = value;
    completeness[key] = value === null ? 'unknown' : 'complete';
  }
  return {
    foodId: id, foodName: row.foodName.trim(), foodSource: row.foodSource.trim(), sourceFoodId: label(row.sourceFoodId),
    sourceVersion: label(row.sourceVersion), retrievedAt, sourceDescription: label(row.sourceDescription), sourceUrl,
    nameNormalized: normalizeFood(row.foodName),
    aliasesNormalized: Array.isArray(row.aliasesNormalized) ? row.aliasesNormalized.filter((a: unknown) => typeof a === 'string').map(normalizeFood) : [],
    foodState: label(row.foodState), dataType: label(row.dataType), category: label(row.category),
    referenceBasis: basis, referenceUnit: expectedUnit, referenceAmount: row.referenceAmount, servingSize, servingUnit,
    densityGramsPerMl: density, densitySourcePortionId: label(row.densitySourcePortionId),
    servingLabel: label(row.servingLabel), version: row.version, ...values, completeness,
  };
}
export class InvalidCatalogCursor extends Error {}

// Cursor binds the account, normalized filter, order and the result revision.
export function foodPage(catalog: Food[], uid: string, q: string, limit: number, cursor?: string): FoodPage {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const matches = catalog.filter(food => {
    const terms = normalizeFood([food.foodName, ...food.aliasesNormalized, food.foodSource, food.sourceFoodId,
      food.foodState, food.dataType, food.category, food.sourceDescription].filter(Boolean).join(' '));
    return q.split(' ').every(word => terms.includes(word));
  }).sort((a,b) => compare(a.nameNormalized, b.nameNormalized) || compare(a.foodId, b.foodId));
  const revision = createHash('sha256').update(JSON.stringify([uid, q, 'name-id-v1',
    matches.map(f => [f.nameNormalized, f.foodId, f.version])])).digest('base64url');
  let start = 0;
  if (cursor !== undefined) {
    try {
      const [signature, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      const position = matches.findIndex(f => f.foodId === id);
      if (signature !== revision || position < 0) throw new Error();
      start = position + 1;
    } catch { throw new InvalidCatalogCursor(); }
  }
  const items = matches.slice(start, start + limit);
  const nextCursor = start + items.length < matches.length
    ? Buffer.from(JSON.stringify([revision, items[items.length - 1].foodId])).toString('base64url') : null;
  return { items, nextCursor };
}

// Check the active IDs and Firestore update times on each search. Warm requests
// reuse the published values. Unpublished/deleted IDs never come from cache alone.
export function firestoreCatalog(db: Firestore) {
  const collection = db.collection('foodCatalog');
  const cache = new Map<string, { timestamp: Timestamp; food: Food | null }>();
  return {
    async list() {
      const query = collection.where('status', '==', 'active')
        .orderBy(FieldPath.documentId()).select('version').limit(100);
      const foods: Food[] = [];
      let page = await query.get();
      while (!page.empty) {
        const misses = [];
        for (const doc of page.docs) {
          const hit = cache.get(doc.id);
          if (hit && hit.timestamp.isEqual(doc.updateTime)) {
            if (hit.food) foods.push(hit.food);
          } else misses.push(doc.ref);
        }
        if (misses.length) {
          const docs = await db.getAll(...misses);
          for (const doc of docs) {
            const food = publishedFood(doc.id, doc.data());
            if (food) foods.push(food);
            if (doc.updateTime) {
              if (!cache.has(doc.id) && cache.size >= 150) cache.delete(cache.keys().next().value!);
              cache.set(doc.id, { timestamp: doc.updateTime, food });
            }
          }
        }
        if (page.size < 100) break;
        page = await query.startAfter(page.docs[page.size - 1]).get();
      }
      return foods;
    },
    async byIds(ids: string[], transaction?: Transaction) {
      const docs = await (transaction ?? db).getAll(...ids.map(id => collection.doc(id)));
      const selected = new Map<string, Food>();
      for (const doc of docs) {
        const food = publishedFood(doc.id, doc.data());
        if (food) selected.set(doc.id, food);
      }
      return selected;
    },
    async detail(id: string) {
      const doc = await collection.doc(id).get();
      return publishedFood(doc.id, doc.data());
    },
  };
}
