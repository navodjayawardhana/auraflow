/**
 * Active energy, estimated from steps.
 *
 * This is a population approximation, not a measurement. It assumes an average stride and
 * a reference body mass, and it knows nothing about pace, gradient or the user's actual
 * weight — two people walking the same thousand steps genuinely burn different amounts.
 *
 * Every rendering of this number is prefixed with "≈" and captioned "estimated from
 * steps" for that reason, and it is deliberately *not* fed to the focus model: the model's
 * `calories` feature is total hourly expenditure including basal metabolism, which this is
 * not, and supplying it would add no information the step count does not already carry.
 */

/** Roughly 0.04 kcal per step at the reference mass. */
const KCAL_PER_STEP_PER_KG = 0.00057;

export const REFERENCE_WEIGHT_KG = 70;

export function estimateActiveKcal(steps: number, weightKg = REFERENCE_WEIGHT_KG): number {
  if (steps <= 0) return 0;

  return Math.round(steps * KCAL_PER_STEP_PER_KG * weightKg);
}
