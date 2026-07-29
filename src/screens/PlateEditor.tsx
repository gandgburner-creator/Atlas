import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { NumberField, parseNum, PushHeader } from '../components/Chrome';
import { SketchBorder, SketchCard } from '../components/Sketch';
import { deletePlate, updatePlate } from '../db/foods';
import { db, type FoodItem } from '../db/schema';
import { computeMacros, formatQuantity, sumMacros, unitLabel } from '../domain/food';
import { useNav } from '../nav';

/**
 * A plate is always created with real items already in it (from today's
 * log — see Food.tsx) so this screen only ever edits one: rename it, adjust
 * or remove an item, add another food, or delete the whole plate.
 */
export function PlateEditorScreen({ id }: { id?: number }) {
  const nav = useNav();
  const [name, setName] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const data = useLiveQuery(async () => {
    if (id === undefined) return undefined;
    const [plate, foods] = await Promise.all([db.plates.get(id), db.foodItems.orderBy('name').toArray()]);
    return { plate, foods };
  }, [id]);

  if (id === undefined || !data?.plate) {
    return <PushHeader title="plate" />;
  }
  const { plate, foods } = data;
  const foodById = new Map(foods.map((f) => [f.id as number, f]));
  const items = plate.items;
  const shownName = name ?? plate.name;

  async function renameTo(v: string) {
    setName(v);
    await updatePlate(id!, { name: v });
  }

  async function setQuantity(index: number, qty: number) {
    const next = items.map((it, i) => (i === index ? { ...it, quantity: qty } : it));
    await updatePlate(id!, { items: next });
  }

  async function removeItem(index: number) {
    await updatePlate(id!, { items: items.filter((_, i) => i !== index) });
  }

  async function addFood(food: FoodItem) {
    if (food.id === undefined) return;
    if (items.some((it) => it.foodId === food.id)) return;
    const qty = food.unitType === 'per100g' ? 100 : 1;
    await updatePlate(id!, { items: [...items, { foodId: food.id, quantity: qty }] });
    setQuery('');
  }

  async function remove() {
    await deletePlate(id!);
    nav.pop();
  }

  const macros = sumMacros(
    items
      .map((it) => {
        const f = foodById.get(it.foodId);
        return f ? computeMacros(f, it.quantity) : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null),
  );

  const q = query.trim().toLowerCase();
  const results = q ? foods.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 6) : [];

  return (
    <div className="flex flex-col gap-4">
      <PushHeader title="plate" />

      <div className="relative flex h-[52px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
        <SketchBorder filter="rough2" radius={4} strokeWidth={2.2} stroke="var(--field-stroke)" />
        <input
          value={shownName}
          onChange={(e) => void renameTo(e.target.value)}
          placeholder="plate name"
          className="relative w-full bg-transparent text-[17px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
        />
      </div>

      <SketchCard className="px-4 py-2">
        {items.map((it, i) => {
          const food = foodById.get(it.foodId);
          return (
            <div
              key={it.foodId}
              className="flex items-end gap-2 border-b-[1.5px] border-dashed border-[var(--rule)] py-2 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{food?.name ?? 'deleted food'}</p>
                {food && (
                  <div className="mt-1 w-28">
                    <NumberField
                      label=""
                      unit={unitLabel(food.unitType)}
                      value={String(it.quantity)}
                      onChange={(v) => {
                        const n = parseNum(v);
                        if (n !== null) void setQuantity(i, n);
                      }}
                      integer={food.unitType !== 'per100g'}
                    />
                  </div>
                )}
              </div>
              <button
                onClick={() => removeItem(i)}
                className="hand shrink-0 px-2 pb-3 text-[16px] text-[var(--ink-muted)]"
              >
                remove
              </button>
            </div>
          );
        })}
        {items.length === 0 && <p className="caption py-2">Nothing in this plate yet.</p>}
      </SketchCard>

      <p className="tnum caption">
        {Math.round(macros.kcal)} kcal · {Math.round(macros.protein)}g protein · {Math.round(macros.fat)}g fat
      </p>

      <div className="relative flex h-[48px] items-center bg-[var(--paper)] px-4">
        <SketchBorder filter="rough2" radius={4} strokeWidth={1.8} stroke="var(--rule)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="add a food to this plate"
          className="relative w-full bg-transparent text-[14px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
        />
      </div>
      {results.length > 0 && (
        <SketchCard filter="rough2" className="px-3 py-1">
          {results.map((f) => (
            <button
              key={f.id}
              onClick={() => addFood(f)}
              className="flex w-full items-center justify-between gap-2 border-b-[1.5px] border-dashed border-[var(--rule)] py-2 text-left last:border-0"
            >
              <span className="truncate text-[14px] font-medium">
                {f.name} · {formatQuantity(f.unitType, f.unitType === 'per100g' ? 100 : 1)}
              </span>
            </button>
          ))}
        </SketchCard>
      )}

      {confirmingDelete ? (
        <SketchCard className="px-4 py-3">
          <p className="caption">Delete this plate? This can't be undone.</p>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </Button>
            <Button className="flex-1" onClick={remove}>
              Delete
            </Button>
          </div>
        </SketchCard>
      ) : (
        <button
          onClick={() => setConfirmingDelete(true)}
          className="hand py-2 text-[18px] text-[var(--ink-muted)]"
        >
          delete this plate
        </button>
      )}
    </div>
  );
}
