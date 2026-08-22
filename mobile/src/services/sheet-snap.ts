/**
 * Where a dragged sheet lands when the finger lifts.
 *
 * Distance alone is the wrong question. The Today sheet travels three hundred-odd points,
 * so a decisive upward flick that covered forty of them would fall straight back down, and
 * the user would read that as the app ignoring them. Velocity is therefore consulted twice:
 * once as an outright override, for a throw whose intent is unmistakable whatever the
 * distance, and once as a short projection of where the finger was heading, which is what
 * settles the slow hesitant drags that stop near the middle.
 *
 * Kept out of the screen because it is the one part of the interaction that can be checked
 * without a finger — the gesture wiring around it cannot be, and pretending otherwise with
 * a faked pan would only test the fake.
 */

export type SheetSnap = 'collapsed' | 'expanded';

/** Past this the throw is the whole message and distance stops counting. Points/second. */
const FLICK_SPEED = 520;

/** How far ahead a drag is carried before it is measured against the midpoint. Seconds. */
const PROJECTION_SECONDS = 0.12;

export interface SheetSnapInput {
  /** 0 at rest, 1 fully open. */
  progress: number;
  /** Screen axis, points/second — negative is a drag towards the top of the screen. */
  velocityY: number;
  /** Points between the two positions, so velocity can be read in the same units. */
  travel: number;
}

export function resolveSheetSnap({ progress, velocityY, travel }: SheetSnapInput): SheetSnap {
  'worklet';

  if (velocityY <= -FLICK_SPEED) return 'expanded';
  if (velocityY >= FLICK_SPEED) return 'collapsed';

  // Zero travel only happens before the safe-area insets have arrived, and there is no
  // meaningful projection to make in that frame — the resting position is the safe answer.
  const projected = travel > 0 ? progress + ((-velocityY / travel) * PROJECTION_SECONDS) : progress;

  return projected >= 0.5 ? 'expanded' : 'collapsed';
}
