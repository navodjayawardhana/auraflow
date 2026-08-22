import {
  RepCounterThresholds,
  completedShallowRep,
  initialRepCounterState,
  kneeAngle,
  observe,
  type Landmarks,
  type RepCounterState,
} from '@/ml/rep-counter';

/**
 * Builds a synthetic leg whose knee angle is exactly `degrees`.
 *
 * Real image coordinates: the origin is the top-left corner, y grows downwards, and every
 * visible landmark is positive. That matters — the estimator signals an occluded joint
 * with the sentinel (-1, -1), so a factory that used negative numbers for "up" would look
 * occluded to the very code under test.
 */
function leg(degrees: number, side: 'LEFT' | 'RIGHT' = 'LEFT'): Landmarks {
  const radians = (degrees * Math.PI) / 180;
  const knee = { x: 200, y: 300 };

  return {
    [`${side}_HIP`]: { x: knee.x, y: knee.y - 100 },
    [`${side}_KNEE`]: knee,
    [`${side}_ANKLE`]: {
      x: knee.x + 100 * Math.sin(radians),
      y: knee.y - 100 * Math.cos(radians),
    },
  };
}

/** The sentinel the pose estimator uses for a joint it could not see. */
const GONE = { x: -1, y: -1 };

const OCCLUDED: Landmarks = {
  LEFT_HIP: GONE,
  LEFT_KNEE: GONE,
  LEFT_ANKLE: GONE,
  RIGHT_HIP: GONE,
  RIGHT_KNEE: GONE,
  RIGHT_ANKLE: GONE,
};

/** Feeds a sequence of knee angles through the counter, as one frame each. */
function run(angles: number[], from: RepCounterState = initialRepCounterState): RepCounterState {
  return angles.reduce((state, angle) => observe(state, leg(angle)), from);
}

/**
 * Golden sequences.
 *
 * Each is one plausible run of frames at roughly four per second — the rate the still
 * capture actually delivers. They are the only evidence that the hysteresis band does
 * what it claims: a single-threshold counter passes the first of these and fails the
 * third and fourth.
 */
const GOLDEN = {
  fullDepthRep: [175, 168, 150, 128, 104, 88, 92, 118, 145, 166, 178],
  shallowRep: [175, 168, 152, 136, 122, 118, 126, 148, 166, 176],
  standingJitter: [176, 158, 172, 159, 174, 161, 177, 158, 175],
  startedMidSquat: [86, 92, 120, 152, 172, 178],
};

describe('kneeAngle', () => {
  it('reads a straight leg as very nearly 180 degrees', () => {
    // Only three places: acos is ill-conditioned as the dot product approaches -1. The
    // thresholds that matter (160, 140, 100) sit nowhere near that.
    expect(kneeAngle(leg(180))).toBeCloseTo(180, 3);
  });

  it('reads a right-angled knee as 90 degrees', () => {
    expect(kneeAngle(leg(90))).toBeCloseTo(90, 6);
  });

  it('averages the two legs when both are visible', () => {
    const both: Landmarks = { ...leg(100, 'LEFT'), ...leg(140, 'RIGHT') };

    expect(kneeAngle(both)).toBeCloseTo(120, 6);
  });

  it('uses the one visible leg when the other is occluded', () => {
    // Side-on to the camera the far leg is hidden for the whole rep, which is exactly
    // the angle that shows depth best. Refusing to read then would be useless.
    const halfSeen: Landmarks = {
      ...leg(95, 'LEFT'),
      RIGHT_HIP: GONE,
      RIGHT_KNEE: GONE,
      RIGHT_ANKLE: GONE,
    };

    expect(kneeAngle(halfSeen)).toBeCloseTo(95, 6);
  });

  it('returns null rather than a number when no leg is visible', () => {
    // Never zero, and never a straight leg — both would be read as a measurement.
    expect(kneeAngle(OCCLUDED)).toBeNull();
    expect(kneeAngle({})).toBeNull();
  });
});

