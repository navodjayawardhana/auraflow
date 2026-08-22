import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pedometer } from 'expo-sensors';

import { todayIsoDate } from '@/services/recovery-service';

/**
 * Steps, counted honestly on Android.
 *
 * `Pedometer.getStepCountAsync` — the one that returns a real daily total — is iOS only.
 * Android offers `watchStepCount`, which reports steps *since the subscription started*
 * and only while the app is foregrounded. So a daily figure here is not "steps you took
 * today"; it is "steps taken while AuraFlow was open". The difference matters enough that
 * the coverage is tracked alongside the count and shown in the UI rather than quietly
 * presented as a complete day.
 */

const KEY_PREFIX = 'auraflow.steps.v1';
const VERSION = 1;

/** Buckets are one minute wide: fine enough for a trailing-hour window, cheap to store. */
const BUCKET_MS = 60_000;

interface DayRecord {
  v: number;
  date: string;
  /** Minute-bucket epoch -> steps counted in that minute. */
  buckets: Record<string, number>;
}

function keyFor(userId: string | number, date: string): string {
  return `${KEY_PREFIX}.${userId}.${date}`;
}

function bucketFor(at: number): string {
  return String(Math.floor(at / BUCKET_MS));
}

async function readDay(userId: string | number, date: string): Promise<DayRecord> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId, date));
    if (raw === null) return { v: VERSION, date, buckets: {} };

    const parsed = JSON.parse(raw) as DayRecord;
    if (parsed.v !== VERSION) return { v: VERSION, date, buckets: {} };

    return parsed;
  } catch {
    return { v: VERSION, date, buckets: {} };
  }
}

async function writeDay(userId: string | number, record: DayRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId, record.date), JSON.stringify(record));
  } catch {
    // A failed write costs this minute's steps, not the session.
  }
}

export async function isPedometerAvailable(): Promise<boolean> {
  try {
    return await Pedometer.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function recordSteps(
  userId: string | number,
  steps: number,
  at = Date.now(),
): Promise<void> {
  if (steps <= 0) return;

  const date = todayIsoDate(new Date(at));
  const record = await readDay(userId, date);
  const bucket = bucketFor(at);

  record.buckets[bucket] = (record.buckets[bucket] ?? 0) + steps;

  await writeDay(userId, record);
}

export interface StepSummary {
  /** Steps counted today while the app was open. */
  today: number;
  /** Steps in the trailing 60 minutes — the window the focus model was trained on. */
  lastHour: number;
  /** Minutes of the trailing hour we actually observed. */
  coverageMinutes: number;
}

export async function summarise(
  userId: string | number,
  now = Date.now(),
): Promise<StepSummary> {
  const record = await readDay(userId, todayIsoDate(new Date(now)));

  const currentBucket = Math.floor(now / BUCKET_MS);
  const oldestInWindow = currentBucket - 59;

  let today = 0;
  let lastHour = 0;
  let coverageMinutes = 0;

  for (const [bucket, steps] of Object.entries(record.buckets)) {
    today += steps;

    const index = Number(bucket);
    if (index >= oldestInWindow && index <= currentBucket) {
      lastHour += steps;
      coverageMinutes += 1;
    }
  }

  return { today, lastHour, coverageMinutes };
}

/** Yesterday and older are of no use to the trailing-hour window or today's tile. */
export async function pruneOldDays(userId: string | number, now = Date.now()): Promise<void> {
  try {
    const today = todayIsoDate(new Date(now));
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter(
      (k) => k.startsWith(`${KEY_PREFIX}.${userId}.`) && !k.endsWith(today),
    );

    if (stale.length > 0) await AsyncStorage.multiRemove(stale);
  } catch {
    // Best effort — stale days cost a few KB, not correctness.
  }
}

export function watchSteps(onSteps: (steps: number) => void) {
  // Android reports steps since this subscription began, so each callback carries a
  // running total rather than a delta. Differencing it here keeps the storage layer
  // dealing only in "steps in this minute".
  let previousTotal = 0;

  return Pedometer.watchStepCount((result) => {
    const delta = result.steps - previousTotal;
    previousTotal = result.steps;

    if (delta > 0) onSteps(delta);
  });
}
