import * as SecureStore from 'expo-secure-store';

import { API_BASE_URL } from '@/constants/api-config';

const TOKEN_KEY = 'auraflow_token';

/**
 * The token lives in SecureStore, not AsyncStorage.
 *
 * AsyncStorage is a plaintext file in the app sandbox: readable on a rooted or
 * jailbroken device, and in any backup that includes app data. SecureStore hands the
 * value to the Android Keystore or the iOS Keychain, which are hardware-backed where
 * the device supports it.
 *
 * For an app holding a token that unlocks health data, that difference is the whole
 * argument. See report 4.6.
 */
export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The token is gone or revoked; the caller should send the user back to sign in. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isValidation(): boolean {
    return this.status === 422;
  }

  /** First message for a field, for showing inline next to the input. */
  fieldError(field: string): string | undefined {
    return this.errors[field]?.[0];
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...(await authHeaders()), ...(init.headers ?? {}) },
    });
  } catch {
    // fetch only rejects on a transport failure, so this is genuinely "no network"
    // rather than an error status. Worth saying plainly: the offline case is common
    // and a bare "Network request failed" tells the user nothing.
    throw new ApiError('Could not reach AuraFlow. Check your connection.', 0);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      body?.message ?? `Request failed (${response.status})`,
      response.status,
      body?.errors ?? {},
    );
  }

  return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
