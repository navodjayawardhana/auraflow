import { apiGet } from '@/services/api-client';
import type { RecoveryReading } from '@/types';

export function todayIsoDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function fetchRecovery(date: string): Promise<RecoveryReading> {
  const payload = await apiGet<{ data: RecoveryReading }>(`/recovery/${date}`);
  return payload.data;
}

/**
 * `iso` moved by `days`. Unbounded — the caller owns what counts as too far.
 *
 * Parsed with the time appended, because `new Date('2026-08-22')` is read as UTC while
 * `new Date('2026-08-22T00:00:00')` is read as local. West of Greenwich the first lands on
 * the previous day, and a date stepper that skips a day the first time you press it is a
 * bug nobody finds until the demo.
 */
export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return todayIsoDate(d);
}

/** The last `days` calendar dates, oldest first, ending today. */
export function recentDates(days: number, from = new Date()): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(from);
    d.setDate(d.getDate() - (days - 1 - i));
    return todayIsoDate(d);
  });
}

/**
 * Fetches a window of readings in parallel. The API returns 200 with
 * `available: false` for days it has no data for, so a missing day is a normal
 * reading here rather than a rejected promise.
 */
export async function fetchRecoveryRange(dates: string[]): Promise<RecoveryReading[]> {
  return Promise.all(dates.map(fetchRecovery));
}
