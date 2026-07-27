import { db, type ISODate } from '../db/schema';
import {
  getCalorieTarget,
  getCraftGoalMin,
  getFocusGoalMin,
  getTrainingState,
} from './../db/config';
import type { CommitmentId } from './commitments';
import { passRestDays, sessionFor } from './training';
import { fromISODate } from './time';

/**
 * Resolves which commitments are DONE today, from raw logs only. Done-ness
 * is generous by design: logging nutrition at all is a done day (adherence
 * is information, not a gate), and a rest day satisfies training.
 */

export interface DaySummary {
  doneIds: Set<CommitmentId>;
  kcalToday: number;
  kcalTarget: number;
  focusMinToday: number;
  focusGoalMin: number;
  craftMinToday: number;
  craftGoalMin: number;
  trainingSession: string;
  trainingPaused: boolean;
}

function dayRange(date: ISODate): [number, number] {
  const start = fromISODate(date).getTime();
  return [start, start + 86_400_000];
}

export async function summariseDay(date: ISODate): Promise<DaySummary> {
  const [sleep, weights, foods, workouts, life, kcalTarget, focusGoalMin, craftGoalMin, training] =
    await Promise.all([
      db.sleepLogs.get(date),
      db.weightLogs.get(date),
      db.foodLogs.where('date').equals(date).toArray(),
      db.workouts.where('date').equals(date).toArray(),
      db.lifeLogs.get(date),
      getCalorieTarget(),
      getFocusGoalMin(),
      getCraftGoalMin(),
      getTrainingState(),
    ]);

  const [t0, t1] = dayRange(date);
  const sessions = await db.focusSessions
    .where('start')
    .between(t0, t1)
    .toArray();

  const minutes = (area: 'work' | 'craft') =>
    sessions
      .filter((s) => (s.area ?? 'work') === area && s.completed)
      .reduce((sum, s) => sum + (s.end - s.start) / 60_000, 0);

  const focusMinToday = Math.round(minutes('work'));
  const craftMinToday = Math.round(minutes('craft'));
  const kcalToday = foods.reduce((s, f) => s + f.kcal, 0);

  const state = passRestDays(training, date);
  const trainingSession = sessionFor(state, date);
  const trainingPaused = Boolean(state.pause);

  const done = new Set<CommitmentId>();
  if (sleep) done.add('wake_time');
  if (weights) done.add('weight_log');
  if (foods.length > 0) done.add('nutrition');
  // A rest day IS the plan; a paused queue asks nothing of you.
  if (workouts.length > 0 || trainingSession === 'rest' || trainingPaused) {
    done.add('training_log');
  }
  if (life?.restBlock) done.add('rest_block');
  if (life?.call) done.add('calls');
  if (focusMinToday >= focusGoalMin) done.add('focus_hours');
  if (craftMinToday >= craftGoalMin) done.add('craft_hours');

  return {
    doneIds: done,
    kcalToday,
    kcalTarget,
    focusMinToday,
    focusGoalMin,
    craftMinToday,
    craftGoalMin,
    trainingSession,
    trainingPaused,
  };
}

/** 'h:mm' for durations — 3:45, 0:50. Digits stay tabular in the caller. */
export function formatHours(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
