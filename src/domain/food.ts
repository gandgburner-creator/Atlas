import type { FoodItem, FoodUnitType } from '../db/schema';

/**
 * Pure macro math. `kcal` on a FoodItem is the LABEL value, per the food's
 * unit — authoritative, never recomputed from protein/carbs/fat, since the
 * two don't always agree and the label is what's wanted. A logged entry
 * snapshots the result of scaling that label by quantity, so correcting a
 * food later never rewrites what was actually eaten on a past day.
 */

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const EMPTY_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

/** The unit the quantity field is in, for display. */
export function unitLabel(unitType: FoodUnitType): string {
  if (unitType === 'per100g') return 'g';
  return unitType;
}

/** A sane starting quantity when logging a food for the first time. */
export function defaultQuantity(unitType: FoodUnitType): number {
  return unitType === 'per100g' ? 100 : 1;
}

/**
 * Scale a food's per-unit macros by quantity. `per100g` foods store macros
 * per 100g, so the factor is quantity/100; `unit` and `scoop` foods store
 * macros per one, so the factor is the count itself.
 */
export function computeMacros(
  food: Pick<FoodItem, 'unitType' | 'kcal' | 'protein' | 'carbs' | 'fat'>,
  quantity: number,
): Macros {
  const factor = food.unitType === 'per100g' ? quantity / 100 : quantity;
  return {
    kcal: food.kcal * factor,
    protein: food.protein * factor,
    carbs: food.carbs * factor,
    fat: food.fat * factor,
  };
}

export function sumMacros(entries: Macros[]): Macros {
  return entries.reduce(
    (sum, m) => ({
      kcal: sum.kcal + m.kcal,
      protein: sum.protein + m.protein,
      carbs: sum.carbs + m.carbs,
      fat: sum.fat + m.fat,
    }),
    { ...EMPTY_MACROS },
  );
}

/** e.g. "300 g" or "2 scoops" (pluralised only for unit/scoop, never for grams). */
export function formatQuantity(unitType: FoodUnitType, quantity: number): string {
  if (unitType === 'per100g') return `${quantity} g`;
  const unit = quantity === 1 ? unitType : `${unitType}s`;
  return `${quantity} ${unit}`;
}
