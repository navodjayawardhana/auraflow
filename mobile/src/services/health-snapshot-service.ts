import { apiGet, apiPost } from '@/services/api-client';
import type { HealthSnapshot, RecordHealthSnapshotInput } from '@/types';

export async function recordHealthSnapshot(
  input: RecordHealthSnapshotInput,
): Promise<HealthSnapshot> {
  const payload = await apiPost<{ data: HealthSnapshot }>('/health-snapshots', input);
  return payload.data;
}

export async function fetchHealthSnapshots(from: string, to: string): Promise<HealthSnapshot[]> {
  const payload = await apiGet<{ data: HealthSnapshot[] }>(
    `/health-snapshots?from=${from}&to=${to}`,
  );
  return payload.data;
}
