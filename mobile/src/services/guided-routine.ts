import { RepCounterThresholds, kneeAngle, type Landmarks, type Point } from '@/ml/rep-counter';
import type { SessionIntensity, SessionPrescription } from '@/ml/session-prescription';

/**
 * The follow-along movement session: a reference figure, keyframed, at a tempo.
 *
 * This exists because the pose runtime is a native module and Expo Go does not carry it,
 * so on the demo device the camera session can never run. Rather than a second feature,
 * it is the same feature with the observer removed: the figure is drawn by `PoseSkeleton`
 * — the very component that draws the AR overlay — from landmarks this module synthesises
 * instead of landmarks a model inferred. That is why there is no 3D engine and no rigged
 * model here. The app can already draw a body; it only lacked something to draw when the
 * camera is not watching.
 *
 * Everything below is pure. The screen owns a clock and nothing else, which is what lets
 * the parts that can be silently wrong — does the demonstrated squat actually reach the
 * depth the rep counter calls correct, does the tempo produce the reps it claims — be
 * checked without a device.
 *
 * The reference poses are authored as **joint angles, not joint positions**. Interpolating
 * positions would shorten every limb on the way between two keyframes: the knee travels on
 * an arc around the ankle, and a straight line between two points on an arc cuts inside
 * it, so a figure keyframed that way visibly telescopes mid-rep. Angles interpolate to
 * angles, and forward kinematics rebuilds the limbs at full length on every frame.
 *
 * The figure carries arms, a head and feet even though the counter reads none of them.
 * That is not decoration: a squat is read from the arms, which swing forward to
 * counterbalance the hips travelling back, and a legs-only figure reads as falling rather
 * than sitting. The camera overlay still draws only the joints it measures — see the two
 * variants in `PoseSkeleton` — because over a live preview the extra strokes would hide
 * which landmarks the count is actually coming from.
 */

// ---------------------------------------------------------------- geometry

/**
 * The coordinate space the landmarks are emitted in — the "camera" the figure is filmed
 * by, so `PoseSkeleton` can project it exactly as it projects a real frame. Sized to the
 * figure's own reach at its widest and deepest pose, so a panel of this aspect ratio
 * crops nothing off it.
 */
export const ReferenceFrame = { width: 176, height: 264 } as const;

/** The floor the figure stands on. Drawn, so the eye has something to place the feet against. */
export const ReferenceGroundY = 250;

/**
 * Reference-frame units, held constant across every pose — that is the whole point.
 *
 * Proportioned off a ~240-unit standing body using the ratios an anatomy canon gives,
 * rather than off what happened to look right in isolation: torso 0.30 of standing height,
 * thigh 0.245, shin 0.235, upper arm 0.186, forearm-with-hand 0.16, foot 0.13. The earlier
 * figure had a torso shorter than its own thigh, and a body proportioned like that looks
 * wrong before it has moved at all.
 */
const SEGMENT = {
  /** Hip to shoulder. */
  torso: 72,
  /** Shoulder to the *centre* of the head; the renderer sizes the skull from this. */
  neck: 27,
  upperArm: 45,
  foreArm: 38,
  thigh: 59,
  shin: 56,
  /** Ankle to toe. */
  foot: 31,
} as const;

/**
 * The ankle sits above the floor, not on it — which is what gives the foot somewhere to
 * go. Every planted-foot angle below is chosen to drop the toe exactly this far.
 */
const ANKLE_HEIGHT = 10;

/** Where the ankle carrying the weight is planted. Everything else is placed relative to it. */
const ANCHOR: Point = { x: 56, y: ReferenceGroundY - ANKLE_HEIGHT };

/**
 * The far side of the body, offset so it reads as a second limb rather than a thicker
 * first one. A pure translation on purpose: it moves the far side without changing the
 * angle at its knee, so the two sides of a squat stay in agreement about depth.
 *
 * Horizontal only. An earlier version also nudged the far side downwards, which is the
 * usual side-on cheat for depth — but with a floor now drawn under the figure it put the
 * far foot through it, and a foot below the ground line is a worse depth cue than none.
 * The far side is separated by stroke weight and opacity in the renderer instead.
 */
const FAR_SIDE_OFFSET: Point = { x: -13, y: 0 };

const RAD = Math.PI / 180;

