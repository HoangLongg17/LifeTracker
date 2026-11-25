import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { normalizeFood, nutrients, publishedFood } from '../src/services/foodCatalog';

type Seed = Record<string, unknown> & { foodId: string; retrievedAt: string };

export function validateSeed(input: unknown): Seed[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 400) {
    throw new Error('Danh mục phải có từ 1 đến 400 dòng trong một lần nhập.');
  }
  const ids = new Set<string>();
  return input.map((row, index) => {
    const id = row?.foodId;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,99}$/.test(id) || ids.has(id)) {
      throw new Error('Document ID trống, trùng hoặc không hợp lệ ở dòng ' + (index + 1));
    }
    ids.add(id);
    const food = publishedFood(id, row);
    if (!food || !food.sourceUrl || !food.retrievedAt || !food.sourceVersion || food.version !== 1
        || row.nameNormalized !== normalizeFood(food.foodName)
        || !Array.isArray(row.aliasesNormalized) || row.aliasesNormalized.some((s: unknown) => typeof s !== 'string' || !s || s !== normalizeFood(s))
        || nutrients.some(key => !Object.hasOwn(row, key)) || 'createdAt' in row || 'updatedAt' in row) {
      throw new Error('Dữ liệu hoặc thông tin nguồn không hợp lệ tại ' + id);
    }
    return { ...row, retrievedAt: food.retrievedAt } as Seed;
  });
}

export async function importFoods(db: Firestore, rows: Seed[]) {
  const refs = rows.map(row => db.collection('foodCatalog').doc(row.foodId));
  return db.runTransaction(async tx => {
    const docs = await tx.getAll(...refs);
    const missing: number[] = [];
    docs.forEach((doc, index) => {
      if (!doc.exists) { missing.push(index); return; }
      const seed = rows[index];
      const existing = doc.data()!;
      for (const key of Object.keys(seed)) {
        const value = key === 'retrievedAt' && existing[key] instanceof Timestamp
          ? existing[key].toDate().toISOString() : existing[key];
        if (!isDeepStrictEqual(value, seed[key])) {
          throw new Error('Xung đột tại ' + seed.foodId + ' (' + key + '). Giao dịch đã hủy.');
        }
      }
    });
    for (const index of missing) {
      const seed = rows[index];
      tx.create(refs[index], { ...seed, retrievedAt: Timestamp.fromDate(new Date(seed.retrievedAt)),
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
    return { created: missing.length, skipped: rows.length - missing.length };
  });
}

async function main(args: string[]) {
  const dryRun = args.length === 0 || (args.length === 1 && args[0] === '--dry-run');
  const apply = args.length === 3 && args[0] === '--apply' && args[1] === '--project';
  if (!dryRun && !apply) throw new Error('Dùng --dry-run hoặc --apply --project PROJECT_ID.');
  const rows = validateSeed(JSON.parse(readFileSync(resolve(__dirname, '../data/foodCatalog.json'), 'utf8')));
  if (dryRun) { console.log(rows.length + ' thực phẩm hợp lệ. Kiểm tra cục bộ hoàn tất.'); return; }
  if (!args[2] || args[2] !== process.env.FIREBASE_PROJECT_ID) {
    throw new Error('PROJECT_ID cần trùng FIREBASE_PROJECT_ID của backend.');
  }
  const { db } = require('../src/config/firebase') as typeof import('../src/config/firebase');
  try {
    const result = await importFoods(db, rows);
    const target = process.env.FIRESTORE_EMULATOR_HOST || 'Cloud Firestore';
    console.log(args[2] + ' / ' + target + ' / foodCatalog. Tạo ' + result.created + ', đã có ' + result.skipped + '.');
  } finally { await db.terminate(); }
}
if (require.main === module) main(process.argv.slice(2)).catch((err: Error) => { console.error(err.message); process.exitCode = 1; });
