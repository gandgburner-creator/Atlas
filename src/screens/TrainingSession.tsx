import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { NumberField, parseNum, PushHeader } from '../components/Chrome';
import { SketchBorder, SketchCard } from '../components/Sketch';
import { deleteWorkout, updateWorkout } from '../db/config';
import { db, type WorkoutExercise, type WorkoutSet } from '../db/schema';
import { formatDayLabel } from '../domain/time';
import { useNav } from '../nav';

/** Edit or delete a past session's logged sets. */
export function TrainingSession({ id }: { id: number }) {
  const nav = useNav();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exercises, setExercises] = useState<WorkoutExercise[] | null>(null);
  const [newName, setNewName] = useState('');

  const workout = useLiveQuery(() => db.workouts.get(id), [id]);

  useEffect(() => {
    if (workout && exercises === null) setExercises(workout.exercises);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout]);

  if (!workout || exercises === null) {
    return (
      <div>
        <PushHeader title="session" />
      </div>
    );
  }

  function setSet(exIdx: number, setIdx: number, patch: Partial<WorkoutSet>) {
    setExercises((prev) => {
      const next = [...(prev ?? [])];
      const ex = next[exIdx];
      if (!ex) return prev;
      const sets = ex.sets.map((s, i) => (i === setIdx ? { ...s, ...patch } : s));
      next[exIdx] = { ...ex, sets };
      return next;
    });
  }

  function addSet(exIdx: number) {
    setExercises((prev) => {
      const next = [...(prev ?? [])];
      const ex = next[exIdx];
      if (!ex) return prev;
      const last = ex.sets[ex.sets.length - 1];
      next[exIdx] = { ...ex, sets: [...ex.sets, { reps: last?.reps ?? 8, weight: last?.weight ?? 0 }] };
      return next;
    });
  }

  function removeSet(exIdx: number, setIdx: number) {
    setExercises((prev) => {
      const next = [...(prev ?? [])];
      const ex = next[exIdx];
      if (!ex) return prev;
      next[exIdx] = { ...ex, sets: ex.sets.filter((_, i) => i !== setIdx) };
      return next;
    });
  }

  function removeExercise(exIdx: number) {
    setExercises((prev) => (prev ?? []).filter((_, i) => i !== exIdx));
  }

  function addExercise() {
    if (!newName.trim()) return;
    setExercises((prev) => [...(prev ?? []), { name: newName.trim(), sets: [{ reps: 8, weight: 0 }] }]);
    setNewName('');
  }

  async function save() {
    setSaving(true);
    try {
      await updateWorkout(id, exercises ?? []);
      nav.pop();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    await deleteWorkout(id);
    nav.pop();
  }

  return (
    <div className="flex flex-col gap-4">
      <PushHeader title={workout.sessionType} />
      <p className="annot -mt-2">{formatDayLabel(workout.date)}</p>

      {exercises.length === 0 && (
        <p className="caption">No sets were logged for this session.</p>
      )}

      {exercises.map((ex, exIdx) => (
        <SketchCard key={`${ex.name}-${exIdx}`} className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <span className="hand text-[24px]">{ex.name}</span>
            <button
              onClick={() => removeExercise(exIdx)}
              className="hand text-[16px] text-[var(--ink-muted)]"
            >
              remove
            </button>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {ex.sets.map((s, setIdx) => (
              <div key={setIdx} className="flex items-end gap-2">
                <div className="flex-1">
                  <NumberField
                    label={`set ${setIdx + 1} · kg`}
                    value={s.weight > 0 ? String(s.weight) : ''}
                    onChange={(v) => setSet(exIdx, setIdx, { weight: parseNum(v) ?? 0 })}
                  />
                </div>
                <div className="flex-1">
                  <NumberField
                    label="reps"
                    value={String(s.reps)}
                    onChange={(v) => setSet(exIdx, setIdx, { reps: parseNum(v) ?? 0 })}
                    integer
                  />
                </div>
                <button
                  onClick={() => removeSet(exIdx, setIdx)}
                  className="hand h-[52px] px-1 text-[16px] text-[var(--ink-muted)]"
                >
                  drop
                </button>
              </div>
            ))}
            <button
              onClick={() => addSet(exIdx)}
              className="hand py-1 text-[15px] text-[var(--ink-muted)]"
            >
              + add a set
            </button>
          </div>
        </SketchCard>
      ))}

      <SketchCard filter="rough2" className="flex items-center gap-2 px-4 py-3">
        <div className="relative flex h-[48px] flex-1 items-center bg-[var(--paper)] px-3">
          <SketchBorder filter="rough2" radius={4} strokeWidth={1.8} />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="forgot to log something?"
            className="relative w-full bg-transparent text-[14px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
          />
        </div>
        <Button variant="secondary" onClick={addExercise} disabled={!newName.trim()}>
          Add
        </Button>
      </SketchCard>

      <Button onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </Button>

      {confirmingDelete ? (
        <SketchCard className="px-4 py-3">
          <p className="caption">Delete this session? It cannot be undone.</p>
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
          delete this session
        </button>
      )}
    </div>
  );
}
