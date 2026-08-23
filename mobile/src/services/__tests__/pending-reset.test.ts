import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  RESET_CODE_TTL_MINUTES,
  forgetPendingReset,
  readPendingReset,
  rememberPendingReset,
} from '@/services/pending-reset';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('pending password reset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('carries the address across an app that was killed mid-flow', async () => {
    // Reading the code means leaving the app, and Android may reclaim it while the user
    // is in their mail client. Without this the person comes back holding a live code and
    // no screen that knows which address it belongs to.
    storage.setItem.mockResolvedValue(undefined);
    await rememberPendingReset('navod@example.com');

    const [key, written] = storage.setItem.mock.calls[0];
    storage.getItem.mockResolvedValue(written);

    expect(await readPendingReset()).toBe('navod@example.com');
    expect(key).toContain('pendingPasswordReset');
  });

  it('never writes the code itself to disk', async () => {
    // Prevents a fifteen-minute secret acquiring the lifetime of the filesystem. Only the
    // address is worth remembering; the code must stay in memory and in the inbox.
    storage.setItem.mockResolvedValue(undefined);
    await rememberPendingReset('navod@example.com');

    const written = storage.setItem.mock.calls[0][1];
    expect(written).not.toMatch(/\d{6}/);
    expect(JSON.parse(written)).toEqual({
      email: 'navod@example.com',
      requestedAt: expect.any(String),
    });
  });

  it('drops a marker older than the code it points at', async () => {
    // Prevents dropping someone onto a code-entry screen for a code that expired hours
    // ago — the honest place is the screen that issues a new one.
    const stale = new Date(Date.now() - (RESET_CODE_TTL_MINUTES + 1) * 60_000).toISOString();
    storage.getItem.mockResolvedValue(
      JSON.stringify({ email: 'navod@example.com', requestedAt: stale }),
    );
    storage.removeItem.mockResolvedValue(undefined);

    expect(await readPendingReset()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalled();
  });

  it('treats a corrupt marker as no marker', async () => {
    // A parse failure must not crash the reset screen on launch.
    storage.getItem.mockResolvedValue('{ not json');

    expect(await readPendingReset()).toBeNull();
  });

  it('survives storage being unavailable', async () => {
    // Failing to remember costs one extra tap; it must never fail a reset the person can
    // otherwise finish on the screen in front of them.
    storage.setItem.mockRejectedValue(new Error('disk full'));
    storage.getItem.mockRejectedValue(new Error('disk full'));
    storage.removeItem.mockRejectedValue(new Error('disk full'));

    await expect(rememberPendingReset('navod@example.com')).resolves.toBeUndefined();
    await expect(readPendingReset()).resolves.toBeNull();
    await expect(forgetPendingReset()).resolves.toBeUndefined();
  });
});
