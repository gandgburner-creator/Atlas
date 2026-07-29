import { describe, expect, it } from 'vitest';
import { computeMacros, defaultQuantity, formatQuantity, sumMacros, unitLabel } from './food';

describe('food macro math', () => {
  it('scales per100g foods by grams/100, not by the raw quantity', () => {
    // Chicken breast: 165 kcal / 31.0P / 0.0C / 3.6F per 100g.
    const chicken = { unitType: 'per100g' as const, kcal: 165, protein: 31.0, carbs: 0, fat: 3.6 };
    const m = computeMacros(chicken, 300);
    expect(m.kcal).toBeCloseTo(495, 5);
    expect(m.protein).toBeCloseTo(93, 5);
    expect(m.fat).toBeCloseTo(10.8, 5);
  });

  it('scales unit and scoop foods by the count directly, not by /100', () => {
    const egg = { unitType: 'unit' as const, kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8 };
    const twoEggs = computeMacros(egg, 2);
    expect(twoEggs.kcal).toBe(144);
    expect(twoEggs.protein).toBeCloseTo(12.6, 5);

    const whey = { unitType: 'scoop' as const, kcal: 120, protein: 30, carbs: 2, fat: 0.5 };
    const oneScoop = computeMacros(whey, 1);
    expect(oneScoop.kcal).toBe(120);
  });

  it('never derives kcal from the macros — the label value passes through untouched', () => {
    // Deliberately inconsistent macros vs. label, as the real world sometimes is:
    // 100 kcal label but macros that would multiply out to a different number.
    const oddLabel = { unitType: 'per100g' as const, kcal: 100, protein: 50, carbs: 50, fat: 50 };
    const m = computeMacros(oddLabel, 100);
    // protein*4 + carbs*4 + fat*9 = 200+200+450 = 850, nowhere near 100 —
    // but computeMacros must still report the label's 100, not 850.
    expect(m.kcal).toBe(100);
  });

  it('sums a list of macro entries field by field', () => {
    const total = sumMacros([
      { kcal: 100, protein: 10, carbs: 5, fat: 2 },
      { kcal: 50, protein: 5, carbs: 2, fat: 1 },
    ]);
    expect(total).toEqual({ kcal: 150, protein: 15, carbs: 7, fat: 3 });
  });

  it('unit label and default quantity match the food\'s unit type', () => {
    expect(unitLabel('per100g')).toBe('g');
    expect(unitLabel('unit')).toBe('unit');
    expect(unitLabel('scoop')).toBe('scoop');
    expect(defaultQuantity('per100g')).toBe(100);
    expect(defaultQuantity('unit')).toBe(1);
    expect(defaultQuantity('scoop')).toBe(1);
  });

  it('formats a quantity with its unit, pluralising only counts, never grams', () => {
    expect(formatQuantity('per100g', 300)).toBe('300 g');
    expect(formatQuantity('unit', 1)).toBe('1 unit');
    expect(formatQuantity('unit', 2)).toBe('2 units');
    expect(formatQuantity('scoop', 1)).toBe('1 scoop');
    expect(formatQuantity('scoop', 2)).toBe('2 scoops');
  });
});
