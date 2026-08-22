/**
 * Counts bodyweight squats from pose landmarks.
 *
 * This is a joint-angle state machine, **not** a second model. The pose estimator
 * (YOLO26N-Pose, Google/Ultralytics, used as-is) gives seventeen COCO landmarks per
 * frame; everything here is trigonometry and hysteresis over the knee angle. That is a
 * deliberate choice: a rule you can read is testable with golden sequences and
 * explainable to a user, and nothing about rep counting needs a learned model.
 *
 * The honesty rules from `focus-features.ts` carry over. A frame whose landmarks are not
 * visible is *skipped*, never read as a straight leg — the pose estimator reports an
 * occluded joint as `{ x: -1, y: -1 }`, and treating that as a measurement would invent
 * reps out of someone walking out of frame.
 */

export interface Point {
  x: number;
  y: number;
}

/** The subset of COCO keypoints this counter reads. */
export type KneeKeypoint =
  | 'LEFT_HIP'
  | 'RIGHT_HIP'
  | 'LEFT_KNEE'
  | 'RIGHT_KNEE'
  | 'LEFT_ANKLE'
  | 'RIGHT_ANKLE';

export type Landmarks = Partial<Record<string, Point>>;

/**
 * Standing is a knee this straight. Set well below 180° because nobody locks out, and
 * because the pose estimator's ankle drifts by a few degrees frame to frame.
 */
const STANDING_ANGLE_MIN = 160;

/**
 * A bend must pass this to be a rep at all. The 20° gap to STANDING_ANGLE_MIN is the
 * hysteresis band: without it, jitter either side of a single threshold would count a
 * rep every couple of frames while someone stood still.
 */
const REP_ANGLE_MAX = 140;

/**
 * Thigh roughly parallel to the ground. Reps shallower than this still count — you did
 * move — but they are not counted as good form, and the UI says which is which rather
 * than silently discarding the work.
 */
const GOOD_DEPTH_ANGLE_MAX = 100;

export const RepCounterThresholds = {
  standingAngleMin: STANDING_ANGLE_MIN,
  repAngleMax: REP_ANGLE_MAX,
  goodDepthAngleMax: GOOD_DEPTH_ANGLE_MAX,
} as const;

/**
 * `unknown` until a standing frame is seen.
 *
 * Starting in `standing` would count a phantom rep whenever the session opens with the
 * user already crouched: the first rise past the threshold would look like the top of a
 * squat that was never observed going down.
 */
export type RepPhase = 'unknown' | 'standing' | 'descending';

export interface RepCounterState {
  phase: RepPhase;
  reps: number;
  goodFormReps: number;
  /** Deepest (smallest) knee angle seen since leaving standing. */
  minAngleThisRep: number | null;
  /** Most recent usable angle, for the live readout. Null while landmarks are missing. */
  lastAngle: number | null;
  observedFrames: number;
  /** Frames dropped for missing landmarks — surfaced so the UI can say "step into frame". */
  skippedFrames: number;
}

export const initialRepCounterState: RepCounterState = {
  phase: 'unknown',
  reps: 0,
  goodFormReps: 0,
  minAngleThisRep: null,
  lastAngle: null,
  observedFrames: 0,
  skippedFrames: 0,
};

/** The estimator marks an occluded joint as (-1, -1) rather than omitting it. */
function isVisible(point: Point | undefined): point is Point {
  return point !== undefined && point.x >= 0 && point.y >= 0;
}

/** Interior angle at `vertex`, in degrees, or null if the arms have no length. */
function angleAt(vertex: Point, a: Point, b: Point): number | null {
  const v1 = { x: a.x - vertex.x, y: a.y - vertex.y };
  const v2 = { x: b.x - vertex.x, y: b.y - vertex.y };

  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);

  if (m1 === 0 || m2 === 0) return null;

  // Clamped because floating point can push a collinear dot product a hair past ±1,
  // where acos returns NaN.
  const cosine = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)));

  return (Math.acos(cosine) * 180) / Math.PI;
}

function sideAngle(marks: Landmarks, side: 'LEFT' | 'RIGHT'): number | null {
  const hip = marks[`${side}_HIP`];
  const knee = marks[`${side}_KNEE`];
  const ankle = marks[`${side}_ANKLE`];

  if (!isVisible(hip) || !isVisible(knee) || !isVisible(ankle)) return null;

  return angleAt(knee, hip, ankle);
}

/**
 * Knee angle in degrees — 180° is a straight leg, smaller is a deeper bend.
 *
 * Both legs are averaged when both are visible, because a single leg's ankle is the
 * noisiest landmark in the set. One visible leg is enough: side-on to the camera, the far
 * leg is occluded for the whole rep, and refusing to count then would make the feature
 * useless in exactly the position that shows depth best.
 */
export function kneeAngle(marks: Landmarks): number | null {
  const angles = [sideAngle(marks, 'LEFT'), sideAngle(marks, 'RIGHT')].filter(
    (a): a is number => a !== null,
  );

  if (angles.length === 0) return null;

  return angles.reduce((sum, a) => sum + a, 0) / angles.length;
}

/**
 * Folds one frame of landmarks into the count.
 *
 * Pure: same state and same landmarks always give the same result, which is what lets the
 * whole counter be tested with golden angle sequences and no camera.
 */
export function observe(state: RepCounterState, marks: Landmarks): RepCounterState {
  const angle = kneeAngle(marks);

  if (angle === null) {
    // Not a reading. The phase is held rather than reset: walking briefly out of frame
    // mid-squat should not silently abandon the rep in progress.
    return { ...state, lastAngle: null, skippedFrames: state.skippedFrames + 1 };
  }

  const next: RepCounterState = {
    ...state,
    lastAngle: angle,
    observedFrames: state.observedFrames + 1,
  };

  if (next.phase === 'unknown') {
    // Wait for a standing frame before counting anything at all.
    return angle >= STANDING_ANGLE_MIN ? { ...next, phase: 'standing' } : next;
  }

  if (next.phase === 'standing') {
    if (angle < REP_ANGLE_MAX) {
      return { ...next, phase: 'descending', minAngleThisRep: angle };
    }
    return next;
  }

  // descending — track the deepest point, and close the rep on the way back up.
  const minAngle = Math.min(next.minAngleThisRep ?? angle, angle);

  if (angle >= STANDING_ANGLE_MIN) {
    return {
      ...next,
      phase: 'standing',
      reps: next.reps + 1,
      goodFormReps: next.goodFormReps + (minAngle <= GOOD_DEPTH_ANGLE_MAX ? 1 : 0),
      minAngleThisRep: null,
    };
  }

  return { ...next, minAngleThisRep: minAngle };
}

/** True when `next` closed a rep that did not reach depth — what the lamp alert fires on. */
export function completedShallowRep(prev: RepCounterState, next: RepCounterState): boolean {
  return next.reps > prev.reps && next.goodFormReps === prev.goodFormReps;
}
