import type { CameraView } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  completedShallowRep,
  initialRepCounterState,
  observe,
  type Landmarks,
  type RepCounterState,
} from '@/ml/rep-counter';

/**
 * Reported as the session's `error` when the pose runtime is not in the build.
 *
 * Named rather than inlined for the same reason `BLE_UNAVAILABLE` is: it is the one pose
 * failure whose fix is a different binary rather than a different camera, light level or
 * stance, and saying so is the difference between a bug report and a rebuild.
 */
const POSE_UNAVAILABLE =
  'The movement coach needs a development build — the pose runtime is not available in Expo Go.';

/** The part of `usePoseEstimation` this file uses. */
interface PoseEstimation {
  isReady: boolean;
  downloadProgress: number;
  error: unknown;
  forward: (uri: string, options: { inputSize: number }) => Promise<unknown[]>;
}

/**
 * Required rather than imported, because `react-native-executorch` throws from its own
 * module body when the native runtime is absent — which is what Expo Go is. A static
 * import would take the whole app down at startup rather than this one screen, since
 * expo-router loads every route module to build the route tree, so the crash arrives
 * before anyone has navigated anywhere near a squat.
 *
 * `react-native-ble-plx` gets away with a static import because it defers its throw to
 * `new BleManager()`. This one does not, so the guard has to sit at the import.
 */
function loadPoseHook(): (() => PoseEstimation) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const executorch = require('react-native-executorch');

    return () =>
      executorch.usePoseEstimation({ model: executorch.models.pose_estimation.yolo26n() });
  } catch {
    return null;
  }
}

const usePoseEstimation = loadPoseHook();

/**
 * Stable identity on purpose: the capture effect lists `pose` in its dependencies, and a
 * fresh object every render would restart it on every render.
 */
const unavailablePose: PoseEstimation = {
  isReady: false,
  downloadProgress: 0,
  error: POSE_UNAVAILABLE,
  forward: async () => [],
};

/**
 * Resolved once at module load, so the hook below always calls exactly one hook from one
 * binding — a conditional call inside the component would be the rules-of-hooks
 * violation this indirection exists to avoid.
 */
const usePose: () => PoseEstimation = usePoseEstimation ?? (() => unavailablePose);

const isPoseAvailable = usePoseEstimation !== null;

/**
 * Runs the camera → pose → rep-counter loop for one movement session.
 *
 * Stills rather than a frame processor, and that is forced rather than chosen: VisionCamera's
 * frame processors need `react-native-worklets` ≥ 0.8, and Expo SDK 54 pins 0.5.1 through
 * Reanimated 4. See docs/adr/0006. A squat's full cycle takes a second or more, so four
 * frames a second is enough to catch the bottom of every rep — it would not be enough for a
 * fast or ballistic movement, which is one reason the feature is scoped to one exercise.
 */

/** ~4 fps. Faster than the model can keep up with on mid-range hardware anyway. */
const CAPTURE_INTERVAL_MS = 250;

/**
 * The smallest YOLO input the model offers. Pose at 384px is ample for a joint angle — the
 * knee is a large, high-contrast landmark — and the larger sizes cost latency that would
 * push the effective frame rate below where reps start being missed.
 */
const INPUT_SIZE = 384;

export type SessionPhase = 'loading' | 'ready' | 'running' | 'finished';

export interface SquatSession {
  phase: SessionPhase;
  /**
   * False in Expo Go, where the pose runtime's native module is absent. The screen shows
   * its own state for this rather than a camera preview that could never count a rep.
   */
  isPoseAvailable: boolean;
  /** 0–1 while the pose model downloads on first use. */
  downloadProgress: number;
  error: string | null;
  counter: RepCounterState;
  /** Landmarks from the most recent usable frame, for the skeleton overlay. */
  landmarks: Landmarks | null;
  /**
   * The captured frame's own pixel dimensions. The landmarks are in this space, so the
   * overlay cannot be projected onto the preview without it.
   */
  frameSize: { width: number; height: number } | null;
  elapsedSeconds: number;
  start: () => void;
  stop: () => void;
}

interface Options {
  camera: React.RefObject<CameraView | null>;
  /** Fires when a rep closes short of depth — the screen uses it to pulse the lamp. */
  onShallowRep?: () => void;
}

export function useSquatSession({ camera, onShallowRep }: Options): SquatSession {
  const pose = usePose();

  const [phase, setPhase] = useState<SessionPhase>('loading');
  const [counter, setCounter] = useState<RepCounterState>(initialRepCounterState);
  const [landmarks, setLandmarks] = useState<Landmarks | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Read inside the capture loop, which must not re-subscribe every time a rep lands.
  const counterRef = useRef(counter);
  counterRef.current = counter;

  const isRunning = useRef(false);
  const onShallowRepRef = useRef(onShallowRep);
  onShallowRepRef.current = onShallowRep;

  useEffect(() => {
    if (pose.isReady && phase === 'loading') setPhase('ready');
  }, [pose.isReady, phase]);

  const start = useCallback(() => {
    setCounter(initialRepCounterState);
    setElapsedSeconds(0);
    setPhase('running');
  }, []);

  const stop = useCallback(() => {
    isRunning.current = false;
    setPhase('finished');
  }, []);

  useEffect(() => {
    if (phase !== 'running') return;

    const started = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'running' || !pose.isReady) return;

    isRunning.current = true;
    let cancelled = false;

    async function loop() {
      while (isRunning.current && !cancelled) {
        const frameStarted = Date.now();

        try {
          const photo = await camera.current?.takePictureAsync({
            // Skipping the round trip through the photo library: the frame is read once
            // and discarded, and writing every frame to disk would be both slow and a
            // surprising thing for a fitness app to leave behind.
            shutterSound: false,
            skipProcessing: true,
            quality: 0.4,
          });

          if (photo?.uri && !cancelled) {
            const people = await pose.forward(photo.uri, { inputSize: INPUT_SIZE });

            // One person: whoever the model is most confident about. A second body in
            // frame is a bystander, not a second athlete to count.
            const marks = (people[0] ?? null) as Landmarks | null;

            if (!cancelled) {
              setFrameSize({ width: photo.width, height: photo.height });
              setLandmarks(marks);

              const previous = counterRef.current;
              const next = observe(previous, marks ?? {});

              counterRef.current = next;
              setCounter(next);

              if (completedShallowRep(previous, next)) onShallowRepRef.current?.();
            }
          }
        } catch {
          // A dropped frame is not a failure worth surfacing — the counter simply does
          // not advance, and the next capture is 250 ms away. Only a model-level error
          // (pose.error) is worth telling the user about.
        }

        const spent = Date.now() - frameStarted;
        if (spent < CAPTURE_INTERVAL_MS) {
          await new Promise((resolve) => setTimeout(resolve, CAPTURE_INTERVAL_MS - spent));
        }
      }
    }

    loop();

    return () => {
      cancelled = true;
      isRunning.current = false;
    };
  }, [phase, pose.isReady, pose, camera]);

  return {
    phase,
    isPoseAvailable,
    downloadProgress: pose.downloadProgress,
    error: !isPoseAvailable
      ? POSE_UNAVAILABLE
      : pose.error === null
        ? null
        : 'The pose model could not be loaded.',
    counter,
    landmarks,
    frameSize,
    elapsedSeconds,
    start,
    stop,
  };
}
