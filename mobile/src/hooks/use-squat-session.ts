import type { CameraView } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { models, usePoseEstimation } from 'react-native-executorch';

import {
  completedShallowRep,
  initialRepCounterState,
  observe,
  type Landmarks,
  type RepCounterState,
} from '@/ml/rep-counter';

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
  const pose = usePoseEstimation({ model: models.pose_estimation.yolo26n() });

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
    downloadProgress: pose.downloadProgress,
    error: pose.error === null ? null : 'The pose model could not be loaded.',
    counter,
    landmarks,
    frameSize,
    elapsedSeconds,
    start,
    stop,
  };
}
