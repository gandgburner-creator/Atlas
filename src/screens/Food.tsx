import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { NumberField, parseNum, TabHeader } from '../components/Chrome';
import { Icon } from '../components/Icon';
import { SketchBorder, SketchCard } from '../components/Sketch';
import { getCalorieTarget, getFatTarget, getProteinTarget, type MacroRange } from '../db/config';
import { addPlate, getFrequentFoodIds, getLastQuantity, getRecentFoodIds } from '../db/foods';
import { db, type FoodItem, type FoodLog, type Plate } from '../db/schema';
import {
  computeMacros,
  defaultQuantity,
  formatQuantity,
  sumMacros,
  unitLabel,
} from '../domain/food';
import { useNav } from '../nav';

/**
 * Food: a searchable database, plates for one-tap combos, and a running
 * daily total. Every log write lands the moment quantity is confirmed —
 * there is no separate submit step, and today's entries can be corrected
 * or removed at any time.
 */
export function FoodScreen({ today }: { today: string }) {
  const nav = useNav();
  const [query, setQuery] = useState('');
  const [activeFoodId, setActiveFoodId] = useState<number | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [busy, setBusy] = useState(false);

  const data = useLiveQuery(async () => {
    const [
      foods,
      plates,
      todayLogs,
      kcalTarget,
      proteinTarget,
      fatTarget,
      recentIds,
      frequentIds,
    ] = await Promise.all([
      db.foodItems.orderBy('name').toArray(),
      db.plates.toArray(),
      db.foodLogs.where('date').equals(today).toArray(),
      getCalorieTarget(),
      getProteinTarget(),
      getFatTarget(),
      getRecentFoodIds(8),
      getFrequentFoodIds(8),
    ]);
    return {
      foods,
      plates,
      todayLogs,
      kcalTarget,
      proteinTarget,
      fatTarget,
      recentIds,
      frequentIds,
    };
  }, [today]);

  if (!data) return null;
  const { foods, plates, todayLogs, kcalTarget, proteinTarget, fatTarget, recentIds, frequentIds } = data;

  const foodById = new Map(foods.map((f) => [f.id as number, f]));
  const totals = sumMacros(todayLogs);

  async function openFood(foodId: number) {
    if (activeFoodId === foodId) {
      setActiveFoodId(null);
      return;
    }
    const food = foodById.get(foodId);
    const last = await getLastQuantity(foodId);
    setQtyInput(String(last ?? defaultQuantity(food?.unitType ?? 'unit')));
    setActiveFoodId(foodId);
  }

  async function confirmLog(food: FoodItem) {
    const qty = parseNum(qtyInput);
    if (qty === null || qty <= 0 || food.id === undefined) return;
    const m = computeMacros(food, qty);
    await db.foodLogs.add({ date: today, foodId: food.id, quantity: qty, ...m });
    setActiveFoodId(null);
    setQtyInput('');
  }

  async function logPlate(plate: Plate) {
    if (plate.id === undefined) return;
    setBusy(true);
    try {
      const rows: Omit<FoodLog, 'id'>[] = [];
      for (const it of plate.items) {
        const food = foodById.get(it.foodId);
        if (!food) continue;
        const m = computeMacros(food, it.quantity);
        rows.push({ date: today, foodId: it.foodId, quantity: it.quantity, plateId: plate.id, ...m });
      }
      if (rows.length > 0) await db.foodLogs.bulkAdd(rows);
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(id?: number) {
    if (id === undefined) return;
    await db.foodLogs.delete(id);
  }

  async function saveTodayAsPlate() {
    // Aggregate today's distinct foods (summing repeats) into a fresh plate,
    // then open it for naming and adjustment — a real row from the first
    // tap, per the same autosave principle as everywhere else.
    const byFood = new Map<number, number>();
    for (const l of todayLogs) {
      // A quick entry has no food to put on a plate.
      if (l.foodId === null) continue;
      byFood.set(l.foodId, (byFood.get(l.foodId) ?? 0) + l.quantity);
    }
    if (byFood.size === 0) return;
    const id = await addPlate({
      name: 'New plate',
      items: [...byFood.entries()].map(([foodId, quantity]) => ({ foodId, quantity })),
    });
    nav.push({ name: 'plate-editor', id });
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? foods.filter((f) => f.name.toLowerCase().includes(q)) : foods;
  const sortedFull = [
    ...filtered.filter((f) => f.favourite),
    ...filtered.filter((f) => !f.favourite),
  ];
  const recentFoods = recentIds.map((id) => foodById.get(id)).filter((f): f is FoodItem => Boolean(f));
  const frequentFoods = frequentIds
    .map((id) => foodById.get(id))
    .filter((f): f is FoodItem => Boolean(f));

  return (
    <div className="flex flex-col gap-5">
      <TabHeader title="Food" annot="log · plates · database" />

      <TotalsCard totals={totals} kcalTarget={kcalTarget} proteinTarget={proteinTarget} fatTarget={fatTarget} />

      {plates.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="hand text-[24px]">plates</span>
          <div className="flex flex-col gap-2">
            {plates.map((p) => (
              <SketchCard key={p.id} filter="rough2" className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="hand truncate text-[21px]">{p.name}</p>
                  <p className="caption truncate">{p.items.length} items</p>
                </div>
                <button
                  onClick={() => nav.push({ name: 'plate-editor', id: p.id })}
                  className="hand shrink-0 px-1 text-[16px] text-[var(--ink-muted)]"
                >
                  edit
                </button>
                <Button
                  variant="secondary"
                  className="shrink-0 px-3 text-[14px]"
                  disabled={busy}
                  onClick={() => logPlate(p)}
                >
                  Log
                </Button>
              </SketchCard>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative flex h-[52px] items-center gap-2 bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
        <SketchBorder filter="rough2" radius={4} strokeWidth={2.2} stroke="var(--field-stroke)" />
        <span className="relative text-[var(--ink-muted)]">
          <Icon name="search" size={19} stroke="var(--ink-muted)" />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search foods"
          className="relative w-full bg-transparent text-[16px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
        />
      </div>

      {!q && recentFoods.length > 0 && (
        <FoodSection
          title="recent"
          foods={recentFoods}
          activeFoodId={activeFoodId}
          qtyInput={qtyInput}
          onQtyChange={setQtyInput}
          onOpen={openFood}
          onConfirm={confirmLog}
          onEdit={(id) => nav.push({ name: 'food-editor', id })}
        />
      )}

      {!q && frequentFoods.length > 0 && (
        <FoodSection
          title="frequent"
          foods={frequentFoods}
          activeFoodId={activeFoodId}
          qtyInput={qtyInput}
          onQtyChange={setQtyInput}
          onOpen={openFood}
          onConfirm={confirmLog}
          onEdit={(id) => nav.push({ name: 'food-editor', id })}
        />
      )}

      <FoodSection
        title={q ? 'results' : 'all foods'}
        foods={sortedFull}
        activeFoodId={activeFoodId}
        qtyInput={qtyInput}
        onQtyChange={setQtyInput}
        onOpen={openFood}
        onConfirm={confirmLog}
        onEdit={(id) => nav.push({ name: 'food-editor', id })}
      />

      <button
        onClick={() => nav.push({ name: 'food-editor' })}
        className="hand w-full py-2 text-[20px] text-[var(--accent)]"
      >
        + add food
      </button>

      {/* Today's log */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="hand text-[24px]">today</span>
          {todayLogs.length > 0 && (
            <button
              onClick={saveTodayAsPlate}
              className="hand text-[16px] text-[var(--ink-muted)] underline"
            >
              save as a plate
            </button>
          )}
        </div>
        {todayLogs.length === 0 ? (
          <p className="caption">Nothing logged yet today.</p>
        ) : (
          <SketchCard className="px-4 py-2">
            {todayLogs.map((l) => {
              const food = l.foodId === null ? undefined : foodById.get(l.foodId);
              return (
                <div
                  key={l.id}
                  className="flex items-center justify-between gap-2 border-b-[1.5px] border-dashed border-[var(--rule)] py-2 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{food?.name ?? 'deleted food'}</p>
                    <p className="tnum caption">
                      {food ? formatQuantity(food.unitType, l.quantity) : `× ${l.quantity}`} ·{' '}
                      {Math.round(l.kcal)} kcal
                    </p>
                  </div>
                  <button
                    onClick={() => removeEntry(l.id)}
                    className="hand shrink-0 px-2 text-[16px] text-[var(--ink-muted)]"
                  >
                    remove
                  </button>
                </div>
              );
            })}
          </SketchCard>
        )}
      </div>
    </div>
  );
}

// ── Totals ────────────────────────────────────────────────────────────────

function rangeStatus(value: number, range: MacroRange): 'under' | 'in' | 'over' {
  if (value < range.min) return 'under';
  if (value > range.max) return 'over';
  return 'in';
}

function TotalsCard({
  totals,
  kcalTarget,
  proteinTarget,
  fatTarget,
}: {
  totals: { kcal: number; protein: number; carbs: number; fat: number };
  kcalTarget: number;
  proteinTarget: MacroRange;
  fatTarget: MacroRange;
}) {
  const proteinState = rangeStatus(totals.protein, proteinTarget);
  const fatState = rangeStatus(totals.fat, fatTarget);
  const color = (s: 'under' | 'in' | 'over') => (s === 'in' ? 'var(--success)' : 'var(--ink)');

  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="hand text-[19px] text-[var(--ink-muted)]">calories</span>
          <span className="tnum text-[24px] font-semibold leading-tight">
            {Math.round(totals.kcal).toLocaleString()}
          </span>
          <span className="tnum caption">of {kcalTarget.toLocaleString()}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="hand text-[19px] text-[var(--ink-muted)]">protein</span>
          <span className="tnum text-[24px] font-semibold leading-tight" style={{ color: color(proteinState) }}>
            {Math.round(totals.protein)}g
          </span>
          <span className="tnum caption">
            {proteinTarget.min}-{proteinTarget.max}g
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="hand text-[19px] text-[var(--ink-muted)]">fat</span>
          <span className="tnum text-[24px] font-semibold leading-tight" style={{ color: color(fatState) }}>
            {Math.round(totals.fat)}g
          </span>
          <span className="tnum caption">
            {fatTarget.min}-{fatTarget.max}g
          </span>
        </div>
      </div>
    </SketchCard>
  );
}

// ── Food list / quantity entry ───────────────────────────────────────────

function FoodSection({
  title,
  foods,
  activeFoodId,
  qtyInput,
  onQtyChange,
  onOpen,
  onConfirm,
  onEdit,
}: {
  title: string;
  foods: FoodItem[];
  activeFoodId: number | null;
  qtyInput: string;
  onQtyChange: (v: string) => void;
  onOpen: (id: number) => void;
  onConfirm: (food: FoodItem) => void;
  onEdit: (id: number) => void;
}) {
  if (foods.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="annot">{title}</span>
      <SketchCard className="px-4 py-1">
        {foods.map((food, i) => (
          <FoodRow
            key={food.id}
            food={food}
            open={activeFoodId === food.id}
            qtyInput={qtyInput}
            onQtyChange={onQtyChange}
            onOpen={() => onOpen(food.id as number)}
            onConfirm={() => onConfirm(food)}
            onEdit={() => onEdit(food.id as number)}
            last={i === foods.length - 1}
          />
        ))}
      </SketchCard>
    </div>
  );
}

function FoodRow({
  food,
  open,
  qtyInput,
  onQtyChange,
  onOpen,
  onConfirm,
  onEdit,
  last,
}: {
  food: FoodItem;
  open: boolean;
  qtyInput: string;
  onQtyChange: (v: string) => void;
  onOpen: () => void;
  onConfirm: () => void;
  onEdit: () => void;
  last: boolean;
}) {
  return (
    <div className={`py-2 ${last ? '' : 'border-b-[1.5px] border-dashed border-[var(--rule)]'}`}>
      <div className="flex items-center gap-2">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="flex items-center gap-1.5">
            {food.favourite && <Icon name="star" size={14} stroke="var(--accent)" />}
            <span className="truncate text-[15px] font-medium">{food.name}</span>
          </span>
          {food.weighDontGuess && (
            <span
              className="mt-0.5 inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: 'var(--sunk)', color: 'var(--accent)', borderRadius: 3 }}
            >
              weigh, don't guess
            </span>
          )}
        </button>
        <button onClick={onEdit} className="hand shrink-0 px-1 text-[15px] text-[var(--ink-muted)]">
          edit
        </button>
      </div>
      {open && (
        <div className="mt-2 flex items-end gap-2">
          <div className="flex-1">
            <NumberField
              label={`quantity (${unitLabel(food.unitType)})`}
              value={qtyInput}
              onChange={onQtyChange}
              autoFocus
              integer={food.unitType !== 'per100g'}
            />
          </div>
          <Button onClick={onConfirm} disabled={parseNum(qtyInput) === null} className="shrink-0">
            Log
          </Button>
        </div>
      )}
    </div>
  );
}
