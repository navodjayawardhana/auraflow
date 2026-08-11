import { fetchRecovery, todayIsoDate } from '@/services/recovery-service';

describe('todayIsoDate', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // I
  it("should use the device's local calendar date, not UTC", () => {
    // 2026-03-15 23:30 local in a zone ahead of UTC is still 2026-03-15 for the user,
    // even though it is already the 16th in UTC. Asking the API for the UTC date would
    // show tomorrow's empty screen at bedtime -- exactly when someone checks recovery.
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 15, 23, 30, 0));

    expect(todayIsoDate()).toBe('2026-03-15');
  });

  // B
  it('should zero-pad single-digit months and days', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 0, 5, 9, 0, 0));

    expect(todayIsoDate()).toBe('2026-01-05');
  });
});

describe('fetchRecovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // O
  it('should unwrap the data envelope', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          date: '2026-03-15',
          available: true,
          score: 72.4,
          provisional: false,
          components_used: 3,
          illness_warning: false,
        },
      }),
    } as Response);

    const reading = await fetchRecovery('2026-03-15');

    expect(reading).toMatchObject({ available: true, score: 72.4 });
  });

  // Z
  it('should pass through an unavailable reading rather than treating it as an error', async () => {
    // available:false is a normal state -- the account and date are fine, there is just
    // nothing recorded. Turning it into a thrown error would show a failure screen for
    // a user who simply has not worn the watch yet.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          date: '2026-03-15',
          available: false,
          score: null,
          reason: 'No sleep was recorded for this night.',
        },
      }),
    } as Response);

    const reading = await fetchRecovery('2026-03-15');

    expect(reading.available).toBe(false);
  });

  // S
  it('should default to today when no date is given', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 15, 8, 0, 0));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { date: '2026-03-15', available: false, score: null, reason: '' } }),
    } as Response);

    await fetchRecovery();

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/recovery/2026-03-15');

    jest.useRealTimers();
  });
});