describe('observe', () => {
  it('counts one rep that reached depth', () => {
    const state = run(GOLDEN.fullDepthRep);

    expect(state.reps).toBe(1);
    expect(state.goodFormReps).toBe(1);
    expect(state.phase).toBe('standing');
  });

  it('counts a shallow rep but not as good form', () => {
    const state = run(GOLDEN.shallowRep);

    // The work happened, so it is counted; it just did not reach depth. Discarding it
    // would tell the user they did nothing.
    expect(state.reps).toBe(1);
    expect(state.goodFormReps).toBe(0);
  });

  it('does not count reps while someone stands still and the estimate jitters', () => {
    const state = run(GOLDEN.standingJitter);

    expect(state.reps).toBe(0);
    expect(state.phase).toBe('standing');
  });

  it('ignores a squat already in progress when the session opens', () => {
    const state = run(GOLDEN.startedMidSquat);

    // Rising past the threshold looks exactly like the top of a rep, so without the
    // `unknown` phase this sequence would count a squat that was never seen going down.
    expect(state.reps).toBe(0);
    expect(state.phase).toBe('standing');
  });

  it('counts each rep in a set', () => {
    const set = [
      ...GOLDEN.fullDepthRep,
      ...GOLDEN.fullDepthRep,
      ...GOLDEN.shallowRep,
      ...GOLDEN.fullDepthRep,
    ];

    const state = run(set);

    expect(state.reps).toBe(4);
    expect(state.goodFormReps).toBe(3);
  });

  it('skips a frame with no visible landmarks without abandoning the rep', () => {
    const descended = run([175, 150, 120, 95]);
    const blinked = observe(descended, OCCLUDED);

    expect(blinked.skippedFrames).toBe(1);
    expect(blinked.lastAngle).toBeNull();
    expect(blinked.phase).toBe('descending');

    // The rep still closes once the user is visible again at the top.
    expect(run([172, 178], blinked).reps).toBe(1);
  });

  it('does not let a skipped frame count towards observed frames', () => {
    const state = observe(run([175, 150]), OCCLUDED);

    expect(state.observedFrames).toBe(2);
    expect(state.skippedFrames).toBe(1);
  });

  it('keeps the deepest angle of the rep, not the last one before standing', () => {
    const state = run([175, 140, 88, 130, 170]);

    // Depth is judged on the bottom of the movement; by the time the knee is back at
    // 130 the rep is already as deep as it is going to get.
    expect(state.goodFormReps).toBe(1);
  });
});

describe('completedShallowRep', () => {
  it('fires only on the frame that closes a rep short of depth', () => {
    // Left mid-rise, so the closing frame is the one this test applies.
    const beforeTop = run([175, 150, 130, 122, 148]);
    const atTop = observe(beforeTop, leg(172));

    expect(atTop.reps).toBe(1);
    expect(atTop.goodFormReps).toBe(0);
    expect(completedShallowRep(beforeTop, atTop)).toBe(true);
    expect(completedShallowRep(atTop, atTop)).toBe(false);
  });

  it('stays quiet when the rep reached depth', () => {
    const beforeTop = run([175, 150, 95, 130]);
    const atTop = observe(beforeTop, leg(172));

    expect(atTop.reps).toBe(1);
    expect(atTop.goodFormReps).toBe(1);
    expect(completedShallowRep(beforeTop, atTop)).toBe(false);
  });
});

describe('RepCounterThresholds', () => {
  it('leaves a hysteresis band between entering a rep and returning to standing', () => {
    // The gap is the whole defence against double-counting. If someone narrows it to
    // zero this test says why that is wrong before the counter starts inventing reps.
    expect(RepCounterThresholds.repAngleMax).toBeLessThan(RepCounterThresholds.standingAngleMin);
    expect(RepCounterThresholds.goodDepthAngleMax).toBeLessThan(RepCounterThresholds.repAngleMax);
  });
});