/**
 * One side of the body, in degrees from straight down, positive towards the direction the
 * figure faces. Absolute rather than joint-relative because the knee's interior angle —
 * the one thing the rep counter reads — is then just `180 - |thigh - shin|`, which makes a
 * keyframe's depth checkable by eye as well as by test.
 *
 * The arm angles are absolute in the same frame rather than relative to the torso, so a
 * chest folding forward does not drag the arms round with it. In a squat the hands hold
 * their line in space while the ribcage rotates underneath them, and absolute angles give
 * that for free.
 */
interface SideAngles {
  thigh: number;
  shin: number;
  /** 71° is a flat foot: it walks the toe forward and exactly `ANKLE_HEIGHT` down. */
  foot: number;
  upperArm: number;
  foreArm: number;
}

interface PoseAngles {
  /** Forward lean of the torso. A squat that stays bolt upright reads as sitting on a chair. */
  torso: number;
  /** Absolute, like the rest — at depth the eyes stay up, so the head leans far less. */
  head: number;
  near: SideAngles;
  far: SideAngles;
}

/** Shape of the segment that starts at a keyframe. */
export type SegmentEasing = 'smooth' | 'drive';

interface Keyframe {
  /** Position within one cycle, 0–1. */
  at: number;
  /** Held until the next keyframe. Every keyframe carries one, so a cue is never absent. */
  cue: string;
  /** Defaults to `smooth`. */
  easing?: SegmentEasing;
  pose: PoseAngles;
}

interface Side {
  knee: Point;
  ankle: Point;
  toe: Point;
  elbow: Point;
  wrist: Point;
}

interface Figure {
  head: Point;
  shoulder: Point;
  hip: Point;
  near: Side;
  far: Side;
}

/** Walks `length` from `from`, in the direction `degrees` names. */
function extend(from: Point, degrees: number, length: number): Point {
  return {
    x: from.x + length * Math.sin(degrees * RAD),
    y: from.y + length * Math.cos(degrees * RAD),
  };
}

/**
 * Places the joints for one pose.
 *
 * Built hip-down and then planted, rather than built up from a fixed foot: only the
 * hip-down chain lets a raised foot leave the ground at all, and planting afterwards is
 * what makes the hips travel back and down through a squat instead of the feet sliding
 * forward under a stationary pelvis.
 */
function buildFigure(pose: PoseAngles): Figure {
  const hip: Point = { x: 0, y: 0 };

  // 180 - lean points the torso up rather than down, so one `extend` serves both.
  const shoulder = extend(hip, 180 - pose.torso, SEGMENT.torso);
  const head = extend(shoulder, 180 - pose.head, SEGMENT.neck);

  const side = (angles: SideAngles): Side => {
    const knee = extend(hip, angles.thigh, SEGMENT.thigh);
    const ankle = extend(knee, angles.shin, SEGMENT.shin);
    const elbow = extend(shoulder, angles.upperArm, SEGMENT.upperArm);

    return {
      knee,
      ankle,
      toe: extend(ankle, angles.foot, SEGMENT.foot),
      elbow,
      wrist: extend(elbow, angles.foreArm, SEGMENT.foreArm),
    };
  };

  const near = side(pose.near);
  const far = side(pose.far);

  // Whichever *ankle* is lower is the one bearing weight — not whichever toe, because a
  // raised leg's toe swings forward and down and would otherwise steal the anchor
  // mid-march, pivoting the whole figure on a foot that is in the air.
  const support = near.ankle.y >= far.ankle.y ? near.ankle : far.ankle;
  const dx = ANCHOR.x - support.x;
  const dy = ANCHOR.y - support.y;

  const plant = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });

  const plantSide = (s: Side): Side => ({
    knee: plant(s.knee),
    ankle: plant(s.ankle),
    toe: plant(s.toe),
    elbow: plant(s.elbow),
    wrist: plant(s.wrist),
  });

  return {
    head: plant(head),
    shoulder: plant(shoulder),
    hip: plant(hip),
    near: plantSide(near),
    far: plantSide(far),
  };
}

