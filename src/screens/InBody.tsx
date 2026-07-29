import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { NumberField, parseNum, PushHeader } from '../components/Chrome';
import { Icon } from '../components/Icon';
import { DashedRule, SketchCard } from '../components/Sketch';
import { saveLeanMassKg } from '../db/config';
import { db, type InBodyReading } from '../db/schema';
import { formatDayLabel, todayISO } from '../domain/time';
import { useNav } from '../nav';

/**
 * InBody entry. Only the core five are required; everything else folds away
 * behind "more measurements" so a fast entry stays fast. Saving updates the
 * shared leanMassKg (fat-free mass) that the composition figure and the
 * projection both read.
 *
 * A draft row is created in Dexie the moment the form opens, before a
 * single field is filled in, and every field edit writes straight to that
 * row — nothing here is ever held only in component state. Reopening the
 * app with an unfinished reading resumes straight into the same draft, no
 * prompt. "Save reading" only validates the core five and flips the row's
 * status to complete; the numbers themselves were already saved as typed.
 */

type FieldSpec = { key: keyof InBodyReading; label: string; unit?: string };

const SEG_LEAN: FieldSpec[] = [
  { key: 'leanRightArm', label: 'right arm', unit: 'kg' },
  { key: 'leanLeftArm', label: 'left arm', unit: 'kg' },
  { key: 'leanTrunk', label: 'trunk', unit: 'kg' },
  { key: 'leanRightLeg', label: 'right leg', unit: 'kg' },
  { key: 'leanLeftLeg', label: 'left leg', unit: 'kg' },
];

const SEG_FAT: FieldSpec[] = [
  { key: 'fatRightArm', label: 'right arm', unit: 'kg' },
  { key: 'fatLeftArm', label: 'left arm', unit: 'kg' },
  { key: 'fatTrunk', label: 'trunk', unit: 'kg' },
  { key: 'fatRightLeg', label: 'right leg', unit: 'kg' },
  { key: 'fatLeftLeg', label: 'left leg', unit: 'kg' },
];

const METABOLIC: FieldSpec[] = [
  { key: 'visceralFatLevel', label: 'visceral fat level' },
  { key: 'basalMetabolicRate', label: 'basal metabolic rate', unit: 'kcal' },
  { key: 'totalBodyWaterL', label: 'total body water', unit: 'L' },
  { key: 'ecwTbwRatio', label: 'ECW/TBW ratio' },
  { key: 'proteinMassKg', label: 'protein mass', unit: 'kg' },
  { key: 'mineralMassKg', label: 'mineral mass', unit: 'kg' },
  { key: 'bmi', label: 'BMI' },
  { key: 'inbodyScore', label: 'InBody score' },
  { key: 'waistHipRatio', label: 'waist-hip ratio' },
];

