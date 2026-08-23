import { apiGet, apiPost, apiPut } from '@/services/api-client';
import type { Plan, PlanOverrideInput } from '@/types';

/** `null` until something derives one. A read does not write; see `plan-targets`. */
export async function fetchPlan(): Promise<Plan | null> {
  const payload = await apiGet<{ data: Plan | null }>('/plan');
  return payload.data;
}

/** Derives afresh from the profile, discarding whatever the user had overridden. */
export async function recalculatePlan(): Promise<Plan> {
  const payload = await apiPost<{ data: Plan }>('/plan/recalculate');
  return payload.data;
}

/**
 * This device's id for one edit, mirroring `newSessionId` for the same reason: Hermes has
 * no `crypto.randomUUID`, and the id only has to be unique within one account.
 */
export function newPlanEditId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Sends only the fields the user changed — that difference is what the server records as
 * `edited_fields`, and what the history screen marks.
 *
 * Safe to replay, and therefore safe to queue offline. Two guards on the server side: the
 * `client_uuid` returns the version that key already produced, and a body that matches the
 * current values produces no version at all. Without both, a retry whose response was lost
 * would leave a duplicate in the user's own history looking like an edit they never made.
 */
export async function overridePlan(input: PlanOverrideInput): Promise<Plan> {
  const payload = await apiPut<{ data: Plan }>('/plan', input);
  return payload.data;
}

/** Newest first, capped server-side at 50. Every entry carries its own `edited_fields`. */
export async function fetchPlanHistory(): Promise<Plan[]> {
  const payload = await apiGet<{ data: Plan[] }>('/plan/history');
  return payload.data;
}
