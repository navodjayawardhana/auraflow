/**
 * The cold-start daily targets.
 *
 * These stopped being the app's goals when the plan arrived. The plan is now the source —
 * `/plan`, resolved by `plan-targets.ts` — and these two figures are what the dashboard
 * shows in the gap before one exists, or when the server cannot be reached at all. The
 * server falls back to the same numbers for a user with an empty profile, so the two ends
 * agree about what "no plan yet" looks like.
 *
 * Reading either of them anywhere but `resolveTargets` is the bug this file used to be:
 * a target with no provenance, presented as though it were about the person holding the
 * phone.
 */

/** The familiar 10,000 — a marketing figure originally, but a recognisable anchor. */
export const FALLBACK_STEP_GOAL = 10_000;

/** Roughly eight glasses; the amount most adult guidance converges on. */
export const FALLBACK_WATER_GOAL_ML = 2_000;

/** One tap on the water tracker. A unit of logging, not a target — the plan sets no glass. */
export const GLASS_ML = 250;
