const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  removeItem: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));

const mockRecordHealthSnapshot = jest.fn();
const mockEnqueue = jest.fn();
const mockSummarise = jest.fn();
const mockStoredDayTotals = jest.fn();
const mockObservedStepsForDay = jest.fn();

jest.mock('@/services/health-snapshot-service', () => ({
  recordHealthSnapshot: (...args: unknown[]) => mockRecordHealthSnapshot(...args),
}));

jest.mock('@/services/outbox', () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
}));

jest.mock('@/services/step-counter', () => ({
  HISTORY_DAYS: 7,
  summarise: (...args: unknown[]) => mockSummarise(...args),
  storedDayTotals: (...args: unknown[]) => mockStoredDayTotals(...args),
  observedStepsForDay: (...args: unknown[]) => mockObservedStepsForDay(...args),
}));

/* The imports below must stay under the jest.mock calls — see outbox.test.ts. */
/* eslint-disable import/first */
import { ApiError } from '@/services/api-client';
import { daysWorthSending, syncSteps, type Marks, type StepDay } from '@/services/step-sync';
/* eslint-enable import/first */

/** Midday, so "today" is unambiguous and a backfill has six whole days behind it. */
const NOW = new Date('2026-08-22T12:00:00').getTime();
const TODAY = '2026-08-22';

function partial(steps: number): void {
  mockSummarise.mockResolvedValue({ today: steps, lastHour: 0, coverageMinutes: 0, isComplete: false });
}

function complete(steps: number): void {
  mockSummarise.mockResolvedValue({ today: steps, lastHour: 0, coverageMinutes: 60, isComplete: true });
}

beforeEach(() => {
  mockStore.clear();
  mockRecordHealthSnapshot.mockReset().mockResolvedValue(undefined);
  mockEnqueue.mockReset().mockResolvedValue(undefined);
  mockSummarise.mockReset();
  mockStoredDayTotals.mockReset().mockResolvedValue([]);
  // No pedometer history unless a test gives it one, which is the Android shape.
  mockObservedStepsForDay.mockReset().mockResolvedValue(null);
});

describe('daysWorthSending', () => {
  const day = (overrides: Partial<StepDay> = {}): StepDay => ({
    date: TODAY,
    steps: 5000,
    isComplete: false,
    ...overrides,
  });

  it('sends a day nothing has been sent for', () => {
    expect(daysWorthSending([day()], {}, 0)).toHaveLength(1);
  });

  it('never writes a zero', () => {
    // On Android it means the app saw nothing; on iOS it is what a day past the seven-day
    // retention window reads as. Neither is evidence that a person did not move.
    expect(daysWorthSending([day({ steps: 0 })], {}, 0)).toEqual([]);
  });

  it('does not resend a figure that has not moved', () => {
    const marks: Marks = { [TODAY]: { steps: 5000, isComplete: false } };

    expect(daysWorthSending([day()], marks, 0)).toEqual([]);
  });

  it('holds a small change back on a tick and sends it on a boundary', () => {
    const marks: Marks = { [TODAY]: { steps: 5000, isComplete: false } };
    const nudged = [day({ steps: 5040 })];

    // Forty steps is a walk to the kettle. At six-second ticks, sending it is how a
    // stationary afternoon becomes six hundred requests.
    expect(daysWorthSending(nudged, marks, 250)).toEqual([]);
    expect(daysWorthSending(nudged, marks, 0)).toHaveLength(1);
  });

  it('sends a day the moment it becomes complete, however small the change', () => {
    const marks: Marks = { [TODAY]: { steps: 5000, isComplete: false } };

    // The same integer means something else now: a floor has become a total.
    expect(daysWorthSending([day({ steps: 5000, isComplete: true })], marks, 250)).toHaveLength(1);
  });

  it('refuses to let a witnessed fragment overwrite a whole day', () => {
    const marks: Marks = { [TODAY]: { steps: 11_000, isComplete: true } };

    // iOS falls back to this app's own buckets whenever the pedometer query fails, so
    // without this rule a refused permission would replace the operating system's answer
    // with the fraction this app happened to see.
    expect(daysWorthSending([day({ steps: 2100 })], marks, 0)).toEqual([]);
  });
});

