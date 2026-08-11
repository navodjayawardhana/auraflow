import * as SecureStore from 'expo-secure-store';

import { ApiError, apiGet, apiPost, clearToken, getToken, saveToken } from '@/services/api-client';

function respondWith(status: number, body: unknown = {}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe('token storage', () => {
  beforeEach(async () => {
    await clearToken();
    jest.clearAllMocks();
  });

  // Z
  it('should return null when no token has been stored', async () => {
    await expect(getToken()).resolves.toBeNull();
  });

  // O
  it('should round-trip a stored token', async () => {
    await saveToken('token-abc');

    await expect(getToken()).resolves.toBe('token-abc');
  });

  // I
  it('should store the token in SecureStore rather than plain storage', async () => {
    // The whole security argument for this app rests on the token not sitting in a
    // plaintext file, so the mechanism is asserted, not just the outcome.
    await saveToken('token-abc');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'auraflow_token',
      'token-abc',
      expect.objectContaining({ keychainAccessible: expect.anything() }),
    );
  });

  // E
  it('should leave nothing behind after clearing', async () => {
    await saveToken('token-abc');
    await clearToken();

    await expect(getToken()).resolves.toBeNull();
  });
});

describe('request handling', () => {
  beforeEach(async () => {
    await clearToken();
    jest.clearAllMocks();
  });

  // Z
  it('should send no authorization header when signed out', async () => {
    respondWith(200, { data: [] });

    await apiGet('/recovery/2026-03-15');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  // O
  it('should attach the bearer token once one is stored', async () => {
    await saveToken('token-abc');
    respondWith(200, { data: [] });

    await apiGet('/me');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer token-abc');
  });

  // B
  it('should treat 204 as success with no body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('no body to parse');
      },
    } as unknown as Response);

    await expect(apiPost('/logout')).resolves.toBeUndefined();
  });

  // E
  it('should flag a 401 so callers can send the user back to sign in', async () => {
    respondWith(401, { message: 'Unauthenticated.' });

    await expect(apiGet('/me')).rejects.toMatchObject({ isUnauthenticated: true });
  });

  // E
  it('should expose per-field messages from a validation failure', async () => {
    respondWith(422, {
      message: 'The given data was invalid.',
      errors: { email: ['These credentials do not match our records.'] },
    });

    try {
      await apiPost('/login', {});
      throw new Error('expected the request to reject');
    } catch (caught) {
      expect(caught).toBeInstanceOf(ApiError);
      expect((caught as ApiError).isValidation).toBe(true);
      expect((caught as ApiError).fieldError('email')).toBe(
        'These credentials do not match our records.',
      );
    }
  });

  // E
  it('should turn a transport failure into a message a user can act on', async () => {
    // fetch only rejects when the request never completed, so this is genuinely
    // "no network" -- and a bare "Network request failed" tells the user nothing.
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    await expect(apiGet('/me')).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('connection'),
    });
  });

  // E
  it('should not lose the status when the error body is unparseable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    await expect(apiGet('/me')).rejects.toMatchObject({ status: 500 });
  });

  // S
  it('should return the decoded body on success', async () => {
    respondWith(200, { data: { id: 1, name: 'Navod' } });

    await expect(apiGet('/me')).resolves.toEqual({ data: { id: 1, name: 'Navod' } });
  });
});
