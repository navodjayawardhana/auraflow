/**
 * Everything the insights screen claims, derived from the window the server sent.
 *
 * The server assembles; this decides. Coverage, averages, adherence and the rank
 * correlations are all statements *about* the data rather than the data, they are the part
 * that can be silently wrong — a mean that quietly spans four days of a fortnight looks
 * exactly like one that spans fourteen — and so they live here, as arithmetic over plain
 * arrays, with hand-worked answers next to them in the tests.
 *
 * Two rules run through all of it:
 *
 *   A gap is never filled. A missing day is dropped from a mean and counted in a
 *   denominator, never treated as a zero, and every figure travels with the number of days
 *   it actually covers so that no screen can render it without saying.
 *
 *   A measurement and an estimate are never summed into one confident figure. Meal
 *   coverage carries how many of its days lean on a guess, for the same reason
 *   `NutritionTotals` keeps measured energy apart from estimated.
 */

import { spearman, type CorrelationOutcome } from '@/services/correlation';
import type { InsightsDay, InsightsSeries } from '@/services/insights-service';

export type SignalKey = 'recovery' | 'sleepHours' | 'restingHeartRate' | 'steps' | 'water';

const SIGNAL_LABELS: Record<SignalKey, string> = {
  recovery: 'Recovery',
  sleepHours: 'Sleep',
  restingHeartRate: 'Resting heart rate',
  steps: 'Steps',
  water: 'Water',
};

/** One day's value for a signal, or null where that day recorded none. */
function valueOf(day: InsightsDay, key: SignalKey): number | null {
  switch (key) {
    case 'recovery':
      return day.recovery_score;
    case 'sleepHours':
      return day.sleep_minutes === null ? null : day.sleep_minutes / 60;
    case 'restingHeartRate':
      return day.resting_heart_rate;
    case 'steps':
      // A day the phone only half watched is not a day's steps, and there is no honest
      // way to average it with days that are. It is dropped here rather than in each
      // consumer — the same treatment the provisional recovery scores get below, and for
      // the same reason: two different measurements sharing a column have no coherent
      // mean, no coherent adherence and no coherent ordering. What was witnessed is not
      // discarded silently: `coverageOf` counts those days and the panel names them.
      return day.steps_are_complete === true ? day.steps : null;
    case 'water':
      return day.water_ml;
  }
}

function seriesOf(series: InsightsSeries, key: SignalKey): (number | null)[] {
  return series.days.map((day) => valueOf(day, key));
}

// ---------------------------------------------------------------- coverage

export interface CoverageRow {
  key: SignalKey | 'meals';
  label: string;
  /** Days in the window carrying this signal at all. */
  days: number;
}

export interface Coverage {
  windowDays: number;
  rows: CoverageRow[];
  /**
   * Of the days with a meal, how many include something nobody measured.
   *
   * Reported next to the meal row rather than folded into it. A fortnight covered by
   * barcode lookups and a fortnight covered by photo guesses have identical coverage and
   * are not equally known, and a single count cannot say which one this is.
   */
  mealDaysWithEstimate: number;
  /**
   * Days that hold a step count covering only part of the day.
   *
   * Not in the step row's `days`, because they are not days of steps — a phone that only
   * counts while it is being looked at reports a fraction it cannot size. Reported beside
   * the row for the same reason `mealDaysWithEstimate` is: something was recorded, and a
   * panel that showed nothing at all would be understating what is known as badly as one
   * that counted them in full would be overstating it.
   */
  stepDaysPartial: number;
}

/**
 * How much of the window each signal actually covers.
 *
 * The panel this feeds is the cheapest one on the screen and the one everything else
 * stands on: a fourteen-day average over three days is a different claim from one over
 * fourteen, and without this the reader has no way to tell which they are being shown.
 */
export function coverageOf(series: InsightsSeries): Coverage {
  const count = (key: SignalKey) => seriesOf(series, key).filter((v) => v !== null).length;

  return {
    windowDays: series.window_days,
    rows: [
      { key: 'recovery', label: 'Recovery score', days: count('recovery') },
      { key: 'sleepHours', label: 'Night logged', days: count('sleepHours') },
      { key: 'restingHeartRate', label: 'Resting heart rate', days: count('restingHeartRate') },
      { key: 'steps', label: 'Step count', days: count('steps') },
      { key: 'water', label: 'Water', days: count('water') },
      {
        key: 'meals',
        label: 'Meal logged',
        days: series.days.filter((day) => day.meal_count > 0).length,
      },
    ],
    mealDaysWithEstimate: series.days.filter((day) => day.estimated_meal_count > 0).length,
    stepDaysPartial: series.days.filter(
      (day) => day.steps !== null && day.steps_are_complete !== true,
    ).length,
  };
}

// ---------------------------------------------------------------- signals

export interface SignalSummary {
  key: SignalKey;
  label: string;
  /** In date order, null on days with nothing recorded — the shape a chart needs. */
  values: (number | null)[];
  recordedDays: number;
  windowDays: number;
  /** Over the recorded days only, or null when there are none. Never over the gaps. */
  mean: number | null;
}

export function summariseSignal(series: InsightsSeries, key: SignalKey): SignalSummary {
  const values = seriesOf(series, key);
  const recorded = values.filter((value): value is number => value !== null);

  return {
    key,
    label: SIGNAL_LABELS[key],
    values,
    recordedDays: recorded.length,
    windowDays: series.window_days,
    mean:
      recorded.length === 0
        ? null
        : recorded.reduce((sum, value) => sum + value, 0) / recorded.length,
  };
}

