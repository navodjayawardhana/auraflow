import {
  RepCounterThresholds,
  initialRepCounterState,
  kneeAngle,
  observe,
  type Landmarks,
  type RepCounterState,
} from '@/ml/rep-counter';
import { PrescriptionThresholds, prescribeSession } from '@/ml/session-prescription';
import {
  GuidedExercises,
  ReferenceFrame,
  ReferenceGroundY,
  easeSegment,
  frameAt,
  planGuidedRoutine,
  plannedDurationMs,
} from '@/services/guided-routine';
import type { RecoveryReading } from '@/types';

const SQUAT = GuidedExercises.squat;
const MARCH = GuidedExercises.march;

/** What the screen actually does: sample the animation at a fixed frame rate. */
const FRAME_MS = 50;

function sampleCycle(exercise = SQUAT, cycleMs = SQUAT.defaultCycleMs, cycles = 1): Landmarks[] {
  const frames: Landmarks[] = [];

  for (let t = 0; t < cycleMs * cycles; t += FRAME_MS) {
    frames.push(frameAt(exercise, cycleMs, t).landmarks);
  }

  // The clock never lands exactly on the end of the cycle, but a rep only closes when the
  // figure is back at standing -- so the final standing frame has to be in the sample.
  frames.push(frameAt(exercise, cycleMs, cycleMs * cycles).landmarks);

  return frames;
}

function count(frames: Landmarks[]): RepCounterState {
  return frames.reduce(observe, initialRepCounterState);
}

function reading(overrides: { score?: number; illness_warning?: boolean } = {}): RecoveryReading {
  return {
    date: '2026-08-23',
    available: true,
    score: 80,
    provisional: false,
    components_used: 4,
    illness_warning: false,
    ...overrides,
  };
}

