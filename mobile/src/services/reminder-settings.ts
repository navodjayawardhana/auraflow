import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  REMINDERS,
  type QuietHours,
  type ReminderKind,
  type ReminderPreference,
} from '@/services/reminder-schedule';
import { parseTimeOfDay, type TimeOfDay } from '@/services/sleep-window';

/**
 * What the user has chosen, on this device.
 *
 * Deliberately not synced to the server. A reminder time is a fact about one handset's
 * owner and their morning, not about the account: the same person's tablet has no business
 * buzzing at 07:00, and a phone that is switched off is not a preference that needs
 * replicating. It also means the settings screen works with no network at all, which is
 * the state a person is most likely to be in when they turn a 06:30 alarm off.
 */

const VERSION = 1;
const PREFIX = `auraflow.reminders.v${VERSION}`;

/**
 * Namespaced by user for the same reason the read cache is: two accounts on one handset
 * must not see each other's settings. Sign-out clears this alongside the cache.
 */
function keyFor(userId: string | number): string {
  return `${PREFIX}.${userId}.settings`;
}

export interface ReminderSettings {
  reminders: Record<ReminderKind, ReminderPreference>;
  quiet: QuietHours;
}

/**
 * Quiet hours, on by default.
 *
 * Defaulting this off would be the more literal reading of "do not decide for the user",
 * but the thing being defaulted is *silence*, and the cost of the two options is not
 * symmetric: a reminder that never arrives is a feature that looks broken, while one that
 * arrives at 03:00 is the reason the app gets uninstalled. The window is set so it does not
 * fight either default — 21:30 is before it starts, and it is half-open at 07:00 so the
 * check-in lands on the boundary rather than inside it.
 */
const DEFAULT_QUIET: QuietHours = {
  isEnabled: true,
  start: { hours: 22, minutes: 0 },
  end: { hours: 7, minutes: 0 },
};

export function defaultSettings(): ReminderSettings {
  const reminders = {} as Record<ReminderKind, ReminderPreference>;

  for (const definition of REMINDERS) {
    reminders[definition.kind] = {
      isEnabled: definition.isOnByDefault,
      time: definition.defaultTime,
    };
  }

  return { reminders, quiet: DEFAULT_QUIET };
}

/** `HH:MM` on the way out, so a stored blob stays readable and reuses one parser coming back. */
const formatTime = (time: TimeOfDay) =>
  `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}`;

interface StoredSettings {
  v: number;
  reminders: Record<string, { isEnabled: boolean; time: string }>;
  quiet: { isEnabled: boolean; start: string; end: string };
}

/**
 * Read back field by field against the current catalogue rather than trusted wholesale.
 *
 * A kind added in this release has no stored preference, and a kind removed in this release
 * still has one — both are ordinary consequences of shipping an update, and both would be
 * a crash or a silently dead reminder if the stored object were cast and used. Anything
 * unparseable falls back to that kind's default, which is the same state a new install is in.
 */
export async function readSettings(userId: string | number): Promise<ReminderSettings> {
  const fallback = defaultSettings();

  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (raw === null) return fallback;

    const stored = JSON.parse(raw) as StoredSettings;
    if (stored.v !== VERSION) return fallback;

    const reminders = {} as Record<ReminderKind, ReminderPreference>;

    for (const definition of REMINDERS) {
      const entry = stored.reminders?.[definition.kind];
      const time = entry === undefined ? null : parseTimeOfDay(entry.time);

      reminders[definition.kind] = {
        isEnabled: entry?.isEnabled ?? definition.isOnByDefault,
        time: time ?? definition.defaultTime,
      };
    }

    const start = parseTimeOfDay(stored.quiet?.start ?? '');
    const end = parseTimeOfDay(stored.quiet?.end ?? '');

    return {
      reminders,
      quiet: {
        isEnabled: stored.quiet?.isEnabled ?? DEFAULT_QUIET.isEnabled,
        start: start ?? DEFAULT_QUIET.start,
        end: end ?? DEFAULT_QUIET.end,
      },
    };
  } catch {
    return fallback;
  }
}

export async function writeSettings(
  userId: string | number,
  settings: ReminderSettings,
): Promise<void> {
  const stored: StoredSettings = {
    v: VERSION,
    reminders: Object.fromEntries(
      Object.entries(settings.reminders).map(([kind, preference]) => [
        kind,
        { isEnabled: preference.isEnabled, time: formatTime(preference.time) },
      ]),
    ),
    quiet: {
      isEnabled: settings.quiet.isEnabled,
      start: formatTime(settings.quiet.start),
      end: formatTime(settings.quiet.end),
    },
  };

  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(stored));
  } catch {
    // The caller has already applied the change to state and to the OS schedule, so a full
    // disk costs the setting at next launch rather than the action the user just took.
  }
}
