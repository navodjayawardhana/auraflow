import { apiGet, apiPost } from '@/services/api-client';

export interface DailyBrief {
  date: string;
  /**
   * `waiting` is not a failure: the day has nothing worth briefing on yet, and it clears
   * itself as soon as anything is logged. The server retries it on its own.
   */
  status: 'pending' | 'ready' | 'failed' | 'waiting';
  body: string | null;
  /** Which model wrote it — advice from a since-replaced model should be identifiable. */
  model: string | null;
  reason: string | null;
  generated_at: string | null;
}

/**
 * Asking creates the brief and queues the work; the same call polls it afterwards. The
 * request never waits on the model — a phone opening a dashboard should not block on a
 * language model call.
 */
export async function fetchBrief(date: string): Promise<DailyBrief> {
  const payload = await apiGet<{ data: DailyBrief }>(`/briefs/${date}`);
  return payload.data;
}

export async function refreshBrief(date: string): Promise<void> {
  await apiPost(`/briefs/${date}/refresh`);
}
