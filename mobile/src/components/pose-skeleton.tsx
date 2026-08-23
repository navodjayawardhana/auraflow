import { StyleSheet } from 'react-native';
import Svg, { Circle, Ellipse, Line } from 'react-native-svg';

import { AuraColors } from '@/constants/theme';
import type { Landmarks, Point } from '@/ml/rep-counter';

/**
 * The body, drawn from landmarks — over the camera preview, and on its own for the guided
 * session.
 *
 * Two variants, because the two callers want opposite things from the same component.
 *
 * `overlay` is the AR skeleton. Only the lower body is drawn: the counter reads the knee
 * angle, so arms and face would be decoration, and decoration over a live camera makes it
 * harder to see which landmarks the app is actually using. Showing exactly the joints that
 * drive the count is the honest overlay.
 *
 * `reference` is the guided session's demonstrator, where nothing is being measured and
 * the only job is to look like a person moving. It draws the whole body, weights each bone
 * in proportion to the limb underneath it, and dims the far side so the figure reads as
 * having two of everything rather than one thick one.
 *
 * Both take whatever landmarks they are handed and skip any bone with an endpoint missing,
 * which is what lets the reference figure invent `HEAD` and `LEFT_FOOT` — names COCO does
 * not have and the estimator will never emit — without the live path noticing.
 */

interface Bone {
  from: string;
  to: string;
  /**
   * Reference variant only, in *source* units. Scaled with the figure, so the body keeps
   * its proportions whatever size panel it is drawn into.
   */
  width?: number;
  /** Drawn first and dimmer: the limbs on the side of the body facing away. */
  far?: boolean;
}

const OVERLAY_BONES: Bone[] = [
  { from: 'LEFT_SHOULDER', to: 'LEFT_HIP' },
  { from: 'RIGHT_SHOULDER', to: 'RIGHT_HIP' },
  { from: 'LEFT_HIP', to: 'RIGHT_HIP' },
  { from: 'LEFT_HIP', to: 'LEFT_KNEE' },
  { from: 'RIGHT_HIP', to: 'RIGHT_KNEE' },
  { from: 'LEFT_KNEE', to: 'LEFT_ANKLE' },
  { from: 'RIGHT_KNEE', to: 'RIGHT_ANKLE' },
];

/**
 * Ordered back to front, because SVG has no z-buffer and paint order is the only depth
 * this figure gets: the far arm and leg go down first, then the trunk, then the near limbs
 * over the top of it.
 */
const REFERENCE_BONES: Bone[] = [
  { from: 'RIGHT_SHOULDER', to: 'RIGHT_ELBOW', width: 8, far: true },
  { from: 'RIGHT_ELBOW', to: 'RIGHT_WRIST', width: 6.5, far: true },
  { from: 'RIGHT_HIP', to: 'RIGHT_KNEE', width: 11, far: true },
  { from: 'RIGHT_KNEE', to: 'RIGHT_ANKLE', width: 9, far: true },
  { from: 'RIGHT_ANKLE', to: 'RIGHT_FOOT', width: 6.5, far: true },
  { from: 'RIGHT_SHOULDER', to: 'RIGHT_HIP', width: 13, far: true },

  { from: 'LEFT_SHOULDER', to: 'RIGHT_SHOULDER', width: 12 },
  { from: 'LEFT_HIP', to: 'RIGHT_HIP', width: 12 },
  { from: 'LEFT_SHOULDER', to: 'LEFT_HIP', width: 15 },
  { from: 'LEFT_SHOULDER', to: 'HEAD', width: 9 },

  { from: 'LEFT_HIP', to: 'LEFT_KNEE', width: 12 },
  { from: 'LEFT_KNEE', to: 'LEFT_ANKLE', width: 10 },
  { from: 'LEFT_ANKLE', to: 'LEFT_FOOT', width: 7 },
  { from: 'LEFT_SHOULDER', to: 'LEFT_ELBOW', width: 9 },
  { from: 'LEFT_ELBOW', to: 'LEFT_WRIST', width: 7 },
];

/** The three joints the knee angle is computed from get a larger, brighter dot. */
const MEASURED = new Set([
  'LEFT_HIP',
  'RIGHT_HIP',
  'LEFT_KNEE',
  'RIGHT_KNEE',
  'LEFT_ANKLE',
  'RIGHT_ANKLE',
]);

const OVERLAY_JOINTS = [...MEASURED, 'LEFT_SHOULDER', 'RIGHT_SHOULDER'];

/**
 * Source-unit radii, tuned to sit just proud of the bone they cap — a knuckle rather than
 * a bead. Sizing them independently of the strokes is what stops the reference figure
 * reading as a wireframe with markers on it.
 */
const REFERENCE_JOINTS: { name: string; radius: number; far?: boolean }[] = [
  { name: 'RIGHT_SHOULDER', radius: 6.5, far: true },
  { name: 'RIGHT_ELBOW', radius: 4.5, far: true },
  { name: 'RIGHT_WRIST', radius: 4, far: true },
  { name: 'RIGHT_HIP', radius: 6.5, far: true },
  { name: 'RIGHT_KNEE', radius: 5.5, far: true },
  { name: 'RIGHT_ANKLE', radius: 4.5, far: true },
  { name: 'LEFT_SHOULDER', radius: 7 },
  { name: 'LEFT_ELBOW', radius: 5 },
  { name: 'LEFT_WRIST', radius: 4.5 },
  { name: 'LEFT_HIP', radius: 7 },
  { name: 'LEFT_KNEE', radius: 6 },
  { name: 'LEFT_ANKLE', radius: 5 },
];

