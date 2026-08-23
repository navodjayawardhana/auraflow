import { Pedometer } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { todayIsoDate } from '@/services/recovery-service';
import {
  isPedometerAvailable,
  pruneOldDays,
  recordSteps,
  summarise,
  watchSteps,
  type StepSummary,
} from '@/services/step-counter';
import { MIN_TICK_DELTA, syncSteps } from '@/services/step-sync';

export type StepStatus = 'checking' | 'unavailable' | 'denied' | 'counting';

const EMPTY: StepSummary = { today: 0, lastHour: 0, coverageMinutes: 0, isComplete: false };

/**
 * Live step count, with the state the UI needs to be honest about it.
 *
 * `unavailable` and `denied` are separate states because they call for different things
 * to be said: a phone with no step sensor is not the user's problem to fix, a refused
 * permission is. Neither is shown as a zero — a zero is a claim that you have not moved.
 *
 * This is also where the count leaves the device. `step-sync` decides what is worth
 * writing; the hook decides when to ask, because it is the only thing that knows when the
 * app woke, when it is about to stop counting, and when the day underneath it changed.
 */
export function useSteps() {
  const { user } = useAuth();
  const userId = user?.id;

  const [status, setStatus] = useState<StepStatus>('checking');
  const [summary, setSummary] = useState<StepSummary>(EMPTY);
  const subscription = useRef<{ remove: () => void } | null>(null);

  /** The day the ticker last saw, so it can notice midnight passing under an open app. */
  const currentDay = useRef(todayIsoDate());

  /**
   * The figure at the last sync *attempt* — a cheap gate, not a record of what the server
   * has. That record is `step-sync`'s own, kept in storage and consulted on every write;
   * this only exists so a stationary phone does not read its marks every six seconds.
   */
  const lastAttempted = useRef(0);

  const refresh = useCallback(async (): Promise<StepSummary | null> => {
    if (userId === undefined) return null;

    const next = await summarise(userId);
    setSummary(next);

    return next;
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

      // Before the prune, always. `pruneOldDays` deletes every day but today, and on a
      // phone with no pedometer history those buckets are the only evidence that the days
      // between two openings happened at all. This is also the run that backfills from
      // iOS's own history, so opening the app after three days away fills all three.
      const next = await refresh();
      await syncSteps(userId, 'start');
      await pruneOldDays(userId);

      currentDay.current = todayIsoDate();
      lastAttempted.current = next?.today ?? 0;

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

  /**
   * The subscription only counts while the app is foregrounded, which makes both edges
   * worth a sync. Coming back is the moment the stored total is most out of date on
   * screen, and possibly days out of date on the server. Leaving is the last chance to
   * record what was witnessed before the counting stops — a phone put down at nine in the
   * morning would otherwise report its afternoon at whatever the last tick happened to
   * catch.
   */
  useEffect(() => {
    // Nothing to carry across when there is no sensor or no permission, and a phone in
    // that state should not be reading storage every time it is picked up.
    if (status !== 'counting' || userId === undefined) return;

    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh().then((next) => {
          lastAttempted.current = next?.today ?? 0;
          return syncSteps(userId, 'foreground');
        });
        return;
      }

      syncSteps(userId, 'background');
    });

    return () => listener.remove();
  }, [status, userId, refresh]);

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
   *
   * The tick is emphatically not a sync interval. A request every six seconds is what this
   * gate exists to prevent: a walk reaches the server every few hundred steps, and a phone
   * sitting on a desk never asks at all.
   */
  useEffect(() => {
    if (status !== 'counting' || userId === undefined) return;

    const ticker = setInterval(async () => {
      const next = await refresh();
      if (next === null) return;

      // Midnight under an open app. Yesterday is final now and will be deleted by the
      // prune, so it is written first — and on iOS rewritten as a complete day, because
      // the history can answer for a day that has ended in a way the buckets cannot.
      if (todayIsoDate() !== currentDay.current) {
        await syncSteps(userId, 'rollover');
        await pruneOldDays(userId);

        currentDay.current = todayIsoDate();
        lastAttempted.current = 0;

        return;
      }

      if (next.today - lastAttempted.current >= MIN_TICK_DELTA) {
        lastAttempted.current = next.today;
        await syncSteps(userId, 'tick');
      }
    }, 6000);

    return () => clearInterval(ticker);
  }, [status, userId, refresh]);

  return { status, ...summary, refresh };
}
