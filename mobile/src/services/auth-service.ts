import * as Device from 'expo-device';

import { apiGet, apiPost, clearToken, setToken } from '@/services/api-client';
import type { AuthPayload, User } from '@/types';

function deviceName(): string {
  return Device.deviceName ?? Device.modelName ?? 'unknown-device';
}

export async function register(params: {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
}): Promise<AuthPayload> {
  const payload = await apiPost<{ data: AuthPayload }>('/register', {
    ...params,
    device_name: deviceName(),
  });
  await setToken(payload.data.token);
  return payload.data;
}

export async function login(params: { email: string; password: string }): Promise<AuthPayload> {
  const payload = await apiPost<{ data: AuthPayload }>('/login', {
    ...params,
    device_name: deviceName(),
  });
  await setToken(payload.data.token);
  return payload.data;
}

/**
 * Ask the server to mail a six-digit code.
 *
 * A code the user types, not a link they tap. AuraFlow is demonstrated in Expo Go, which
 * owns the URL scheme — a reset link would have to carry an `exp://` address tied to the
 * machine running the packager, and it would break on every restart and again the moment
 * the project moves to a development or release build. See the API's
 * Domain\Auth\ValueObject\ResetCode for the full reasoning; this is the client half of
 * the same decision, and it is why there is no deep-link handler anywhere in this app.
 *
 * Resolves identically whether or not the address belongs to an account — the API answers
 * the same way on purpose, so there is nothing here to branch on and the screen must not
 * invent a distinction. The server's own wording is returned rather than a local copy, so
 * the hedge in it cannot drift away from what the API actually promised.
 */
export async function requestPasswordReset(params: { email: string }): Promise<string> {
  const payload = await apiPost<{ data: { message: string } }>('/password/forgot', params);
  return payload.data.message;
}

/**
 * Spend the code and set the new password, in one call.
 *
 * The server signs the user in as part of the reset and revokes every other session while
 * doing it, so the token stored here is deliberately the only one left alive on the
 * account — which is the point when the reason for the reset was that somebody else had
 * one.
 */
export async function resetPassword(params: {
  email: string;
  code: string;
  password: string;
  password_confirmation: string;
}): Promise<AuthPayload> {
  const payload = await apiPost<{ data: AuthPayload }>('/password/reset', {
    ...params,
    device_name: deviceName(),
  });
  await setToken(payload.data.token);
  return payload.data;
}

export async function logout(): Promise<void> {
  try {
    await apiPost('/logout');
  } catch {
    // best-effort — the local token is cleared regardless
  }
  await clearToken();
}

export async function logoutEverywhere(): Promise<void> {
  try {
    await apiPost('/logout-everywhere');
  } catch {
    // best-effort — the local token is cleared regardless
  }
  await clearToken();
}

export async function fetchCurrentUser(): Promise<User> {
  return apiGet<User>('/me');
}
