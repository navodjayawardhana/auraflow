import { apiGet, apiPut } from '@/services/api-client';
import type { Profile, UpdateProfileInput } from '@/types';

/** `null` is an answer, not a failure: nothing about the app requires a profile to exist. */
export async function fetchProfile(): Promise<Profile | null> {
  const payload = await apiGet<{ data: Profile | null }>('/profile');
  return payload.data;
}

/**
 * Idempotent per user, which is what lets a failed save go through the outbox: replaying
 * the same body lands on the same profile rather than a second one.
 */
export async function saveProfile(input: UpdateProfileInput): Promise<Profile> {
  const payload = await apiPut<{ data: Profile }>('/profile', input);
  return payload.data;
}
