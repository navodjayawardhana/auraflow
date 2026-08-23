import { apiDelete, apiGet, apiPost } from '@/services/api-client';

/**
 * Three kinds of claim, kept apart because they are not equally trustworthy: a figure
 * someone else measured, a figure the user typed, and a figure a vision model guessed from
 * a photograph with no scale in it.
 */
export type MealSource = 'lookup' | 'estimate' | 'photo';

export interface MealEntry {
  id: number;
  name: string;
  kcal: number;
  /** Where the figure came from — the UI renders each of the three differently. */
  source: MealSource;
  barcode: string | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  portion_g: number | null;
  /** The instant, used for the time of day a meal was eaten. */
  eaten_at: string;
  /**
   * The day it was filed under, as the eater's own calendar saw it.
   *
   * Grouping uses this rather than the date part of `eaten_at`. A meal eaten at half past
   * midnight is stored as an instant, and re-deriving a date from that instant puts it on
   * the wrong day for anyone whose offset has since changed — travel, or a device clock
   * set differently from the one that wrote the row.
   */
  eaten_on: string;
}

/**
 * A sum that still knows what it is made of.
 *
 * `measured_kcal` is the part that came from barcode lookups; `estimated_kcal` is
 * everything a person or a model guessed. The two are reported separately because three
 * lookups and three guesses can reach the same number, and a screen showing only the sum
 * has no way to tell the reader which of those it is looking at.
 */
export interface NutritionTotals {
  kcal: number;
  measured_kcal: number;
  estimated_kcal: number;
  meal_count: number;
  measured_count: number;
  estimated_count: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** How many of the meals carried a macro breakdown at all — most estimates do not. */
  meals_with_macros: number;
}

/** One calendar day, week or month of the window, totalled. */
export interface PeriodBucket extends NutritionTotals {
  period: 'day' | 'week' | 'month';
  /** The whole natural period, whatever part of it the window covered. */
  start: string;
  end: string;
  covered_from: string;
  covered_to: string;
  /** True when the window stopped mid-period, so this total is of a fragment of it. */
  partial: boolean;
}

export interface NutritionWindow {
  from: string;
  to: string;
  meals: MealEntry[];
  totals: NutritionTotals;
  days: PeriodBucket[];
  weeks: PeriodBucket[];
  months: PeriodBucket[];
}

export interface FoodProduct {
  barcode: string;
  name: string;
  brand: string | null;
  kcal_per_100g: number;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
  serving_g: number | null;
  source: string;
}

export interface LogMealInput {
  name: string;
  kcal: number;
  source: MealSource;
  /** ISO 8601 *with the phone's offset*, so the server files the meal on the right day. */
  eaten_at?: string;
  barcode?: string;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  portion_g?: number;
}

/**
 * The meals in an inclusive span of days, with the day, week and month totals worked out.
 *
 * One request per window rather than one per grouping: the three tabs of the history
 * screen are three views of the same meals, and re-fetching to switch between them would
 * put a spinner over totals the phone already holds.
 */
export async function fetchWindow(from: string, to: string): Promise<NutritionWindow> {
  const payload = await apiGet<{
    data: MealEntry[];
    meta: {
      from: string;
      to: string;
      totals: NutritionTotals;
      days: PeriodBucket[];
      weeks: PeriodBucket[];
      months: PeriodBucket[];
    };
  }>(`/meals?from=${from}&to=${to}`);

  return {
    from: payload.meta.from,
    to: payload.meta.to,
    meals: payload.data,
    totals: payload.meta.totals,
    days: payload.meta.days,
    weeks: payload.meta.weeks,
    months: payload.meta.months,
  };
}

export async function logMeal(input: LogMealInput): Promise<MealEntry> {
  const payload = await apiPost<{ data: MealEntry }>('/meals', input);
  return payload.data;
}

export async function removeMeal(id: number): Promise<void> {
  await apiDelete(`/meals/${id}`);
}

/** Null when the barcode is not in the database — common, and not an error. */
export async function lookupBarcode(barcode: string): Promise<FoodProduct | null> {
  try {
    const payload = await apiGet<{ data: FoodProduct }>(`/foods/${barcode}`);
    return payload.data;
  } catch {
    return null;
  }
}
