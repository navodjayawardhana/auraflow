import { todayIsoDate } from '@/services/recovery-service';
import type { TimeOfDay } from '@/services/sleep-window';

/**
 * When each reminder should fire, worked out as arithmetic rather than handed to a
 * repeating trigger.
 *
 * The whole module is pure and takes its `now` as an argument, because every hard case
 * here is a date case — a clock that goes back an hour, a reminder set for a time that
 * has already passed today, a day that was already logged before the reminder came round.
 * None of those are discoverable by running the app on the morning they happen.
 *
 * On the choice of a one-shot occurrence over `SchedulableTriggerInputTypes.DAILY`, see
 * `notification-service`: the short version is that a repeating trigger cannot be told
 * "not today", and not-today is most of what this file computes.
 */

/** Reminders that exist. Adding one here is most of adding one to the app. */
export type ReminderKind = 'morning-checkin' | 'log-night' | 'water' | 'movement';

export interface ReminderDefinition {
  kind: ReminderKind;
  /** Shown as the row title on the settings screen. */
  label: string;
  /** Why this reminder exists, in the settings screen's own words. */
  rationale: string;
  title: string;
  body: string;
  /** Where a tap lands. An expo-router path, resolved by the response listener. */
  route: string;
  defaultTime: TimeOfDay;
  /**
   * Whether the reminder is on before anyone has been to the settings screen.
   *
   * Two of the four are on, and the split is not a guess about engagement. A morning
   * check-in and a logged night are *inputs to a measurement* — the baseline and the
   * recovery score are wrong without them, in a way the app cannot correct for later.
   * Water and movement are things the app merely tracks; nothing it reports becomes
   * misleading because a glass went unlogged. A health app that arrives already nagging
   * about the second kind is one people turn off wholesale, taking the first kind with it.
   */
  isOnByDefault: boolean;
  /**
   * The Android channel this posts to. One per kind rather than one for the app, because
   * a channel's importance is owned by the user once it exists: someone who wants the
   * morning prompt to make a sound but the water one to stay silent can have that, and
   * a single channel would make it all-or-nothing.
   */
  channelId: string;
}

export const REMINDERS: readonly ReminderDefinition[] = [
  {
    kind: 'morning-checkin',
    label: 'Morning check-in',
    rationale:
      'A seated resting rate is only comparable with your own past ones if it is taken the same way each day. The reminder is part of the measurement — same time, sitting, before caffeine.',
    title: 'Morning check-in',
    body: 'A minute on the node now — sitting, before coffee — keeps today’s reading comparable with the rest of your baseline.',
    route: '/morning-checkin',
    defaultTime: { hours: 7, minutes: 0 },
    isOnByDefault: true,
    channelId: 'morning-checkin',
  },
  {
    kind: 'log-night',
    label: 'Log last night',
    rationale:
      'Sleep is the second input to the recovery score. A night logged the next evening is still accurate; a night never logged leaves a gap the score cannot fill.',
    title: 'Log last night',
    body: 'Your sleep, and an overnight resting rate if your watch has one. The recovery score is built from both.',
    route: '/log-night',
    defaultTime: { hours: 21, minutes: 30 },
    isOnByDefault: true,
    channelId: 'log-night',
  },
  {
    kind: 'water',
    label: 'Water pacing',
    rationale:
      'Nothing the app reports gets less accurate when a glass goes unlogged, so this is off unless you ask for it.',
    title: 'Water',
    body: 'A glass, if it has been a while. Tap to log it.',
    route: '/meals',
    defaultTime: { hours: 14, minutes: 0 },
    isOnByDefault: false,
    channelId: 'water',
  },
  {
    kind: 'movement',
    label: 'Movement',
    rationale:
      'A prompt to move, at a time you pick. Off by default — whether today is a day to train is a question this morning’s recovery score already answered.',
    title: 'Movement',
    body: 'Time for a session, if this morning’s recovery left room for one.',
    route: '/move',
    defaultTime: { hours: 17, minutes: 30 },
    isOnByDefault: false,
    channelId: 'movement',
  },
] as const;

export function reminderFor(kind: ReminderKind): ReminderDefinition {
  const found = REMINDERS.find((r) => r.kind === kind);

  // Unreachable while `kind` comes from the union, but settings are read back from
  // storage where an older build's key could survive an update.
  if (found === undefined) throw new Error(`Unknown reminder kind: ${kind}`);

  return found;
}

export interface QuietHours {
  isEnabled: boolean;
  start: TimeOfDay;
  end: TimeOfDay;
}

export interface ReminderPreference {
  isEnabled: boolean;
  time: TimeOfDay;
}

