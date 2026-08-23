import { apiGet } from '@/services/api-client';

/**
 * One day of the window, exactly as the server sends it.
 *
 * Every signal is nullable and none of the nulls is a zero. `steps: 0` is a day someone did
 * not move; `steps: null` is a day nobody counted, and every figure on the insights screen
 * turns on the difference — an average over four days of a fortnight is not a fortnight's
 * average, and the only way to know which one you have is for the gaps to survive the trip.
 */
export interface InsightsDay {
  date: string;
  recovery_score: number | null;
  /** Scored without a personal resting-HR baseline. Never averaged with the rest. */
  recovery_provisional: boolean;
  sleep_minutes: number | null;
  resting_heart_rate: number | null;
  steps: number | null;
  water_ml: number | null;
  meal_count: number;
  /** How many of that day's meals are a guess rather than a manufacturer's label. */
  estimated_meal_count: number;
}

export interface InsightsSeries {
  from: string;
  to: string;
  /** The denominator for every coverage figure — read from here, never from `days.length`. */
  window_days: number;
  days: InsightsDay[];
}

/**
 * The whole insights screen, in one request.
 *
 * The screen it feeds used to make one request per day for recovery alone. Widening the
 * server's read was the cheaper half of this: a fortnight of six signals is a few kilobytes,
 * and the alternative was fourteen round trips before the first chart could be drawn.
 */
export async function fetchInsights(days: number): Promise<InsightsSeries> {
  const payload = await apiGet<{ data: InsightsSeries }>(`/insights?days=${days}`);
  return payload.data;
}
