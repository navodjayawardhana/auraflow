import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/context/auth-context';
import {
  getPermissionStateAsync,
  requestPermissionAsync,
  type PermissionState,
} from '@/services/notification-service';
import type {
  PlannedOccurrence,
  QuietHours,
  ReminderKind,
} from '@/services/reminder-schedule';
import {
  defaultSettings,
  readSettings,
  writeSettings,
  type ReminderSettings,
} from '@/services/reminder-settings';
import { reconcileRemindersAsync } from '@/services/reminder-sync';
import type { TimeOfDay } from '@/services/sleep-window';

/**
 * The settings screen's state, and the only place a reminder preference changes.
 *
 * Every mutation follows the same three steps in the same order: state, storage, OS. State
 * first because a switch that waits on storage feels broken, storage before the OS because a
 * reconcile reads it back, and the OS last because it is the only step that can fail in a
 * way the user needs to hear about.
 */

export interface RemindersController {
  settings: ReminderSettings;
  permission: PermissionState;
  /** When each kind next fires, for the row subtitles. Absent means nothing is scheduled. */
  nextFiring: Map<ReminderKind, Date>;
  isReady: boolean;
  setEnabled: (kind: ReminderKind, isEnabled: boolean) => Promise<void>;
  setTime: (kind: ReminderKind, time: TimeOfDay) => Promise<void>;
  setQuiet: (patch: Partial<QuietHours>) => Promise<void>;
  /** Re-reads the OS permission — the settings screen calls this when it regains focus. */
  refreshPermission: () => Promise<void>;
}

function firstPerKind(occurrences: PlannedOccurrence[]): Map<ReminderKind, Date> {
  const next = new Map<ReminderKind, Date>();

  for (const occurrence of occurrences) {
    const existing = next.get(occurrence.kind);
    if (existing === undefined || occurrence.at < existing) next.set(occurrence.kind, occurrence.at);
  }

  return next;
}

export function useReminders(): RemindersController {
  const { user } = useAuth();
  const userId = user?.id;

  const [settings, setSettings] = useState<ReminderSettings>(defaultSettings);
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [nextFiring, setNextFiring] = useState<Map<ReminderKind, Date>>(new Map());
  const [isReady, setIsReady] = useState(false);

  // Read through a ref by the mutators so they keep their identity as settings change —
  // the rows put them in dependency lists, and a new function per keystroke of the time
  // wheel would remount the wheel underneath the person using it.
  const current = useRef(settings);
  current.current = settings;

  useEffect(() => {
    if (userId === undefined) return;

    let isActive = true;

    (async () => {
      const [stored, state] = await Promise.all([
        readSettings(userId),
        getPermissionStateAsync(),
      ]);

      if (!isActive) return;

      setSettings(stored);
      setPermission(state);

      // Opening the screen is itself a reconcile point: the day may have rolled over, or
      // the permission may have been revoked in the OS since the last one.
      const planned = await reconcileRemindersAsync(userId, stored);
      if (!isActive) return;

      setNextFiring(firstPerKind(planned));

      // Ready only once the firings are known, so the rows never render a "next" state
      // computed from an empty map they are about to be given.
      setIsReady(true);
    })();

    return () => {
      isActive = false;
    };
  }, [userId]);

  const apply = useCallback(
    async (next: ReminderSettings) => {
      setSettings(next);

      if (userId === undefined) return;

      await writeSettings(userId, next);
      setNextFiring(firstPerKind(await reconcileRemindersAsync(userId, next)));
    },
    [userId],
  );

  const setEnabled = useCallback(
    async (kind: ReminderKind, isEnabled: boolean) => {
      /**
       * The prompt happens here and nowhere else — the moment someone switches a reminder
       * on, having just read what it is for and chosen a time for it. That is the only
       * point in the app where the OS dialog is a question the user already knows the
       * answer to. On iOS it can be asked exactly once per install, so spending it on a
       * launch-time prompt would spend it on a refusal.
       */
      if (isEnabled && permission === 'undetermined') {
        setPermission(await requestPermissionAsync());
      }

      // The preference is stored either way, including after a refusal. The switch records
      // what the user asked for; whether the OS is currently letting it through is a
      // separate fact the screen states separately. Silently flipping it back would tell
      // them their tap did not register.
      await apply({
        ...current.current,
        reminders: {
          ...current.current.reminders,
          [kind]: { ...current.current.reminders[kind], isEnabled },
        },
      });
    },
    [apply, permission],
  );

  const setTime = useCallback(
    async (kind: ReminderKind, time: TimeOfDay) => {
      await apply({
        ...current.current,
        reminders: {
          ...current.current.reminders,
          [kind]: { ...current.current.reminders[kind], time },
        },
      });
    },
    [apply],
  );

  const setQuiet = useCallback(
    async (patch: Partial<QuietHours>) => {
      await apply({ ...current.current, quiet: { ...current.current.quiet, ...patch } });
    },
    [apply],
  );

  const refreshPermission = useCallback(async () => {
    const state = await getPermissionStateAsync();
    setPermission(state);

    // A permission granted in the OS settings while the app sat in the background leaves
    // nothing scheduled, because the last reconcile ran while it was still blocked.
    if (userId !== undefined && state === 'granted') {
      setNextFiring(firstPerKind(await reconcileRemindersAsync(userId, current.current)));
    }
  }, [userId]);

  return {
    settings,
    permission,
    nextFiring,
    isReady,
    setEnabled,
    setTime,
    setQuiet,
    refreshPermission,
  };
}
