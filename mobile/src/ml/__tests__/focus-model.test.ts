import { buildFocusFeatures } from '@/ml/focus-features';
import { model, predictFocusReady } from '@/ml/focus-model';
import type { HealthSnapshot } from '@/types';

/** A night with everything absent unless the test says otherwise. */
function night(overrides: Partial<HealthSnapshot> & { date: string }): HealthSnapshot {
  return {
    sleep_minutes: null,
    deep_sleep_minutes: null,
    rem_sleep_minutes: null,
    resting_heart_rate: null,
    resting_hr_source: null,
    steps: null,
    water_ml: null,
    ...overrides,
  };
}

/**
 * Golden vectors.
 *
 * These probabilities were computed in Python directly from
 * ml/artifacts/focus_model_coefficients.json, using the pipeline the artifact documents.
 * They are the only evidence that this TypeScript port really is the trained model
 * rather than something that merely resembles it — without them, a transposed
 * coefficient or a mis-ordered feature would pass every other test in this file.
 */
const GOLDEN = {
  allMedian: 0.3538709317243073,
  restedWorkMorning: 0.1952573466523016,
  poorSleepEvening: 0.5757646270298303,
};

describe('predictFocusReady', () => {
  it('matches the reference implementation with every feature imputed', () => {
    const { probability } = predictFocusReady({});

    expect(probability).toBeCloseTo(GOLDEN.allMedian, 6);
  });

  it('matches the reference implementation for a well-rested workday morning', () => {
    const { probability } = predictFocusReady({
      hour_sin: 0.5,
      hour_cos: 0.8660254037844387,
      dow_sin: 0.0,
      dow_cos: 1.0,
      is_weekend: 0,
      sleep_hours: 8.0,
      resting_hr: 55.0,
      sleep_deep_ratio: 0.2,
      sleep_rem_ratio: 0.22,
      HOME: 0,
      'WORK/SCHOOL': 1,
    });

    expect(probability).toBeCloseTo(GOLDEN.restedWorkMorning, 6);
  });

  it('matches the reference implementation for a poorly-slept evening with live vitals', () => {
    const { probability } = predictFocusReady({
      hour_sin: -0.9,
      hour_cos: -0.4,
      dow_sin: 0.78,
      dow_cos: -0.62,
      is_weekend: 1,
      sleep_hours: 5.0,
      resting_hr: 74.0,
      resting_hr_delta_7d: 6.5,
      bpm: 92.0,
      spo2: 94.0,
    });

    expect(probability).toBeCloseTo(GOLDEN.poorSleepEvening, 6);
  });

  it('reports which features it had to impute', () => {
    const { imputedFeatures } = predictFocusReady({ sleep_hours: 7.5, resting_hr: 60 });

    expect(imputedFeatures).not.toContain('sleep_hours');
    expect(imputedFeatures).not.toContain('resting_hr');
    expect(imputedFeatures).toContain('steps');
    expect(imputedFeatures).toContain('rmssd');
    expect(predictFocusReady({ sleep_hours: 7.5 }).imputedFeatures).toHaveLength(
      model.features.length - 1,
    );
  });

  it('treats a non-finite input as missing rather than poisoning the sum', () => {
    const { probability, imputedFeatures } = predictFocusReady({ sleep_hours: Number.NaN });

    expect(Number.isFinite(probability)).toBe(true);
    expect(imputedFeatures).toContain('sleep_hours');
  });

  it('applies the artifact threshold rather than a hardcoded one', () => {
    const below = predictFocusReady({});
    const above = predictFocusReady({
      hour_sin: -0.9,
      hour_cos: -0.4,
      is_weekend: 1,
      sleep_hours: 5.0,
      resting_hr: 74.0,
      resting_hr_delta_7d: 6.5,
      bpm: 92.0,
      spo2: 94.0,
      dow_sin: 0.78,
      dow_cos: -0.62,
    });

    expect(below.ready).toBe(below.probability >= model.threshold);
    expect(above.ready).toBe(above.probability >= model.threshold);
    expect(below.ready).toBe(false);
    expect(above.ready).toBe(true);
  });

  it('keeps the probability inside [0, 1] for extreme inputs', () => {
    const extreme = predictFocusReady({
      steps: 1e6,
      bpm: 1e4,
      calories: 1e6,
      resting_hr_delta_7d: -1e4,
    });

    expect(extreme.probability).toBeGreaterThanOrEqual(0);
    expect(extreme.probability).toBeLessThanOrEqual(1);
  });
});

