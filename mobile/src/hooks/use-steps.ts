import { Pedometer } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/auth-context';
import {
  isPedometerAvailable,
  pruneOldDays,
  recordSteps,
  summarise,
  watchSteps,
  type StepSummary,
} from '@/services/step-counter';

export type StepStatus = 'checking' | 'unavailable' | 'denied' | 'counting';

const EMPTY: StepSummary = { today: 0, lastHour: 0, coverageMinutes: 0, isComplete: false };

/**
 * Live step count, with the state the UI needs to be honest about it.
 *
 * `unavailable` and `denied` are separate states because they call for different things
 * to be said: a phone with no step sensor is not the user's problem to fix, a refused
 * permission is. Neither is shown as a zero — a zero is a claim that you have not moved.
 */
export function useSteps() {
  const { user } = useAuth();
  const userId = user?.id;

  const [status, setStatus] = useState<StepStatus>('checking');
  const [summary, setSummary] = useState<StepSummary>(EMPTY);
  const subscription = useRef<{ remove: () => void } | null>(null);

  const refresh = useCallback(async () => {
    if (userId === undefined) return;
    setSummary(await summarise(userId));
  }, [userId]);

  useEffect(() => {
    if (userId === undefined) return;

    let cancelled = false;

    (async () => {
      if (!(await isPedometerAvailable())) {
        if (!cancelled) setStatus('unavailable');
        return;
      }

      // Android 10+ gates the step counter behind activity recognition. iOS grants motion
      // access through the same call.
      const permission = await Pedometer.requestPermissionsAsync();
      if (cancelled) return;

      if (!permission.granted) {
        setStatus('denied');
        return;
      }

      setStatus('counting');
      await pruneOldDays(userId);
      await refresh();

      subscription.current = watchSteps((delta) => {
        recordSteps(userId, delta).then(refresh);
      });
    })();

    return () => {
      cancelled = true;
      subscription.current?.remove();
      subscription.current = null;
    };
  }, [userId, refresh]);

  // The subscription only counts while the app is foregrounded, so coming back is the
  // moment the stored total is most out of date on screen.
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    return () => listener.remove();
  }, [refresh]);

  /**
   * A ticker, because the subscription cannot be the only thing that moves the number.
   *
   * `watchStepCount` fires when the platform decides to, and on iOS the count that matters
   * does not come from it at all — it comes from asking the pedometer's own history, which
   * nothing was doing between callbacks. So someone walking with the screen open watched a
   * figure the operating system had already updated and the app had not thought to re-read.
   *
   * Six seconds is under the interval at which a walking person notices a counter is stuck,
   * and the read behind it is two pedometer queries and one cache hit. iOS suspends JS
   * timers in the background, so this stops costing anything the moment it stops mattering.
   */
  useEffect(() => {
    if (status !== 'counting') return;

    const ticker = setInterval(refresh, 6000);
    return () => clearInterval(ticker);
  }, [status, refresh]);

  return { status, ...summary, refresh };
}
