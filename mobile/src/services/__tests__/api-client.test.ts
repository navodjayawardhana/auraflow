import { ApiError, apiGet, apiPost } from '@/services/api-client';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  global.fetch = jest.fn(async () => response as Response) as unknown as typeof fetch;
}

describe('api-client error mapping', () => {
  it('surfaces a 401 as unauthenticated', async () => {
    mockFetch({ ok: false, status: 401, json: async () => ({ message: 'Unauthenticated.' }) });

    await expect(apiGet('/me')).rejects.toMatchObject({ isUnauthenticated: true });
  });

  it('exposes per-field messages from a 422', async () => {
    mockFetch({
      ok: false,
      status: 422,
      json: async () => ({
        message: 'The given data was invalid.',
        errors: { email: ['These credentials do not match our records.'] },
      }),
    });

    try {
      await apiPost('/login', { email: 'a@b.c', password: 'wrong' });
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.isValidation).toBe(true);
      expect(apiError.fieldError('email')).toBe('These credentials do not match our records.');
      expect(apiError.fieldError('password')).toBeUndefined();
    }
  });

  it('treats a throttled login as a field error rather than a special case', async () => {
    // Laravel throws the rate limiter as a validation exception on `email`, so the UI
    // needs no separate 429 branch — this test pins that behaviour.
    mockFetch({
      ok: false,
      status: 429,
      json: async () => ({ message: 'Too many attempts.', errors: { email: ['Try again later.'] } }),
    });

    try {
      await apiPost('/login', {});
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as ApiError).isValidation).toBe(true);
      expect((error as ApiError).fieldError('email')).toBe('Try again later.');
    }
  });

  it('turns an unreachable server into status 0 with a friendly message', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    try {
      await apiGet('/me');
      throw new Error('expected a rejection');
    } catch (error) {
      const apiError = error as ApiError;
      // status 0 is what the offline outbox keys on to decide "queue and retry" rather
      // than "the user typed something wrong".
      expect(apiError.status).toBe(0);
      expect(apiError.isValidation).toBe(false);
      expect(apiError.message).toMatch(/reach AuraFlow/);
    }
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    mockFetch({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });

    await expect(apiGet('/me')).rejects.toMatchObject({ status: 500 });
  });
});
