import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { NumberField, parseNum } from '../components/Chrome';
import { SketchBorder, SketchCard } from '../components/Sketch';
import { getCalorieTarget } from '../db/config';
import { db } from '../db/schema';

/**
 * Nutrition capture: kcal is the one required number, macros welcome when
 * the label offers them. The day's total sits against the target as
 * information — a day over target is a number, not a verdict.
 */
export function NutritionCard({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');

  const data = useLiveQuery(async () => {
    const [foods, target] = await Promise.all([
      db.foodLogs.where('date').equals(today).toArray(),
      getCalorieTarget(),
    ]);
    return { foods, target };
  }, [today]);

  const total = (k: 'kcal' | 'protein' | 'fat' | 'carbs') =>
    Math.round((data?.foods ?? []).reduce((s, f) => s + (f[k] || 0), 0));

  async function add() {
    const k = parseNum(kcal);
    if (k === null || k < 0) return;
    await db.foodLogs.add({
      date: today,
      itemId: name.trim() || 'quick',
      quantity: 1,
      kcal: k,
      protein: parseNum(protein) ?? 0,
      fat: parseNum(fat) ?? 0,
      carbs: parseNum(carbs) ?? 0,
    });
    setName('');
    setKcal('');
    setProtein('');
    setFat('');
    setCarbs('');
    setOpen(false);
  }

  return (
    <SketchCard filter="rough2" className="px-5 pt-4 pb-5">
      <div className="flex items-center justify-between">
        <span className="hand text-[26px]">nutrition</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="hand px-2 py-1 text-[20px] text-[var(--accent)]"
        >
          {open ? 'close' : '+ log food'}
        </button>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="tnum text-[34px] font-semibold tracking-[-0.02em]">
          {total('kcal').toLocaleString()}
        </span>
        <span className="tnum caption">
          of {data?.target.toLocaleString() ?? '—'} kcal
        </span>
      </div>
      {(data?.foods.length ?? 0) > 0 && (
        <p className="tnum caption">
          P {total('protein')} · F {total('fat')} · C {total('carbs')} g
        </p>
      )}

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="relative flex h-[52px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
            <SketchBorder filter="rough2" radius={4} strokeWidth={2} stroke="var(--field-stroke)" />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="what was it (optional)"
              className="relative w-full bg-transparent text-[16px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="kcal" value={kcal} onChange={setKcal} autoFocus />
            <NumberField label="protein" unit="g" value={protein} onChange={setProtein} optional />
            <NumberField label="fat" unit="g" value={fat} onChange={setFat} optional />
            <NumberField label="carbs" unit="g" value={carbs} onChange={setCarbs} optional />
          </div>
          <Button onClick={add} disabled={parseNum(kcal) === null}>
            Add
          </Button>
        </div>
      )}

      {!open && (data?.foods.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-col">
          {data!.foods.map((f) => (
            <div
              key={f.id}
              className="flex items-baseline justify-between border-b-[1.5px] border-dashed border-[var(--rule)] py-1.5 last:border-0"
            >
              <span className="text-[14.5px] font-medium">
                {f.itemId === 'quick' ? 'entry' : f.itemId}
              </span>
              <span className="tnum caption">{Math.round(f.kcal)} kcal</span>
            </div>
          ))}
        </div>
      )}
    </SketchCard>
  );
}