describe('the reference figure', () => {
  it('should keep every limb the same length in every pose', () => {
    // The reason the keyframes are angles rather than positions. If this drifts, the
    // figure telescopes mid-rep and nobody notices until they watch it on a device.
    const lengths = sampleCycle().map((marks) => ({
      thigh: distance(marks, 'LEFT_HIP', 'LEFT_KNEE'),
      shin: distance(marks, 'LEFT_KNEE', 'LEFT_ANKLE'),
      torso: distance(marks, 'LEFT_HIP', 'LEFT_SHOULDER'),
    }));

    for (const { thigh, shin, torso } of lengths) {
      expect(thigh).toBeCloseTo(lengths[0].thigh, 6);
      expect(shin).toBeCloseTo(lengths[0].shin, 6);
      expect(torso).toBeCloseTo(lengths[0].torso, 6);
    }
  });

  it('should stay inside the frame it says it is drawn in', () => {
    // PoseSkeleton cover-fits, so anything outside this box is silently cropped.
    for (const marks of [...sampleCycle(), ...sampleCycle(MARCH, MARCH.defaultCycleMs, 2)]) {
      for (const point of Object.values(marks)) {
        expect(point!.x).toBeGreaterThanOrEqual(0);
        expect(point!.y).toBeGreaterThanOrEqual(0);
        expect(point!.x).toBeLessThanOrEqual(ReferenceFrame.width);
        expect(point!.y).toBeLessThanOrEqual(ReferenceFrame.height);
      }
    }
  });

  it('should keep the supporting foot on the floor rather than sliding it', () => {
    const floor = sampleCycle().map((marks) => Math.max(marks.LEFT_ANKLE!.y, marks.RIGHT_ANKLE!.y));

    for (const y of floor) expect(y).toBeCloseTo(floor[0], 6);
  });

  it('should keep every added limb the same length too', () => {
    // Arms, neck and feet were added after the fact, and forward kinematics only
    // guarantees what it is asked to build. A limb left out of `buildFigure` and
    // interpolated as a position would telescope exactly the way the legs used to.
    const lengths = sampleCycle().map((marks) => ({
      upperArm: distance(marks, 'LEFT_SHOULDER', 'LEFT_ELBOW'),
      foreArm: distance(marks, 'LEFT_ELBOW', 'LEFT_WRIST'),
      farUpperArm: distance(marks, 'RIGHT_SHOULDER', 'RIGHT_ELBOW'),
      neck: distance(marks, 'LEFT_SHOULDER', 'HEAD'),
      foot: distance(marks, 'LEFT_ANKLE', 'LEFT_FOOT'),
    }));

    for (const frame of lengths) {
      expect(frame.upperArm).toBeCloseTo(lengths[0].upperArm, 6);
      expect(frame.foreArm).toBeCloseTo(lengths[0].foreArm, 6);
      expect(frame.farUpperArm).toBeCloseTo(lengths[0].farUpperArm, 6);
      expect(frame.neck).toBeCloseTo(lengths[0].neck, 6);
      expect(frame.foot).toBeCloseTo(lengths[0].foot, 6);
    }
  });

  it('should have a whole body, not just the half the counter reads', () => {
    // The reason the figure stopped looking like someone falling over: a squat is read
    // from the arms, and there were none.
    const marks = frameAt(SQUAT, SQUAT.defaultCycleMs, 0).landmarks;

    for (const name of [
      'HEAD',
      'LEFT_ELBOW',
      'LEFT_WRIST',
      'RIGHT_ELBOW',
      'RIGHT_WRIST',
      'LEFT_FOOT',
      'RIGHT_FOOT',
    ]) {
      expect(marks[name]).toBeDefined();
    }
  });

  it('should stand on the floor it says it draws, on both feet', () => {
    // A toe hanging in the air or buried under the ground line is the thing a drawn floor
    // makes impossible to miss.
    for (const marks of sampleCycle()) {
      expect(marks.LEFT_FOOT!.y).toBeCloseTo(ReferenceGroundY, 0);
      expect(marks.RIGHT_FOOT!.y).toBeCloseTo(ReferenceGroundY, 0);
    }
  });

  it('should be proportioned like a person rather than to taste', () => {
    // A torso the length of a thigh looks wrong before the figure has moved at all.
    const marks = frameAt(SQUAT, SQUAT.defaultCycleMs, 0).landmarks;

    const torso = distance(marks, 'LEFT_HIP', 'LEFT_SHOULDER');
    const thigh = distance(marks, 'LEFT_HIP', 'LEFT_KNEE');
    const shin = distance(marks, 'LEFT_KNEE', 'LEFT_ANKLE');
    const arm =
      distance(marks, 'LEFT_SHOULDER', 'LEFT_ELBOW') + distance(marks, 'LEFT_ELBOW', 'LEFT_WRIST');

    // Torso is the longest segment of the three; the leg is close to evenly split; the
    // whole arm reaches past the hip but not past the knee.
    expect(torso).toBeGreaterThan(thigh);
    expect(Math.abs(thigh - shin) / thigh).toBeLessThan(0.1);
    expect(arm).toBeGreaterThan(torso);
    expect(arm).toBeLessThan(torso + thigh);
  });
});

