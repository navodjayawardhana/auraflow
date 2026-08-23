import { PrescriptionThresholds, prescribeSession } from '@/ml/session-prescription';
import type { RecoveryReading } from '@/types';

function reading(overrides: Partial<Extract<RecoveryReading, { available: true }>>): RecoveryReading {
  return {
    date: '2026-08-22',
    available: true,
    score: 80,
    provisional: false,
    components_used: 3,
    illness_warning: false,
    ...overrides,
  };
}

describe('prescribeSession', () => {
  it('clears a rested user for a full set', () => {
    const p = prescribeSession(reading({ score: 82 }));

    expect(p.intensity).toBe('full');
    expect(p.targetReps).toBe(PrescriptionThresholds.fullTargetReps);
  });

  it('cuts the set for a middling score', () => {
    const p = prescribeSession(reading({ score: 61 }));

    expect(p.intensity).toBe('reduced');
    expect(p.targetReps).toBe(PrescriptionThresholds.reducedTargetReps);
  });

  it('drops to mobility below the lower threshold', () => {
    const p = prescribeSession(reading({ score: 38 }));

    expect(p.intensity).toBe('mobility');
    // No target: a number here would read as something to push towards.
    expect(p.targetReps).toBeNull();
  });

  it('treats the thresholds as inclusive lower bounds', () => {
    expect(prescribeSession(reading({ score: PrescriptionThresholds.fullScoreMin })).intensity).toBe(
      'full',
    );
    expect(
      prescribeSession(reading({ score: PrescriptionThresholds.fullScoreMin - 1 })).intensity,
    ).toBe('reduced');
    expect(
      prescribeSession(reading({ score: PrescriptionThresholds.reducedScoreMin })).intensity,
    ).toBe('reduced');
    expect(
      prescribeSession(reading({ score: PrescriptionThresholds.reducedScoreMin - 1 })).intensity,
    ).toBe('mobility');
  });

  it('overrides a good score when the illness detector has flagged the morning', () => {
    // The score alone would clear this user for a full set.
    const p = prescribeSession(reading({ score: 76, illness_warning: true }));

    expect(p.intensity).toBe('mobility');
    expect(p.reason).toContain('resting heart rate');
  });

  it('carries the provisional flag through so the UI can say the score is still settling', () => {
    expect(prescribeSession(reading({ score: 80, provisional: true })).provisional).toBe(true);
  });

  it('does not gate the session when there is no score', () => {
    const p = prescribeSession({
      date: '2026-08-22',
      available: false,
      score: null,
      reason: 'No sleep logged for last night.',
      last_known: null,
    });

    // Absent is not low: it neither prescribes a set nor refuses one, and it says so.
    expect(p.intensity).toBe('unknown');
    expect(p.targetReps).toBeNull();
    expect(p.reason).toContain('No sleep logged');
  });

  it('handles the reading not having loaded yet', () => {
    const p = prescribeSession(null);

    expect(p.intensity).toBe('unknown');
    expect(p.targetReps).toBeNull();
  });

  it('never quotes a score it was not given', () => {
    expect(prescribeSession(null).reason).not.toMatch(/\d/);
  });
});
