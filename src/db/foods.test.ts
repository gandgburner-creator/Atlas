import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

describe('the food database', () => {
  let db: typeof import('./schema').db;
  let foods: typeof import('./foods');

  beforeEach(async () => {
    const schema = await import('./schema');
    await schema.db.delete();
    await schema.db.open();
    db = schema.db;
    foods = await import('./foods');
  });

  it('seeds every listed food exactly once, with the label kcal authoritative', async () => {
    await foods.seedFoodDatabase();
    const all = await db.foodItems.toArray();
    expect(all.length).toBe(20); // 17 per100g + 2 unit + 1 scoop

    const chicken = all.find((f) => f.name === 'Chicken breast, raw skinless');
    expect(chicken?.unitType).toBe('per100g');
    expect(chicken?.kcal).toBe(165);
    expect(chicken?.protein).toBe(31.0);

    const egg = all.find((f) => f.name === 'Large egg');
    expect(egg?.unitType).toBe('unit');

    const whey = all.find((f) => f.name === 'Whey isolate');
    expect(whey?.unitType).toBe('scoop');

    // The five where calories hide in small volume differences.
    const flagged = all.filter((f) => f.weighDontGuess).map((f) => f.name).sort();
    expect(flagged).toEqual(
      ['Butter', 'Mixed nuts', 'Olive oil', 'Peanut butter', 'Tahini'].sort(),
    );
  });

  it('is idempotent — calling seed again never duplicates', async () => {
    await foods.seedFoodDatabase();
    await foods.seedFoodDatabase();
    expect(await db.foodItems.count()).toBe(20);
  });

  it('two concurrent seed calls (React StrictMode double-invokes the mount effect) never duplicate', async () => {
    await Promise.all([foods.seedFoodDatabase(), foods.seedFoodDatabase()]);
    expect(await db.foodItems.count()).toBe(20);
    expect(await db.plates.count()).toBe(2);
  });

  it('seeds Plate A and Plate B with the exact listed quantities', async () => {
    await foods.seedFoodDatabase();
    const plates = await db.plates.toArray();
    expect(plates.map((p) => p.name).sort()).toEqual(['Plate A', 'Plate B']);

    const chicken = (await db.foodItems.where('name').equals('Chicken breast, raw skinless').first())!;
    const rice = (await db.foodItems.where('name').equals('Jasmine rice, cooked').first())!;
    const oil = (await db.foodItems.where('name').equals('Olive oil').first())!;

    const plateA = plates.find((p) => p.name === 'Plate A')!;
    expect(plateA.items).toContainEqual({ foodId: chicken.id, quantity: 300 });
    expect(plateA.items).toContainEqual({ foodId: rice.id, quantity: 200 });
    expect(plateA.items).toContainEqual({ foodId: oil.id, quantity: 10 });

    const plateB = plates.find((p) => p.name === 'Plate B')!;
    expect(plateB.items).toHaveLength(6);
    expect(plateB.items).toContainEqual({ foodId: chicken.id, quantity: 200 });
  });

  it('a food is fully editable and deletable, including a seeded one', async () => {
    await foods.seedFoodDatabase();
    const chicken = (await db.foodItems.where('name').equals('Chicken breast, raw skinless').first())!;
    await foods.updateFoodItem(chicken.id!, { kcal: 170, favourite: true });
    const updated = await db.foodItems.get(chicken.id!);
    expect(updated?.kcal).toBe(170);
    expect(updated?.favourite).toBe(true);

    await foods.deleteFoodItem(chicken.id!);
    expect(await db.foodItems.get(chicken.id!)).toBeUndefined();
  });

  it('remembers the last quantity logged for a food', async () => {
    const id = await foods.addFoodItem({ name: 'Test food', unitType: 'per100g', kcal: 100, protein: 10, carbs: 10, fat: 1 });
    expect(await foods.getLastQuantity(id)).toBeUndefined();

    await db.foodLogs.add({ date: '2026-07-01', foodId: id, quantity: 150, kcal: 150, protein: 15, carbs: 15, fat: 1.5 });
    await db.foodLogs.add({ date: '2026-07-02', foodId: id, quantity: 220, kcal: 220, protein: 22, carbs: 22, fat: 2.2 });
    expect(await foods.getLastQuantity(id)).toBe(220);
  });

  it('surfaces recent foods most-recently-logged first, deduped', async () => {
    const a = await foods.addFoodItem({ name: 'A', unitType: 'unit', kcal: 1, protein: 1, carbs: 1, fat: 1 });
    const b = await foods.addFoodItem({ name: 'B', unitType: 'unit', kcal: 1, protein: 1, carbs: 1, fat: 1 });
    await db.foodLogs.add({ date: '2026-07-01', foodId: a, quantity: 1, kcal: 1, protein: 1, carbs: 1, fat: 1 });
    await db.foodLogs.add({ date: '2026-07-02', foodId: b, quantity: 1, kcal: 1, protein: 1, carbs: 1, fat: 1 });
    await db.foodLogs.add({ date: '2026-07-03', foodId: a, quantity: 1, kcal: 1, protein: 1, carbs: 1, fat: 1 });

    const recent = await foods.getRecentFoodIds(8);
    expect(recent).toEqual([a, b]); // a logged most recently, deduped to one entry
  });

  it('surfaces frequent foods by log count, most-logged first', async () => {
    const a = await foods.addFoodItem({ name: 'A', unitType: 'unit', kcal: 1, protein: 1, carbs: 1, fat: 1 });
    const b = await foods.addFoodItem({ name: 'B', unitType: 'unit', kcal: 1, protein: 1, carbs: 1, fat: 1 });
    for (let i = 0; i < 3; i++) {
      await db.foodLogs.add({ date: '2026-07-01', foodId: a, quantity: 1, kcal: 1, protein: 1, carbs: 1, fat: 1 });
    }
    await db.foodLogs.add({ date: '2026-07-01', foodId: b, quantity: 1, kcal: 1, protein: 1, carbs: 1, fat: 1 });

    const frequent = await foods.getFrequentFoodIds(8);
    expect(frequent[0]).toBe(a);
    expect(frequent).toContain(b);
  });
});
