import { syncScheduleAsync } from '@/services/notification-service';
import { todayIsoDate } from '@/services/recovery-service';
import { markDone, readDoneDates } from '@/services/reminder-completion';
import type { PlannedOccurrence, ReminderKind } from '@/services/reminder-schedule';
import { readSettings, type ReminderSettings } from '@/services/reminder-settings';

/**
 * One pass of "make the OS agree with reality".
 *
 * Kept apart from both the settings store and the OS wrapper because it is the only thing
 * that knows they are related, and because *when* it runs is the whole design. It has to run
 * at every point where one of its three inputs can have changed since the last pass:
 *
 *   - the app returning to the foreground, which covers a day rolling over, the phone
 *     crossing into another timezone, and a check-in logged on another device that the Today
 *     screen has since refreshed into the cache;
 *   - immediately after a write that answers a reminder, so this evening's prompt is gone
 *     before the user has put the phone down;
 *   - a settings change, which is the obvious one.
 *
 * Everything it reads is local. There is no request here, so it is safe to run on a cold
 * launch in airplane mode and safe to run often.
 */
export async function reconcileRemindersAsync(
  userId: string | number,
  settings?: ReminderSettings,
): Promise<PlannedOccurrence[]> {
  const resolved = settings ?? (await readSettings(userId));

  // Nothing before today can suppress anything, because nothing is ever scheduled into the
  // past — so today is also the right cutoff for pruning the completion log.
  const done = await readDoneDates(userId, todayIsoDate());

  return syncScheduleAsync(resolved, done, new Date());
}

/**
 * What a screen calls the moment its write lands: record it, then take today's reminder back
 * off the schedule.
 *
 * One function rather than two calls at each site, because forgetting the reconcile is
 * silent — the marker would be written, the suppression would work tomorrow, and this
 * evening's reminder would still arrive for something already done.
 *
 * Never awaited by its callers and never throws. It runs after a save the user has already
 * been told succeeded, and a reminder that fails to unschedule is not worth turning that
 * into an error message.
 */
export function noteReminderDone(userId: string | number, kind: ReminderKind): void {
  (async () => {
    try {
      await markDone(userId, kind);
      await reconcileRemindersAsync(userId);
    } catch {
      // Costs one redundant reminder. The next foreground reconcile picks the marker up.
    }
  })();
}
