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

    const data = await backup.buildBackup('2026-07-29', true);
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
    const data = await backup.buildBackup('2026-07-29', false);
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
});
