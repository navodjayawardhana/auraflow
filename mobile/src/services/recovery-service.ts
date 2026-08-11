import { apiGet } from '@/services/api-client';
import type { ApiEnvelope, RecoveryReading } from '@/types';

/** Local calendar date, not UTC: "today" is the user's today, not the server's. */
export function todayIsoDate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export async function fetchRecovery(date: string = todayIsoDate()): Promise<RecoveryReading> {
  const { data } = await apiGet<ApiEnvelope<RecoveryReading>>(`/recovery/${date}`);
  return data;
}
