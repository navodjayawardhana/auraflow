/**
 * The calendar grid, as data.
 *
 * Kept out of the component because every hard part of a calendar is arithmetic — where
 * the month starts in the week, how many rows it needs, what "one month earlier" means on
 * the 31st — and none of it is worth discovering through a screenshot.
 */

import { todayIsoDate } from '@/services/recovery-service';

/**
 * Weeks start on Monday. Not locale-derived: the app has one date format throughout and a
 * grid that silently reshuffles between devices is harder to reason about than one that is
 * the same everywhere. The header row is rendered from this order.
 */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/**
 * Always six rows.
 *
 * Five would fit most months, and the sheet would then change height as you paged through
 * the year. A fixed grid costs one blank row in February and buys a calendar that does not
 * move under the finger.
 */
const ROWS = 6;
const COLUMNS = 7;

export interface MonthGrid {
  /** The first of the month this grid shows, ISO. */
  monthStart: string;
  /** Six rows of seven. `null` is a cell outside the month, not a date to render. */
  weeks: (string | null)[][];
}

function isoFrom(year: number, monthIndex: number, day: number): string {
  return todayIsoDate(new Date(year, monthIndex, day));
}

/** Monday is 0 — `Date.getDay()` puts Sunday there, which is not the column we want. */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function monthGridFor(iso: string): MonthGrid {
  const anchor = new Date(`${iso}T00:00:00`);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const leading = mondayIndex(new Date(year, month, 1));
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weeks: (string | null)[][] = [];

  for (let row = 0; row < ROWS; row += 1) {
    const week: (string | null)[] = [];

    for (let column = 0; column < COLUMNS; column += 1) {
      const day = row * COLUMNS + column - leading + 1;
      week.push(day >= 1 && day <= daysInMonth ? isoFrom(year, month, day) : null);
    }

    weeks.push(week);
  }

  return { monthStart: isoFrom(year, month, 1), weeks };
}

/**
 * The same day-of-month `months` away, or the last of that month when it has no such day.
 *
 * The clamp is the whole reason this exists. `new Date(2026, 0, 31).setMonth(1)` is the 3rd
 * of March, because February has no 31st and the platform rolls over rather than
 * complaining — so paging back from the 31st would skip February entirely.
 */
export function shiftMonth(iso: string, months: number): string {
  const anchor = new Date(`${iso}T00:00:00`);
  const target = new Date(anchor.getFullYear(), anchor.getMonth() + months, 1);
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();

  return isoFrom(
    target.getFullYear(),
    target.getMonth(),
    Math.min(anchor.getDate(), daysInTarget),
  );
}
