import type { InsightsDay, InsightsSeries } from '@/services/insights-service';
import {
  coverageNote,
  coverageOf,
  goalAdherence,
  recoveryDrivers,
  sleepAgainstNeed,
  summariseSignal,
} from '@/services/insights-summary';

/** A day with nothing in it, so each fixture below states only what it is about. */
function day(date: string, overrides: Partial<InsightsDay> = {}): InsightsDay {
  return {
    date,
    recovery_score: null,
    recovery_provisional: false,
    sleep_minutes: null,
    resting_heart_rate: null,
    steps: null,
    // Whole days by default. A fixture that states a step count means a day's steps
    // unless it says otherwise, which the partial-day cases below do explicitly.
    steps_are_complete: true,
    water_ml: null,
    meal_count: 0,
    estimated_meal_count: 0,
    ...overrides,
  };
}

function series(days: InsightsDay[], windowDays = days.length): InsightsSeries {
  return {
    from: days[0]?.date ?? '2026-08-01',
    to: days[days.length - 1]?.date ?? '2026-08-01',
    window_days: windowDays,
    days,
  };
}

/** `2026-08-01` … — one date per index, so a fixture reads as a run of days. */
function dates(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
}

describe('coverageOf', () => {
  it('counts the days carrying each signal, not the days in the window', () => {
    const [a, b, c, d] = dates(4);

    const coverage = coverageOf(
      series([
        day(a, { sleep_minutes: 420, resting_heart_rate: 58, recovery_score: 61 }),
        day(b, { sleep_minutes: 400 }),
        day(c, { steps: 6000, water_ml: 1500, meal_count: 2 }),
        day(d),
      ]),
    );

    expect(coverage.windowDays).toBe(4);
    expect(coverage.rows).toEqual([
      { key: 'recovery', label: 'Recovery score', days: 1 },
      { key: 'sleepHours', label: 'Night logged', days: 2 },
      { key: 'restingHeartRate', label: 'Resting heart rate', days: 1 },
      { key: 'steps', label: 'Step count', days: 1 },
      { key: 'water', label: 'Water', days: 1 },
      { key: 'meals', label: 'Meal logged', days: 1 },
    ]);
  });

  it('counts a recorded zero as coverage — it is a measurement, not a gap', () => {
    const [a, b] = dates(2);

    const coverage = coverageOf(series([day(a, { steps: 0, water_ml: 0 }), day(b)]));

    expect(coverage.rows.find((row) => row.key === 'steps')?.days).toBe(1);
    expect(coverage.rows.find((row) => row.key === 'water')?.days).toBe(1);
  });

  it('leaves a partially witnessed day out of the step row and names it separately', () => {
    const [a, b, c] = dates(3);

    const coverage = coverageOf(
      series([
        day(a, { steps: 9200 }),
        day(b, { steps: 1800, steps_are_complete: false }),
        day(c, { steps: 2400, steps_are_complete: null }),
      ]),
    );

    // Only the day that covers a day. The other two hold a floor of unknown size, and a
    // count with nothing said about it is read the same way as one that admits it.
    expect(coverage.rows.find((row) => row.key === 'steps')?.days).toBe(1);
    expect(coverage.stepDaysPartial).toBe(2);
  });

  it('says how many of the fed days lean on an estimate', () => {
    const [a, b, c] = dates(3);

    const coverage = coverageOf(
      series([
        day(a, { meal_count: 3, estimated_meal_count: 0 }),
        day(b, { meal_count: 2, estimated_meal_count: 1 }),
        day(c, { meal_count: 1, estimated_meal_count: 1 }),
      ]),
    );

    expect(coverage.rows.find((row) => row.key === 'meals')?.days).toBe(3);
    expect(coverage.mealDaysWithEstimate).toBe(2);
  });
});

