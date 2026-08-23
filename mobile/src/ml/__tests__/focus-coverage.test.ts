import {
  buildFocusFeatures,
  CLOCK_FEATURES,
  CONTEXTS,
  focusCoverage,
  HEALTH_FEATURES,
} from '@/ml/focus-features';
import { model, predictFocusReady } from '@/ml/focus-model';

const AT = new Date('2026-08-22T10:00:00');

/**
 * The disclosure card's honesty rests entirely on this split. A single count over all 25
 * features says twelve for an account that has contributed nothing, because the clock and
 * the location encoding are always written — so these tests pin the denominator to the
 * inputs a person can actually supply.
 */
describe('focusCoverage', () => {
  it('partitions every one of the model features exactly once', () => {
    expect(HEALTH_FEATURES.length + CLOCK_FEATURES.length + CONTEXTS.length).toBe(
      model.features.length,
    );

    for (const feature of model.features) {
      const homes = [
        HEALTH_FEATURES.includes(feature),
        (CLOCK_FEATURES as readonly string[]).includes(feature),
        (CONTEXTS as readonly string[]).includes(feature),
      ].filter(Boolean);

      expect(homes).toHaveLength(1);
    }
  });

  it('reports nothing supplied for an account with no data and no context', () => {
    const coverage = focusCoverage(predictFocusReady(buildFocusFeatures({ at: AT })));

    expect(coverage.supplied).toBe(0);
    expect(coverage.total).toBe(HEALTH_FEATURES.length);
  });

  it('still reports nothing supplied once a context is chosen', () => {
    // A location is not a vital sign. Naming one must not move the health count, which is
    // the specific overstatement this split exists to prevent.
    const coverage = focusCoverage(
      predictFocusReady(buildFocusFeatures({ at: AT, context: 'GYM' })),
    );

    expect(coverage.supplied).toBe(0);
  });

  it('counts a night the user actually recorded', () => {
    const coverage = focusCoverage(
      predictFocusReady(
        buildFocusFeatures({
          at: AT,
          snapshot: {
            date: '2026-08-22',
            sleep_minutes: 450,
            deep_sleep_minutes: 90,
            rem_sleep_minutes: 100,
            resting_heart_rate: 58,
            resting_hr_source: 'overnight',
            steps: null,
            water_ml: null,
          },
        }),
      ),
    );

    // sleep_hours, sleep_deep_ratio, sleep_rem_ratio, resting_hr. Not resting_hr_delta_7d:
    // one night has no preceding week to compare against.
    expect(coverage.supplied).toBe(4);
  });

  it('counts the ambient inputs separately rather than dropping them', () => {
    const coverage = focusCoverage(predictFocusReady(buildFocusFeatures({ at: AT })));

    expect(coverage.ambient).toBe(CLOCK_FEATURES.length + CONTEXTS.length);
  });
});
