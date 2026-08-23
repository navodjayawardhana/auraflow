/**
 * The date arithmetic behind the nutrition history screen.
 *
 * Kept out of the component for the same reason `month-grid.ts` is: every hard part of a
 * calendar is arithmetic — which Monday a Sunday belongs to, how long February is, what a
 * timezone offset does to a meal eaten just after midnight — and none of it should be
 * discovered by staring at a screenshot.
 *
 * The totals themselves are not computed here. They come from the API, where a tested
 * domain service does the summing; a second implementation on this side would be a second
 * chance to be wrong, and no way to tell which of the two was.
 */

import type { NutritionTotals, MealEntry } from '@/services/meal-service';
import { monthGridFor } from '@/services/month-grid';
import { shiftIsoDate, todayIsoDate } from '@/services/recovery-service';

/**
 * The three windows history can be read in.
 *
 * Weeks run Monday to Sunday, matching `month-grid.ts` and the API's own definition, so
 * the week a total covers is the week the calendar drew. Months are calendar months — 1 to
 * 31 August, never the last thirty days — because a rolling window means something
 * different every day it is opened, and the screen says which it is rather than leaving
 * "this month" to the reader.
 */
export type PeriodKind = 'day' | 'week' | 'month';

export interface PeriodWindow {
  kind: PeriodKind;
  /** A day inside the window; what the steppers and the calendar move. */
  anchor: string;
  from: string;
  to: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Monday is 0 — `Date.getDay()` puts Sunday there, which is not the week we want. */
function mondayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00`).getDay() + 6) % 7;
}

/** The last day of the month `iso` falls in. Day 0 of the next month is this month's last. */
function monthEnd(iso: string): string {
  const anchor = new Date(`${iso}T00:00:00`);
  return todayIsoDate(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0));
}

export function periodWindow(kind: PeriodKind, anchor: string): PeriodWindow {
  if (kind === 'day') {
    return { kind, anchor, from: anchor, to: anchor };
  }

  if (kind === 'week') {
    const monday = shiftIsoDate(anchor, -mondayIndex(anchor));
    return { kind, anchor, from: monday, to: shiftIsoDate(monday, 6) };
  }

  return { kind, anchor, from: monthGridFor(anchor).monthStart, to: monthEnd(anchor) };
}

/**
 * The window `steps` periods away.
 *
 * Stepped from the window's own edge rather than from the anchor: one day before the 1st
 * of a month is the last day of the month before it, whatever the anchor's day-of-month
 * was, so paging never skips a short February or lands twice on the same week.
 */
export function shiftPeriodWindow(window: PeriodWindow, steps: number): PeriodWindow {
  if (steps === 0) return window;

  const edge = steps < 0 ? shiftIsoDate(window.from, -1) : shiftIsoDate(window.to, 1);
  const next = periodWindow(window.kind, edge);

  return Math.abs(steps) <= 1 ? next : shiftPeriodWindow(next, steps - Math.sign(steps));
}

/**
 * Switching tabs keeps the day you were looking at, when it still exists in the new window.
 *
 * Moving from a month to a day would otherwise land on the 1st, which is almost never the
 * day the user had in mind — they were looking at a month because of something in it.
 */
export function retargetWindow(window: PeriodWindow, kind: PeriodKind, today: string): PeriodWindow {
  const anchor = window.from <= today && today <= window.to ? today : window.anchor;
  return periodWindow(kind, anchor);
}

/** Whether the window contains today, and so is still being written. */
export function isCurrent(window: PeriodWindow, today = todayIsoDate()): boolean {
  return window.from <= today && today <= window.to;
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function dayAndMonth(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

/** The heading: what window you are looking at, in as few words as name it exactly. */
export function periodTitle(window: PeriodWindow, today = todayIsoDate()): string {
  if (window.kind === 'day') {
    if (window.from === today) return 'Today';
    if (window.from === shiftIsoDate(today, -1)) return 'Yesterday';
    return longDate(window.from);
  }

  if (window.kind === 'week') {
    return isCurrent(window, today) ? 'This week' : `${dayAndMonth(window.from)} – ${dayAndMonth(window.to)}`;
  }

  return new Date(`${window.from}T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The line under the heading, and the reason it exists.
 *
 * "This week" and "this month" are both ambiguous — a rolling seven days and a rolling
 * thirty are just as plausible a reading — so the exact span is spelled out underneath
 * rather than left to be inferred. A total nobody can reproduce is worse than no total.
 */
export function periodSubtitle(window: PeriodWindow, today = todayIsoDate()): string {
  if (window.kind === 'day') {
    return window.from === today ? longDate(window.from) : 'A day you have already lived';
  }

  const span = `${dayAndMonth(window.from)} – ${dayAndMonth(window.to)}`;
  const kind = window.kind === 'week' ? 'Monday to Sunday' : 'Calendar month';

  return isCurrent(window, today) ? `${kind}, ${span} — so far` : `${kind}, ${span}`;
}

// ---------------------------------------------------------------- provenance

/** A total with any guessed energy in it is approximate, and is shown with a ≈. */
export function isApproximate(totals: NutritionTotals): boolean {
  return totals.estimated_kcal > 0;
}

/**
 * What the total is made of, in one sentence.
 *
 * Shown under every figure that has anything behind it. Three barcode lookups and three
 * guesses can add to the same number, and without this line the screen would present both
 * with equal confidence — which is exactly how a food diary starts lying to its owner.
 */
export function provenanceNote(totals: NutritionTotals): string | null {
  if (totals.meal_count === 0) return null;

  if (totals.estimated_count === 0) {
    return 'Every figure here came from a packaged product’s own label.';
  }

  if (totals.measured_count === 0) {
    return totals.meal_count === 1
      ? 'An estimate, not a measurement.'
      : 'Every figure here is an estimate, not a measurement.';
  }

  return `${totals.measured_kcal.toLocaleString()} of ${totals.kcal.toLocaleString()} kcal came from product labels — the rest is estimated.`;
}

/** How much of the macro breakdown the day actually covers, or null when it covers none. */
export function macroCoverageNote(totals: NutritionTotals): string | null {
  if (totals.meals_with_macros === 0) return null;
  if (totals.meals_with_macros === totals.meal_count) return null;

  const missing = totals.meal_count - totals.meals_with_macros;

  return `${missing} item${missing === 1 ? '' : 's'} carr${missing === 1 ? 'ies' : 'y'} no macro breakdown, so these are under-counted.`;
}

// ---------------------------------------------------------------- the day's list

/**
 * Bands of the day, not meal names.
 *
 * "Breakfast" would be a claim about what the meal was; the app only knows when it was
 * eaten. Someone on nights eats their largest meal at four in the morning and should not
 * be told it was breakfast.
 */
export type DayBand = 'Morning' | 'Midday' | 'Afternoon' | 'Evening';

const BAND_ORDER: DayBand[] = ['Morning', 'Midday', 'Afternoon', 'Evening'];

export function bandOf(eatenAt: string): DayBand {
  const hour = new Date(eatenAt).getHours();

  if (hour < 11) return 'Morning';
  if (hour < 15) return 'Midday';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

export interface BandedMeals {
  band: DayBand;
  meals: MealEntry[];
}

/** A day's meals in bands, keeping the order they arrived in and dropping empty bands. */
export function bandMeals(meals: MealEntry[]): BandedMeals[] {
  return BAND_ORDER.map((band) => ({
    band,
    meals: meals.filter((meal) => bandOf(meal.eaten_at) === band),
  })).filter((group) => group.meals.length > 0);
}

/** A window's meals grouped by the day they were filed under, oldest day first. */
export function groupByDay(meals: MealEntry[]): { date: string; meals: MealEntry[] }[] {
  const days = new Map<string, MealEntry[]>();

  for (const meal of meals) {
    const existing = days.get(meal.eaten_on);
    if (existing === undefined) days.set(meal.eaten_on, [meal]);
    else existing.push(meal);
  }

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayMeals]) => ({ date, meals: dayMeals }));
}

