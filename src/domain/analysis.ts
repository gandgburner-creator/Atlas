import { db } from '../db/schema';
import {
  getCalorieTarget,
  getCraftGoalMin,
  getFatTarget,
  getFocusGoalMin,
  getLeanMassKg,
  getModuleFlags,
  getProteinTarget,
  getTrainingState,
  getWeightPlan,
} from '../db/config';
import { bucketFor, durationOf, formatClock, formatDuration } from './sessionTime';
import { formatHours } from './today';
import { passRestDays, sessionFor } from './training';
import { addDays, formatDayLabel, toISODate } from './time';

/**
 * The pasteable summary: a human- and LLM-readable snapshot meant to be
 * dropped straight into a chat. Deliberately free of anything that only
 * means something inside this app — no row ids, no UUIDs, no epoch
 * timestamps. Every date is a plain calendar date; every number stands on
 * its own.
 */

export type AnalysisRange = '7' | '30' | 'all';

function rangeStart(range: AnalysisRange, today: string): string | null {
  if (range === '7') return addDays(today, -6);
  if (range === '30') return addDays(today, -29);
  return null;
}

const fmt1 = (n: number | undefined): string => (n === undefined ? '—' : n.toFixed(1));

export async function buildAnalysisMarkdown(
  range: AnalysisRange,
  today: string,
): Promise<string> {
  const start = rangeStart(range, today);
  const inRange = (date: string) => start === null || date >= start;

  const [
    kcalTarget,
    proteinTarget,
    fatTarget,
    focusGoalMin,
    craftGoalMin,
    weightPlan,
    leanMassKg,
    training,
    moduleFlags,
    sleepLogs,
    weightLogs,
    foodLogs,
    workouts,
    focusSessions,
    inbody,
  ] = await Promise.all([
    getCalorieTarget(),
    getProteinTarget(),
    getFatTarget(),
    getFocusGoalMin(),
    getCraftGoalMin(),
    getWeightPlan(),
    getLeanMassKg(),
    getTrainingState(),
    getModuleFlags(),
    db.sleepLogs.toArray(),
    db.weightLogs.toArray(),
    db.foodLogs.toArray(),
    db.workouts.toArray(),
    db.focusSessions.toArray(),
    db.inbody.toArray(),
  ]);

  const lines: string[] = [];
  const rangeLabel = range === '7' ? 'last 7 days' : range === '30' ? 'last 30 days' : 'everything';
  const passed = passRestDays(training, today);
  const nextSession = sessionFor(passed, today);

  lines.push(`# Atlas — analysis export (${rangeLabel})`);
  lines.push(`_as of ${formatDayLabel(today)}_`, '');

  // ── Current stats & targets ──────────────────────────────────────────
  lines.push('## Current stats & targets', '');
  lines.push(`- Weight target: ${weightPlan.targetKg} kg by ${formatDayLabel(weightPlan.targetDate)}`);
  lines.push(
    `- Food targets: ${kcalTarget} kcal/day · protein ${proteinTarget.min}-${proteinTarget.max}g · fat ${fatTarget.min}-${fatTarget.max}g`,
  );
  if (moduleFlags.work || moduleFlags.craft) {
    const parts = [
      moduleFlags.work ? `focus ${formatHours(focusGoalMin)}/day` : null,
      moduleFlags.craft ? `craft ${formatHours(craftGoalMin)}/day` : null,
    ].filter(Boolean);
    lines.push(`- Goals: ${parts.join(' · ')}`);
  }
  lines.push(
    `- Training split: ${training.split.join(', ')} (${training.mode} mode)${training.pause ? ' — paused' : ` — next up: ${nextSession}`}`,
  );
  if (moduleFlags.insight) {
    lines.push(`- Lean mass (from InBody): ${leanMassKg.toFixed(1)} kg`);
  }
  lines.push('');

  // ── Training ──────────────────────────────────────────────────────────
  lines.push('## Training', '');
  const sessions = workouts
    .filter((w) => w.status !== 'in_progress' && inRange(w.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sessions.length === 0) {
    lines.push('_No sessions logged in this range._', '');
  } else {
    for (const w of sessions) {
      const duration = durationOf(w);
      const when =
        w.startedAt === undefined
          ? ''
          : ` · ${bucketFor(w.startedAt)}, ${formatClock(w.startedAt)}${
              duration === null ? '' : `, ${formatDuration(duration)}`
            }`;
      lines.push(`### ${formatDayLabel(w.date)} — ${w.sessionType}${when}`, '');
      if (w.exercises.length === 0) {
        lines.push('_No sets logged._', '');
        continue;
      }
      lines.push('| Exercise | Sets (kg × reps) |', '|---|---|');
      for (const ex of w.exercises) {
        const setsStr = ex.sets
          .map((s) => (s.weight > 0 ? `${s.weight}×${s.reps}` : `${s.reps}`))
          .join(', ');
        lines.push(`| ${ex.name} | ${setsStr || '—'} |`);
      }
      lines.push('');
    }
  }

  // ── Weight & composition ──────────────────────────────────────────────
  lines.push('## Weight & composition', '');
  const weights = weightLogs
    .filter((w) => inRange(w.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weights.length > 0) {
    lines.push('| Date | Weight (kg) |', '|---|---|');
    for (const w of weights) lines.push(`| ${formatDayLabel(w.date)} | ${w.kg.toFixed(1)} |`);
    lines.push('');
  } else {
    lines.push('_No weight entries in this range._', '');
  }

  const inbodyRows = inbody
    .filter((r) => r.status !== 'in_progress' && inRange(r.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (inbodyRows.length > 0) {
    lines.push('### InBody readings', '');
    lines.push(
      '| Date | Weight (kg) | Skeletal muscle (kg) | Body fat % | Fat-free mass (kg) |',
      '|---|---|---|---|---|',
    );
    for (const r of inbodyRows) {
      lines.push(
        `| ${formatDayLabel(r.date)} | ${fmt1(r.weightKg)} | ${fmt1(r.skeletalMuscleMassKg)} | ${fmt1(r.bodyFatPercent)} | ${fmt1(r.fatFreeMassKg)} |`,
      );
    }
    lines.push('');
  }

  // ── Sleep ─────────────────────────────────────────────────────────────
  lines.push('## Sleep', '');
  const sleeps = sleepLogs
    .filter((s) => inRange(s.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sleeps.length > 0) {
    lines.push('| Date | Target wake | Actual wake |', '|---|---|---|');
    for (const s of sleeps) {
      lines.push(`| ${formatDayLabel(s.date)} | ${s.targetWake} | ${s.actualWake} |`);
    }
    lines.push('');
  } else {
    lines.push('_No sleep entries in this range._', '');
  }

  // ── Food adherence ────────────────────────────────────────────────────
  lines.push('## Food', '');
  const foodByDate = new Map<string, { kcal: number; protein: number; fat: number; carbs: number }>();
  for (const f of foodLogs) {
    if (!inRange(f.date)) continue;
    const cur = foodByDate.get(f.date) ?? { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    cur.kcal += f.kcal;
    cur.protein += f.protein;
    cur.fat += f.fat;
    cur.carbs += f.carbs;
    foodByDate.set(f.date, cur);
  }
  if (foodByDate.size > 0) {
    lines.push(
      '| Date | kcal | vs target | protein (g) | fat (g) | carbs (g) |',
      '|---|---|---|---|---|---|',
    );
    for (const [date, tot] of [...foodByDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const diff = Math.round(tot.kcal - kcalTarget);
      lines.push(
        `| ${formatDayLabel(date)} | ${Math.round(tot.kcal)} | ${diff >= 0 ? '+' : ''}${diff} | ${Math.round(tot.protein)} | ${Math.round(tot.fat)} | ${Math.round(tot.carbs)} |`,
      );
    }
    lines.push('');
  } else {
    lines.push('_No food entries in this range._', '');
  }

  // ── Focus hours by tag ────────────────────────────────────────────────
  lines.push('## Focus hours by tag', '');
  const byTag = new Map<string, { work: number; craft: number }>();
  for (const s of focusSessions) {
    if (!s.completed || s.end === undefined) continue;
    const date = toISODate(new Date(s.start));
    if (!inRange(date)) continue;
    const area = s.area ?? 'work';
    const hours = (s.end - s.start) / 3_600_000;
    const cur = byTag.get(s.tag) ?? { work: 0, craft: 0 };
    cur[area] += hours;
    byTag.set(s.tag, cur);
  }
  if (byTag.size > 0) {
    lines.push('| Tag | Work hours | Craft hours |', '|---|---|---|');
    for (const [tag, h] of [...byTag.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`| ${tag} | ${h.work.toFixed(1)} | ${h.craft.toFixed(1)} |`);
    }
    lines.push('');
  } else {
    lines.push('_No focus sessions in this range._', '');
  }

  return lines.join('\n');
}
