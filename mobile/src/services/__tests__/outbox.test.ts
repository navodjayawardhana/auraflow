const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  removeItem: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
  multiRemove: jest.fn(async (keys: string[]) => {
    keys.forEach((k) => mockStore.delete(k));
  }),
}));

const mockRecordHealthSnapshot = jest.fn();
const mockLogExerciseSession = jest.fn();

jest.mock('@/services/health-snapshot-service', () => ({
  recordHealthSnapshot: (...args: unknown[]) => mockRecordHealthSnapshot(...args),
}));

jest.mock('@/services/movement-service', () => ({
  logExerciseSession: (...args: unknown[]) => mockLogExerciseSession(...args),
}));

import { ApiError } from '@/services/api-client';
import { clearOutbox, enqueue, flush, pendingCount, type QueuedPayload } from '@/services/outbox';

const V1_KEY = 'auraflow.outbox.v1';

function snapshot(date: string): QueuedPayload {
  return { kind: 'health-snapshot', body: { recorded_on: date, water_ml: 500 } };
}

function session(clientUuid: string): QueuedPayload {
  return {
    kind: 'exercise-session',
    body: {
      exercise: 'squat',
      total_reps: 10,
      good_form_reps: 8,
      duration_seconds: 120,
      mean_heart_rate: null,
      prescribed_intensity: 'full',
      recovery_score: 75,
      client_uuid: clientUuid,
    },
  };
}

beforeEach(async () => {
  mockStore.clear();
  mockRecordHealthSnapshot.mockReset().mockResolvedValue(undefined);
  mockLogExerciseSession.mockReset().mockResolvedValue(undefined);
});

describe('enqueue', () => {
  it('keeps only the latest write for a night', async () => {
    await enqueue(snapshot('2026-08-22'));
    await enqueue(snapshot('2026-08-22'));

    // The endpoint is idempotent per (user, date), so two entries would mean sending
    // conflicting figures for the same night.
    expect(await pendingCount()).toBe(1);
  });

  it('keeps nights for different dates apart', async () => {
    await enqueue(snapshot('2026-08-21'));
    await enqueue(snapshot('2026-08-22'));

    expect(await pendingCount()).toBe(2);
  });

  it('never collapses two exercise sessions', async () => {
    await enqueue(session('a'));
    await enqueue(session('b'));

    // Two sets before lunch are two sessions. Only a replay of the *same* one is a
    // duplicate, and the client id is what the server dedupes on.
    expect(await pendingCount()).toBe(2);
  });

  it('does not let a session displace a queued night', async () => {
    await enqueue(snapshot('2026-08-22'));
    await enqueue(session('a'));

    expect(await pendingCount()).toBe(2);
  });
});

describe('flush', () => {
  it('sends each kind to its own endpoint', async () => {
    await enqueue(snapshot('2026-08-22'));
    await enqueue(session('a'));

    const result = await flush();

    expect(result).toEqual({ sent: 2, dropped: 0, remaining: 0 });
    expect(mockRecordHealthSnapshot).toHaveBeenCalledTimes(1);
    expect(mockLogExerciseSession).toHaveBeenCalledTimes(1);
  });

  it('drops a write the server calls invalid', async () => {
    // It will be invalid on every retry, so keeping it would mean a queue that never
    // drains.
    mockLogExerciseSession.mockRejectedValue(
      new ApiError('bad', 422, { total_reps: ['too many'] }),
    );

    await enqueue(session('a'));
    const result = await flush();

    expect(result).toEqual({ sent: 0, dropped: 1, remaining: 0 });
  });

  it('keeps a write that failed for a reason that might pass later', async () => {
    mockLogExerciseSession.mockRejectedValue(new ApiError('unreachable', 0));

    await enqueue(session('a'));

    expect(await flush()).toEqual({ sent: 0, dropped: 0, remaining: 1 });
    expect(await pendingCount()).toBe(1);
  });

  it('does not hold up the rest of the queue when one entry fails', async () => {
    mockRecordHealthSnapshot.mockRejectedValue(new ApiError('unreachable', 0));

    await enqueue(snapshot('2026-08-22'));
    await enqueue(session('a'));

    expect(await flush()).toEqual({ sent: 1, dropped: 0, remaining: 1 });
  });
});

describe('the v1 queue', () => {
  it('carries nights logged before the update into the new shape', async () => {
    // Dropping these would lose exactly the writes this module exists to protect.
    mockStore.set(
      V1_KEY,
      JSON.stringify([
        {
          id: '2026-08-20-1',
          createdAt: '2026-08-20T07:00:00.000Z',
          payload: { recorded_on: '2026-08-20', sleep_minutes: 430 },
        },
      ]),
    );

    expect(await pendingCount()).toBe(1);

    await flush();

    expect(mockRecordHealthSnapshot).toHaveBeenCalledWith({
      recorded_on: '2026-08-20',
      sleep_minutes: 430,
    });
  });

  it('is read once and then left alone', async () => {
    mockStore.set(
      V1_KEY,
      JSON.stringify([
        { id: 'x', createdAt: 'x', payload: { recorded_on: '2026-08-20' } },
      ]),
    );

    await pendingCount();

    expect(mockStore.has(V1_KEY)).toBe(false);
    // And the entry is not counted a second time on the next read.
    expect(await pendingCount()).toBe(1);
  });

  it('survives a corrupt legacy value', async () => {
    mockStore.set(V1_KEY, 'not json');

    expect(await pendingCount()).toBe(0);
  });
});

describe('clearOutbox', () => {
  it('removes both the current and the legacy queue', async () => {
    mockStore.set(V1_KEY, JSON.stringify([]));
    await enqueue(snapshot('2026-08-22'));

    await clearOutbox();

    expect(await pendingCount()).toBe(0);
    expect(mockStore.size).toBe(0);
  });
});