describe('the demonstrated squat, judged by the counter that grades the real one', () => {
  it('should stand straight enough to be read as standing', () => {
    expect(kneeAngle(frameAt(SQUAT, SQUAT.defaultCycleMs, 0).landmarks)!).toBeGreaterThanOrEqual(
      RepCounterThresholds.standingAngleMin,
    );
  });

  it('should reach the depth the counter calls good form', () => {
    const deepest = Math.min(
      ...sampleCycle().map((marks) => kneeAngle(marks) ?? Number.POSITIVE_INFINITY),
    );

    expect(deepest).toBeLessThanOrEqual(RepCounterThresholds.goodDepthAngleMax);
  });

  it('should leave headroom under the depth threshold rather than scraping it', () => {
    // A demonstration that only just qualifies teaches a squat that gets graded shallow.
    const deepest = Math.min(
      ...sampleCycle().map((marks) => kneeAngle(marks) ?? Number.POSITIVE_INFINITY),
    );

    expect(RepCounterThresholds.goodDepthAngleMax - deepest).toBeGreaterThanOrEqual(5);
  });

  it('should score one good-form rep per cycle when fed to the rep counter', () => {
    const state = count(sampleCycle());

    expect(state.reps).toBe(1);
    expect(state.goodFormReps).toBe(1);
  });

  it('should never leave the counter with a rep half-open at the end of a cycle', () => {
    // A cycle that finished mid-descent would drop a rep every time the figure looped.
    expect(count(sampleCycle()).phase).toBe('standing');
  });

  it('should score exactly one rep per cycle over a full prescribed set', () => {
    const reps = PrescriptionThresholds.fullTargetReps;
    const state = count(sampleCycle(SQUAT, SQUAT.defaultCycleMs, reps));

    expect(state.reps).toBe(reps);
    expect(state.goodFormReps).toBe(reps);
  });

  it('should count the same reps at the reduced tempo as at the full one', () => {
    // Tempo scales the clock; it must not change what the movement is.
    const routine = planGuidedRoutine(prescribeSession(reading({ score: 60 })));
    const state = count(sampleCycle(SQUAT, routine.cycleMs, 3));

    expect(state.reps).toBe(3);
    expect(state.goodFormReps).toBe(3);
  });
});

describe('the tempo', () => {
  it('should report no completed reps until the first cycle closes', () => {
    expect(frameAt(SQUAT, 4000, 0).completedReps).toBe(0);
    expect(frameAt(SQUAT, 4000, 3999).completedReps).toBe(0);
    expect(frameAt(SQUAT, 4000, 4000).completedReps).toBe(1);
  });

  it('should report the rep count its own cycle length implies', () => {
    expect(frameAt(SQUAT, 4000, 4000 * 12 + 10).completedReps).toBe(12);
  });

  it('should treat a clock that has not started as the top of the first rep', () => {
    // The screen renders the figure before Start is pressed; a negative or zero elapsed
    // must not wrap round to the end of a cycle.
    expect(frameAt(SQUAT, 4000, -500).progress).toBe(0);
    expect(frameAt(SQUAT, 4000, -500).completedReps).toBe(0);
  });

  it('should take the prescribed set exactly as long as its target and tempo say', () => {
    const routine = planGuidedRoutine(prescribeSession(reading({ score: 85 })));

    expect(plannedDurationMs(routine)).toBe(routine.targetReps! * routine.cycleMs);
  });

  it('should give no planned duration when the prescription set no target', () => {
    expect(plannedDurationMs(planGuidedRoutine(prescribeSession(null)))).toBeNull();
  });
});

describe('the march', () => {
  it('should alternate legs between cycles', () => {
    const first = frameAt(MARCH, MARCH.defaultCycleMs, MARCH.defaultCycleMs * 0.5);
    const second = frameAt(MARCH, MARCH.defaultCycleMs, MARCH.defaultCycleMs * 1.5);

    // The raised knee is the one that has left the standing line, and it swaps sides.
    expect(first.landmarks.LEFT_KNEE!.y).toBeLessThan(first.landmarks.RIGHT_KNEE!.y);
    expect(second.landmarks.RIGHT_KNEE!.y).toBeLessThan(second.landmarks.LEFT_KNEE!.y);
  });

  it('should never claim to reach a depth it is not trying to reach', () => {
    for (const marks of sampleCycle(MARCH, MARCH.defaultCycleMs, 2)) {
      expect(frameAt(MARCH, MARCH.defaultCycleMs, 0).isAtDepth).toBe(false);
      expect(kneeAngle(marks)!).toBeGreaterThan(RepCounterThresholds.goodDepthAngleMax);
    }
  });

  it('should breathe in on the way up and out on the way down', () => {
    expect(frameAt(MARCH, 4000, 800).cue).toContain('Breathe in');
    expect(frameAt(MARCH, 4000, 2400).cue).toContain('Breathe out');
  });
});

