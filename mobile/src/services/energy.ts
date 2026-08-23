/**
 * Active energy, estimated from steps.
 *
 * Still a population approximation rather than a measurement: it assumes an average stride
 * and knows nothing about pace or gradient, so two people walking the same thousand steps
 * genuinely burn different amounts. Mass is the one term it no longer has to guess at —
 * the caller passes the profile's weight, and `REFERENCE_WEIGHT_KG` is only what
 * `resolveTargets` substitutes while the profile has none.
 *
 * `weightKg` is required for that reason. It was optional for the whole of the first phase
 * and no caller ever supplied it, so every figure the app has ever shown was computed for a
 * 70 kg stranger. A required parameter makes that impossible to repeat quietly.
 *
 * Every rendering of this number is prefixed with "≈" and captioned with where the mass
 * came from, and it is deliberately *not* fed to the focus model: the model's `calories`
 * feature is total hourly expenditure including basal metabolism, which this is not, and
 * supplying it would add no information the step count does not already carry.
 */

/** Roughly 0.04 kcal per step at the reference mass. */
const KCAL_PER_STEP_PER_KG = 0.00057;

/** The stand-in mass, used only until the profile has a real one. */
export const REFERENCE_WEIGHT_KG = 70;

export function estimateActiveKcal(steps: number, weightKg: number): number {
  if (steps <= 0) return 0;

  return Math.round(steps * KCAL_PER_STEP_PER_KG * weightKg);
}
