import { useRef, useState } from 'react';
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
 * InBody entry. Only the core six are required; everything else folds away
 * behind "more measurements" so a fast entry stays fast. Saving updates the
 * shared leanMassKg (fat-free mass) that the composition figure and the
 * projection both read.
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
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const v = (k: string) => values[k] ?? '';
  const setV = (k: string) => (val: string) =>
    setValues((s) => ({ ...s, [k]: val }));

  const core = {
    weightKg: parseNum(v('weightKg')),
    skeletalMuscleMassKg: parseNum(v('skeletalMuscleMassKg')),
    bodyFatMassKg: parseNum(v('bodyFatMassKg')),
    bodyFatPercent: parseNum(v('bodyFatPercent')),
    fatFreeMassKg: parseNum(v('fatFreeMassKg')),
  };
  const coreComplete = Object.values(core).every((x) => x !== null);

  async function save() {
    if (!coreComplete) return;
    setSaving(true);
    try {
      let photoId: number | undefined;
      if (photo) {
        photoId = (await db.photos.add({
          date: v('date') || todayISO(),
          type: 'inbody',
          blob: photo,
        })) as number;
      }
      const reading: InBodyReading = {
        date: v('date') || todayISO(),
        weightKg: core.weightKg!,
        skeletalMuscleMassKg: core.skeletalMuscleMassKg!,
        bodyFatMassKg: core.bodyFatMassKg!,
        bodyFatPercent: core.bodyFatPercent!,
        fatFreeMassKg: core.fatFreeMassKg!,
        photoId,
      };
      for (const spec of [...SEG_LEAN, ...SEG_FAT, ...METABOLIC]) {
        const n = parseNum(v(spec.key as string));
        if (n !== null) (reading as unknown as Record<string, unknown>)[spec.key as string] = n;
      }
      await db.inbody.add(reading);
      // Fat-free mass IS the lean mass the figure and projection use.
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
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
        />
        {photo ? (
          <div className="mt-2 flex items-center gap-3">
            <img
              src={URL.createObjectURL(photo)}
              alt="InBody printout"
              className="h-24 w-16 object-cover"
              style={{ border: '2px solid var(--rule)' }}
            />
            <button onClick={() => setPhoto(null)} className="hand text-[19px] text-[var(--ink-muted)]">
              remove
            </button>
          </div>
        ) : (
          <Button variant="secondary" className="mt-2 w-full" onClick={() => fileRef.current?.click()}>
            Attach the slip
          </Button>
        )}
      </SketchCard>

      <Button onClick={save} disabled={!coreComplete || saving}>
        {saving ? 'Saving…' : 'Save reading'}
      </Button>
      {!coreComplete && (
        <p className="caption text-center">the six core numbers are all it needs</p>
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
    ['weight', `${r.weightKg.toFixed(1)} kg`],
    ['skeletal muscle', `${r.skeletalMuscleMassKg.toFixed(1)} kg`],
    ['body fat mass', `${r.bodyFatMassKg.toFixed(1)} kg`],
    ['body fat', `${r.bodyFatPercent.toFixed(1)} %`],
    ['fat-free mass', `${r.fatFreeMassKg.toFixed(1)} kg`],
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
