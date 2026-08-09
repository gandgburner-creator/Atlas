import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The backup is only as good as its round trip: everything gathered by
 * buildBackup must reconstruct byte-for-byte via restoreBackup, including
 * photo blobs and the ids other rows (an InBody reading's photoId) point at.
 */

describe('backup and restore', () => {
  let db: typeof import('./schema').db;
  let backup: typeof import('./backup');

  beforeEach(async () => {
    const schema = await import('./schema');
    await schema.db.delete();
    await schema.db.open();
    db = schema.db;
    backup = await import('./backup');
  });

  it('round-trips every table, preserving ids and cross-table references', async () => {
    await db.sleepLogs.add({
      date: '2026-07-20',
      targetWake: '07:00',
      actualWake: '07:05',
      createdAt: 1,
      updatedAt: 1,
    });
    await db.weightLogs.add({ date: '2026-07-20', kg: 91.2 });
    const photoId = (await db.photos.add({
      date: '2026-07-20',
      type: 'inbody',
      blob: new Blob(['printout-bytes'], { type: 'image/jpeg' }),
    })) as number;
    const inbodyId = (await db.inbody.add({
      date: '2026-07-20',
      weightKg: 91,
      skeletalMuscleMassKg: 38,
      bodyFatMassKg: 18,
      bodyFatPercent: 20,
      fatFreeMassKg: 73,
      photoId,
      status: 'complete',
    })) as number;
    const workoutId = (await db.workouts.add({
      date: '2026-07-20',
      sessionType: 'back',
      exercises: [{ name: 'Pull-ups', sets: [{ reps: 8, weight: 0 }] }],
      status: 'complete',
    })) as number;
    await db.config.put({ key: 'calorieTarget', value: 2300 });

    const data = await backup.buildBackup(true);
    expect(data.photos).toHaveLength(1);
    expect(data.photos[0]?.base64.length).toBeGreaterThan(0);

    // Wipe everything, as if this were a fresh install.
    await db.delete();
    await db.open();
    expect(await db.workouts.count()).toBe(0);

    await backup.restoreBackup(data);

    const restoredWorkout = await db.workouts.get(workoutId);
    expect(restoredWorkout?.sessionType).toBe('back');
    expect(restoredWorkout?.exercises[0]?.sets).toHaveLength(1);

    const restoredInbody = await db.inbody.get(inbodyId);
    expect(restoredInbody?.photoId).toBe(photoId);

    const restoredPhoto = await db.photos.get(photoId);
    expect(restoredPhoto?.blob.type).toBe('image/jpeg');
    const text = await restoredPhoto?.blob.text();
    expect(text).toBe('printout-bytes');

    const cfg = await db.config.get('calorieTarget');
    expect(cfg?.value).toBe(2300);
  });

  it('excludes photos from the backup when includePhotos is false', async () => {
    await db.photos.add({ date: '2026-07-20', type: 'inbody', blob: new Blob(['x']) });
    const data = await backup.buildBackup(false);
    expect(data.photosIncluded).toBe(false);
    expect(data.photos).toHaveLength(0);
  });

  it('rejects a file that is not an Atlas backup', () => {
    expect(backup.looksLikeBackup({ hello: 'world' })).toBe(false);
    expect(backup.looksLikeBackup(null)).toBe(false);
    expect(backup.looksLikeBackup('a string')).toBe(false);
  });

  it('names the backup file after the date it was made', () => {
    expect(backup.backupFilename('2026-07-29')).toBe('atlas-backup-2026-07-29.json');
  });

  // ── Metadata and migration ───────────────────────────────────────────────

  it('stamps a full instant, so same-day backups are distinguishable', async () => {
    const data = await backup.buildBackup(false);
    // Date-only made two backups from one day identical in the one field
    // meant to tell them apart.
    expect(data.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Number.isNaN(Date.parse(data.exportedAt))).toBe(false);
  });

  it('says photos are included only when the file actually carries some', async () => {
    // Asked for, but there are none to include — the flag describes the
    // file, since that is what a restore reads it for.
    const empty = await backup.buildBackup(true);
    expect(empty.photos).toHaveLength(0);
    expect(empty.photosIncluded).toBe(false);

    await db.photos.add({ date: '2026-07-20', type: 'inbody', blob: new Blob(['x']) });
    expect((await backup.buildBackup(true)).photosIncluded).toBe(true);
  });

  it('normalises a version 1 backup rather than restoring the drift', async () => {
    const v1 = {
      version: 1,
      exportedAt: '2026-08-09',
      photosIncluded: false,
      sleepLogs: [],
      weightLogs: [],
      // The two shapes the old table carried at once.
      foodLogs: [
        { id: 1, date: '2026-07-27', itemId: 'quick', quantity: 1, kcal: 820, protein: 82, fat: 15, carbs: 75 },
        { id: 2, date: '2026-08-03', foodId: 1, quantity: 300, kcal: 495, protein: 93, fat: 10.8, carbs: 0 },
      ],
      // A session logged before `status` existed.
      workouts: [{ id: 1, date: '2026-07-28', sessionType: 'back', exercises: [] }],
      focusSessions: [], lifeLogs: [], photos: [], inbody: [],
      craftItems: [], letters: [], config: [], foodItems: [], plates: [],
    } as unknown as import('./backup').AtlasBackup;

    const migrated = backup.migrateBackup(v1);
    expect(migrated.version).toBe(backup.BACKUP_VERSION);

    const [quick, real] = migrated.foodLogs;
    // The meal is kept — its macros still sum into that day's total. It
    // just says plainly that it points at no food.
    expect(quick?.foodId).toBeNull();
    expect(quick?.source).toBe('quick');
    expect(quick?.kcal).toBe(820);
    expect((quick as unknown as Record<string, unknown>).itemId).toBeUndefined();
    // A row that was already fine is untouched.
    expect(real?.foodId).toBe(1);
    expect(real?.source).toBeUndefined();

    expect(migrated.workouts[0]?.status).toBe('complete');
  });

  it('restores an old backup already normalised', async () => {
    const v1 = {
      version: 1, exportedAt: '2026-08-09', photosIncluded: false,
      sleepLogs: [], weightLogs: [],
      foodLogs: [{ id: 1, date: '2026-07-27', itemId: 'quick', quantity: 1, kcal: 820, protein: 82, fat: 15, carbs: 75 }],
      workouts: [{ id: 1, date: '2026-07-28', sessionType: 'back', exercises: [] }],
      focusSessions: [], lifeLogs: [], photos: [], inbody: [],
      craftItems: [], letters: [], config: [], foodItems: [], plates: [],
    } as unknown as import('./backup').AtlasBackup;

    // Restore inserts rows directly, so no Dexie upgrade hook ever sees
    // them — without the migration the drift would come straight back.
    await backup.restoreBackup(v1);
    expect((await db.foodLogs.get(1))?.foodId).toBeNull();
    expect((await db.workouts.get(1))?.status).toBe('complete');
  });

  it('refuses a backup from a newer build instead of dropping what it cannot read', () => {
    const future = { version: backup.BACKUP_VERSION + 1 } as import('./backup').AtlasBackup;
    expect(backup.isFromNewerBuild(future)).toBe(true);
    expect(backup.isFromNewerBuild({ version: backup.BACKUP_VERSION } as import('./backup').AtlasBackup)).toBe(false);
  });
});