/**
 * What a figure has to admit about the days underneath it.
 *
 * Every mean on this screen is rendered with one of these, without exception. "7.4 hours"
 * over four nights of a fortnight is not a fortnight's sleep, and the difference is
 * invisible unless something says it.
 */
export function coverageNote(recordedDays: number, windowDays: number): string {
  if (recordedDays === 0) return `no days of ${windowDays} recorded`;
  if (recordedDays === windowDays) return `all ${windowDays} days`;

  return `${recordedDays} of ${windowDays} days — the rest are gaps, not zeroes`;
}

// ---------------------------------------------------------------- plan adherence

export interface GoalAdherence {
  key: SignalKey;
  label: string;
  /** Days that reached the target, out of the days that recorded anything at all. */
  metDays: number;
  recordedDays: number;
  windowDays: number;
  target: number;
  /** Whether the target came from the user's plan or from the cold-start constant. */
  source: 'plan' | 'fallback';
}

/**
 * Days that met a target, counted against the days that could have.
 *
 * The denominator is recorded days, not the window. Scoring an unmeasured day as a miss
 * would turn a phone that was not carrying a step counter into a fortnight of failure,
 * which is a claim about the user rather than about the data; the recorded count travels
 * alongside so the screen can show both.
 */
export function goalAdherence(
  series: InsightsSeries,
  key: SignalKey,
  target: number,
  source: 'plan' | 'fallback',
): GoalAdherence {
  const recorded = seriesOf(series, key).filter((value): value is number => value !== null);

  return {
    key,
    label: SIGNAL_LABELS[key],
    metDays: recorded.filter((value) => value >= target).length,
    recordedDays: recorded.length,
    windowDays: series.window_days,
    target,
    source,
  };
}

export interface SleepAgainstNeed {
  meanHours: number | null;
  recordedDays: number;
  windowDays: number;
  /**
   * Null until a plan derives one, and no constant stands in.
   *
   * `resolveTargets` substitutes a default step goal and a default water target because
   * both are published population figures. It refuses to invent a sleep need, and so does
   * this: a nightly hour count aimed at somebody whose age we do not know is health advice
   * with no author. The panel shows the average and says the target is missing.
   */
  needHours: number | null;
  /** Mean minus need — negative is short. Null whenever either side is missing. */
  differenceHours: number | null;
}

export function sleepAgainstNeed(
  series: InsightsSeries,
  needHours: number | null,
): SleepAgainstNeed {
  const sleep = summariseSignal(series, 'sleepHours');

  return {
    meanHours: sleep.mean,
    recordedDays: sleep.recordedDays,
    windowDays: sleep.windowDays,
    needHours,
    differenceHours:
      sleep.mean === null || needHours === null ? null : sleep.mean - needHours,
  };
}

// ---------------------------------------------------------------- what moves with recovery

export type DriverKey = Extract<SignalKey, 'restingHeartRate' | 'sleepHours' | 'steps'>;

export interface RecoveryDriver {
  key: DriverKey;
  label: string;
  /**
   * True when the recovery score is computed *from* this signal.
   *
   * The score is 0.80 resting-HR z with sleep making up the rest (E-015), so two of these
   * three coefficients are largely restatements of that arithmetic rather than discoveries
   * about the person. Steps is the only one the score never sees. The panel has to say
   * which is which, or it presents a tautology as a finding.
   */
  isScoreInput: boolean;
  outcome: CorrelationOutcome;
}

/**
 * Rank correlation between recovery and each of resting heart rate, sleep and steps.
 *
 * **Established days only.** Provisional scores — those computed with no personal
 * resting-HR baseline — are a different measurement sharing the same 0–100 column, and
 * E-015 records exactly what mixing them costs: the score's correlation against
 * self-reported readiness was 0.063 with them in and 0.123 with them excluded. A rank
 * correlation is a statement about ordering, and two measurements interleaved in one
 * column have no coherent ordering to state.
 *
 * There is no averaging across people to do here, and that is worth naming: E-015 computed
 * ρ per participant and then averaged, because pooling would mostly measure differences in
 * how individuals use a scale. On a phone there is one participant, so this is the
 * per-participant coefficient the study averaged — over a fortnight rather than the study's
 * years, which is why the panel leads with how little it can carry.
 */
export function recoveryDrivers(series: InsightsSeries): RecoveryDriver[] {
  const established = series.days.map((day) =>
    day.recovery_provisional ? null : day.recovery_score,
  );

  const drivers: { key: DriverKey; isScoreInput: boolean }[] = [
    { key: 'restingHeartRate', isScoreInput: true },
    { key: 'sleepHours', isScoreInput: true },
    { key: 'steps', isScoreInput: false },
  ];

  return drivers.map(({ key, isScoreInput }) => ({
    key,
    label: SIGNAL_LABELS[key],
    isScoreInput,
    outcome: spearman(established, seriesOf(series, key)),
  }));
}

/**
 * The strongest thing that may be said about a coefficient from a fortnight of one person.
 *
 * Deliberately not a verdict — "strong", "moderate" and "weak" are the vocabulary of a
 * result, and this is not one. The words describe the shape of the relationship in the
 * window and nothing beyond it.
 */
export function describeRho(rho: number): string {
  const size = Math.abs(rho);
  const direction = rho >= 0 ? 'rose together' : 'moved opposite ways';

  if (size < 0.2) return 'no ordering worth reading';

  return `${direction} in this window`;
}
