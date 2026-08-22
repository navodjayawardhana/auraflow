import type { RecoveryReading } from '@/types';

/**
 * Decides what today's movement session should be, from the recovery score.
 *
 * This is the "context-aware and adaptive" half of the feature, and it is deliberately a
 * rule rather than a model: the user can read the reason, and an examiner can check the
 * thresholds. Nothing here is learned, and nothing here is a medical judgement — it
 * scales a set of bodyweight squats, and says why.
 *
 * The score itself comes from the existing rule-based recovery calculator, so this is the
 * second feature to consume it rather than a parallel notion of readiness.
 */

export type SessionIntensity = 'full' | 'reduced' | 'mobility' | 'unknown';

export interface SessionPrescription {
  intensity: SessionIntensity;
  /** Squats to aim for. Null for `mobility` and `unknown`, where a target would mislead. */
  targetReps: number | null;
  headline: string;
  /** Shown under the headline — always states what the decision was made from. */
  reason: string;
  /** True when the figures behind the decision are themselves shaky. */
  provisional: boolean;
}

const FULL_SCORE_MIN = 70;
const REDUCED_SCORE_MIN = 50;

const FULL_TARGET_REPS = 15;
const REDUCED_TARGET_REPS = 8;

export const PrescriptionThresholds = {
  fullScoreMin: FULL_SCORE_MIN,
  reducedScoreMin: REDUCED_SCORE_MIN,
  fullTargetReps: FULL_TARGET_REPS,
  reducedTargetReps: REDUCED_TARGET_REPS,
} as const;

/**
 * @param recovery today's reading, or null when it has not loaded yet
 */
export function prescribeSession(recovery: RecoveryReading | null): SessionPrescription {
  if (recovery === null || !recovery.available) {
    // No score is not the same as a low score. Offering a full set here would be a
    // guess dressed as a prescription, and offering mobility only would nag someone
    // who is simply new. So: let them move, and be plain that nothing was gated.
    return {
      intensity: 'unknown',
      targetReps: null,
      headline: 'No recovery score today',
      reason:
        recovery?.available === false
          ? `${recovery.reason} Log last night and the session will scale to it.`
          : 'Log last night and the session will scale to it.',
      provisional: false,
    };
  }

  const { score, provisional, illness_warning: illnessWarning } = recovery;

  // An elevated resting heart rate overrides the band. The recovery score already
  // accounts for it, but a score can sit at 72 on a morning the illness detector has
  // flagged, and pushing a full set through that is the one outcome worth avoiding.
  if (illnessWarning) {
    return {
      intensity: 'mobility',
      targetReps: null,
      headline: 'Take it gently today',
      reason: `Your resting heart rate is higher than usual, so this is a mobility session rather than a set — recovery ${Math.round(score)}.`,
      provisional,
    };
  }

  if (score >= FULL_SCORE_MIN) {
    return {
      intensity: 'full',
      targetReps: FULL_TARGET_REPS,
      headline: "You're clear for a full set",
      reason: `Recovery ${Math.round(score)} — rested enough for ${FULL_TARGET_REPS} squats.`,
      provisional,
    };
  }

  if (score >= REDUCED_SCORE_MIN) {
    return {
      intensity: 'reduced',
      targetReps: REDUCED_TARGET_REPS,
      headline: 'A shorter set today',
      reason: `Recovery ${Math.round(score)} — ${REDUCED_TARGET_REPS} squats rather than ${FULL_TARGET_REPS}.`,
      provisional,
    };
  }

  return {
    intensity: 'mobility',
    targetReps: null,
    headline: 'Mobility only today',
    reason: `Recovery ${Math.round(score)} — move and breathe, but leave the set for tomorrow.`,
    provisional,
  };
}
