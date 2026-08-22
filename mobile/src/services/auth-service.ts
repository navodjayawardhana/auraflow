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