export function InBodyForm({ today }: { today: string }) {
  const nav = useNav();
  const [values, setValues] = useState<Record<string, string>>({ date: today });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [photoPreview, setPhotoPreview] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // The draft row this form is writing to. Created immediately on open, or
  // resumed from whatever was left in progress — either way, by the time
  // the user can type anything, there is already a row for it to land in.
  const draftIdRef = useRef<number | null>(null);
  const draftPromiseRef = useRef<Promise<number> | null>(null);
  const [loadedDraftId, setLoadedDraftId] = useState<number | null>(null);

  // Third arg is the value used only until the very first query resolves —
  // `null` here, distinct from `undefined` (resolved, confirmed no draft
  // left open), so a fresh draft isn't created a beat too early, racing a
  // real one about to be resumed.
  const existingDraft = useLiveQuery(
    () => db.inbody.filter((r) => r.status === 'in_progress').first(),
    [],
    null,
  );

  if (existingDraft && loadedDraftId !== existingDraft.id) {
    draftIdRef.current = existingDraft.id ?? null;
    const loaded: Record<string, string> = { date: existingDraft.date };
    for (const [k, val] of Object.entries(existingDraft)) {
      if (['id', 'date', 'status', 'photoId'].includes(k)) continue;
      if (val === undefined || val === null) continue;
      loaded[k] = String(val);
    }
    setValues(loaded);
    setLoadedDraftId(existingDraft.id ?? null);
  }

  useEffect(() => {
    if (!existingDraft?.photoId) return;
    let cancelled = false;
    void db.photos.get(existingDraft.photoId).then((p) => {
      if (!cancelled && p) setPhotoPreview(p.blob);
    });
    return () => {
      cancelled = true;
    };
  }, [existingDraft?.photoId]);

  // No draft to resume, confirmed (not just "still loading") — start a
  // fresh one immediately, before a single field is filled in.
  useEffect(() => {
    if (existingDraft === null || existingDraft) return;
    if (draftIdRef.current || draftPromiseRef.current) return;
    void ensureDraftId();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDraft]);

  if (existingDraft === null) return <PushHeader title="inbody reading" />;

  async function ensureDraftId(): Promise<number> {
    if (draftIdRef.current) return draftIdRef.current;
    if (!draftPromiseRef.current) {
      draftPromiseRef.current = db.inbody.add({
        date: today,
        status: 'in_progress',
      }) as Promise<number>;
    }
    const id = await draftPromiseRef.current;
    draftIdRef.current = id;
    return id;
  }

  async function patchField(key: string, raw: string) {
    const id = await ensureDraftId();
    const patch: Partial<InBodyReading> =
      key === 'date' ? { date: raw || todayISO() } : { [key]: parseNum(raw) ?? undefined };
    await db.inbody.update(id, patch);
  }

  const v = (k: string) => values[k] ?? '';
  const setV = (k: string) => (val: string) => {
    setValues((s) => ({ ...s, [k]: val }));
    void patchField(k, val);
  };

  const core = {
    weightKg: parseNum(v('weightKg')),
    skeletalMuscleMassKg: parseNum(v('skeletalMuscleMassKg')),
    bodyFatMassKg: parseNum(v('bodyFatMassKg')),
    bodyFatPercent: parseNum(v('bodyFatPercent')),
    fatFreeMassKg: parseNum(v('fatFreeMassKg')),
  };
  const coreComplete = Object.values(core).every((x) => x !== null);

  async function attachPhoto(file: File) {
    const id = await ensureDraftId();
    const photoId = (await db.photos.add({
      date: v('date') || todayISO(),
      type: 'inbody',
      blob: file,
    })) as number;
    await db.inbody.update(id, { photoId });
    setPhotoPreview(file);
  }

  async function removePhoto() {
    const id = await ensureDraftId();
    const current = await db.inbody.get(id);
    await db.inbody.update(id, { photoId: undefined });
    if (current?.photoId) await db.photos.delete(current.photoId);
    setPhotoPreview(null);
  }

  async function save() {
    if (!coreComplete) return;
    setSaving(true);
    try {
      const id = await ensureDraftId();
      // Every field was already written to the draft as it was typed; this
      // final write only guarantees the very last keystroke landed before
      // the row flips to complete, and sets the shared lean mass the figure
      // and projection read from.
      await db.inbody.update(id, {
        date: v('date') || todayISO(),
        weightKg: core.weightKg!,
        skeletalMuscleMassKg: core.skeletalMuscleMassKg!,
        bodyFatMassKg: core.bodyFatMassKg!,
        bodyFatPercent: core.bodyFatPercent!,
        fatFreeMassKg: core.fatFreeMassKg!,
        status: 'complete',
      });
      await saveLeanMassKg(core.fatFreeMassKg!);
      nav.pop();
    } finally {
      setSaving(false);
    }
  }

  function Collapsible({
    id,
    title,
    fields,
  }: {
    id: string;
    title: string;
    fields: FieldSpec[];
  }) {
    const isOpen = open[id];
    return (
      <SketchCard filter="rough2" className="px-4 py-3">
        <button
          onClick={() => setOpen((s) => ({ ...s, [id]: !s[id] }))}
          className="flex w-full items-center justify-between"
        >
          <span className="hand text-[22px]">{title}</span>
          <span className="hand text-[20px] text-[var(--ink-muted)]">
            {isOpen ? 'close' : 'open'}
          </span>
        </button>
        {isOpen && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <NumberField
                key={f.key as string}
                label={f.label}
                unit={f.unit}
                value={v(f.key as string)}
                onChange={setV(f.key as string)}
                optional
              />
            ))}
          </div>
        )}
      </SketchCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PushHeader title="inbody reading" />

      <SketchCard className="px-4 py-4">
        <span className="hand text-[22px]">core</span>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="col-span-2 flex flex-col gap-1.5">
            <span className="hand text-[21px] text-[var(--ink-muted)]">date</span>
            <input
              type="date"
              value={v('date')}
              onChange={(e) => setV('date')(e.target.value)}
              className="tnum relative h-[56px] w-full bg-[var(--paper)] px-4 text-[20px] font-semibold outline-none"
              style={{ border: '2.2px solid var(--ink)', borderRadius: 4 }}
            />
          </label>
          <NumberField label="weight" unit="kg" value={v('weightKg')} onChange={setV('weightKg')} />
          <NumberField label="skeletal muscle" unit="kg" value={v('skeletalMuscleMassKg')} onChange={setV('skeletalMuscleMassKg')} />
          <NumberField label="body fat mass" unit="kg" value={v('bodyFatMassKg')} onChange={setV('bodyFatMassKg')} />
          <NumberField label="body fat" unit="%" value={v('bodyFatPercent')} onChange={setV('bodyFatPercent')} />
          <NumberField label="fat-free mass" unit="kg" value={v('fatFreeMassKg')} onChange={setV('fatFreeMassKg')} />
        </div>
      </SketchCard>

      <Collapsible id="lean" title="segmental lean" fields={SEG_LEAN} />
      <Collapsible id="fat" title="segmental fat" fields={SEG_FAT} />
      <Collapsible id="meta" title="more measurements" fields={METABOLIC} />

      {/* Printout photo */}
      <SketchCard filter="rough2" className="px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="hand text-[22px]">printout photo</span>
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
          <div className="mt-2 flex items-center gap-3">
            <img
              src={URL.createObjectURL(photoPreview)}
              alt="InBody printout"
              className="h-24 w-16 object-cover"
              style={{ border: '2px solid var(--rule)' }}
            />
            <button onClick={() => void removePhoto()} className="hand text-[19px] text-[var(--ink-muted)]">
              remove
            </button>
          </div>
        ) : (
          <Button variant="secondary" className="mt-2 w-full" onClick={() => fileRef.current?.click()}>
            Attach the slip
          </Button>
        )}
      </SketchCard>

      <p className="annot -mt-1 text-center text-[var(--success)]">✓ saved as you type</p>

      <Button onClick={save} disabled={!coreComplete || saving}>
        {saving ? 'Saving…' : 'Save reading'}
      </Button>
      {!coreComplete && (
        <p className="caption text-center">the five core numbers are all it needs</p>
      )}
    </div>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────