describe('summariseSignal', () => {
  it('averages only the recorded days and says how many there were', () => {
    const [a, b, c, d] = dates(4);

    // 480, 420 and 360 minutes → 8, 7 and 6 hours → mean 7, over three of four days.
    const sleep = summariseSignal(
      series([
        day(a, { sleep_minutes: 480 }),
        day(b, { sleep_minutes: 420 }),
        day(c),
        day(d, { sleep_minutes: 360 }),
      ]),
      'sleepHours',
    );

    expect(sleep.mean).toBeCloseTo(7, 10);
    expect(sleep.recordedDays).toBe(3);
    expect(sleep.windowDays).toBe(4);
    expect(sleep.values).toEqual([8, 7, null, 6]);
  });

  it('never treats a gap as a zero', () => {
    const [a, b] = dates(2);

    const steps = summariseSignal(series([day(a, { steps: 10_000 }), day(b)]), 'steps');

    // 10,000 over the one day that was counted. Halving it because the other day is
    // missing would be reporting a day nobody measured as a day of no movement.
    expect(steps.mean).toBe(10_000);
    expect(steps.recordedDays).toBe(1);
  });

  it('returns a null mean rather than a zero when nothing was recorded', () => {
    const summary = summariseSignal(series(dates(3).map((d) => day(d))), 'restingHeartRate');

    expect(summary.mean).toBeNull();
    expect(summary.recordedDays).toBe(0);
  });

  it('averages whole days of steps and drops the witnessed fragments', () => {
    const [a, b, c] = dates(3);

    const summary = summariseSignal(
      series([
        day(a, { steps: 9000 }),
        day(b, { steps: 11_000 }),
        day(c, { steps: 900, steps_are_complete: false }),
      ]),
      'steps',
    );

    // 10,000 over two days, not 6,967 over three. The fragment is not a small day.
    expect(summary.mean).toBe(10_000);
    expect(summary.recordedDays).toBe(2);
    expect(summary.values).toEqual([9000, 11_000, null]);
  });
});

describe('coverageNote', () => {
  it('names the gap whenever there is one', () => {
    expect(coverageNote(4, 14)).toBe('4 of 14 days — the rest are gaps, not zeroes');
  });

  it('says so plainly when the window is complete', () => {
    expect(coverageNote(14, 14)).toBe('all 14 days');
  });

  it('has something to say about an empty window', () => {
    expect(coverageNote(0, 14)).toBe('no days of 14 recorded');
  });
});

describe('goalAdherence', () => {
  it('counts met days against the days that recorded anything, not the window', () => {
    const [a, b, c, d, e] = dates(5);

    const adherence = goalAdherence(
      series(
        [
          day(a, { steps: 12_000 }),
          day(b, { steps: 9_000 }),
          day(c),
          day(d, { steps: 10_000 }),
          day(e),
        ],
        14,
      ),
      'steps',
      10_000,
      'plan',
    );

    // Exactly on the goal counts as met.
    expect(adherence.metDays).toBe(2);
    // Three days carried a count; the window was fourteen. Both travel, so no screen can
    // show "2 of 14" and imply twelve failures out of days nobody measured.
    expect(adherence.recordedDays).toBe(3);
    expect(adherence.windowDays).toBe(14);
    expect(adherence.target).toBe(10_000);
    expect(adherence.source).toBe('plan');
  });

  it('never counts a partly witnessed day as having met a step goal', () => {
    const [a, b, c] = dates(3);

    const adherence = goalAdherence(
      series([
        day(a, { steps: 10_500 }),
        // Above the target and still not a day that met it: the true figure is at least
        // this and unknowable, so the honest answer is that this day cannot be judged.
        day(b, { steps: 10_400, steps_are_complete: false }),
        day(c, { steps: 4000 }),
      ]),
      'steps',
      10_000,
      'plan',
    );

    expect(adherence.metDays).toBe(1);
    expect(adherence.recordedDays).toBe(2);
  });

  it('reports no met days and no recorded days for an untouched signal', () => {
    const adherence = goalAdherence(
      series(dates(3).map((d) => day(d))),
      'water',
      2_000,
      'fallback',
    );

    expect(adherence).toEqual({
      key: 'water',
      label: 'Water',
      metDays: 0,
      recordedDays: 0,
      windowDays: 3,
      target: 2_000,
      source: 'fallback',
    });
  });
});