describe('the easing', () => {
  it('should land on both endpoints exactly, whatever curve it is given', () => {
    // The whole safety argument for easing: it changes when the figure is somewhere, never
    // where the keyframes said it would end up. A curve that undershot 1 would quietly
    // shallow the demonstrated squat.
    for (const kind of ['smooth', 'drive'] as const) {
      expect(easeSegment(kind, 0)).toBe(0);
      expect(easeSegment(kind, 1)).toBe(1);
    }
  });

  it('should never go backwards', () => {
    // A non-monotonic curve reads as the figure flinching back mid-movement.
    for (const kind of ['smooth', 'drive'] as const) {
      let previous = -Infinity;

      for (let t = 0; t <= 1.0001; t += 0.005) {
        const value = easeSegment(kind, t);

        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it('should clamp rather than extrapolate outside the segment', () => {
    expect(easeSegment('smooth', -0.5)).toBe(0);
    expect(easeSegment('drive', 1.5)).toBe(1);
  });

  it('should leave the bottom of a squat faster than it leaves the top', () => {
    // `drive` against `smooth` is the difference between standing up out of a squat and
    // being winched out of one.
    expect(easeSegment('drive', 0.15)).toBeGreaterThan(easeSegment('smooth', 0.15));
  });
});

describe('the phase split', () => {
  it('should divide each cycle into segments that span it exactly once', () => {
    for (const exercise of [SQUAT, MARCH]) {
      const { keyframes } = exercise;

      expect(keyframes[0].at).toBe(0);
      expect(keyframes[keyframes.length - 1].at).toBe(1);

      const spans = keyframes.slice(1).map((frame, i) => frame.at - keyframes[i].at);

      for (const span of spans) expect(span).toBeGreaterThan(0);
      expect(spans.reduce((sum, span) => sum + span, 0)).toBeCloseTo(1, 10);
    }
  });

  it('should lower slowly, pause, and drive up quicker', () => {
    // Measured off the movement rather than off the table, because the table is not what
    // anybody watches. Evenly divided phases are the loudest tell that an animation was
    // laid out on a grid.
    const angles = [];
    for (let t = 0; t < SQUAT.defaultCycleMs; t += 10) {
      angles.push(kneeAngle(frameAt(SQUAT, SQUAT.defaultCycleMs, t).landmarks)!);
    }

    const deepest = Math.min(...angles);
    const firstAtDepth = angles.findIndex((a) => a <= deepest + 1);
    const lastAtDepth = angles.length - 1 - [...angles].reverse().findIndex((a) => a <= deepest + 1);

    const descent = firstAtDepth / angles.length;
    const hold = (lastAtDepth - firstAtDepth) / angles.length;
    const rise = 1 - lastAtDepth / angles.length;

    expect(descent).toBeGreaterThanOrEqual(0.5);
    expect(rise).toBeLessThan(descent);
    expect(hold).toBeGreaterThan(0.05);
  });
});

describe('the idle', () => {
  it('should never let the standing figure be perfectly still', () => {
    // A figure frozen between reps looks switched off.
    const still = frameAt(SQUAT, SQUAT.defaultCycleMs, 0).landmarks;
    const later = frameAt(SQUAT, SQUAT.defaultCycleMs, 900).landmarks;

    expect(later.LEFT_SHOULDER!.x).not.toBeCloseTo(still.LEFT_SHOULDER!.x, 3);
  });

  it('should stay small enough that the figure never bobs', () => {
    // The failure mode of the fix is worse than the thing it fixes.
    const standing = [];
    for (let t = 0; t < 20000; t += 50) {
      // Sampled only where the cycle is at the top, which is where the idle is at full
      // weight.
      const frame = frameAt(SQUAT, SQUAT.defaultCycleMs, t);
      if (frame.progress < 0.05) standing.push(frame.landmarks.LEFT_SHOULDER!);
    }

    const xs = standing.map((p) => p.x);
    const ys = standing.map((p) => p.y);

    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(6);
  });

  it('should be incapable of moving the knee angle at all', () => {
    // The idle rotates thigh and shin together, so `180 - |thigh - shin|` cannot change.
    // That is what keeps it from nudging a standing frame under the counter's threshold or
    // opening a rep out of a breath.
    for (let t = 0; t < 20000; t += 37) {
      const frame = frameAt(SQUAT, SQUAT.defaultCycleMs, t);
      if (frame.progress >= 0.05) continue;

      // Not exact only because `acos` near a straight leg is: the pose angles themselves
      // are identical to the last bit.
      expect(frame.kneeAngleDegrees!).toBeCloseTo(180, 4);
    }
  });

  it('should fade out entirely at the bottom of a squat', () => {
    // Nothing may wobble the depth the counter is about to grade.
    const held = [];
    for (let t = 0; t < 20000; t += 50) {
      const frame = frameAt(SQUAT, SQUAT.defaultCycleMs, t);
      if (frame.progress > 0.58 && frame.progress < 0.66) held.push(frame.landmarks.LEFT_KNEE!);
    }

    for (const knee of held) expect(knee.x).toBeCloseTo(held[0].x, 6);
  });
});

describe('the recovery gate', () => {
  it('should prescribe the full set of squats the camera session would', () => {
    const prescription = prescribeSession(reading({ score: 85 }));
    const routine = planGuidedRoutine(prescription);

    expect(routine.exercise.id).toBe('squat');
    expect(routine.targetReps).toBe(PrescriptionThresholds.fullTargetReps);
    expect(routine.targetReps).toBe(prescription.targetReps);
  });

  it('should prescribe the shorter set below the full threshold', () => {
    const routine = planGuidedRoutine(prescribeSession(reading({ score: 60 })));

    expect(routine.intensity).toBe('reduced');
    expect(routine.targetReps).toBe(PrescriptionThresholds.reducedTargetReps);
  });

  it('should run the shorter set at a slower tempo, not a rushed one', () => {
    const full = planGuidedRoutine(prescribeSession(reading({ score: 85 })));
    const reduced = planGuidedRoutine(prescribeSession(reading({ score: 60 })));

    expect(reduced.cycleMs).toBeGreaterThan(full.cycleMs);
  });

  it('should offer mobility rather than squats below the reduced threshold', () => {
    const routine = planGuidedRoutine(prescribeSession(reading({ score: 30 })));

    expect(routine.intensity).toBe('mobility');
    expect(routine.exercise.id).toBe('march');
    expect(routine.targetReps).toBeNull();
  });

  it('should offer mobility when the illness detector has flagged the morning', () => {
    // The score alone would have cleared a full set; the override has to survive here too.
    const routine = planGuidedRoutine(prescribeSession(reading({ score: 72, illness_warning: true })));

    expect(routine.exercise.id).toBe('march');
    expect(routine.targetReps).toBeNull();
  });

  it('should never set a target the prescription did not set', () => {
    const scores = [0, 25, 49, 50, 69, 70, 100];

    for (const score of scores) {
      const prescription = prescribeSession(reading({ score }));

      expect(planGuidedRoutine(prescription).targetReps).toBe(prescription.targetReps);
    }
  });

  it('should let an ungated day move without inventing a target for it', () => {
    const routine = planGuidedRoutine(prescribeSession(null));

    expect(routine.intensity).toBe('unknown');
    expect(routine.exercise.id).toBe('squat');
    expect(routine.targetReps).toBeNull();
  });
});

function distance(marks: Landmarks, from: string, to: string): number {
  return Math.hypot(marks[from]!.x - marks[to]!.x, marks[from]!.y - marks[to]!.y);
}
