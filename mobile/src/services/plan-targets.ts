import { FALLBACK_STEP_GOAL, FALLBACK_WATER_GOAL_ML } from '@/constants/goals';
import { REFERENCE_WEIGHT_KG } from '@/services/energy';
import type { Plan, Profile } from '@/types';

/**
 * The one place that decides "the plan's number, or the constant we used before there was
 * a plan".
 *
 * Every screen takes its targets from here rather than reaching for either source itself.
 * That is what keeps the fallback honest: there is a single expression that knows a
 * substitution happened, and a single `source` flag the UI can be made to say it out loud.
 *
 * A missing plan is not an error. The endpoints may be unreachable, the account may be
 * minutes old, the server may have nothing to derive from — all three land here as
 * `source: 'fallback'`, and the dashboard shows exactly what it showed before this phase.
 */

export interface DailyTargets {
  stepGoal: number;
  waterMl: number;
  /** No constant stands in for these two: an invented one would be advice, not a default. */
  activeKcalGoal: number | null;
  sleepNeedHours: number | null;
  /** The mass `estimateActiveKcal` should use. */
  weightKg: number;
  isWeightPersonal: boolean;
  source: 'plan' | 'fallback';
}

export function resolveTargets(plan: Plan | null, profile: Profile | null): DailyTargets {
  const weightKg = profile?.weight_kg ?? null;

  return {
    stepGoal: plan?.step_goal ?? FALLBACK_STEP_GOAL,
    waterMl: plan?.water_ml ?? FALLBACK_WATER_GOAL_ML,
    activeKcalGoal: plan?.active_kcal_goal ?? null,
    sleepNeedHours: plan?.sleep_need_hours ?? null,
    weightKg: weightKg ?? REFERENCE_WEIGHT_KG,
    isWeightPersonal: weightKg !== null,
    source: plan === null ? 'fallback' : 'plan',
  };
}

/** What the active-energy tile has to admit about the mass behind its figure. */
export function activeKcalCaption(targets: DailyTargets): string {
  return targets.isWeightPersonal
    ? 'estimated from steps and your weight'
    : `estimated from steps at a ${REFERENCE_WEIGHT_KG} kg reference`;
}