/**
 * Emits the COCO landmark names `PoseSkeleton` and the rep counter both read, so a
 * reference pose is indistinguishable from an observed one downstream.
 *
 * `HEAD`, `LEFT_FOOT` and `RIGHT_FOOT` are not COCO names and never will be — the
 * estimator has no toe keypoint, and this figure needs one to stand on. They are extra
 * keys on a `Partial` record, which is exactly the case `PoseSkeleton` already handles by
 * skipping any bone whose endpoints it cannot find.
 *
 * `swapSides` sends the authored near side to the far side of the drawing. A march
 * alternates legs, and swapping here means the keyframes only ever describe one raise
 * rather than a left one and a right one that could drift apart. Each arm travels with its
 * own leg, so the opposite-arm swing alternates along with it.
 */
function toLandmarks(figure: Figure, swapSides: boolean): Landmarks {
  const drawnNear = swapSides ? figure.far : figure.near;
  const drawnFar = swapSides ? figure.near : figure.far;

  const behind = (p: Point): Point => ({
    x: p.x + FAR_SIDE_OFFSET.x,
    y: p.y + FAR_SIDE_OFFSET.y,
  });

  return {
    HEAD: figure.head,
    LEFT_SHOULDER: figure.shoulder,
    RIGHT_SHOULDER: behind(figure.shoulder),
    LEFT_HIP: figure.hip,
    RIGHT_HIP: behind(figure.hip),
    LEFT_ELBOW: drawnNear.elbow,
    LEFT_WRIST: drawnNear.wrist,
    RIGHT_ELBOW: behind(drawnFar.elbow),
    RIGHT_WRIST: behind(drawnFar.wrist),
    LEFT_KNEE: drawnNear.knee,
    LEFT_ANKLE: drawnNear.ankle,
    LEFT_FOOT: drawnNear.toe,
    RIGHT_KNEE: behind(drawnFar.knee),
    RIGHT_ANKLE: behind(drawnFar.ankle),
    RIGHT_FOOT: behind(drawnFar.toe),
  };
}

// ---------------------------------------------------------------- interpolation

/**
 * Shapes one segment's progress.
 *
 * Nothing alive moves at constant velocity, and a straight `lerp` between keyframes is
 * exactly constant velocity — which is the mechanical quality the figure had. Both curves
 * are monotonic and hit 0 and 1 exactly, so easing changes *when* the figure is somewhere,
 * never *where* the keyframes said it would end up: the depth the rep counter grades is
 * the same number before and after.
 *
 * `smooth` leaves one pose at rest and arrives at the next at rest. `drive` leaves at full
 * speed and decelerates in — the concentric half of a lift, where the effort is all at the
 * bottom and the top is coasted into.
 */
export function easeSegment(kind: SegmentEasing, t: number): number {
  const p = Math.min(1, Math.max(0, t));

  return kind === 'drive' ? 1 - (1 - p) * (1 - p) : p * p * (3 - 2 * p);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpSide(a: SideAngles, b: SideAngles, t: number): SideAngles {
  return {
    thigh: lerp(a.thigh, b.thigh, t),
    shin: lerp(a.shin, b.shin, t),
    foot: lerp(a.foot, b.foot, t),
    upperArm: lerp(a.upperArm, b.upperArm, t),
    foreArm: lerp(a.foreArm, b.foreArm, t),
  };
}

function lerpPose(a: PoseAngles, b: PoseAngles, t: number): PoseAngles {
  return {
    torso: lerp(a.torso, b.torso, t),
    head: lerp(a.head, b.head, t),
    near: lerpSide(a.near, b.near, t),
    far: lerpSide(a.far, b.far, t),
  };
}

/**
 * The pose and cue at a point in the cycle.
 *
 * Easing is applied per segment, which only works because every keyframe below is a pose
 * the body genuinely comes to rest in: the top of the movement, the bottom of it, or the
 * far end of a hold. An earlier version keyframed the halfway pose as well, and easing
 * *that* braked the figure to a stop in mid-descent. The way to shape a movement here is to
 * author its resting points and let the curve fill in between them, never to add a
 * waypoint the body is only meant to travel through.
 */
function sampleKeyframes(frames: Keyframe[], progress: number): { pose: PoseAngles; cue: string } {
  const p = Math.min(1, Math.max(0, progress));

  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].at <= p) i += 1;

  const from = frames[i];
  const to = frames[i + 1];
  const span = to.at - from.at;
  const t = span <= 0 ? 0 : Math.min(1, Math.max(0, (p - from.at) / span));

  return {
    pose: lerpPose(from.pose, to.pose, easeSegment(from.easing ?? 'smooth', t)),
    cue: from.cue,
  };
}

