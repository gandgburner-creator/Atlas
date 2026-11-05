/**
 * The exercise library behind the custom workout builder.
 *
 * Every exercise says which muscles it works (primary or secondary) and at
 * what ANGLE: the line of force or position that decides which part of the
 * muscle takes the load. That is what turns a pile of exercises into a chart
 * of what a session actually covers: an incline press and a flat press both
 * say "chest", but they hit different parts of it.
 *
 * The data is a compact table so it can be read and corrected at a glance:
 *   group | name | equipment | volume multiplier | reps | primary | secondary | angles
 * Multipliers follow the program: x1 machine/cable/barbell, x2 dumbbells or
 * per-side work, x4 per-hand work with reps per leg, x0 counts as a set but
 * adds no volume.
 */

export type Group = 'legs' | 'chest' | 'back' | 'shoulders' | 'arms' | 'core';
export const GROUPS: Group[] = ['legs', 'chest', 'back', 'shoulders', 'arms', 'core'];

export type Equip = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight';
export const EQUIPMENT: Equip[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'];

export const MUSCLES_BY_GROUP: Record<Group, string[]> = {
  legs: ['quads', 'hamstrings', 'glutes', 'adductors', 'abductors', 'calves'],
  chest: ['upper chest', 'mid chest', 'lower chest'],
  back: ['lats', 'mid back', 'traps'],
  shoulders: ['front delts', 'side delts', 'rear delts'],
  arms: ['biceps', 'triceps', 'forearms'],
  core: ['abs', 'obliques', 'lower back', 'hip flexors'],
};

/** The angles a well-rounded session for each body part would touch. */
export const ANGLES_BY_GROUP: Record<Group, string[]> = {
  legs: ['squat pattern', 'hinge', 'knee extension', 'knee flexion', 'hip extension', 'hip abduction', 'hip adduction', 'calf raise'],
  chest: ['incline press', 'flat press', 'decline press', 'chest fly'],
  back: ['vertical pull', 'horizontal pull', 'straight-arm pull'],
  shoulders: ['overhead press', 'lateral raise', 'rear delt fly'],
  arms: ['curl (stretched)', 'curl (standard)', 'curl (neutral grip)', 'pushdown', 'overhead extension'],
  core: ['crunch', 'leg raise', 'anti-extension', 'rotation'],
};

export interface LibExercise {
  id: string;
  group: Group;
  name: string;
  equip: Equip;
  mult: number;
  bodyweight: boolean;
  repLow: number;
  repHigh: number;
  rest: number;
  primary: string[];
  secondary: string[];
  angles: string[];
}

const RAW = `
legs|Barbell Back Squat|barbell|1|6-10|quads,glutes|adductors,lower back|squat pattern
legs|Barbell Front Squat|barbell|1|6-10|quads|glutes,abs,lower back|squat pattern
legs|Hack Squat|machine|1|8-12|quads|glutes|squat pattern
legs|Pendulum Squat|machine|1|8-12|quads|glutes|squat pattern
legs|Smith Machine Squat|machine|1|8-12|quads,glutes|adductors|squat pattern
legs|Belt Squat|machine|1|8-12|quads,glutes|adductors|squat pattern
legs|Leg Press|machine|1|10-12|quads,glutes|adductors,hamstrings|squat pattern
legs|Narrow-Stance Leg Press|machine|1|10-12|quads|glutes|squat pattern
legs|High-Foot Leg Press|machine|1|10-12|glutes,hamstrings|quads|squat pattern,hip extension
legs|Goblet Squat|dumbbell|1|10-15|quads,glutes|abs,adductors|squat pattern
legs|Sissy Squat|bodyweight|1|10-15|quads||knee extension,squat pattern
legs|DB Bulgarian Split Squat|dumbbell|4|8-12|quads,glutes|adductors|squat pattern,single-leg
legs|DB Walking Lunge|dumbbell|4|10-14|quads,glutes|hamstrings,adductors|squat pattern,single-leg
legs|DB Reverse Lunge|dumbbell|4|8-12|glutes,quads|hamstrings|squat pattern,single-leg
legs|Barbell Lunge|barbell|2|8-12|quads,glutes|hamstrings,adductors|squat pattern,single-leg
legs|DB Step-Up|dumbbell|4|8-12|quads,glutes|calves|squat pattern,single-leg
legs|Leg Extension|machine|1|10-15|quads||knee extension
legs|Single-Leg Extension|machine|1|10-15|quads||knee extension,single-leg
legs|Seated Leg Curl|machine|1|10-12|hamstrings|calves|knee flexion
legs|Lying Leg Curl|machine|1|10-12|hamstrings|calves|knee flexion
legs|Standing Leg Curl|machine|1|10-12|hamstrings||knee flexion,single-leg
legs|Nordic Curl|bodyweight|1|5-8|hamstrings|glutes,calves|knee flexion
legs|Romanian Deadlift|barbell|1|6-10|hamstrings,glutes|lower back,forearms|hinge
legs|DB Romanian Deadlift|dumbbell|2|8-12|hamstrings,glutes|lower back,forearms|hinge
legs|Stiff-Leg Deadlift|barbell|1|6-10|hamstrings|glutes,lower back|hinge
legs|Conventional Deadlift|barbell|1|3-6|glutes,hamstrings|quads,traps,lats,forearms,lower back|hinge
legs|Sumo Deadlift|barbell|1|4-8|glutes,adductors|quads,hamstrings,lower back,forearms|hinge,squat pattern
legs|Trap-Bar Deadlift|barbell|1|5-8|quads,glutes|hamstrings,traps,lower back|hinge,squat pattern
legs|Good Morning|barbell|1|8-12|hamstrings,lower back|glutes|hinge
legs|Cable Pull-Through|cable|1|10-15|glutes,hamstrings|lower back|hinge,hip extension
legs|Hip Thrust|barbell|1|8-12|glutes|hamstrings,quads|hip extension
legs|Machine Hip Thrust|machine|1|8-12|glutes|hamstrings|hip extension
legs|Barbell Glute Bridge|barbell|1|10-15|glutes|hamstrings|hip extension
legs|Back Extension (45°)|bodyweight|1|10-15|glutes,hamstrings|lower back|hinge,hip extension
legs|Reverse Hyperextension|machine|1|10-15|glutes|hamstrings,lower back|hip extension
legs|Cable Kickback|cable|1|10-15|glutes|hamstrings|hip extension,single-leg
legs|Hip Abduction Machine|machine|1|12-15|abductors,glutes||hip abduction
legs|Cable Hip Abduction|cable|1|12-15|abductors,glutes||hip abduction,single-leg
legs|Hip Adduction Machine|machine|1|12-15|adductors|| hip adduction
legs|Cable Hip Adduction|cable|1|12-15|adductors||hip adduction,single-leg
legs|Standing Calf Raise|machine|1|8-12|calves||calf raise
legs|Seated Calf Raise|machine|1|12-15|calves||calf raise
legs|Leg Press Calf Raise|machine|1|12-20|calves||calf raise
legs|Donkey Calf Raise|machine|1|10-15|calves||calf raise
legs|Single-Leg Calf Raise|dumbbell|1|12-15|calves||calf raise,single-leg
chest|Barbell Bench Press|barbell|1|6-10|mid chest|triceps,front delts,upper chest|flat press
chest|Incline Barbell Press|barbell|1|6-10|upper chest|front delts,triceps|incline press
chest|Decline Barbell Press|barbell|1|6-10|lower chest|triceps,front delts|decline press
chest|Flat DB Press|dumbbell|2|6-10|mid chest|triceps,front delts|flat press
chest|Incline DB Press|dumbbell|2|6-10|upper chest|front delts,triceps|incline press
chest|Decline DB Press|dumbbell|2|8-12|lower chest|triceps|decline press
chest|Machine Chest Press|machine|1|8-12|mid chest|triceps,front delts|flat press
chest|Incline Machine Press|machine|1|8-12|upper chest|front delts,triceps|incline press
chest|Smith Incline Press|machine|1|8-12|upper chest|front delts,triceps|incline press
chest|Pec Deck|machine|1|10-15|mid chest|front delts|chest fly
chest|Cable Fly|cable|1|10-15|mid chest||chest fly
chest|Low-to-High Cable Fly|cable|1|10-15|upper chest|front delts|chest fly
chest|High-to-Low Cable Fly|cable|1|10-15|lower chest||chest fly
chest|Incline DB Fly|dumbbell|2|10-15|upper chest|front delts|chest fly
chest|Chest Dips|bodyweight|1|8-12|lower chest|triceps,front delts|decline press
chest|Push-Up|bodyweight|1|10-20|mid chest|triceps,front delts,abs|flat press
back|Pull-Up|bodyweight|1|6-10|lats|biceps,mid back,forearms|vertical pull
back|Chin-Up|bodyweight|1|6-10|lats|biceps,mid back,forearms|vertical pull
back|Assisted Pull-Up|bodyweight|1|8-12|lats|biceps,mid back|vertical pull
back|Lat Pulldown|machine|1|8-12|lats|biceps,mid back|vertical pull
back|Close-Grip Pulldown|machine|1|8-12|lats|biceps|vertical pull
back|Single-Arm Cable Pulldown|cable|1|10-12|lats|biceps|vertical pull
back|Barbell Row|barbell|1|6-10|lats,mid back|biceps,lower back,rear delts|horizontal pull
back|Pendlay Row|barbell|1|5-8|mid back,lats|biceps,lower back|horizontal pull
back|One-Arm DB Row|dumbbell|2|8-12|lats|mid back,biceps,rear delts|horizontal pull
back|Chest-Supported Row|machine|1|8-12|mid back|lats,rear delts,biceps|horizontal pull
back|Seated Cable Row|cable|1|8-12|mid back,lats|biceps,rear delts|horizontal pull
back|Low Row (machine)|machine|1|8-10|lats,mid back|biceps|horizontal pull
back|High Row (machine)|machine|1|8-12|mid back,traps|lats,rear delts,biceps|horizontal pull
back|T-Bar Row|barbell|1|8-12|mid back,lats|biceps,rear delts,lower back|horizontal pull
back|Meadows Row|barbell|1|8-12|lats|mid back,biceps|horizontal pull
back|Inverted Row|bodyweight|1|8-12|mid back,lats|biceps,rear delts|horizontal pull
back|Straight-Arm Pulldown|cable|1|10-15|lats|triceps|straight-arm pull
back|Pullover (machine)|machine|1|10-15|lats|triceps,mid chest|straight-arm pull
back|DB Pullover|dumbbell|1|10-15|lats|mid chest,triceps|straight-arm pull
back|Barbell Shrug|barbell|1|8-12|traps|forearms|shrug
back|DB Shrug|dumbbell|2|10-15|traps|forearms|shrug
shoulders|Seated DB Shoulder Press|dumbbell|2|6-10|front delts|side delts,triceps,upper chest|overhead press
shoulders|Standing Barbell Overhead Press|barbell|1|5-8|front delts|side delts,triceps,upper chest,abs|overhead press
shoulders|Machine Shoulder Press|machine|1|8-12|front delts|side delts,triceps|overhead press
shoulders|Arnold Press|dumbbell|2|8-12|front delts,side delts|triceps|overhead press
shoulders|Landmine Press|barbell|1|8-12|front delts|upper chest,triceps|overhead press
shoulders|DB Lateral Raise|dumbbell|2|10-15|side delts|traps|lateral raise
shoulders|Cable Lateral Raise|cable|2|10-15|side delts||lateral raise
shoulders|Machine Lateral Raise|machine|1|10-15|side delts||lateral raise
shoulders|Upright Row|barbell|1|8-12|side delts,traps|biceps,front delts|upright pull
shoulders|DB Front Raise|dumbbell|2|10-15|front delts|upper chest|front raise
shoulders|Reverse Pec Deck|machine|1|12-15|rear delts|mid back,traps|rear delt fly
shoulders|Rear Delt Cable Fly|cable|2|12-15|rear delts|mid back|rear delt fly
shoulders|Bent-Over DB Rear Delt Raise|dumbbell|2|12-15|rear delts|mid back|rear delt fly
shoulders|Face Pull|cable|1|12-15|rear delts|mid back,traps,side delts|rear delt fly
arms|Barbell Curl|barbell|1|8-12|biceps|forearms|curl (standard)
arms|EZ-Bar Curl|barbell|1|8-12|biceps|forearms|curl (standard)
arms|DB Curl|dumbbell|2|8-12|biceps|forearms|curl (standard)
arms|Cable Curl|cable|1|10-15|biceps|forearms|curl (standard)
arms|Incline DB Curl|dumbbell|2|8-12|biceps||curl (stretched)
arms|Bayesian Cable Curl|cable|1|10-15|biceps||curl (stretched)
arms|Preacher Curl|machine|1|8-12|biceps||curl (shortened)
arms|Spider Curl|dumbbell|2|10-12|biceps||curl (shortened)
arms|Hammer Curl|dumbbell|2|10-12|biceps,forearms||curl (neutral grip)
arms|Cross-Body Hammer Curl|dumbbell|2|10-12|biceps,forearms||curl (neutral grip)
arms|Rope Hammer Curl|cable|1|10-12|biceps,forearms||curl (neutral grip)
arms|Reverse Curl|barbell|1|10-15|forearms|biceps|curl (reverse grip)
arms|Wrist Curl|dumbbell|1|12-20|forearms||wrist curl
arms|Triceps Pressdown|cable|1|10-12|triceps||pushdown
arms|Rope Pressdown|cable|1|10-12|triceps||pushdown
arms|Overhead Cable Triceps Extension|cable|1|10-12|triceps||overhead extension
arms|Overhead DB Triceps Extension|dumbbell|1|10-12|triceps||overhead extension
arms|Skull Crusher|barbell|1|8-12|triceps||lying extension
arms|Close-Grip Bench Press|barbell|1|6-10|triceps|mid chest,front delts|close-grip press
arms|Triceps Dips|bodyweight|1|8-12|triceps|lower chest,front delts|close-grip press
core|Cable Crunch|cable|1|10-15|abs|obliques|crunch
core|Machine Crunch|machine|1|10-15|abs||crunch
core|Weighted Crunch|dumbbell|1|10-15|abs||crunch
core|Decline Sit-Up|bodyweight|1|10-15|abs|hip flexors|crunch
core|Hanging Leg Raise|bodyweight|0|10-15|abs,hip flexors|forearms|leg raise
core|Reverse Crunch|bodyweight|0|10-15|abs||leg raise
core|Captain's Chair Leg Raise|bodyweight|0|10-15|abs,hip flexors||leg raise
core|Ab Wheel Rollout|bodyweight|0|8-12|abs|lats,front delts,lower back|anti-extension
core|Cable Woodchop|cable|1|10-15|obliques|abs|rotation
core|Pallof Press|cable|1|10-12|obliques|abs|rotation
core|Russian Twist|dumbbell|1|12-20|obliques|abs|rotation
core|Dumbbell Side Bend|dumbbell|1|10-15|obliques||side bend
core|Cable Side Bend|cable|1|10-15|obliques||side bend
`;

const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function restFor(group: Group, repLow: number): number {
  if (group === 'core') return 60;
  if (repLow <= 6) return 180;
  if (repLow <= 8) return 150;
  if (repLow <= 10) return 120;
  if (repLow <= 12) return 90;
  return 75;
}

export const LIBRARY: LibExercise[] = RAW.trim()
  .split('\n')
  .map((line) => {
    const [group, name, equip, mult, reps, primary, secondary, angles] = line.split('|').map((x) => x.trim());
    const [lo, hi] = (reps ?? '8-12').split('-').map(Number);
    return {
      id: `${group}-${slug(name ?? '')}`,
      group: group as Group,
      name: name ?? '',
      equip: equip as Equip,
      mult: Number(mult),
      bodyweight: equip === 'bodyweight' && Number(mult) > 0,
      repLow: lo ?? 8,
      repHigh: hi ?? 12,
      rest: restFor(group as Group, lo ?? 8),
      primary: list(primary),
      secondary: list(secondary),
      angles: list(angles),
    };
  });

export const LIB_BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));

