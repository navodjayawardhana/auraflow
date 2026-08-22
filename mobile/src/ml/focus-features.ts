import type { HealthSnapshot } from '@/types';

/**
 * Builds the model's input vector for one hour.
 *
 * What is honest about this file is what it *doesn't* fill in. The model was trained on
 * a Fitbit cohort with pedometer, calorimetry, HRV and a proprietary stress score; this
 * app has none of those feeds, so those features fall back to the training-set median
 * and the UI says how many did. Overstating coverage would make a weak signal look like
 * a measurement.
 */

/** The seven location categories the model one-hot encodes. OTHER is the reference. */
export const CONTEXTS = [
  'HOME',
  'WORK/SCHOOL',
  'HOME_OFFICE',
  'GYM',
  'OUTDOORS',
  'TRANSIT',
  'ENTERTAINMENT',
] as const;

export type Context = (typeof CONTEXTS)[number];

export interface FocusFeatureInputs {
  at: Date;
  /** The night that produced today's score, if we have it. */
  snapshot?: HealthSnapshot | null;
  /** Prior nights, used only for the trailing resting-HR delta. */
  history?: HealthSnapshot[];
  context?: Context | null;
  /** Live from the IoT node when connected. */
  liveHeartRate?: number | null;
  liveSpo2?: number | null;
  /**
   * Steps in the trailing 60 minutes — deliberately not a daily total. The model was
   * trained on hourly rows (median 356, sd 759), so a day's ~8,000 would sit roughly ten
   * standard deviations out and produce confident nonsense while *looking* like the
   * feature had been supplied.
   */
  stepsLastHour?: number | null;
  /** How much of that hour was actually observed. See STEP_COVERAGE_MIN_MINUTES. */
  stepsCoverageMinutes?: number;
}

const DELTA_WINDOW_DAYS = 7;

/**
 * Android's pedometer only counts while the app is foregrounded, so a low figure can mean
 * "sat still" or "wasn't watching". Below this much coverage the two are indistinguishable
 * and the feature is withheld — the median imputation is a better answer than a number
 * that is wrong in an unknown direction.
 */
const STEP_COVERAGE_MIN_MINUTES = 40;

/**
 * Today's resting heart rate against the mean of the preceding week. The model was
 * trained on exactly this construction, so it is computed the same way here rather than
 * substituted with something similar.
 */
function restingHrDelta(snapshot: HealthSnapshot, history: HealthSnapshot[]): number | undefined {
  if (snapshot.resting_heart_rate === null) return undefined;

  const priors = history
    .filter((h) => h.date < snapshot.date && h.resting_heart_rate !== null)
    .slice(-DELTA_WINDOW_DAYS)
    .map((h) => h.resting_heart_rate as number);

  if (priors.length === 0) return undefined;

  const mean = priors.reduce((sum, v) => sum + v, 0) / priors.length;

  return snapshot.resting_heart_rate - mean;
}

export function buildFocusFeatures(inputs: FocusFeatureInputs): Record<string, number> {
  const {
    at,
    snapshot,
    history = [],
    context,
    liveHeartRate,
    liveSpo2,
    stepsLastHour,
    stepsCoverageMinutes = 0,
  } = inputs;

  const features: Record<string, number> = {};

  // --- From the clock. Always real. ---
  const hourAngle = (2 * Math.PI * at.getHours()) / 24;
  const dowAngle = (2 * Math.PI * at.getDay()) / 7;

  features.hour_sin = Math.sin(hourAngle);
  features.hour_cos = Math.cos(hourAngle);
  features.dow_sin = Math.sin(dowAngle);
  features.dow_cos = Math.cos(dowAngle);
  features.is_weekend = at.getDay() === 0 || at.getDay() === 6 ? 1 : 0;

  // --- From the user's own night, when recorded. ---
  if (snapshot) {
    if (snapshot.sleep_minutes !== null) {
      features.sleep_hours = snapshot.sleep_minutes / 60;

      if (snapshot.deep_sleep_minutes !== null) {
        features.sleep_deep_ratio = snapshot.deep_sleep_minutes / snapshot.sleep_minutes;
      }
      if (snapshot.rem_sleep_minutes !== null) {
        features.sleep_rem_ratio = snapshot.rem_sleep_minutes / snapshot.sleep_minutes;
      }
    }

    if (snapshot.resting_heart_rate !== null) {
      features.resting_hr = snapshot.resting_heart_rate;
    }

    const delta = restingHrDelta(snapshot, history);
    if (delta !== undefined) {
      features.resting_hr_delta_7d = delta;
    }
  }

  // --- Live from the IoT node, when one is connected. ---
  if (liveHeartRate != null) features.bpm = liveHeartRate;
  if (liveSpo2 != null) features.spo2 = liveSpo2;

  // --- Movement, only when we watched enough of the hour to mean it. ---
  if (stepsLastHour != null && stepsCoverageMinutes >= STEP_COVERAGE_MIN_MINUTES) {
    features.steps = stepsLastHour;
  }

  // --- Where the user says they are. ---
  // All zeros means OTHER, the category held out of the encoding. That is deliberately
  // the default rather than the median's HOME=1: "unknown" should not be silently
  // recorded as "at home".
  for (const c of CONTEXTS) {
    features[c] = context === c ? 1 : 0;
  }

  // calories, stress_score, sleep_efficiency, nremhr and rmssd are left out on purpose —
  // the app has no calorimeter, HRV or stress feed, so the model imputes them and the
  // disclosure card says so.
  //
  // Calories are deliberately withheld even though the dashboard shows an estimate: the
  // training feature is total hourly energy expenditure including basal metabolism, while
  // ours is derived from step count alone. Feeding it back would add no information the
  // `steps` feature does not already carry, while inflating the "real inputs" count with
  // a number the model would read as something it is not.

  return features;
}
