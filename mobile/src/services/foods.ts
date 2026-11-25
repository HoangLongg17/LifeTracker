import type { User } from 'firebase/auth';
import type { MealDraft, MealEditor, MealJournalEntry, PortionItem } from '../../../shared/food';
import { apiRequest } from '@/services/session';
import type { Food, FoodPage, NutritionPreview } from '@/utils/food';

export async function searchFoods(user: User, query: string, cursor?: string) {
  const params = new URLSearchParams({ q: query, limit: '20' });
  if (cursor) params.set('cursor', cursor);
  return await apiRequest(user, '/foods?' + params.toString(), 'GET') as FoodPage;
}
export async function getFood(user: User, id: string) {
  return await apiRequest(user, '/foods/' + encodeURIComponent(id), 'GET') as Food;
}

type EditTarget = Pick<MealEditor, 'entryId' | 'version'>;
const mealPath = (id: string) => '/me/logs/meal/' + encodeURIComponent(id);

export async function getMealEditor(user: User, id: string): Promise<MealEditor> {
  const result = await apiRequest(user, mealPath(id), 'GET') as MealEditor;
  if (result?.entryId !== id || !result.lines?.length) throw new Error('INVALID_MEAL_RESPONSE');
  return result;
}

export async function calculatePortion(user: User, items: PortionItem[], existing?: EditTarget) {
  const path = existing ? mealPath(existing.entryId) + '/preview' : '/nutrition/calculate';
  const response = await apiRequest(user, path, 'POST', { items, ...(existing && { version: existing.version }) }) as {
    data: NutritionPreview; meta: { previewTag: string };
  };
  if (!response?.meta?.previewTag || response.data?.items?.length !== items.length ||
      response.data.items.some((item, i) => item.foodId !== items[i].foodId)) throw new Error('INVALID_NUTRITION_RESPONSE');
  return { ...response.data, previewTag: response.meta.previewTag };
}

export async function saveMeal(user: User, draft: MealDraft, version?: number) {
  const { entryId, ...fields } = draft;
  const result = (version === undefined
    ? await apiRequest(user, '/me/logs/meal', 'POST', draft)
    : await apiRequest(user, mealPath(entryId), 'PATCH', { ...fields, version })) as { entryId: string; localDate: string; status: string };
  const statuses = version === undefined ? ['created', 'existing'] : ['updated'];
  if (result?.entryId !== entryId || !statuses.includes(result.status) || typeof result.localDate !== 'string') throw new Error('INVALID_MEAL_RESPONSE');
  return result.localDate;
}

export function deleteMeal(user: User, id: string, version: number) {
  return apiRequest(user, mealPath(id), 'DELETE', { version });
}

export async function getMealDay(user: User, date: string) {
  const items: MealJournalEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const path: string = '/me/logs/meal?date=' + encodeURIComponent(date) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const page = await apiRequest(user, path, 'GET') as { date: string; items: MealJournalEntry[]; nextCursor: string | null };
    if (page?.date !== date || !Array.isArray(page.items)) throw new Error('INVALID_MEAL_DAY');
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('INVALID_MEAL_CURSOR');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}