// ── What a set of exercises covers ────────────────────────────────────────

export interface Pick {
  libId: string;
  sets: number;
}

export interface Coverage {
  /** Per muscle: primary sets, and secondary sets (which count half). */
  muscles: { muscle: string; group: Group; primary: number; secondary: number; effective: number }[];
  /** Sets per angle. */
  angles: { angle: string; sets: number }[];
  /** Body parts in the workout, and what each one is still missing. */
  gaps: { group: Group; muscles: string[]; angles: string[] }[];
}

const MUSCLE_GROUP = new Map<string, Group>(
  GROUPS.flatMap((g) => MUSCLES_BY_GROUP[g].map((m) => [m, g] as [string, Group])),
);

export function analyze(picks: Pick[]): Coverage {
  const muscle = new Map<string, { primary: number; secondary: number }>();
  const angle = new Map<string, number>();
  const groups = new Set<Group>();
  for (const p of picks) {
    const ex = LIB_BY_ID.get(p.libId);
    if (!ex || p.sets <= 0) continue;
    groups.add(ex.group);
    for (const m of ex.primary) {
      const c = muscle.get(m) ?? { primary: 0, secondary: 0 };
      c.primary += p.sets;
      muscle.set(m, c);
    }
    for (const m of ex.secondary) {
      const c = muscle.get(m) ?? { primary: 0, secondary: 0 };
      c.secondary += p.sets;
      muscle.set(m, c);
    }
    for (const a of ex.angles) angle.set(a, (angle.get(a) ?? 0) + p.sets);
  }
  const muscles = [...muscle.entries()]
    .map(([m, c]) => ({
      muscle: m,
      group: MUSCLE_GROUP.get(m) ?? ('core' as Group),
      primary: c.primary,
      secondary: c.secondary,
      effective: c.primary + c.secondary * 0.5,
    }))
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || b.effective - a.effective);
  const angles = [...angle.entries()].map(([a, sets]) => ({ angle: a, sets })).sort((a, b) => b.sets - a.sets);
  const gaps = GROUPS.filter((g) => groups.has(g)).map((g) => ({
    group: g,
    muscles: MUSCLES_BY_GROUP[g].filter((m) => !(muscle.get(m)?.primary ?? 0)),
    angles: ANGLES_BY_GROUP[g].filter((a) => !angle.has(a)),
  }));
  return { muscles, angles, gaps };
}
