import { db } from './schema';
import { DEFAULT_RAMP, type RampConfig } from '../domain/ramp';

/**
 * Typed doors onto the config KV table.
 *
 * Keys for later slices are named here so the shape is settled, but only
 * `ramp` is read or written in slice 1.
 */
export const CONFIG_KEYS = {
  ramp: 'ramp',
  calorieTarget: 'calorieTarget',
  splitDefinition: 'splitDefinition',
  currentPhase: 'currentPhase',
} as const;

async function get<T>(key: string): Promise<T | undefined> {
  const row = await db.config.get(key);
  return row?.value as T | undefined;
}

async function set<T>(key: string, value: T): Promise<void> {
  await db.config.put({ key, value });
}

export async function getRamp(): Promise<RampConfig | undefined> {
  const stored = await get<Partial<RampConfig>>(CONFIG_KEYS.ramp);
  if (!stored?.startDate) return undefined;
  // Merge over defaults so a ramp written by an older build still loads.
  return {
    startDate: stored.startDate,
    baselineWake: stored.baselineWake ?? DEFAULT_RAMP.baselineWake,
    steps: stored.steps ?? DEFAULT_RAMP.steps,
    repeats: stored.repeats ?? [],
  };
}

export async function saveRamp(ramp: RampConfig): Promise<void> {
  await set(CONFIG_KEYS.ramp, ramp);
}

/** First run: record the start date and seed the default six-week ramp. */
export async function initRamp(startDate: string): Promise<RampConfig> {
  const ramp: RampConfig = { ...DEFAULT_RAMP, startDate };
  await saveRamp(ramp);
  return ramp;
}
