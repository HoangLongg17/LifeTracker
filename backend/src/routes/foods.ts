import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyAccount } from '../middlewares/verifyAccount';
import { accessError } from '../services/logCommon';
import { foodPage, firestoreCatalog, InvalidCatalogCursor, normalizeFood, validFoodId } from '../services/foodCatalog';
import { calculatePortions, mealPreviewTag, PortionError, readPortionItems } from '../services/nutrition';

export function foodsRouter(auth: Pick<Auth, 'verifyIdToken'>, db: Firestore, catalog = firestoreCatalog(db)) {
  const router = Router();
  router.use(['/foods', '/nutrition/calculate'], verifyAccount(auth), async (_req, res, next) => {
    try {
      const user = await db.collection('users').doc(res.locals.identity.uid).get();
      if (!user.exists) { res.status(404).json({ code: 'ACCOUNT_NOT_INITIALIZED' }); return; }
      const denied = accessError(user.get('status'));
      if (denied) { res.status(403).json({ code: denied }); return; }
      next();
    } catch { res.status(503).json({ code: 'CATALOG_UNAVAILABLE' }); }
  });
  router.get('/foods', async (req, res) => {
    const { q = '', limit = '20', cursor } = req.query;
    if (typeof q !== 'string' || q.length > 150 || typeof limit !== 'string' || !/^[1-9]\d{0,2}$/.test(limit)
        || Number(limit) > 100 || (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 1500))) {
      res.status(400).json({ code: 'INVALID_SEARCH' }); return;
    }
    try {
      const normalized = normalizeFood(q);
      if (q.trim() && !normalized) { res.json({ items: [], nextCursor: null }); return; }
      res.json(foodPage(await catalog.list(), res.locals.identity.uid, normalized, Number(limit), cursor));
    } catch (error) {
      if (error instanceof InvalidCatalogCursor) res.status(400).json({ code: 'INVALID_CURSOR' });
      else res.status(503).json({ code: 'CATALOG_UNAVAILABLE' });
    }
  });
  router.get('/foods/:foodId', async (req, res) => {
    const id = req.params.foodId;
    if (!validFoodId(id)) {
      res.status(404).json({ code: 'FOOD_NOT_FOUND' }); return;
    }
    try {
      const item = await catalog.detail(id);
      if (!item) { res.status(404).json({ code: 'FOOD_NOT_FOUND' }); return; }
      res.json(item);
    } catch { res.status(503).json({ code: 'CATALOG_UNAVAILABLE' }); }
  });
  router.post('/nutrition/calculate', async (req, res) => {
    const requestId = randomUUID();
    res.set('X-Request-Id', requestId);
    try {
      const inputs = readPortionItems(req.body);
      const ids = [...new Set(inputs.map(item => item.foodId))];
      const selected = await catalog.byIds(ids);
      const data = calculatePortions(inputs, selected);
      res.json({ success: true, data, meta: { requestId, previewTag: mealPreviewTag(inputs, selected) } });
    } catch (error) {
      if (error instanceof PortionError) {
        const missing = error.code === 'FOOD_NOT_FOUND';
        res.status(missing ? 404 : 400).json({ success: false, error: {
          code: missing ? 'FOOD_NOT_FOUND' : 'VALIDATION_ERROR', message: error.message, requestId,
          fieldErrors: [{ field: error.field, code: error.code, message: error.message }],
        } });
      } else {
        res.status(503).json({ success: false, error: {
          code: 'CATALOG_UNAVAILABLE', message: 'Chưa đọc được danh mục thực phẩm.', requestId,
        } });
      }
    }
  });
  return router;
}
