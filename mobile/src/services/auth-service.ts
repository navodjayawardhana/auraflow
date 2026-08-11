import * as Device from 'expo-device';

import { apiGet, apiPost, clearToken, saveToken } from '@/services/api-client';
import type { ApiEnvelope, AuthPayload, User } from '@/types';

/**
 * Names the token after the device, so a user can tell their phone from their tablet
 * when reviewing sessions -- and so signing in again replaces this device's token
 * rather than accumulating a new one on every re-install.
 */
function deviceName(): string {
  return Device.deviceName ?? `${Device.osName ?? 'unknown'} device`;
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}): Promise<User> {
  const { data } = await apiPost<ApiEnvelope<AuthPayload>>('/register', {
    name: input.name,
    email: input.email,
    password: input.password,
    password_confirmation: input.passwordConfirmation,
    device_name: deviceName(),
  });

  await saveToken(data.token);
  return data.user;
}

export async function login(email: string, password: string): Promise<User> {
  const { data } = await apiPost<ApiEnvelope<AuthPayload>>('/login', {
    email,
    password,
    device_name: deviceName(),
  });

  await saveToken(data.token);
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await apiPost('/logout');
  } finally {
    // Clear locally even if the request failed. An offline sign-out that leaves the
    // token on the device would be a sign-out that did not happen.
    await clearToken();
  }
}

export async function fetchCurrentUser(): Promise<User> {
  const { data } = await apiGet<ApiEnvelope<User>>('/me');
  return data;
}
