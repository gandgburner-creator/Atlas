import { db, type FoodItem, type Plate, type PlateItem } from './schema';

/**
 * The food database: CRUD for foods and plates, plus the small queries the
 * log screen needs (recent, frequent, last quantity used). Every food is
 * editable and deletable, including seeded ones — labels change.
 */

export type NewFoodItem = Omit<FoodItem, 'id' | 'createdAt' | 'updatedAt'>;

export function addFoodItem(input: NewFoodItem): Promise<number> {
  const now = Date.now();
  return db.foodItems.add({ ...input, createdAt: now, updatedAt: now }) as Promise<number>;
}

export async function updateFoodItem(
  id: number,
  patch: Partial<NewFoodItem>,
): Promise<void> {
  await db.foodItems.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteFoodItem(id: number): Promise<void> {
  await db.foodItems.delete(id);
}

export type NewPlate = Omit<Plate, 'id' | 'createdAt' | 'updatedAt'>;

export function addPlate(input: NewPlate): Promise<number> {
  const now = Date.now();
  return db.plates.add({ ...input, createdAt: now, updatedAt: now }) as Promise<number>;
}

export async function updatePlate(
  id: number,
  patch: { name?: string; items?: PlateItem[] },
): Promise<void> {
  await db.plates.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deletePlate(id: number): Promise<void> {
  await db.plates.delete(id);
}

/** The quantity last logged for this food, standalone or via a plate — pre-fills the next entry. */
export async function getLastQuantity(foodId: number): Promise<number | undefined> {
  const rows = await db.foodLogs.where('foodId').equals(foodId).toArray();
  if (rows.length === 0) return undefined;
  return rows.reduce((latest, r) => ((r.id ?? 0) > (latest.id ?? 0) ? r : latest)).quantity;
}

/** Distinct foods, most recently logged first. Small window — recency, not history. */
export async function getRecentFoodIds(limit = 8): Promise<number[]> {
  const rows = await db.foodLogs.orderBy('id').reverse().limit(200).toArray();
  const seen = new Set<number>();
  const order: number[] = [];
  for (const r of rows) {
    if (seen.has(r.foodId)) continue;
    seen.add(r.foodId);
    order.push(r.foodId);
    if (order.length >= limit) break;
  }
  return order;
}

/** Foods logged most often, all-time — "the same eight things" surface here. */
export async function getFrequentFoodIds(limit = 8): Promise<number[]> {
  const rows = await db.foodLogs.toArray();
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.foodId, (counts.get(r.foodId) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

// ── Seed data ────────────────────────────────────────────────────────────

const SEED_FOODS: NewFoodItem[] = [
  { name: 'Chicken breast, raw skinless', unitType: 'per100g', kcal: 165, protein: 31.0, carbs: 0.0, fat: 3.6 },
  { name: 'Ground beef 80/20, raw', unitType: 'per100g', kcal: 254, protein: 17.0, carbs: 0.0, fat: 20.0 },
  { name: 'Kirkland nonfat Greek yogurt', unitType: 'per100g', kcal: 59, protein: 9.4, carbs: 4.4, fat: 0.4 },
  { name: 'Kirkland low-moisture mozzarella', unitType: 'per100g', kcal: 276, protein: 27.5, carbs: 3.6, fat: 17.4 },
  { name: 'Jasmine rice, dry', unitType: 'per100g', kcal: 360, protein: 7.0, carbs: 80.0, fat: 0.6 },
  { name: 'Jasmine rice, cooked', unitType: 'per100g', kcal: 130, protein: 2.5, carbs: 28.0, fat: 0.3 },
  { name: 'Potato, raw', unitType: 'per100g', kcal: 77, protein: 2.0, carbs: 17.0, fat: 0.1 },
  { name: 'Mixed vegetables', unitType: 'per100g', kcal: 35, protein: 2.0, carbs: 7.0, fat: 0.2 },
  { name: 'Broccoli', unitType: 'per100g', kcal: 34, protein: 2.8, carbs: 7.0, fat: 0.4 },
  { name: 'Banana', unitType: 'per100g', kcal: 89, protein: 1.1, carbs: 23.0, fat: 0.3 },
  { name: 'Apple', unitType: 'per100g', kcal: 52, protein: 0.3, carbs: 14.0, fat: 0.2 },
  { name: 'Mixed nuts', unitType: 'per100g', kcal: 607, protein: 20.0, carbs: 21.0, fat: 54.0, weighDontGuess: true },
  { name: 'Peanut butter', unitType: 'per100g', kcal: 588, protein: 25.0, carbs: 20.0, fat: 50.0, weighDontGuess: true },
  { name: 'Tahini', unitType: 'per100g', kcal: 595, protein: 17.0, carbs: 21.0, fat: 54.0, weighDontGuess: true },
  { name: 'Olive oil', unitType: 'per100g', kcal: 884, protein: 0.0, carbs: 0.0, fat: 100.0, weighDontGuess: true },
  { name: 'Butter', unitType: 'per100g', kcal: 717, protein: 0.9, carbs: 0.1, fat: 81.0, weighDontGuess: true },
  { name: 'Full cream milk', unitType: 'per100g', kcal: 61, protein: 3.2, carbs: 4.8, fat: 3.3 },
  { name: 'Large egg', unitType: 'unit', kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8 },
  { name: 'Fabryco 8" tortilla', unitType: 'unit', kcal: 113, protein: 2.8, carbs: 19.8, fat: 2.5 },
  { name: 'Whey isolate', unitType: 'scoop', kcal: 120, protein: 30.0, carbs: 2.0, fat: 0.5 },
];

/**
 * Seeds the food database and the two starter plates, once — if any food
 * already exists (seeded before, or the user added their own first), this
 * is a no-op, so it's safe to call on every app open.
 *
 * The check-then-insert runs inside one Dexie transaction so two calls
 * racing on the same page (React StrictMode deliberately double-invokes
 * mount effects to catch exactly this) can't both pass the "is it empty"
 * check before either has written anything — IndexedDB serializes the two
 * transactions, so the second one's count() always sees the first one's
 * inserts and correctly bails out.
 */
export async function seedFoodDatabase(): Promise<void> {
  await db.transaction('rw', [db.foodItems, db.plates], async () => {
    if ((await db.foodItems.count()) > 0) return;

    const now = Date.now();
    const ids: Record<string, number> = {};
    for (const f of SEED_FOODS) {
      const id = (await db.foodItems.add({ ...f, createdAt: now, updatedAt: now })) as number;
      ids[f.name] = id;
    }

    const chicken = ids['Chicken breast, raw skinless']!;
    const rice = ids['Jasmine rice, cooked']!;
    const veg = ids['Mixed vegetables']!;
    const oil = ids['Olive oil']!;
    const tahini = ids['Tahini']!;
    const yogurt = ids['Kirkland nonfat Greek yogurt']!;

    await db.plates.bulkAdd([
      {
        name: 'Plate A',
        items: [
          { foodId: chicken, quantity: 300 },
          { foodId: rice, quantity: 200 },
          { foodId: veg, quantity: 200 },
          { foodId: oil, quantity: 10 },
        ],
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Plate B',
        items: [
          { foodId: chicken, quantity: 200 },
          { foodId: rice, quantity: 200 },
          { foodId: veg, quantity: 200 },
          { foodId: tahini, quantity: 20 },
          { foodId: yogurt, quantity: 100 },
          { foodId: oil, quantity: 10 },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });
}