describe('buildFocusFeatures', () => {
  it('only emits names the model declares', () => {
    const features = buildFocusFeatures({
      at: new Date(2026, 7, 21, 9, 0, 0),
      snapshot: night({
        date: '2026-08-21',
        sleep_minutes: 480,
        deep_sleep_minutes: 96,
        rem_sleep_minutes: 105,
        resting_heart_rate: 58,
      }),
      history: [],
    });

    // A feature the model does not know about would be silently ignored at inference,
    // so a typo here has to fail loudly instead.
    for (const name of Object.keys(features)) {
      expect(model.features).toContain(name);
    }
  });

  it('derives sleep ratios and the clock features from real data', () => {
    const features = buildFocusFeatures({
      at: new Date(2026, 7, 22, 12, 0, 0), // a Saturday
      snapshot: night({
        date: '2026-08-22',
        sleep_minutes: 480,
        deep_sleep_minutes: 96,
        rem_sleep_minutes: 96,
        resting_heart_rate: 58,
      }),
    });

    expect(features.sleep_hours).toBe(8);
    expect(features.sleep_deep_ratio).toBeCloseTo(0.2, 6);
    expect(features.sleep_rem_ratio).toBeCloseTo(0.2, 6);
    expect(features.is_weekend).toBe(1);
  });

  it('computes the resting-HR delta against preceding nights only', () => {
    const features = buildFocusFeatures({
      at: new Date(2026, 7, 21, 9, 0, 0),
      snapshot: night({ date: '2026-08-21', sleep_minutes: 420, resting_heart_rate: 64 }),
      history: [
        night({ date: '2026-08-19', sleep_minutes: 420, resting_heart_rate: 58 }),
        night({ date: '2026-08-20', sleep_minutes: 420, resting_heart_rate: 60 }),
        // Today's own reading must not pull its own baseline.
        night({ date: '2026-08-21', sleep_minutes: 420, resting_heart_rate: 64 }),
      ],
    });

    expect(features.resting_hr_delta_7d).toBeCloseTo(5, 6);
  });

  it('supplies steps only when enough of the hour was observed', () => {
    // The model's `steps` feature is steps per *hour* (median 356, sd 759). Android only
    // counts while the app is foregrounded, so a low figure over a barely-watched hour is
    // indistinguishable from sitting still — and a number that is wrong in an unknown
    // direction is worse than the median the model would otherwise impute.
    const sparse = buildFocusFeatures({
      at: new Date(2026, 7, 21, 9, 0, 0),
      stepsLastHour: 120,
      stepsCoverageMinutes: 12,
    });

    expect(sparse.steps).toBeUndefined();

    const observed = buildFocusFeatures({
      at: new Date(2026, 7, 21, 9, 0, 0),
      stepsLastHour: 480,
      stepsCoverageMinutes: 52,
    });

    expect(observed.steps).toBe(480);
  });

  it('never supplies calories, even though the dashboard shows an estimate', () => {
    // Ours is derived from steps; the model's is total hourly expenditure including basal
    // metabolism. Feeding it back would add no information and inflate the real-input
    // count with a number the model would read as something it is not.
    const features = buildFocusFeatures({
      at: new Date(2026, 7, 21, 9, 0, 0),
      stepsLastHour: 480,
      stepsCoverageMinutes: 52,
    });

    expect(features.calories).toBeUndefined();
  });

  it('defaults an unknown location to the held-out reference category', () => {
    const features = buildFocusFeatures({ at: new Date(2026, 7, 21, 9, 0, 0) });

    // All zeros means OTHER. Defaulting to HOME would record a guess as a fact.
    expect(features.HOME).toBe(0);
    expect(features['WORK/SCHOOL']).toBe(0);
    expect(features.GYM).toBe(0);
  });
});
