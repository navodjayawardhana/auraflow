import { useCallback, useEffect, useState } from 'react';

import {
  frameAt,
  plannedDurationMs,
  type GuidedFrame,
  type GuidedRoutine,
} from '@/services/guided-routine';

/**
 * Runs the clock for one follow-along session.
 *
 * The hook owns nothing but time. Every pose, cue and rep comes back out of
 * `frameAt`, which is a pure function of the elapsed milliseconds — so a dropped frame,
 * a re-render from an unrelated state change, or the screen coming back from the
 * background all leave the figure exactly where the clock says, with no drift to correct.
 */

/**
 * 20 fps. `PoseSkeleton` is an ordinary prop-driven SVG, so animating it means a React
 * render per frame; a Reanimated shared value would need every line and circle rebuilt as
 * an animated node, which is a second skeleton to keep in step with the first. Fifteen
 * SVG children at 20 fps is the cheaper trade, and a four-second squat still gets eighty
 * steps to move through.
 */
const FRAME_MS = 50;

export type GuidedPhase = 'ready' | 'running' | 'finished';

export interface GuidedSession {
  phase: GuidedPhase;
  frame: GuidedFrame;
  /** Whole cycles the user has been led through. Zero until the session actually starts. */
  reps: number;
  elapsedSeconds: number;
  start: () => void;
  stop: () => void;
  /** Back to the top: no reps, no clock, no leaving the screen. */
  reset: () => void;
}

export function useGuidedSession(routine: GuidedRoutine): GuidedSession {
  const [phase, setPhase] = useState<GuidedPhase>('ready');
  const [elapsedMs, setElapsedMs] = useState(0);

  /**
   * Bumped by `reset`, and only there. Restarting from `ready` back to `ready` is a
   * no-op as far as React is concerned, so the clock effect below would never re-run and
   * a reset from the preview state would silently do nothing — this is the one piece of
   * state whose value is meaningless and whose *change* is the whole point.
   */
  const [runId, setRunId] = useState(0);

  const { cycleMs } = routine;
  const limitMs = plannedDurationMs(routine);

  useEffect(() => {
    if (phase === 'finished') return;

    // The clock restarts whenever the phase does, which is what makes the demonstration
    // begin at the top of a cycle rather than wherever the preview loop had got to.
    const startedAt = Date.now();
    setElapsedMs(0);

    const timer = setInterval(() => {
      const next = Date.now() - startedAt;

      // Stopping at the prescribed set is the gate doing its job at the far end: a
      // session that kept going would quietly undo the reduction it was given.
      if (phase === 'running' && limitMs !== null && next >= limitMs) {
        setElapsedMs(limitMs);
        setPhase('finished');
        return;
      }

      setElapsedMs(next);
    }, FRAME_MS);

    return () => clearInterval(timer);
  }, [phase, cycleMs, limitMs, runId]);

  const start = useCallback(() => setPhase('running'), []);
  const stop = useCallback(() => setPhase('finished'), []);

  const reset = useCallback(() => {
    setPhase('ready');
    setElapsedMs(0);
    setRunId((n) => n + 1);
  }, []);

  const frame = frameAt(routine.exercise, cycleMs, elapsedMs);

  return {
    phase,
    frame,
    // Before Start the same animation is playing as a preview, and cycles watched are
    // not cycles done.
    reps: phase === 'ready' ? 0 : frame.completedReps,
    elapsedSeconds: phase === 'ready' ? 0 : Math.floor(elapsedMs / 1000),
    start,
    stop,
    reset,
  };
}
