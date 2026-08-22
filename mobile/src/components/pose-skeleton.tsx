import { StyleSheet } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import { AuraColors } from '@/constants/theme';
import type { Landmarks, Point } from '@/ml/rep-counter';

/**
 * The skeleton drawn over the camera preview — the "AR" of the movement session.
 *
 * Only the lower body is drawn. The counter reads the knee angle, so the arms and face
 * would be decoration, and decoration over a live camera makes it harder to see which
 * landmarks the app is actually using. Showing exactly the joints that drive the count is
 * the honest overlay.
 */

const BONES: [string, string][] = [
  ['LEFT_SHOULDER', 'LEFT_HIP'],
  ['RIGHT_SHOULDER', 'RIGHT_HIP'],
  ['LEFT_HIP', 'RIGHT_HIP'],
  ['LEFT_HIP', 'LEFT_KNEE'],
  ['RIGHT_HIP', 'RIGHT_KNEE'],
  ['LEFT_KNEE', 'LEFT_ANKLE'],
  ['RIGHT_KNEE', 'RIGHT_ANKLE'],
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

const JOINTS = [...MEASURED, 'LEFT_SHOULDER', 'RIGHT_SHOULDER'];

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
}

export function PoseSkeleton({
  landmarks,
  sourceWidth,
  sourceHeight,
  width,
  height,
  isAtDepth = false,
  mirrored = false,
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

  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height} pointerEvents="none">
      {BONES.map(([from, to]) => {
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
            strokeWidth={4}
            strokeLinecap="round"
            opacity={0.9}
          />
        );
      })}

      {JOINTS.map((name) => {
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
