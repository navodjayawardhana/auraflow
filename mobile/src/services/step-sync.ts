import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError } from '@/services/api-client';
import { recordHealthSnapshot } from '@/services/health-snapshot-service';
import { enqueue } from '@/services/outbox';
import { todayIsoDate } from '@/services/recovery-service';
import {
  HISTORY_DAYS,
  observedStepsForDay,
  storedDayTotals,
  summarise,
} from '@/services/step-counter';

/**
 * Getting the step count off the phone and into the day's row.
 *
 * The counter has always been a local thing: buckets in AsyncStorage, pruned to today,
 * read by one tile. Nothing carried it to the server, so `health_snapshots.steps` was
 * never written, the plan's Tudor-Locke band never had a median to sit above, and the
 * insights screen drew an empty row for a signal the phone had been counting all along.
 *
 * Two things make this harder than a POST.
 *
 * **A day means different things on the two platforms.** iOS answers from the operating
 * system's pedometer history, so its figure is the day. Android reports only what was
 * counted while the app was foregrounded. Both are worth recording and only one is a
 * total, so every write states which it is and the server stores that beside the count.
 *
 * **The number moves constantly.** `use-steps` re-reads every six seconds; a write per
 * read would be six hundred requests in an hour of walking. So writes happen on the
 * boundaries that matter — opening the app, leaving it, the day turning over — and
 * between them only when the figure has moved enough to be worth a row, which is what
 * `MIN_TICK_DELTA` is for. A value that has not changed is never sent at all.
 *
 * The write itself is `POST /health-snapshots`, which merges rather than replaces and is
 * idempotent per (user, day). That is what makes all of this safe: a partial figure sent
 * at noon and the same day's complete figure sent tomorrow morning land on one row, and
 * neither touches the night's sleep already recorded there.
 */

/** Marks live per user; a shared device must not skip a write because someone else made it. */
const KEY_PREFIX = 'auraflow.steps.sync.v1';

/**
 * Steps that have to accumulate before a routine tick is worth a request.
 *
 * Two hundred and fifty is a couple of minutes of walking. Below it the row would be
 * rewritten with a figure no reader could tell from the last one; above it and a walk
 * would reach the server only when the app was closed.
 */
export const MIN_TICK_DELTA = 250;

/** Enough marks to cover the backfill window and the day it rolls into. */
const MARK_LIMIT = HISTORY_DAYS + 1;

/**
 * Why a sync is happening. Only the routine tick is throttled: every other reason is a
 * moment the current figure may be the last one this day ever gets.
 */
export type SyncReason =
  /** Permission granted and counting started — the first chance to backfill. */
  | 'start'
  /** Returned to the app, possibly days later. */
  | 'foreground'
  /** Leaving the app: whatever was witnessed is about to stop being witnessed. */
  | 'background'
  /** Midnight passed with the app open; yesterday is now final. */
  | 'rollover'
  /** The six-second refresh. */
  | 'tick';

export interface StepDay {
  date: string;
  steps: number;
  /** Whether `steps` covers the whole day or only the part the app was awake for. */
  isComplete: boolean;
}

export interface Mark {
  steps: number;
  isComplete: boolean;
}

/** What was last sent for each day, so an unchanged figure is never sent twice. */
export type Marks = Record<string, Mark>;

async function readMarks(userId: string | number): Promise<Marks> {
  try {
    const raw = await AsyncStorage.getItem(`${KEY_PREFIX}.${userId}`);
    return raw === null ? {} : (JSON.parse(raw) as Marks);
  } catch {
    // An unreadable mark file costs a duplicate write, which the server absorbs.
    return {};
  }
}

async function writeMarks(userId: string | number, marks: Marks): Promise<void> {
  const recent = Object.keys(marks)
    .sort()
    .slice(-MARK_LIMIT)
    .reduce<Marks>((kept, date) => ({ ...kept, [date]: marks[date] }), {});

  try {
    await AsyncStorage.setItem(`${KEY_PREFIX}.${userId}`, JSON.stringify(recent));
  } catch {
    // Same cost as above.
  }
}

