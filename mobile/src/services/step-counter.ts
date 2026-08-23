import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pedometer } from 'expo-sensors';
import { Platform } from 'react-native';

import { todayIsoDate } from '@/services/recovery-service';

/**
 * Steps, from the best source each platform offers.
 *
 * iOS keeps a pedometer history the app can query for any past window, so it can be asked
 * what actually happened. Android has no equivalent — `getStepCountAsync` is documented
 * iOS-only and throws there — leaving `watchStepCount`, which reports steps since the
 * subscription began and only while the app is foregrounded.
 *
 * So the same figure means two different things depending on the phone, and the difference
 * is not cosmetic: on Android it is "steps taken while AuraFlow was open", which on a day
 * spent not looking at your phone is a small fraction of the truth. Both paths therefore
 * report whether the window was fully observed, and everything downstream — the tile's
 * caption, and the focus model's decision to use the feature at all — reads that rather
 * than assuming.
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

/**
 * What the platform's own history says, or null where there is no history to ask.
 *
 * Wrapped in a try because a refused motion permission surfaces as a throw rather than a
 * zero, and a throw here means "fall back", never "you did not move".
 */
async function queryObservedSteps(from: Date, to: Date): Promise<number | null> {
  if (Platform.OS !== 'ios') return null;

  try {
    const result = await Pedometer.getStepCountAsync(from, to);
    return typeof result?.steps === 'number' ? result.steps : null;
  } catch {
    return null;
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
  /** Today's steps: every one of them where `isComplete`, otherwise only those witnessed. */
  today: number;
  /** Steps in the trailing 60 minutes — the window the focus model was trained on. */
  lastHour: number;
  /** Minutes of the trailing hour we actually observed. */
  coverageMinutes: number;
  /**
   * Whether the platform answered from its own history rather than from what this app
   * happened to see. The caption on the tile turns on it, because "9,412 steps" and "9,412
   * steps while you had the app open" are different claims and only one of them is a day.
   */
  isComplete: boolean;
}

export async function summarise(
  userId: string | number,
  now = Date.now(),
): Promise<StepSummary> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [observedToday, observedHour] = await Promise.all([
    queryObservedSteps(startOfDay, new Date(now)),
    queryObservedSteps(new Date(now - 60 * BUCKET_MS), new Date(now)),
  ]);

  if (observedToday !== null && observedHour !== null) {
    // The operating system watched the whole window, not just the part this app was awake
    // for, so the coverage is genuinely complete rather than generously rounded.
    return {
      today: observedToday,
      lastHour: observedHour,
      coverageMinutes: 60,
      isComplete: true,
    };
  }

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

  return { today, lastHour, coverageMinutes, isComplete: false };
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