// ---------------------------------------------------------------- the idle

/**
 * One breath. Driven off the wall clock rather than off cycle progress, and deliberately
 * not a divisor of any tempo: a chest that rises on exactly the same beat of every rep
 * reads as a looping animation, where one that drifts against the count reads as a person
 * who happens to be breathing.
 */
const BREATH_MS = 3600;

/** Slower again, and coprime enough with the breath that the two never pulse as one. */
const SWAY_MS = 6100;

/** Past this much knee bend the body is working, and a working body does not idle. */
const IDLE_FADES_BY_DEGREES = 15;

/**
 * Adds the motion a standing body never stops making.
 *
 * A figure frozen between reps looks switched off, so this is not optional — but it is
 * tiny, because a figure that bobs is worse than one that stands still. Two components,
 * both fading out as the knee bends so neither ever fights the movement itself: the chest
 * opens and the head lifts a degree on the inhale, and the whole body sways a degree over
 * the planted ankle.
 *
 * The sway rotates thigh and shin by the *same* amount, which is the one detail here that
 * matters for correctness rather than looks. The knee's interior angle is
 * `180 - |thigh - shin|`, so rotating both by an equal amount leaves it exactly untouched:
 * the idle cannot nudge a standing frame under the counter's standing threshold, and
 * cannot open a phantom rep, no matter what amplitude it is given.
 */
function withIdle(pose: PoseAngles, elapsedMs: number): PoseAngles {
  const flex = Math.abs(pose.near.thigh - pose.near.shin);
  const weight = Math.max(0, 1 - flex / IDLE_FADES_BY_DEGREES);

  if (weight === 0) return pose;

  const breath = Math.sin((2 * Math.PI * elapsedMs) / BREATH_MS) * weight;
  const sway = Math.sin((2 * Math.PI * elapsedMs) / SWAY_MS) * weight;

  const idleSide = (side: SideAngles): SideAngles => ({
    ...side,
    thigh: side.thigh + 0.8 * sway,
    shin: side.shin + 0.8 * sway,
    upperArm: side.upperArm + 1.4 * breath,
  });

  return {
    torso: pose.torso - 1.1 * breath,
    head: pose.head - 0.9 * breath,
    near: idleSide(pose.near),
    far: idleSide(pose.far),
  };
}

// ---------------------------------------------------------------- the exercises

/**
 * Hand-authored, so there are two.
 *
 * A squat, because the rep counter already grades squats and a demonstration that
 * disagreed with the grader would teach one movement and mark another. A march, because
 * the recovery gate prescribes mobility below 50 and until now there was nothing to
 * prescribe. Both are shown side-on: projected front-on, a knee bend collapses to almost
 * nothing, so a front-facing figure cannot show depth at all — the same reason the
 * counter's own comments call side-on the angle that reads depth best.
 */

const SQUAT_STAND: PoseAngles = {
  torso: 4,
  head: 2,
  near: { thigh: 0, shin: 0, foot: 71, upperArm: 8, foreArm: 12 },
  far: { thigh: 0, shin: 0, foot: 71, upperArm: 8, foreArm: 12 },
};

/**
 * Knee at 89°. Chosen with margin under the counter's 100° rather than level with it:
 * someone copying a figure that only just qualified would be graded shallow on their own
 * attempt, and the gap absorbs that.
 *
 * The arms are the half of this pose that does the explaining. They swing up to roughly hip
 * height in front as the hips travel back, which is what a person actually does to keep
 * their centre of mass over the foot — and what makes the figure read as sitting into the
 * squat rather than toppling backwards out of it.
 */
const SQUAT_BOTTOM: PoseAngles = {
  torso: 40,
  head: 18,
  near: { thigh: 61, shin: -30, foot: 71, upperArm: 62, foreArm: 78 },
  far: { thigh: 61, shin: -30, foot: 71, upperArm: 62, foreArm: 78 },
};

