/**
 * Turning "I went to bed at 23:30 and woke at 06:45" into the minutes the score wants.
 *
 * Two times rather than a duration because that is what people actually know. Asked for
 * hours slept they round to the nearest half and their answer drifts; asked when they went
 * to bed they read it off their own evening. The arithmetic is ours to do, not theirs.
 *
 * The times themselves come from a wheel, so `HH:MM` is the only shape that reaches here
 * from the app -- but it is parsed rather than trusted, since a queued write from an older
 * build could carry anything.
 */

/** The wrap a night crossing midnight needs. */
const MINUTES_PER_DAY = 24 * 60;

export interface TimeOfDay {
  hours: number;
  minutes: number;
}

/** Null for anything that is not a real time of day, including a half-typed one. */
export function parseTimeOfDay(value: string): TimeOfDay | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return null;

  return { hours, minutes };
}

/**
 * Minutes from one clock time to the next, wrapping over midnight.
 *
 * The wrap is the whole point: a night is nearly always bed-yesterday, wake-today, so a
 * plain subtraction would give a negative number for the ordinary case and a positive one
 * only for an afternoon nap. Equal times return 0 rather than a full day — someone who
 * enters the same time twice has mistyped, and 24 hours of sleep is not the charitable
 * reading of that.
 */
export function sleepMinutesBetween(bed: TimeOfDay, wake: TimeOfDay): number {
  const bedAbsolute = bed.hours * 60 + bed.minutes;
  const wakeAbsolute = wake.hours * 60 + wake.minutes;

  return (wakeAbsolute - bedAbsolute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** `7h 15m`, or `45m` when there is no hour to show. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;

  return `${h}h ${m}m`;
}
