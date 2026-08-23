import AsyncStorage from '@react-native-async-storage/async-storage';

import { readCache } from '@/services/cache';
import { todayIsoDate } from '@/services/recovery-service';
import type { ReminderKind } from '@/services/reminder-schedule';
import type { HealthSnapshot } from '@/types';

/**
 * Which days a reminder has already been answered on.
 *
 * This is the hard half of the feature. A scheduled local notification is handed to the OS
 * and fires whether or not the app is running, so there is no moment at delivery time to
 * ask "did they already do this?" — the question has to be answered *before* the thing is
 * scheduled, and the answer re-checked whenever the app has a chance to. That is why
 * nothing here uses a repeating trigger: a repeat cannot be told to skip a day.
 *
 * Two sources, because neither is sufficient alone.
 *
 * The local marker is written the instant a check-in saves, works offline, and is the only
 * thing that can suppress this evening's reminder for something done thirty seconds ago
 * while the phone has no signal. It knows nothing about other devices.
 *
 * The cached snapshots are the server's view, already fetched and cached by the Today
 * screen under its own key. Reading it here costs no request and covers the case the marker
 * cannot — logged on a tablet, or on a reinstalled app. It is only ever as fresh as the last
 * time Today refreshed.
 *
 * Together they cover everything except one residual, which is genuinely unfixable from
 * here: a reminder already sitting with the OS will still fire if the user logs the thing
 * on another device and never foregrounds this one before the reminder is due. Nothing
 * short of a push message can recall it, and a push would cost a development build,
 * FCM/APNs credentials, and the app's ability to run in Expo Go — see `notification-service`.
 */

const VERSION = 1;
const PREFIX = `auraflow.reminders.v${VERSION}`;

/** The key the Today screen caches its eight-day snapshot window under. */
const SNAPSHOT_RESOURCE = 'health-snapshots.8';

function keyFor(userId: string | number): string {
  return `${PREFIX}.${userId}.completed`;
}

type CompletionLog = Partial<Record<ReminderKind, string[]>>;

/**
 * What counts as having answered each reminder, read off a day's snapshot.
 *
 * Pure, and the definitions are worth stating rather than inlining. The two measurement
 * reminders have crisp answers: a seated source is a check-in that happened, a sleep figure
 * is a night that was logged. Water does not — the day's target arrives glass by glass, and
 * there is no point at which it is finished.
 *
 * So water is suppressed by *any* water logged that day, which under-reminds on purpose.
 * The alternative is comparing against the day's target, and a notification that keeps
 * arriving until a number is reached is the pacing nag this app has no business being. This
 * reminder exists to catch a day nobody drank anything on record, and that is all.
 *
 * Movement is absent by design: an exercise session is not part of a health snapshot, so
 * this source cannot see one. Its local marker is the only signal, which means a session
 * logged on another device will not suppress it.
 */
export function deriveDoneDates(
  kind: ReminderKind,
  snapshots: readonly HealthSnapshot[],
): Set<string> {
  const done = new Set<string>();

  for (const snapshot of snapshots) {
    const isDone =
      kind === 'morning-checkin'
        ? snapshot.resting_hr_source === 'seated_spot'
        : kind === 'log-night'
          ? snapshot.sleep_minutes !== null
          : kind === 'water'
            ? snapshot.water_ml !== null && snapshot.water_ml > 0
            : false;

    if (isDone) done.add(snapshot.date);
  }

  return done;
}

/**
 * Drops markers older than the window anything still reads from.
 *
 * Without this the log grows for the life of the install to answer a question that only
 * ever concerns the next few days.
 */
export function pruneDates(dates: readonly string[], keepFrom: string): string[] {
  // Plain string comparison, which is exactly right for `YYYY-MM-DD` and avoids parsing
  // dates only to throw them away.
  return dates.filter((date) => date >= keepFrom);
}

/**
 * Records that a reminder's job is done for a local date.
 *
 * Called at the write sites rather than inferred later, because the point is to suppress a
 * reminder *before* the next reconcile has any server data to go on.
 */
export async function markDone(
  userId: string | number,
  kind: ReminderKind,
  date = todayIsoDate(),
): Promise<void> {
  try {
    const log = await readCompletionLog(userId);
    const existing = log[kind] ?? [];

    if (existing.includes(date)) return;

    log[kind] = [...existing, date];
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(log));
  } catch {
    // A marker that fails to write costs one redundant reminder, which is a smaller
    // failure than a save that reports an error because its bookkeeping did not stick.
  }
}

async function readCompletionLog(userId: string | number): Promise<CompletionLog> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    return raw === null ? {} : (JSON.parse(raw) as CompletionLog);
  } catch {
    return {};
  }
}

/**
 * Both sources, merged, per kind — and the prune, done here because this runs on every
 * foreground and is the one place guaranteed to see the log.
 */
export async function readDoneDates(
  userId: string | number,
  keepFrom: string,
): Promise<Map<ReminderKind, Set<string>>> {
  const log = await readCompletionLog(userId);

  const cached = await readCache<HealthSnapshot[]>(userId, SNAPSHOT_RESOURCE);
  const snapshots = cached?.value ?? [];

  let didPrune = false;
  const merged = new Map<ReminderKind, Set<string>>();

  for (const [kind, dates] of Object.entries(log) as [ReminderKind, string[]][]) {
    const kept = pruneDates(dates, keepFrom);
    if (kept.length !== dates.length) {
      log[kind] = kept;
      didPrune = true;
    }

    merged.set(kind, new Set(kept));
  }

  for (const kind of ['morning-checkin', 'log-night', 'water'] as const) {
    const derived = deriveDoneDates(kind, snapshots);
    const existing = merged.get(kind) ?? new Set<string>();

    for (const date of derived) existing.add(date);
    merged.set(kind, existing);
  }

  if (didPrune) {
    try {
      await AsyncStorage.setItem(keyFor(userId), JSON.stringify(log));
    } catch {
      // Pruning is housekeeping. Failing it changes nothing the caller can observe.
    }
  }

  return merged;
}

/** Cleared alongside the read cache on sign-out. */
export async function clearCompletion(userId: string | number): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Unreachable data on a signed-out account; nothing to recover from.
  }
}