const MARCH_STAND: PoseAngles = {
  torso: 2,
  head: 1,
  near: { thigh: 0, shin: 0, foot: 71, upperArm: 6, foreArm: 10 },
  far: { thigh: 0, shin: 0, foot: 71, upperArm: 6, foreArm: 10 },
};

/**
 * Thigh to roughly parallel, shin hanging. The far leg stays straight and carries the
 * weight, and the arms swing contralaterally — the raised knee's own arm goes back — which
 * is how walking is wired, and what stops a march looking like a hopping toy.
 *
 * The raised foot is dorsiflexed, toe pulled up. Left hanging it swings through the floor
 * at the halfway point of the raise, where the thigh is only part way up but the shin has
 * already dropped.
 */
const MARCH_TOP: PoseAngles = {
  torso: 2,
  head: 1,
  near: { thigh: 60, shin: -5, foot: 100, upperArm: -22, foreArm: -8 },
  far: { thigh: 0, shin: 0, foot: 71, upperArm: 25, foreArm: 55 },
};

export type GuidedExerciseId = 'squat' | 'march';

export interface GuidedExercise {
  id: GuidedExerciseId;
  name: string;
  /** One line under the figure, saying what the body is meant to be doing. */
  summary: string;
  /** Plural, for the count readout. Not every rep is a squat. */
  repNoun: string;
  defaultCycleMs: number;
  /** True when consecutive cycles work opposite legs, as a march does. */
  alternatesSides: boolean;
  /**
   * True when the movement has a depth the rep counter would grade. The figure lights up
   * there, borrowing the camera session's own signal for "this is the part that counts".
   */
  showsDepth: boolean;
  keyframes: Keyframe[];
}

/**
 * The phase split, and it is not the even one it first looks like it should be.
 *
 * A squat is asymmetric in time: half the cycle or more goes on lowering under control,
 * there is a short pause at the bottom, and the rise is quicker than the descent because
 * it is driven rather than resisted. Evenly divided phases are the loudest tell that an
 * animation was laid out on a grid rather than watched off a person — louder than any
 * amount of missing geometry.
 *
 * 50% descending, 12% at depth, 22% driving up, 16% standing across the loop seam. The rise
 * additionally uses `drive`, so it leaves the bottom at speed and coasts into the top,
 * where the descent both leaves and arrives at rest.
 */
const SQUAT: GuidedExercise = {
  id: 'squat',
  name: 'Bodyweight squat',
  summary: 'Feet under your hips, weight in your heels, chest up as you sit back.',
  repNoun: 'squats',
  defaultCycleMs: 4000,
  alternatesSides: false,
  showsDepth: true,
  keyframes: [
    { at: 0, cue: 'Stand tall', pose: SQUAT_STAND },
    { at: 0.06, cue: 'Hips back, lower', pose: SQUAT_STAND },
    { at: 0.56, cue: 'Hold the depth', pose: SQUAT_BOTTOM },
    { at: 0.68, cue: 'Drive up', easing: 'drive', pose: SQUAT_BOTTOM },
    { at: 0.9, cue: 'Stand tall', pose: SQUAT_STAND },
    { at: 1, cue: 'Stand tall', pose: SQUAT_STAND },
  ],
};

/**
 * The mobility movement, and the slow tempo is the point: at four seconds a raise, the
 * cues are one breath in and one breath out, which is what "move and breathe" was asking
 * for. Nothing here approaches the depth the counter grades, and it is not meant to.
 *
 * Closer to symmetric in time than the squat, because a knee raise is: the leg is lifted
 * and then lowered under the same control. The lowering gets slightly longer than the lift
 * only so the foot arrives rather than drops.
 */
const MARCH: GuidedExercise = {
  id: 'march',
  name: 'Standing march',
  summary: 'One knee at a time, slow enough to breathe with. Nothing here should strain.',
  repNoun: 'knee raises',
  defaultCycleMs: 4000,
  alternatesSides: true,
  showsDepth: false,
  keyframes: [
    { at: 0, cue: 'Stand tall', pose: MARCH_STAND },
    { at: 0.08, cue: 'Breathe in — knee up', pose: MARCH_STAND },
    { at: 0.42, cue: 'Tall through the hip', pose: MARCH_TOP },
    { at: 0.52, cue: 'Breathe out — foot down', pose: MARCH_TOP },
    { at: 0.88, cue: 'Stand tall', pose: MARCH_STAND },
    { at: 1, cue: 'Stand tall', pose: MARCH_STAND },
  ],
};

