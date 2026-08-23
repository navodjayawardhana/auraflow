import { FALLBACK_STEP_GOAL, FALLBACK_WATER_GOAL_ML } from '@/constants/goals';
import { REFERENCE_WEIGHT_KG } from '@/services/energy';
import { activeKcalCaption, resolveTargets } from '@/services/plan-targets';
import type { Plan, Profile } from '@/types';

const plan: Plan = {
  version: 3,
  source: 'derived',
  step_goal: 8400,
  water_ml: 2650,
  active_kcal_goal: 480,
  sleep_need_hours: 8,
  hr_zones: { easy: [96, 116], moderate: [117, 143], hard: [144, 172] },
  basis: {
    bmr_kcal: 1620,
    tdee_kcal: 2510,
    bmr_formula: 'mifflin_st_jeor',
    max_hr_formula: 'tanaka',
    hr_zone_formula: 'karvonen',
    activity_factor: 1.55,
    max_hr_bpm: 183,
    resting_hr_bpm: 58,
    resting_hr_source: 'measured_14d',
    step_goal_source: 'measured_7d',
    water_source: 'mass_only',
    sleep_need_source: 'age_band',
    sleep_need_range: [7, 9],
    missing: [],
  },
  edited_fields: [],
  created_at: '2026-08-22T06:00:00Z',
};

const profile: Profile = {
  date_of_birth: '1990-01-15',
  sex: 'female',
  height_cm: 163,
  weight_kg: 58.5,
  activity_level: 'moderate',
  bmi: 22.0,
  bmi_band: 'healthy',
  bmi_scale: 'who_asian',
  bmi_bands: { who_standard: 'healthy', who_asian: 'healthy' },
  updated_at: '2026-08-20T09:00:00Z',
};

describe('resolveTargets without a plan', () => {
  it('falls back to the cold-start constants and says so', () => {
    const targets = resolveTargets(null, null);

    expect(targets.stepGoal).toBe(FALLBACK_STEP_GOAL);
    expect(targets.waterMl).toBe(FALLBACK_WATER_GOAL_ML);
    expect(targets.source).toBe('fallback');
  });

  it('invents nothing for the targets that have no constant behind them', () => {
    // There is no defensible stand-in for a personal energy or sleep target, so the UI is
    // given a null to render as an em dash rather than a number to present as advice.
    const targets = resolveTargets(null, null);

    expect(targets.activeKcalGoal).toBeNull();
    expect(targets.sleepNeedHours).toBeNull();
  });

  it('still uses a real weight when the profile has one', () => {
    // The plan and the profile fail independently: a reachable profile is enough to stop
    // the energy estimate being computed for a 70 kg stranger.
    const targets = resolveTargets(null, profile);

    expect(targets.weightKg).toBe(58.5);
    expect(targets.isWeightPersonal).toBe(true);
    expect(targets.source).toBe('fallback');
  });
});

describe('resolveTargets with a plan', () => {
  it('prefers every plan value over the constant', () => {
    const targets = resolveTargets(plan, profile);

    expect(targets).toMatchObject({
      stepGoal: 8400,
      waterMl: 2650,
      activeKcalGoal: 480,
      sleepNeedHours: 8,
      source: 'plan',
    });
  });

  it('carries a null energy target through rather than substituting one', () => {
    // The server sends null when it cannot derive an energy goal, because there is no
    // population figure for it that is not a fabricated person. Filling that in here
    // would undo the decision at the far end of the wire.
    const targets = resolveTargets({ ...plan, active_kcal_goal: null }, profile);

    expect(targets.activeKcalGoal).toBeNull();
    expect(targets.source).toBe('plan');
  });

  it('takes the weight from the profile, never from the plan', () => {
    // The plan carries goals; the body figure behind the energy estimate is the profile's,
    // and a plan derived before the last weigh-in must not pin it to a stale number.
    const targets = resolveTargets(plan, { ...profile, weight_kg: 61 });

    expect(targets.weightKg).toBe(61);
  });

  it('substitutes the reference mass when the profile has no weight', () => {
    const targets = resolveTargets(plan, { ...profile, weight_kg: null });

    expect(targets.weightKg).toBe(REFERENCE_WEIGHT_KG);
    expect(targets.isWeightPersonal).toBe(false);
  });
});

describe('activeKcalCaption', () => {
  it('names the reference mass when it had to be substituted', () => {
    expect(activeKcalCaption(resolveTargets(plan, { ...profile, weight_kg: null }))).toContain(
      `${REFERENCE_WEIGHT_KG} kg`,
    );
  });

  it('claims the user’s own weight only when it has it', () => {
    expect(activeKcalCaption(resolveTargets(plan, profile))).toBe(
      'estimated from steps and your weight',
    );
  });
});