// ---------------------------------------------------------------- when it was eaten

/**
 * A chosen day and a chosen clock time, as one instant the server can file correctly.
 *
 * The offset is the whole point. Sending `2026-08-21T19:30:00` bare, or converting to UTC
 * first, loses which day the eater was living in: half past midnight in Colombo is seven
 * in the evening the day before in UTC, and a supper logged there would land on yesterday
 * — in the wrong day's total, sometimes the wrong week's, occasionally the wrong month's.
 *
 * The offset is read from the chosen date rather than from today, so a meal backfilled
 * across a daylight-saving change carries the offset that was in force when it was eaten.
 */
export function composeEatenAt(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);

  const local = new Date(year, month - 1, day, hours, minutes, 0, 0);
  // `getTimezoneOffset` counts minutes *behind* UTC, so east of Greenwich is negative.
  const offset = -local.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const size = Math.abs(offset);

  return `${date}T${pad(hours)}:${pad(minutes)}:00${sign}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}

/** True when the chosen moment has not happened yet — the one thing the server refuses. */
export function isInFuture(date: string, time: string, now = new Date()): boolean {
  return new Date(composeEatenAt(date, time)).getTime() > now.getTime();
}

/** `HH:MM` for the current clock, snapped down to the wheel's five-minute step. */
export function nowAsWheelTime(now = new Date()): string {
  return `${pad(now.getHours())}:${pad(Math.floor(now.getMinutes() / 5) * 5)}`;
}