describe('syncSteps', () => {
  it('writes today with the provenance the platform gives it', async () => {
    partial(3200);

    await syncSteps('u1', 'foreground', NOW);

    expect(mockRecordHealthSnapshot).toHaveBeenCalledWith({
      recorded_on: TODAY,
      steps: 3200,
      steps_are_complete: false,
    });
  });

  it('sends nothing at all on a second sync of an unchanged day', async () => {
    partial(3200);

    await syncSteps('u1', 'foreground', NOW);
    await syncSteps('u1', 'foreground', NOW);

    // The endpoint would absorb the repeat, being idempotent by day. The point is not to
    // make the request: `use-steps` asks every six seconds.
    expect(mockRecordHealthSnapshot).toHaveBeenCalledTimes(1);
  });

  it('fills the week behind it from the pedometer history on the first sync', async () => {
    complete(4400);
    mockObservedStepsForDay.mockResolvedValue(9100);

    await syncSteps('u1', 'start', NOW);

    // Six days back plus today: the edge of what Apple documents CMPedometer as keeping.
    // Without this a new install would wait a week before the plan had a median to read.
    expect(mockRecordHealthSnapshot).toHaveBeenCalledTimes(7);
    expect(mockRecordHealthSnapshot).toHaveBeenCalledWith({
      recorded_on: '2026-08-16',
      steps: 9100,
      steps_are_complete: true,
    });
  });

  it('hands the days the app counted for itself over before they are pruned', async () => {
    // Android, opened for the first time in three days. The buckets are the only record
    // that those days happened, and `pruneOldDays` is about to delete them.
    partial(700);
    mockStoredDayTotals.mockResolvedValue([
      { date: '2026-08-20', steps: 2400 },
      { date: '2026-08-21', steps: 1900 },
    ]);

    await syncSteps('u1', 'start', NOW);

    expect(mockRecordHealthSnapshot).toHaveBeenCalledTimes(3);
    expect(mockRecordHealthSnapshot).toHaveBeenCalledWith({
      recorded_on: '2026-08-21',
      steps: 1900,
      steps_are_complete: false,
    });
  });

  it('prefers the history over what the app itself witnessed for the same day', async () => {
    complete(4400);
    mockStoredDayTotals.mockResolvedValue([{ date: '2026-08-21', steps: 1900 }]);
    mockObservedStepsForDay.mockResolvedValue(8800);

    await syncSteps('u1', 'start', NOW);

    expect(mockRecordHealthSnapshot).toHaveBeenCalledWith({
      recorded_on: '2026-08-21',
      steps: 8800,
      steps_are_complete: true,
    });
    expect(mockRecordHealthSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ recorded_on: '2026-08-21', steps: 1900 }),
    );
  });

  it('queues the write when the phone is offline', async () => {
    partial(5200);
    mockRecordHealthSnapshot.mockRejectedValue(new ApiError('unreachable', 0));

    await syncSteps('u1', 'background', NOW);

    expect(mockEnqueue).toHaveBeenCalledWith({
      kind: 'health-snapshot',
      body: { recorded_on: TODAY, steps: 5200, steps_are_complete: false },
    });
  });

  it('tries again next time when the server was reachable but unhappy', async () => {
    partial(5200);
    mockRecordHealthSnapshot.mockRejectedValueOnce(new ApiError('boom', 500));

    await syncSteps('u1', 'foreground', NOW);
    await syncSteps('u1', 'foreground', NOW);

    // A 500 is a reason to retry; marking the day sent would lose it silently. A 422
    // would not be — that payload is invalid on every attempt.
    expect(mockRecordHealthSnapshot).toHaveBeenCalledTimes(2);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('keeps one user’s marks away from another’s', async () => {
    partial(3200);

    await syncSteps('u1', 'foreground', NOW);
    await syncSteps('u2', 'foreground', NOW);

    expect(mockRecordHealthSnapshot).toHaveBeenCalledTimes(2);
  });
});
