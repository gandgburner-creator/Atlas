import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { NumberField, parseNum, PushHeader, YesNo } from '../components/Chrome';
import { caloriesWarning } from '../domain/plausible';
import { Icon } from '../components/Icon';
import { SketchBorder, SketchCard } from '../components/Sketch';
import { getModuleFlags } from '../db/config';
import { addFoodItem, deleteFoodItem, updateFoodItem } from '../db/foods';
import { db, type FoodUnitType } from '../db/schema';
import { DEFAULT_MODULE_FLAGS } from '../domain/commitments';
import { todayISO } from '../domain/time';
import { useNav } from '../nav';

const UNIT_OPTIONS: { id: FoodUnitType; label: string }[] = [
  { id: 'per100g', label: 'per 100g' },
  { id: 'unit', label: 'per unit' },
  { id: 'scoop', label: 'per scoop' },
];

/**
 * Add or edit a food — including seeded ones. Every value is editable, and
 * a food can be deleted outright; entries already logged against it keep
 * their own snapshotted numbers regardless.
 */
export function FoodEditorScreen({ id }: { id?: number }) {
  const nav = useNav();
  const existing = useLiveQuery(() => (id !== undefined ? db.foodItems.get(id) : undefined), [id]);
  const moduleFlags = useLiveQuery(getModuleFlags, [], DEFAULT_MODULE_FLAGS);

  const [loaded, setLoaded] = useState(id === undefined);
  const [name, setName] = useState('');
  const [unitType, setUnitType] = useState<FoodUnitType>('per100g');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [favourite, setFavourite] = useState(false);
  const [weighDontGuess, setWeighDontGuess] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (existing && !loaded) {
    setName(existing.name);
    setUnitType(existing.unitType);
    setKcal(String(existing.kcal));
    setProtein(String(existing.protein));
    setCarbs(String(existing.carbs));
    setFat(String(existing.fat));
    setFavourite(Boolean(existing.favourite));
    setWeighDontGuess(Boolean(existing.weighDontGuess));
    setLoaded(true);
    if (existing.photoId) {
      void db.photos.get(existing.photoId).then((p) => p && setPhotoPreview(p.blob));
    }
  }

  const values = {
    kcal: parseNum(kcal),
    protein: parseNum(protein),
    carbs: parseNum(carbs),
    fat: parseNum(fat),
  };
  const valid =
    name.trim().length > 0 &&
    values.kcal !== null &&
    values.protein !== null &&
    values.carbs !== null &&
    values.fat !== null;

  const kcalMismatch =
    values.kcal !== null &&
    values.protein !== null &&
    values.carbs !== null &&
    values.fat !== null
      ? caloriesWarning(values.kcal, values.protein, values.carbs, values.fat)
      : null;

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      const input = {
        name: name.trim(),
        unitType,
        kcal: values.kcal!,
        protein: values.protein!,
        carbs: values.carbs!,
        fat: values.fat!,
        favourite,
        weighDontGuess,
      };
      if (id !== undefined) await updateFoodItem(id, input);
      else await addFoodItem(input);
      nav.pop();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (id !== undefined) await deleteFoodItem(id);
    nav.pop();
  }

  async function attachPhoto(file: File) {
    if (id === undefined) return;
    const photoId = (await db.photos.add({
      date: todayISO(),
      type: 'food-label',
      blob: file,
    })) as number;
    await updateFoodItem(id, { photoId });
    setPhotoPreview(file);
  }

  return (
    <div className="flex flex-col gap-4">
      <PushHeader title={id === undefined ? 'add food' : 'edit food'} />

      <SketchCard className="px-4 py-4">
        <div className="flex flex-col gap-3">
          <div className="relative flex h-[52px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
            <SketchBorder filter="rough2" radius={4} strokeWidth={2.2} stroke="var(--field-stroke)" />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="food name"
              autoFocus={id === undefined}
              className="relative w-full bg-transparent text-[16px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
            />
          </div>

          <div className="flex gap-2">
            {UNIT_OPTIONS.map((u) => (
              <button
                key={u.id}
                onClick={() => setUnitType(u.id)}
                className="relative flex-1 py-2 text-[13px] font-semibold"
                style={
                  unitType === u.id
                    ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 5 }
                    : { color: 'var(--ink-muted)' }
                }
              >
                {unitType !== u.id && <SketchBorder radius={5} strokeWidth={1.8} />}
                <span className="relative">{u.label}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField label="calories" value={kcal} onChange={setKcal} integer />
            <NumberField label="protein" unit="g" value={protein} onChange={setProtein} />
            <NumberField label="carbs" unit="g" value={carbs} onChange={setCarbs} />
            <NumberField label="fat" unit="g" value={fat} onChange={setFat} />
          </div>

          {/* The label's calories stay authoritative — this only points out
              that the two numbers on the packet disagree, in case one of
              them was mistyped. Saving is unaffected either way. */}
          {kcalMismatch && (
            <p className="caption" style={{ color: 'var(--accent)' }}>
              {kcalMismatch} Saved as entered.
            </p>
          )}

          <div className="flex items-center justify-between border-t-[1.5px] border-dashed border-[var(--rule)] pt-3">
            <span className="hand text-[19px] text-[var(--ink-muted)]">favourite</span>
            <YesNo value={favourite} onChange={setFavourite} />
          </div>
          <div className="flex items-center justify-between">
            <span className="hand text-[19px] text-[var(--ink-muted)]">weigh, don't guess</span>
            <YesNo value={weighDontGuess} onChange={setWeighDontGuess} />
          </div>
        </div>
      </SketchCard>

      {id !== undefined && moduleFlags.photos && (
        <SketchCard filter="rough2" className="px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="hand text-[22px]">label photo</span>
            <Icon name="photo" size={22} stroke="var(--ink-muted)" />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void attachPhoto(file);
            }}
          />
          {photoPreview ? (
            <img
              src={URL.createObjectURL(photoPreview)}
              alt="Nutrition label"
              className="mt-2 h-24 w-16 object-cover"
              style={{ border: '2px solid var(--rule)' }}
            />
          ) : (
            <Button variant="secondary" className="mt-2 w-full" onClick={() => fileRef.current?.click()}>
              Attach the label
            </Button>
          )}
        </SketchCard>
      )}

      <Button onClick={save} disabled={!valid || saving}>
        {saving ? 'Saving…' : 'Save food'}
      </Button>

      {id !== undefined && (
        confirmingDelete ? (
          <SketchCard className="px-4 py-3">
            <p className="caption">
              Delete this food? Entries already logged with it keep their own numbers.
            </p>
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
            delete this food
          </button>
        )
      )}
    </div>
  );
}