/**
 * The skull, as a fraction of the shoulder-to-head-centre distance. Derived rather than
 * given as a prop so the head can never end up sized for a body it is not attached to.
 */
const HEAD_RADIUS_RATIO = 0.6;

const FAR_SIDE_OPACITY = 0.42;
const NEAR_SIDE_OPACITY = 0.95;

function visible(p: Point | undefined): p is Point {
  return p !== undefined && p.x >= 0 && p.y >= 0;
}

interface PoseSkeletonProps {
  landmarks: Landmarks | null;
  /** The pose model's own coordinate space, so points can be mapped onto the preview. */
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  /** Depth reached on the current rep — the skeleton turns brand blue once it is good. */
  isAtDepth?: boolean;
  /** Front camera previews are mirrored, so the landmarks have to be mirrored to match. */
  mirrored?: boolean;
  /** Defaults to the AR overlay; see the note at the top for what the other one is for. */
  variant?: 'overlay' | 'reference';
  /** Source-space floor line. Omitted for the overlay, where the real floor is on camera. */
  groundY?: number;
}

export function PoseSkeleton({
  landmarks,
  sourceWidth,
  sourceHeight,
  width,
  height,
  isAtDepth = false,
  mirrored = false,
  variant = 'overlay',
  groundY,
}: PoseSkeletonProps) {
  if (landmarks === null || sourceWidth <= 0 || sourceHeight <= 0) return null;

  // The preview is cover-fitted, so the shorter axis is cropped. Scaling by the larger
  // ratio and centring the overflow reproduces that crop rather than stretching the
  // skeleton away from the body it is drawn over.
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const offsetX = (width - sourceWidth * scale) / 2;
  const offsetY = (height - sourceHeight * scale) / 2;

  const project = (p: Point) => {
    const x = p.x * scale + offsetX;
    return { x: mirrored ? width - x : x, y: p.y * scale + offsetY };
  };

  const stroke = isAtDepth ? AuraColors.brand.glow : '#ffffff';
  const isReference = variant === 'reference';

  const head = isReference ? landmarks.HEAD : undefined;
  const neckBase = isReference ? landmarks.LEFT_SHOULDER : undefined;
  const floorY = groundY === undefined ? null : groundY * scale + offsetY;

  // Both feet, so the contact patch sits under the stance rather than under one ankle.
  const feet = [landmarks.LEFT_FOOT, landmarks.RIGHT_FOOT].filter(visible).map(project);

  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height} pointerEvents="none">
      {floorY !== null ? (
        <Line
          x1={0}
          y1={floorY}
          x2={width}
          y2={floorY}
          stroke="#ffffff"
          strokeWidth={1.5}
          opacity={0.18}
        />
      ) : null}

      {/* Grounds the figure the way the floor line alone cannot: the eye reads contact from
          the shadow, not from a line the feet merely happen to touch. */}
      {floorY !== null && feet.length > 0 ? (
        <Ellipse
          cx={feet.reduce((sum, f) => sum + f.x, 0) / feet.length}
          cy={floorY}
          rx={22 * scale}
          ry={4 * scale}
          fill="#000000"
          opacity={0.28}
        />
      ) : null}

      {(isReference ? REFERENCE_BONES : OVERLAY_BONES).map(({ from, to, width: bone, far }) => {
        const a = landmarks[from];
        const b = landmarks[to];
        if (!visible(a) || !visible(b)) return null;

        const p1 = project(a);
        const p2 = project(b);

        return (
          <Line
            key={`${from}-${to}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={stroke}
            strokeWidth={isReference ? (bone ?? 8) * scale : 4}
            strokeLinecap="round"
            opacity={isReference ? (far ? FAR_SIDE_OPACITY : NEAR_SIDE_OPACITY) : 0.9}
          />
        );
      })}

      {isReference && visible(head) && visible(neckBase) ? (
        <Circle
          cx={project(head).x}
          cy={project(head).y}
          r={Math.hypot(head.x - neckBase.x, head.y - neckBase.y) * HEAD_RADIUS_RATIO * scale}
          fill={stroke}
          opacity={NEAR_SIDE_OPACITY}
        />
      ) : null}

      {isReference
        ? REFERENCE_JOINTS.map(({ name, radius, far }) => {
            const p = landmarks[name];
            if (!visible(p)) return null;

            const { x, y } = project(p);

            return (
              <Circle
                key={name}
                cx={x}
                cy={y}
                r={radius * scale}
                fill={stroke}
                opacity={far ? FAR_SIDE_OPACITY : NEAR_SIDE_OPACITY}
              />
            );
          })
        : OVERLAY_JOINTS.map((name) => {
            const p = landmarks[name];
            if (!visible(p)) return null;

            const { x, y } = project(p);
            const measured = MEASURED.has(name);

            return (
              <Circle
                key={name}
                cx={x}
                cy={y}
                r={measured ? 7 : 5}
                fill={measured ? stroke : 'rgba(255,255,255,0.55)'}
              />
            );
          })}
    </Svg>
  );
}
