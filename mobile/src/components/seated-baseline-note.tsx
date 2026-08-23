import { BasisDisclosure } from '@/components/basis-disclosure';

/**
 * What has to be said wherever a recovery score rests on morning check-ins.
 *
 * The score's 0.80-weighted component is a z-score of today's resting rate against the
 * user's own recent ones. Those recent ones now come in two kinds, and the project's
 * evidence covers exactly one of them: E-015 scored this model against 1,729 days of
 * self-reported readiness from sixteen people using *overnight* resting rates, reaching
 * ρ 0.123 — a figure the evidence log itself calls weak by any standard. A seated morning
 * capture is a different input to the same arithmetic. Nothing in that evaluation describes
 * it, in either direction.
 *
 * So the summary line is the limitation and the number is inside, the way the recovery
 * drivers panel orders its own caveat. A bold "ρ 0.123" with a hedge underneath gets read as
 * a finding with a disclaimer attached, and this is worse than that: it would be a finding
 * about a different measurement borrowed to vouch for this one.
 *
 * Written once and used everywhere the distinction appears, because a limitation phrased
 * three slightly different ways on three screens is a limitation the reader learns to skip.
 */
export function SeatedBaselineNote() {
  return (
    <BasisDisclosure
      summary="Measured against your morning check-ins — not the version that was tested"
      lines={[
        'Most of this score is how today’s resting heart rate compares with your own recent ones. Yours are morning check-ins: awake, seated, a finger on the node. They are kept in a separate baseline from any overnight readings and the two are never averaged together, because a seated rate sits several bpm above the same heart asleep.',
        'This project tested the recovery score against 1,729 days of self-reported readiness from sixteen people, and every resting rate in that test was an overnight one from a wearable. It reached ρ 0.123, which is a weak correlation by any standard.',
        'That result does not extend to this. A score built on seated check-ins has not been measured against anything, so it is neither better nor worse than ρ 0.123 — it is untested. Read it as your own trend over time, not as a validated measurement.',
        'A check-in taken the same way each morning is still a real signal about you. Same time, sitting, before caffeine, before the day starts — that consistency is what the baseline is made of.',
      ]}
    />
  );
}