export const GuidedExercises: Record<GuidedExerciseId, GuidedExercise> = {
  squat: SQUAT,
  march: MARCH,
};

// ---------------------------------------------------------------- the clock

export interface GuidedFrame {
  /** Ready for `PoseSkeleton`, in `ReferenceFrame` coordinates. */
  landmarks: Landmarks;
  cue: string;
  /**
   * Whole cycles finished. An *assumed* rep count — the tempo kept time, nothing watched
   * whether the user kept up with it, and the saved session says so.
   */
  completedReps: number;
  /** 0–1 through the current cycle. */
  progress: number;
  /** The figure's own knee angle, by the same measure the counter applies to a person. */
  kneeAngleDegrees: number | null;
  isAtDepth: boolean;
}

/**
 * The whole animation, as a function of elapsed time.
 *
 * A function rather than a stepper because it then has no memory to get out of step with:
 * the screen can drop frames, be backgrounded, or re-render for an unrelated reason, and
 * the figure is still exactly where the clock says it should be. The idle is applied here
 * rather than inside the sampler because it needs the raw elapsed time — the whole reason
 * it does not lock to the tempo.
 */
export function frameAt(exercise: GuidedExercise, cycleMs: number, elapsedMs: number): GuidedFrame {
  const elapsed = Math.max(0, elapsedMs);
  const cycle = Math.floor(elapsed / cycleMs);
  const progress = (elapsed % cycleMs) / cycleMs;

  const { pose, cue } = sampleKeyframes(exercise.keyframes, progress);
  const landmarks = toLandmarks(
    buildFigure(withIdle(pose, elapsed)),
    exercise.alternatesSides && cycle % 2 === 1,
  );

  const angle = kneeAngle(landmarks);

  return {
    landmarks,
    cue,
    completedReps: cycle,
    progress,
    kneeAngleDegrees: angle,
    isAtDepth:
      exercise.showsDepth && angle !== null && angle <= RepCounterThresholds.goodDepthAngleMax,
  };
}

// ---------------------------------------------------------------- the prescription

/**
 * A slower cycle rather than a different movement. On a reduced day the shortfall the
 * recovery score describes is capacity, not skill, and hurrying through eight squats
 * would spend exactly what the gate was trying to protect.
 */
const REDUCED_CYCLE_MS = 4800;

export interface GuidedRoutine {
  intensity: SessionIntensity;
  exercise: GuidedExercise;
  /** Taken from the prescription, never recomputed. Null means what it means there. */
  targetReps: number | null;
  cycleMs: number;
}

/**
 * Turns today's prescription into a routine the figure can demonstrate.
 *
 * It consumes `prescribeSession`'s output rather than reading the recovery score again,
 * and that is the only way the guided and camera sessions can be guaranteed to gate
 * identically: there is one decision, made once, and this picks a movement to carry it
 * out. A second reading of the score here would be a second gate to keep in step.
 */
export function planGuidedRoutine(prescription: SessionPrescription): GuidedRoutine {
  switch (prescription.intensity) {
    case 'full':
      return {
        intensity: 'full',
        exercise: SQUAT,
        targetReps: prescription.targetReps,
        cycleMs: SQUAT.defaultCycleMs,
      };

    case 'reduced':
      return {
        intensity: 'reduced',
        exercise: SQUAT,
        targetReps: prescription.targetReps,
        cycleMs: REDUCED_CYCLE_MS,
      };

    case 'mobility':
      return {
        intensity: 'mobility',
        exercise: MARCH,
        targetReps: prescription.targetReps,
        cycleMs: MARCH.defaultCycleMs,
      };

    default:
      // Ungated, exactly as the camera session treats it: squats are still on offer, but
      // with no target, because no score was seen to set one from.
      return {
        intensity: 'unknown',
        exercise: SQUAT,
        targetReps: prescription.targetReps,
        cycleMs: SQUAT.defaultCycleMs,
      };
  }
}

/** How long the prescribed set takes at its tempo, or null when there is no target to time. */
export function plannedDurationMs(routine: GuidedRoutine): number | null {
  return routine.targetReps === null ? null : routine.targetReps * routine.cycleMs;
}
