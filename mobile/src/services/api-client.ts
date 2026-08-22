import * as SecureStore from 'expo-secure-store';

// Edit this if your API isn't running on the same machine's default port.
// Physical devices need your machine's LAN address, not localhost.
const DEFAULT_API_URL = 'http://localhost:8000/api/v1';
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;

const TOKEN_KEY = 'auraflow.authToken';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  errors?: Record<string, string[]>;

  constructor(message: string, status: number, errors?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.errors = errors;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isValidation(): boolean {
    return (this.status === 422 || this.status === 429) && this.errors != null;
  }

  fieldError(field: string): string | undefined {
    return this.errors?.[field]?.[0];
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `${API_URL}${path}`;

  // Development only. These lines print URLs, status codes and error bodies — including
  // validation errors from the login route — so they must never reach a release build.
  if (__DEV__) {
    console.log(`[api] ${options.method ?? 'GET'} ${url}`);
  }

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (error) {
    if (__DEV__) {
      console.log('[api] request failed:', url, error);
    }
    throw new ApiError("Can't reach AuraFlow — check your connection.", 0);
  }

  if (__DEV__) {
    console.log(`[api] ${response.status} ${url}`);
  }

  if (!response.ok) {
    let body: { message?: string; errors?: Record<string, string[]> } = {};
    try {
      body = await response.json();
    } catch {
      // no JSON body — fall through with a generic message
    }
    if (__DEV__) {
      console.log('[api] error body:', body);
    }
    throw new ApiError(body.message ?? 'Something went wrong.', response.status, body.errors);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