/**
 * Which of the days in hand are worth sending.
 *
 * Pure, and separated from the sending for that reason: this is where a bug would be
 * silent. A missed write shows up as an empty chart, but a spurious one shows up as a
 * step goal derived from a number nobody walked.
 *
 * Four rules, in order of how much they cost when wrong:
 *
 *   A zero is never written. On Android it means the app saw nothing, and on iOS a day
 *   past the retention window reads as zero too — neither is evidence that a person did
 *   not move, and a stored zero would pull a median down as hard as a real rest day.
 *
 *   A partial figure never replaces a complete one. iOS falls back to the app's own
 *   buckets whenever the pedometer query fails, which would otherwise let a transient
 *   permission error overwrite the operating system's own answer for the day with the
 *   fraction this app happened to see.
 *
 *   A value that has not moved is not resent. The row would be identical.
 *
 *   A tick has to clear `minDelta`; every other reason does not. Boundaries are the
 *   moments a figure may never be improved on, so they send whatever they have.
 */
export function daysWorthSending(days: StepDay[], marks: Marks, minDelta: number): StepDay[] {
  return days.filter((day) => {
    if (day.steps <= 0) return false;

    const mark = marks[day.date];
    if (mark === undefined) return true;

    if (mark.isComplete && !day.isComplete) return false;

    // A count that has just become complete is worth sending at any size: the same
    // integer means something different now.
    if (day.isComplete && !mark.isComplete) return true;

    return day.steps !== mark.steps && Math.abs(day.steps - mark.steps) >= minDelta;
  });
}

/**
 * Everything this device can currently say about a day.
 *
 * Today always, from whichever source `summarise` found. Past days on iOS from the
 * pedometer's own history, which is the reason a first sync can fill a week rather than
 * starting a week's worth of history from scratch. Past days on Android only where the
 * app left buckets behind — a day that ended between two openings.
 *
 * Where both sources answer for the same date, history wins: it saw the whole day.
 */
async function collectDays(
  userId: string | number,
  now: number,
  withHistory: boolean,
): Promise<StepDay[]> {
  const byDate = new Map<string, StepDay>();

  for (const stored of await storedDayTotals(userId, now)) {
    byDate.set(stored.date, { date: stored.date, steps: stored.steps, isComplete: false });
  }

  if (withHistory) {
    for (let back = 1; back < HISTORY_DAYS; back += 1) {
      const date = new Date(now);
      date.setDate(date.getDate() - back);

      const steps = await observedStepsForDay(date);
      // Null is Android always, and iOS when the query is refused. Either way there is
      // no history to walk further back through.
      if (steps === null) break;

      byDate.set(todayIsoDate(date), { date: todayIsoDate(date), steps, isComplete: true });
    }
  }

  const today = await summarise(userId, now);
  byDate.set(todayIsoDate(new Date(now)), {
    date: todayIsoDate(new Date(now)),
    steps: today.today,
    isComplete: today.isComplete,
  });

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Concurrency guard, not an optimisation.
 *
 * Two screens mount `use-steps` at once and a returning app can fire a foreground sync
 * into a tick. Overlapping runs would read the same marks, both decide to write, and
 * double the requests; worse, the later write of the pair could be the older figure.
 */
let inFlight: Promise<void> | null = null;

export async function syncSteps(
  userId: string | number,
  reason: SyncReason,
  now = Date.now(),
): Promise<void> {
  if (inFlight !== null) return inFlight;

  inFlight = run(userId, reason, now).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

async function run(userId: string | number, reason: SyncReason, now: number): Promise<void> {
  // The history query is six round trips to the operating system, so it runs when there
  // is plausibly something new in it — an app that has just opened, or a day that has
  // just ended — and not on every tick.
  const days = await collectDays(userId, now, reason !== 'tick' && reason !== 'background');

  const marks = await readMarks(userId);
  const pending = daysWorthSending(days, marks, reason === 'tick' ? MIN_TICK_DELTA : 0);

  for (const day of pending) {
    const payload = {
      recorded_on: day.date,
      steps: day.steps,
      steps_are_complete: day.isComplete,
    };

    try {
      await recordHealthSnapshot(payload);
    } catch (error) {
      const offline = error instanceof ApiError && error.status === 0;
      const rejected = error instanceof ApiError && error.isValidation;

      if (offline) {
        // The queue is durable and the write is idempotent by day, so a replay lands on
        // the same row — and a later, larger figure for the same day supersedes this one
        // in the queue rather than queueing behind it.
        await enqueue({ kind: 'health-snapshot', body: payload });
      } else if (!rejected) {
        // A server that is up but unhappy is worth trying again later, so the day stays
        // unmarked. A payload it called invalid never will be, and leaving that unmarked
        // would retry it every six seconds for the rest of the day.
        continue;
      }
    }

    marks[day.date] = { steps: day.steps, isComplete: day.isComplete };
  }

  if (pending.length > 0) await writeMarks(userId, marks);
}
