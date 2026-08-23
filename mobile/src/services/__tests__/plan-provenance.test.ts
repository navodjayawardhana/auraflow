import {
  basisSummary,
  personalTargetCount,
  sleepNeedBasis,
  stepGoalBasis,
  waterBasis,
} from '@/services/plan-provenance';
import type { PlanBasis } from '@/types';

const derived: PlanBasis = {
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
};

const empty: PlanBasis = {
  bmr_kcal: null,
  tdee_kcal: null,
  bmr_formula: null,
  max_hr_formula: null,
  hr_zone_formula: null,
  activity_factor: null,
  max_hr_bpm: null,
  resting_hr_bpm: null,
  resting_hr_source: null,
  step_goal_source: 'population_default',
  water_source: 'population_default',
  sleep_need_source: 'population_default',
  sleep_need_range: null,
  missing: ['date_of_birth', 'height_cm', 'weight_kg'],
};

describe('a hand-set target', () => {
  it('cites the user, never the paper it displaced', () => {
    // The whole point of `user_edited`: leaving a study named beside a number someone
    // typed would be the basis lying about the only thing it exists to do.
    expect(stepGoalBasis({ ...derived, step_goal_source: 'user_edited' })).toBe(
      'you set this yourself',
    );
    expect(waterBasis({ ...derived, water_source: 'user_edited' })).toBe('you set this yourself');
    expect(sleepNeedBasis({ ...derived, sleep_need_source: 'user_edited' })).toBe(
      'you set this yourself',
    );
  });
});

describe('the water citation', () => {
  it('names neither climate nor a coefficient nobody published', () => {
    // The server declined to adjust for temperature because no source gives a per-degree
    // correction. A UI still promising one would be the app inventing it instead.
    for (const source of ['mass_only', 'sex_reference_intake', 'population_default'] as const) {
      expect(waterBasis({ ...derived, water_source: source }).toLowerCase()).not.toContain(
        'climate',
      );
    }
  });

  it('distinguishes a mass-scaled goal from a sex reference intake', () => {
    expect(waterBasis({ ...derived, water_source: 'mass_only' })).toContain('Holliday');
    expect(waterBasis({ ...derived, water_source: 'sex_reference_intake' })).toContain('EFSA');
  });
});

describe('sleepNeedBasis', () => {
  it('shows the published band beside the midpoint we reduced it to', () => {
    expect(sleepNeedBasis(derived)).toContain('7–9 h');
    expect(sleepNeedBasis(derived)).toContain('midpoint');
  });

  it('says so plainly when there was no age to band', () => {
    expect(sleepNeedBasis(empty)).toContain('population default');
  });
});

describe('personalTargetCount', () => {
  it('counts nothing for a plan derived from an empty profile', () => {
    expect(personalTargetCount(empty)).toBe(0);
    expect(basisSummary(empty)).toBe('0 of 5 targets come from your own figures');
  });

  it('counts every target when all five rest on the user', () => {
    expect(personalTargetCount(derived)).toBe(5);
  });

  it('counts a target the user set by hand as theirs', () => {
    // Their own decision is not a population default, and a summary that said otherwise
    // would be telling them their plan knows less about them than it does.
    expect(personalTargetCount({ ...empty, step_goal_source: 'user_edited' })).toBe(1);
  });

  it('does not count zones built on a population resting rate', () => {
    expect(personalTargetCount({ ...derived, resting_hr_source: 'population_default' })).toBe(4);
  });
});
