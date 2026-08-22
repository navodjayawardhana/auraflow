import { useCallback, useMemo, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  clamp,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { resolveSheetSnap, type SheetSnap } from '@/services/sheet-snap';

/** Points of finger travel before the drag is awarded to the sheet or to the list. */
const DECISION_SLOP = 5;

/** The grab strip above the list. A touch here is always the sheet's, whatever is below. */
const GRAB_ZONE = 34;

/** Underdamped enough to feel thrown rather than driven; the overshoot is a few points. */
const SPRING = { damping: 24, stiffness: 220, mass: 0.9 } as const;

/** Module scope so both the end and the cancel path capture the same worklet. */
function settle(
  progress: SharedValue<number>,
  snap: SheetSnap,
  onSettled: (isExpanded: boolean) => void,
) {
  'worklet';
  const isExpanded = snap === 'expanded';
  progress.value = withSpring(isExpanded ? 1 : 0, SPRING);
  runOnJS(onSettled)(isExpanded);
}

interface SheetDragOptions {
  /** Where the sheet's top edge sits at rest, in points from the top of the screen. */
  restingTop: number;
  /** Where it sits fully open — below the status bar, not under it. */
  expandedTop: number;
}

/**
 * The Apple Health drag: a sheet that pulls up over a hero, with a list inside it.
 *
 * The hard part is not the movement, it is deciding who owns a downward finger. The list
 * has to keep pull-to-refresh and ordinary scrolling, and the sheet has to collapse — from
 * the same stroke, in the same place on screen. So the pan does not activate on its own:
 * `manualActivation` holds it in BEGAN while `blocksExternalGesture` keeps the list's own
 * scroll gesture waiting behind it, and the first few points of movement answer the
 * question once, for the whole touch. Down with the list already at its top, or up with the
 * sheet not yet open, is the sheet's; anything else fails the pan, which releases the list
 * to scroll — or to refresh — as if no pan existed.
 *
 * Deciding once per touch rather than continuously is deliberate. A stroke that changes its
 * mind halfway — scroll up to the top, keep pulling, expect the sheet to follow — is not a
 * stroke anyone makes on purpose, and the alternative is pinning the list's offset frame by
 * frame while the sheet moves, which trades a case nobody meets for a fight with the
 * platform's own scroller on every single drag.
 *
 * Everything that moves runs on the UI thread. `isExpanded` crosses back to React only to
 * size the list's tail padding and to name the state for a screen reader; nothing the
 * finger is touching waits on a render.
 */
export function useSheetDrag({ restingTop, expandedTop }: SheetDragOptions) {
  const [isExpanded, setIsExpanded] = useState(false);

  // A ratio, not points: the insets behind `travel` can arrive a frame late, and a position
  // stored in points would then be measured against a distance that no longer exists.
  const progress = useSharedValue(0);
  const scrollOffset = useSharedValue(0);

  const touchOriginY = useSharedValue(0);
  const isTouchDecided = useSharedValue(false);
  const isGrabTouch = useSharedValue(false);
  const grabProgress = useSharedValue(0);
  const grabTranslation = useSharedValue(0);
  const isDriving = useSharedValue(false);

  const travel = Math.max(restingTop - expandedTop, 1);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollOffset.value = event.contentOffset.y;
  });

  /** Attached to the list, so the pan above has a handler it can hold back. */
  const scrollGesture = useMemo(() => Gesture.Native(), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .blocksExternalGesture(scrollGesture)
        .onTouchesDown((event) => {
          'worklet';
          const touch = event.allTouches[0];
          touchOriginY.value = touch?.absoluteY ?? 0;
          // `y` is relative to the sheet, so this asks whether the finger landed on the
          // handle. Nothing scrollable lives up there, and putting the list's offset in
          // charge of a touch it never received would strand the handle whenever the list
          // happened to be scrolled.
          isGrabTouch.value = (touch?.y ?? GRAB_ZONE) < GRAB_ZONE;
          isTouchDecided.value = false;
        })
        .onTouchesMove((event, state) => {
          'worklet';
          if (isTouchDecided.value) return;

          const touch = event.allTouches[0];
          if (touch === undefined) return;

          const moved = touch.absoluteY - touchOriginY.value;
          if (Math.abs(moved) < DECISION_SLOP) return;

          isTouchDecided.value = true;

          const isSheets =
            moved < 0
              ? progress.value < 1
              : progress.value > 0 && (isGrabTouch.value || scrollOffset.value <= 0);

          if (isSheets) state.activate();
          else state.fail();
        })
        .onStart((event) => {
          'worklet';
          isDriving.value = true;
          grabProgress.value = progress.value;
          // translationY counts from the touch rather than from activation, so the slop
          // spent deciding is already in it. Subtracting it is what stops the sheet jumping
          // those few points the instant it takes the drag.
          grabTranslation.value = event.translationY;
        })
        .onUpdate((event) => {
          'worklet';
          const dragged = event.translationY - grabTranslation.value;
          progress.value = clamp(grabProgress.value - dragged / travel, 0, 1);
        })
        .onEnd((event) => {
          'worklet';
          isDriving.value = false;
          settle(
            progress,
            resolveSheetSnap({ progress: progress.value, velocityY: event.velocityY, travel }),
            setIsExpanded,
          );
        })
        .onFinalize(() => {
          'worklet';
          // A drag cancelled rather than ended — an incoming call, a navigation — would
          // otherwise park the sheet between its positions with no finger left to finish it.
          if (!isDriving.value) return;
          isDriving.value = false;
          settle(
            progress,
            resolveSheetSnap({ progress: progress.value, velocityY: 0, travel }),
            setIsExpanded,
          );
        }),
    // The shared values are stable for the life of the screen; only these two can change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrollGesture, travel],
  );

  /** The same two positions without a finger — the handle's press, and its assistive action. */
  const toggle = useCallback(() => {
    const next = !isExpanded;
    progress.value = withSpring(next ? 1 : 0, SPRING);
    setIsExpanded(next);
  }, [isExpanded, progress]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * travel }],
  }));

  // The hero is covered by the time the sheet is open, so this only reads during the drag —
  // but without it the rings stay fully lit under a sheet that is plainly on top of them.
  const heroStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.7], [1, 0], Extrapolation.CLAMP),
  }));

  return { pan, scrollGesture, onScroll, sheetStyle, heroStyle, isExpanded, toggle, travel };
}
