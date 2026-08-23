import type { PlanBasis } from '@/types';

/**
 * Every target's provenance, as the sentence the UI shows beside it.
 *
 * Kept out of the screens because two of them render the same claims — today's plan and
 * every earlier version — and a formula that is named one way on one screen and another
 * way on the next is not a citation, it is decoration.
 *
 * The `user_edited` branches matter more than they look. Once someone types over a goal,
 * the provenance of that number is them; leaving a study cited beside it would be the one
 * thing this whole module exists to prevent.
 */

const FIELD_LABELS: Record<string, string> = {
  date_of_birth: 'your date of birth',
  sex: 'your sex',
  height_cm: 'your height',
  weight_kg: 'your weight',
  activity_level: 'your activity level',
};

/** Unknown names are shown, not swallowed — a gap nobody can read is a gap nobody fixes. */
export function labelForMissing(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, ' ');
}

/** "your weight and your date of birth" — an Oxford-free list, because it is read aloud. */
export function listMissing(missing: string[]): string {
  const labels = missing.map(labelForMissing);

  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;

  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

const YOURS = 'you set this yourself';

export function stepGoalBasis(basis: PlanBasis): string {
  switch (basis.step_goal_source) {
    case 'user_edited':
      return YOURS;
    case 'measured_7d':
      return 'your own 7-day median, nudged upward';
    default:
      return 'population default — 10,000 is a recognisable anchor, not a clinical target';
  }
}

export function waterBasis(basis: PlanBasis): string {
  switch (basis.water_source) {
    case 'user_edited':
      return YOURS;
    case 'mass_only':
      return 'Holliday–Segar scaled to your mass, at the IOM beverage fraction';
    case 'sex_reference_intake':
      return 'EFSA adequate intake for your sex — add a weight and it scales to you';
    default:
      return 'population default — the adult figure, scaled to nobody';
  }
}

export function activeKcalBasis(basis: PlanBasis): string {
  if (basis.bmr_formula !== 'mifflin_st_jeor') {
    return 'needs your age, sex, height and mass — no honest default exists';
  }

  const bmr = basis.bmr_kcal === null ? 'a BMR' : `a BMR of ${Math.round(basis.bmr_kcal)} kcal`;
  const factor = basis.activity_factor === null ? '' : ` × ${basis.activity_factor}`;
  const tdee =
    basis.tdee_kcal === null ? '' : `, for ${Math.round(basis.tdee_kcal)} kcal a day in total`;

  return `Mifflin–St Jeor (1990) gives ${bmr}${factor}${tdee}`;
}

export function sleepNeedBasis(basis: PlanBasis): string {
  if (basis.sleep_need_source === 'user_edited') return YOURS;

  const published =
    basis.sleep_need_range === null
      ? ''
      : ` — the published band is ${basis.sleep_need_range[0]}–${basis.sleep_need_range[1]} h`;

  return basis.sleep_need_source === 'age_band'
    ? `midpoint of the NSF band for your age${published}`
    : 'population default — without your age, the adult figure';
}

export function hrZoneBasis(basis: PlanBasis): string {
  if (basis.hr_zone_formula !== 'karvonen') {
    return 'needs your age — a zone built on a guessed one is a training instruction for someone else';
  }

  const maximum = basis.max_hr_bpm === null ? '' : ` and a maximum of ${basis.max_hr_bpm} bpm`;
  const resting =
    basis.resting_hr_source === 'measured_14d'
      ? `your measured resting rate${basis.resting_hr_bpm === null ? '' : ` of ${basis.resting_hr_bpm} bpm`}`
      : `a population resting rate${basis.resting_hr_bpm === null ? '' : ` of ${basis.resting_hr_bpm} bpm`}`;

  return `Karvonen heart-rate reserve, from ${resting}${maximum}`;
}

/**
 * How much of the plan is actually about this person. Five targets, counted honestly —
 * and a target the user set by hand counts, because their own decision is not a default.
 */
export function personalTargetCount(basis: PlanBasis): number {
  return [
    basis.step_goal_source !== 'population_default',
    basis.water_source !== 'population_default',
    basis.bmr_formula === 'mifflin_st_jeor',
    basis.sleep_need_source !== 'population_default',
    basis.hr_zone_formula === 'karvonen' && basis.resting_hr_source === 'measured_14d',
  ].filter(Boolean).length;
}

export const TARGET_COUNT = 5;

export function basisSummary(basis: PlanBasis): string {
  return `${personalTargetCount(basis)} of ${TARGET_COUNT} targets come from your own figures`;
}

/** The working, for the disclosure panel. One paragraph per claim worth checking. */
export function basisLines(basis: PlanBasis): string[] {
  const lines = [
    'Nothing here is a clinical prescription. Each number names the published work it came from so you can disagree with it — and override it, which is what Edit targets does.',
  ];

  if (basis.bmr_formula === 'mifflin_st_jeor') {
    lines.push(
      `Energy: ${activeKcalBasis(basis)}. Mifflin–St Jeor is used rather than Harris–Benedict because it validates better on modern populations.`,
    );
  }

  if (basis.max_hr_formula === 'tanaka') {
    lines.push(
      `Maximum heart rate: Tanaka (2001), 208 − 0.7 × age${basis.max_hr_bpm === null ? '' : `, which puts yours at ${basis.max_hr_bpm} bpm`}. Not 220 − age, which is folklore with an error term wide enough to matter.`,
    );

    lines.push(
      basis.resting_hr_source === 'measured_14d'
        ? 'Your zones use a resting rate measured over your own last fortnight.'
        : 'Your zones use a population resting rate. Log a fortnight of resting heart rate and they are recomputed from yours.',
    );
  }

  if (basis.sleep_need_range !== null) {
    lines.push(
      `Sleep: the National Sleep Foundation published ${basis.sleep_need_range[0]}–${basis.sleep_need_range[1]} hours for your age band. The single figure above is the midpoint of it, which is our reduction and not theirs.`,
    );
  }

  // Stated rather than left as an absence, because "why is there no climate adjustment"
  // is the first question anyone asks of a hydration goal in Sri Lanka.
  lines.push(
    'Water is not adjusted for temperature. The published intakes are stated for a moderate climate and no source gives a per-degree correction, so applying one would be a coefficient we made up.',
  );

  if (basis.missing.length > 0) {
    lines.push(
      `The plan does not know ${listMissing(basis.missing)}. What depends on them is a population default until it does.`,
    );
  }

  return lines;
}