/** One notification to place with the OS. */
export interface PlannedOccurrence {
  kind: ReminderKind;
  /** The instant, in this device's current zone. */
  at: Date;
  /** The local calendar date it lands on, `YYYY-MM-DD` — what "already done" is keyed by. */
  onDate: string;
}

const minutesOf = (time: TimeOfDay) => time.hours * 60 + time.minutes;

/**
 * The first instant at `time` strictly after `from`, in whatever zone the device is in.
 *
 * Built from local calendar fields rather than by adding 24h to a previous firing, which
 * is the detail that survives daylight saving. On the night a clock goes back, the day is
 * twenty-five hours long; anything that schedules the next reminder as "the last one plus
 * 86,400,000 ms" lands an hour early and stays an hour out until something resets it. Here
 * the hour and minute are re-applied to the next calendar day, so 07:00 is 07:00 either side.
 *
 * Strictly after, never equal: re-planning at the exact moment a reminder fires must
 * produce tomorrow's, not a duplicate of the one being delivered.
 */
export function nextOccurrence(time: TimeOfDay, from: Date): Date {
  const at = new Date(from);
  at.setHours(time.hours, time.minutes, 0, 0);

  if (at.getTime() <= from.getTime()) {
    at.setDate(at.getDate() + 1);
    // Re-applied after the date change on purpose. `setDate` moves the calendar day while
    // holding the wall clock, but the day it lands on may be the one that loses an hour at
    // 01:00, and on some engines that leaves the time field shifted. Setting it again is
    // free and makes the result independent of that.
    at.setHours(time.hours, time.minutes, 0, 0);
  }

  return at;
}

/**
 * Whether a wall-clock time falls inside the quiet window.
 *
 * Half-open — `[start, end)` — so a reminder set for exactly the moment quiet hours end is
 * allowed through. That is the ordinary configuration rather than an edge case: quiet until
 * 07:00 with the check-in at 07:00 is what someone means when they set both.
 *
 * A window whose ends are equal is read as zero-length rather than as the whole day. Both
 * readings are defensible from the numbers alone; only one of them fails safe. Twenty-four
 * hours of quiet would silently suppress every reminder the user had switched on, and they
 * would have no way to tell that from the notifications simply not working.
 */
export function isWithinQuietHours(time: TimeOfDay, quiet: QuietHours): boolean {
  if (!quiet.isEnabled) return false;

  const at = minutesOf(time);
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);

  if (start === end) return false;

  // A window that wraps midnight is the normal one, so it is the case handled first.
  return start > end ? at >= start || at < end : at >= start && at < end;
}

/**
 * The calendar dates a reminder should be placed on, oldest first.
 *
 * A horizon rather than one occurrence, because a one-shot notification only survives as
 * long as nobody has to re-arm it, and the app is not running to re-arm anything. Someone
 * who does not open AuraFlow for three days should still be reminded on each of them —
 * which is precisely the person the morning check-in exists for.
 *
 * @param horizonDays how many firings to place. Every kind is capped by the same number,
 *   and iOS silently keeps only the 64 soonest pending notifications per app: four kinds
 *   over seven days is 28, which leaves room for the count to grow without hitting it.
 */
export function upcomingOccurrences(
  kind: ReminderKind,
  time: TimeOfDay,
  from: Date,
  horizonDays: number,
): PlannedOccurrence[] {
  const occurrences: PlannedOccurrence[] = [];
  let cursor = from;

  for (let i = 0; i < horizonDays; i++) {
    const at = nextOccurrence(time, cursor);
    occurrences.push({ kind, at, onDate: todayIsoDate(at) });
    cursor = at;
  }

  return occurrences;
}

/**
 * Everything that should be sitting with the OS for one reminder, given what the user has
 * set and what they have already done.
 *
 * The three suppressions are deliberately different in kind. Switched off is a preference.
 * Inside quiet hours is a contradiction the user has set up — resolved by dropping the
 * firing rather than shifting it, because a "log last night" that arrives at breakfast
 * because 21:30 was quiet is a reminder about the wrong thing at the wrong time; the
 * settings screen says so rather than letting it vanish silently. Already done is the only
 * one that is about today's facts, and it is why this whole file recomputes from scratch
 * instead of setting a repeat and walking away.
 */
export function planOccurrences(
  kind: ReminderKind,
  preference: ReminderPreference,
  quiet: QuietHours,
  doneDates: ReadonlySet<string>,
  from: Date,
  horizonDays: number,
): PlannedOccurrence[] {
  if (!preference.isEnabled) return [];
  if (isWithinQuietHours(preference.time, quiet)) return [];

  return upcomingOccurrences(kind, preference.time, from, horizonDays).filter(
    (occurrence) => !doneDates.has(occurrence.onDate),
  );
}