export function InBodyDetail({ id }: { id: number }) {
  const data = useLiveQuery(async () => {
    const reading = await db.inbody.get(id);
    const photo = reading?.photoId ? await db.photos.get(reading.photoId) : undefined;
    return { reading, photo };
  }, [id]);

  if (!data?.reading) return <PushHeader title="reading" />;
  const r = data.reading;

  const rows: [string, string][] = [
    ['weight', `${r.weightKg?.toFixed(1) ?? '—'} kg`],
    ['skeletal muscle', `${r.skeletalMuscleMassKg?.toFixed(1) ?? '—'} kg`],
    ['body fat mass', `${r.bodyFatMassKg?.toFixed(1) ?? '—'} kg`],
    ['body fat', `${r.bodyFatPercent?.toFixed(1) ?? '—'} %`],
    ['fat-free mass', `${r.fatFreeMassKg?.toFixed(1) ?? '—'} kg`],
  ];
  const extra: [string, FieldSpec[]][] = [
    ['segmental lean', SEG_LEAN],
    ['segmental fat', SEG_FAT],
    ['metabolic & health', METABOLIC],
  ];

  return (
    <div className="flex flex-col gap-4">
      <PushHeader title={formatDayLabel(r.date)} />
      <SketchCard className="px-5 py-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between border-b-[1.5px] border-dashed border-[var(--rule)] py-1.5 last:border-0">
            <span className="caption">{label}</span>
            <span className="tnum text-[17px] font-semibold">{value}</span>
          </div>
        ))}
      </SketchCard>

      {extra.map(([title, fields]) => {
        const present = fields.filter(
          (f) => (r as unknown as Record<string, unknown>)[f.key as string] !== undefined,
        );
        if (present.length === 0) return null;
        return (
          <SketchCard key={title} filter="rough2" className="px-5 py-4">
            <span className="hand text-[22px]">{title}</span>
            <div className="mt-1">
              {present.map((f) => (
                <div key={f.key as string} className="flex items-baseline justify-between py-1">
                  <span className="caption">{f.label}</span>
                  <span className="tnum text-[15px] font-semibold">
                    {String((r as unknown as Record<string, unknown>)[f.key as string])}
                    {f.unit ? ` ${f.unit}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </SketchCard>
        );
      })}

      {data.photo && (
        <SketchCard className="px-4 py-4">
          <span className="hand text-[22px]">printout</span>
          <img
            src={URL.createObjectURL(data.photo.blob)}
            alt="InBody printout"
            className="mt-2 w-full"
          />
        </SketchCard>
      )}
      <DashedRule />
      <p className="caption pb-2 text-center">
        fat-free mass from the latest reading drives the figure
      </p>
    </div>
  );
}
