jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};

  return {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
    getAllKeys: jest.fn(async () => Object.keys(store)),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((k) => delete store[k]);
    }),
    __reset: () => {
      store = {};
    },
  };
});

/* Imports sit below the mock factory for the reason the outbox test gives: jest hoists the
   factory above them regardless, and ordering them this way makes the file read the way it
   actually executes. */
/* eslint-disable import/first */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { writeCache } from '@/services/cache';
import {
  clearCompletion,
  deriveDoneDates,
  markDone,
  pruneDates,
  readDoneDates,
} from '@/services/reminder-completion';
import type { HealthSnapshot } from '@/types';
/* eslint-enable import/first */

const USER = 42;

const snapshot = (date: string, fields: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  date,
  sleep_minutes: null,
  deep_sleep_minutes: null,
  rem_sleep_minutes: null,
  resting_heart_rate: null,
  resting_hr_source: null,
  steps: null,
  water_ml: null,
  ...fields,
});

beforeEach(() => {
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
});

describe('deriveDoneDates', () => {
  it('counts a seated reading as a check-in, and an overnight one as not', () => {
    const snapshots = [
      snapshot('2026-08-20', { resting_heart_rate: 58, resting_hr_source: 'seated_spot' }),
      // A night's reading answers the night reminder, never the morning one — they are
      // separate baselines, which is the whole reason the source field exists.
      snapshot('2026-08-21', { resting_heart_rate: 52, resting_hr_source: 'overnight' }),
    ];

    expect([...deriveDoneDates('morning-checkin', snapshots)]).toEqual(['2026-08-20']);
  });

  it('counts a logged sleep figure as the night being logged', () => {
    const snapshots = [
      snapshot('2026-08-20', { sleep_minutes: 430 }),
      snapshot('2026-08-21', { resting_heart_rate: 52, resting_hr_source: 'overnight' }),
    ];

    expect([...deriveDoneDates('log-night', snapshots)]).toEqual(['2026-08-20']);
  });

  it('counts any water at all, and not a zero', () => {
    const snapshots = [
      snapshot('2026-08-20', { water_ml: 250 }),
      // Zero is someone having undone their last glass, which is not a day they logged on.
      snapshot('2026-08-21', { water_ml: 0 }),
    ];

    expect([...deriveDoneDates('water', snapshots)]).toEqual(['2026-08-20']);
  });

  it('finds nothing for movement, which snapshots do not record', () => {
    expect(deriveDoneDates('movement', [snapshot('2026-08-20', { steps: 9000 })]).size).toBe(0);
  });
});

describe('pruneDates', () => {
  it('keeps the cutoff day and everything after it', () => {
    const dates = ['2026-08-19', '2026-08-20', '2026-08-21'];

    expect(pruneDates(dates, '2026-08-20')).toEqual(['2026-08-20', '2026-08-21']);
  });

  it('keeps everything when nothing is old enough', () => {
    expect(pruneDates(['2026-08-21'], '2026-08-20')).toEqual(['2026-08-21']);
  });
});

describe('markDone and readDoneDates', () => {
  it('suppresses the day a check-in was saved on, with no server data at all', async () => {
    // The offline case: the marker is the only thing that exists, and it has to be enough.
    await markDone(USER, 'morning-checkin', '2026-08-22');

    const done = await readDoneDates(USER, '2026-08-20');

    expect(done.get('morning-checkin')?.has('2026-08-22')).toBe(true);
  });

  it('does not record the same day twice', async () => {
    await markDone(USER, 'water', '2026-08-22');
    await markDone(USER, 'water', '2026-08-22');

    expect(await readWaterDates()).toEqual(['2026-08-22']);
  });

  it('keeps kinds apart', async () => {
    await markDone(USER, 'morning-checkin', '2026-08-22');

    const done = await readDoneDates(USER, '2026-08-20');

    expect(done.get('log-night')?.has('2026-08-22') ?? false).toBe(false);
  });

  it('merges the cached snapshots with the local markers', async () => {
    // The cross-device case: logged elsewhere, seen here only because the Today screen has
    // since cached the server's answer.
    await writeCache(USER, 'health-snapshots.8', [
      snapshot('2026-08-21', { resting_hr_source: 'seated_spot', resting_heart_rate: 57 }),
    ]);
    await markDone(USER, 'morning-checkin', '2026-08-22');

    const done = await readDoneDates(USER, '2026-08-20');

    expect([...(done.get('morning-checkin') ?? [])].sort()).toEqual(['2026-08-21', '2026-08-22']);
  });

  it('keeps one account’s markers away from another’s', async () => {
    await markDone(USER, 'morning-checkin', '2026-08-22');

    const other = await readDoneDates(99, '2026-08-20');

    expect(other.get('morning-checkin')?.size ?? 0).toBe(0);
  });

  it('drops markers older than the cutoff, and writes the shorter log back', async () => {
    await markDone(USER, 'water', '2026-08-01');
    await markDone(USER, 'water', '2026-08-22');

    const done = await readDoneDates(USER, '2026-08-20');

    expect([...(done.get('water') ?? [])]).toEqual(['2026-08-22']);
    // Pruned in storage too, or the log grows for the life of the install.
    expect(await readWaterDates()).toEqual(['2026-08-22']);
  });

  it('forgets everything on sign-out', async () => {
    await markDone(USER, 'morning-checkin', '2026-08-22');
    await clearCompletion(USER);

    const done = await readDoneDates(USER, '2026-08-20');

    expect(done.get('morning-checkin')?.size ?? 0).toBe(0);
  });

  it('treats a corrupt log as an empty one rather than throwing', async () => {
    await AsyncStorage.setItem('auraflow.reminders.v1.42.completed', '{not json');

    const done = await readDoneDates(USER, '2026-08-20');

    expect(done.get('morning-checkin')?.size ?? 0).toBe(0);
  });
});

/** Reads the raw log back, to assert on what was actually persisted rather than merged. */
async function readWaterDates(): Promise<string[]> {
  const raw = await AsyncStorage.getItem('auraflow.reminders.v1.42.completed');

  return (JSON.parse(raw ?? '{}') as { water?: string[] }).water ?? [];
}
