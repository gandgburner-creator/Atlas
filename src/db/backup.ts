import {
  db,
  type ConfigEntry,
  type CraftItem,
  type FocusSession,
  type FoodItem,
  type FoodLog,
  type InBodyReading,
  type Letter,
  type LifeLog,
  type Plate,
  type SleepLog,
  type WeightLog,
  type Workout,
} from './schema';

/**
 * The full backup: every table, as plain arrays, restorable byte for byte —
 * including primary keys, so cross-table references (an InBody reading's
 * photoId, a workout id an old lastFinish points at) still resolve after a
 * restore. "A backup I can't restore is only half a backup."
 */

const BACKUP_VERSION = 1;

export interface PhotoBackup {
  id?: number;
  date: string;
  type: string;
  mime: string;
  base64: string;
}

export interface AtlasBackup {
  version: number;
  exportedAt: string; // ISO date — the backup's own metadata, not user data.
  photosIncluded: boolean;
  sleepLogs: SleepLog[];
  weightLogs: WeightLog[];
  foodLogs: FoodLog[];
  workouts: Workout[];
  focusSessions: FocusSession[];
  lifeLogs: LifeLog[];
  photos: PhotoBackup[];
  inbody: InBodyReading[];
  craftItems: CraftItem[];
  letters: Letter[];
  config: ConfigEntry[];
  foodItems: FoodItem[];
  plates: Plate[];
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function backupFilename(today: string): string {
  return `atlas-backup-${today}.json`;
}

/** Gather every table into one restorable object. */
export async function buildBackup(
  today: string,
  includePhotos: boolean,
): Promise<AtlasBackup> {
  const [
    sleepLogs,
    weightLogs,
    foodLogs,
    workouts,
    focusSessions,
    lifeLogs,
    photoRows,
    inbody,
    craftItems,
    letters,
    config,
    foodItems,
    plates,
  ] = await Promise.all([
    db.sleepLogs.toArray(),
    db.weightLogs.toArray(),
    db.foodLogs.toArray(),
    db.workouts.toArray(),
    db.focusSessions.toArray(),
    db.lifeLogs.toArray(),
    db.photos.toArray(),
    db.inbody.toArray(),
    db.craftItems.toArray(),
    db.letters.toArray(),
    db.config.toArray(),
    db.foodItems.toArray(),
    db.plates.toArray(),
  ]);

  const photos: PhotoBackup[] = includePhotos
    ? await Promise.all(
        photoRows.map(async (p) => ({
          id: p.id,
          date: p.date,
          type: p.type,
          mime: p.blob.type || 'image/jpeg',
          base64: await blobToBase64(p.blob),
        })),
      )
    : [];

  return {
    version: BACKUP_VERSION,
    exportedAt: today,
    photosIncluded: includePhotos,
    sleepLogs,
    weightLogs,
    foodLogs,
    workouts,
    focusSessions,
    lifeLogs,
    photos,
    inbody,
    craftItems,
    letters,
    config,
    foodItems,
    plates,
  };
}

/** Loose shape check — enough to reject a random JSON file, not a full schema. */
export function looksLikeBackup(data: unknown): data is AtlasBackup {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.version === 'number' &&
    Array.isArray(d.sleepLogs) &&
    Array.isArray(d.workouts) &&
    Array.isArray(d.config)
  );
}

/**
 * Rebuild the database from a backup, replacing everything currently
 * stored. Runs as one transaction so a failure partway through can't leave
 * the database half-old, half-restored.
 */
export async function restoreBackup(data: AtlasBackup): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.sleepLogs,
      db.weightLogs,
      db.foodLogs,
      db.workouts,
      db.focusSessions,
      db.lifeLogs,
      db.photos,
      db.inbody,
      db.craftItems,
      db.letters,
      db.config,
      db.foodItems,
      db.plates,
    ],
    async () => {
      await Promise.all([
        db.sleepLogs.clear(),
        db.weightLogs.clear(),
        db.foodLogs.clear(),
        db.workouts.clear(),
        db.focusSessions.clear(),
        db.lifeLogs.clear(),
        db.photos.clear(),
        db.inbody.clear(),
        db.craftItems.clear(),
        db.letters.clear(),
        db.config.clear(),
        db.foodItems.clear(),
        db.plates.clear(),
      ]);

      await Promise.all([
        db.sleepLogs.bulkAdd(data.sleepLogs),
        db.weightLogs.bulkAdd(data.weightLogs),
        db.foodLogs.bulkAdd(data.foodLogs),
        db.workouts.bulkAdd(data.workouts),
        db.focusSessions.bulkAdd(data.focusSessions),
        db.lifeLogs.bulkAdd(data.lifeLogs),
        db.inbody.bulkAdd(data.inbody),
        db.craftItems.bulkAdd(data.craftItems),
        db.letters.bulkAdd(data.letters),
        db.config.bulkAdd(data.config),
        // Absent on a backup made before the food rebuild — restore what exists.
        db.foodItems.bulkAdd(data.foodItems ?? []),
        db.plates.bulkAdd(data.plates ?? []),
      ]);

      if (data.photosIncluded && data.photos.length > 0) {
        await db.photos.bulkAdd(
          data.photos.map((p) => ({
            id: p.id,
            date: p.date,
            type: p.type,
            blob: base64ToBlob(p.base64, p.mime),
          })),
        );
      }
    },
  );
}