describe('sleepAgainstNeed', () => {
  it('reports the shortfall against a plan-derived need', () => {
    const [a, b] = dates(2);

    const against = sleepAgainstNeed(
      series([day(a, { sleep_minutes: 420 }), day(b, { sleep_minutes: 360 })]),
      8,
    );

    expect(against.meanHours).toBeCloseTo(6.5, 10);
    expect(against.differenceHours).toBeCloseTo(-1.5, 10);
    expect(against.recordedDays).toBe(2);
  });

  it('shows the average but no comparison when no plan has derived a need', () => {
    const [a] = dates(1);

    const against = sleepAgainstNeed(series([day(a, { sleep_minutes: 450 })]), null);

    expect(against.meanHours).toBeCloseTo(7.5, 10);
    // No invented eight hours. A need aimed at somebody whose age we do not know would be
    // advice with no author, which is why `resolveTargets` refuses to substitute one.
    expect(against.needHours).toBeNull();
    expect(against.differenceHours).toBeNull();
  });
});

describe('recoveryDrivers', () => {
  /** Ten established days, each with a heart rate that falls as the score rises. */
  function tenGoodDays(): InsightsDay[] {
    return dates(10).map((date, i) =>
      day(date, {
        recovery_score: 50 + i * 2,
        resting_heart_rate: 70 - i,
        sleep_minutes: 400 + i * 5,
        steps: 5_000 + i * 100,
      }),
    );
  }

  it('correlates recovery against each signal', () => {
    const drivers = recoveryDrivers(series(tenGoodDays()));

    expect(drivers.map((driver) => driver.key)).toEqual([
      'restingHeartRate',
      'sleepHours',
      'steps',
    ]);

    expect(drivers[0].outcome).toEqual({ kind: 'computed', rho: -1, pairs: 10 });
    expect(drivers[1].outcome).toEqual({ kind: 'computed', rho: 1, pairs: 10 });
  });

  it('marks the two signals the score is computed from', () => {
    const drivers = recoveryDrivers(series(tenGoodDays()));

    // Resting HR carries 0.80 of the score's weight and sleep the rest, so their
    // coefficients are largely restatements of the formula. Steps is the only one the
    // score never sees, and the panel has to be able to say which is which.
    expect(drivers.map((driver) => driver.isScoreInput)).toEqual([true, true, false]);
  });

  /**
   * The rule E-015 paid for: provisional days are excluded.
   *
   * Mixing scores computed with a personal resting-HR baseline and scores computed without
   * one halved the study's rank correlation (0.123 → 0.063), because the two are different
   * measurements sharing a column and their interleaved ordering means nothing.
   */
  it('pairs only established days, never provisional ones', () => {
    const days = tenGoodDays();
    days[0].recovery_provisional = true;
    days[1].recovery_provisional = true;

    const drivers = recoveryDrivers(series(days));

    // Twelve scored days would clear the floor; eight established ones do not.
    expect(drivers[0].outcome).toEqual({ kind: 'too-few-pairs', pairs: 8 });
  });

  it('withholds a coefficient rather than reading one off a short window', () => {
    const drivers = recoveryDrivers(series(tenGoodDays().slice(0, 9), 14));

    for (const driver of drivers) {
      expect(driver.outcome).toEqual({ kind: 'too-few-pairs', pairs: 9 });
    }
  });

  it('calls a signal that never moved undefined rather than uncorrelated', () => {
    const days = tenGoodDays().map((d) => ({ ...d, steps: 7_000 }));

    const steps = recoveryDrivers(series(days)).find((driver) => driver.key === 'steps');

    expect(steps?.outcome).toEqual({ kind: 'no-variation', pairs: 10 });
  });
});
