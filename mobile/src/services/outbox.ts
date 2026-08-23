import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError } from '@/services/api-client';
import { recordHealthSnapshot } from '@/services/health-snapshot-service';
import { logExerciseSession, type LogExerciseSessionInput } from '@/services/movement-service';
import { overridePlan } from '@/services/plan-service';
import { saveProfile } from '@/services/profile-service';
import type { PlanOverrideInput, RecordHealthSnapshotInput, UpdateProfileInput } from '@/types';

/**
 * A durable queue for writes made while offline.
 *
 * Every kind in here has to be safe to send twice, because the queue cannot tell a write
 * that failed from one whose response was lost. The four kinds earn that differently: a
 * health snapshot is idempotent per (user, date) on the server, an exercise session carries
 * a client-generated id the server dedupes on, a profile is a single row per user that a
 * replay overwrites with the same values, and a plan override carries both a client id and
 * a server-side no-op rule for a body that matches what is already current. Nothing may be
 * added to this queue that lacks one of those properties.
 */

const KEY = 'auraflow.outbox.v2';

/** v1 held bare snapshot payloads. Read once, on the first flush after an update. */
const LEGACY_KEY = 'auraflow.outbox.v1';

export type QueuedPayload =
  | { kind: 'health-snapshot'; body: RecordHealthSnapshotInput }
  | { kind: 'exercise-session'; body: LogExerciseSessionInput }
  | { kind: 'profile'; body: UpdateProfileInput }
  | { kind: 'plan-override'; body: PlanOverrideInput };

interface QueuedWrite {
  id: string;
  createdAt: string;
  payload: QueuedPayload;
}

/**
 * Pulls anything left in the v1 queue into the current shape.
 *
 * Dropping it instead would silently lose the nights someone logged offline immediately
 * before updating — the one thing this whole module exists to prevent.
 */
async function drainLegacy(): Promise<QueuedWrite[]> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_KEY);
    if (raw === null) return [];

    const legacy = JSON.parse(raw) as {
      id: string;
      createdAt: string;
      payload: RecordHealthSnapshotInput;
    }[];

    await AsyncStorage.removeItem(LEGACY_KEY);

    return legacy.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      payload: { kind: 'health-snapshot', body: entry.payload },
    }));
  } catch {
    return [];
  }
}

async function readQueue(): Promise<QueuedWrite[]> {
  let current: QueuedWrite[] = [];

  try {
    const raw = await AsyncStorage.getItem(KEY);
    current = raw === null ? [] : (JSON.parse(raw) as QueuedWrite[]);
  } catch {
    current = [];
  }

  const legacy = await drainLegacy();
  if (legacy.length === 0) return current;

  const merged = [...legacy, ...current];
  await writeQueue(merged);

  return merged;
}

async function writeQueue(queue: QueuedWrite[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Nothing useful to do — the caller already knows whether the network write worked.
  }
}

/**
 * One write absorbing another, where replaying both would be wrong.
 *
 * Snapshots absorb per date, and by field rather than wholesale. Every writer of a day
 * sends only what it knows — a night from the log screen, a running water total, a step
 * count from the sync — and the endpoint merges them for exactly that reason. Dropping
 * the earlier entry would therefore lose a night the moment a glass of water or a walk
 * was recorded for the same date offline, which with a step count arriving every few
 * hundred steps is not a corner case. Later fields win; untouched ones survive.
 *
 * Profiles absorb outright — the form submits every field it manages, so the last edit
 * made offline is the whole answer and sending the earlier one first would only make the
 * server derive a plan nobody asked for.
 *
 * Sessions never absorb — two sets before lunch are two sessions — and their client id
 * is what keeps a *replay* from becoming a third. Plan overrides do not either, and for a
 * subtler reason: each one is a diff against the plan the device is still showing, so two
 * edits made offline touch fields that are not necessarily the same ones. Keeping only
 * the later would silently drop the earlier field.
 */
function absorbed(existing: QueuedPayload, incoming: QueuedPayload): QueuedPayload | null {
  if (existing.kind === 'profile' && incoming.kind === 'profile') return incoming;

  if (
    existing.kind === 'health-snapshot' &&
    incoming.kind === 'health-snapshot' &&
    existing.body.recorded_on === incoming.body.recorded_on
  ) {
    return { kind: 'health-snapshot', body: { ...existing.body, ...incoming.body } };
  }

  return null;
}

export async function enqueue(payload: QueuedPayload): Promise<void> {
  const queue = await readQueue();

  // In place, keeping the entry's position. A write that has been waiting since this
  // morning is still this morning's write; moving it to the back would let a later
  // exercise session overtake it for no reason.
  for (const entry of queue) {
    const merged = absorbed(entry.payload, payload);

    if (merged !== null) {
      entry.payload = merged;
      await writeQueue(queue);

      return;
    }
  }

  queue.push({
    id: `${payload.kind}-${Date.now()}-${queue.length}`,
    createdAt: new Date().toISOString(),
    payload,
  });

  await writeQueue(queue);
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

export interface FlushResult {
  sent: number;
  dropped: number;
  remaining: number;
}

function send(payload: QueuedPayload): Promise<unknown> {
  switch (payload.kind) {
    case 'health-snapshot':
      return recordHealthSnapshot(payload.body);
    case 'exercise-session':
      return logExerciseSession(payload.body);
    case 'profile':
      return saveProfile(payload.body);
    case 'plan-override':
      return overridePlan(payload.body);
  }
}

/**
 * Attempts every queued write once.
 *
 * A 2xx clears the entry, and so does a 422: a payload the server calls invalid will be
 * invalid on every retry, so keeping it would mean a queue that never drains. Anything
 * else — a network failure, a 5xx — leaves the entry for the next flush.
 */
export async function flush(): Promise<FlushResult> {
  const queue = await readQueue();
  if (queue.length === 0) {
    return { sent: 0, dropped: 0, remaining: 0 };
  }

  const remaining: QueuedWrite[] = [];
  let sent = 0;
  let dropped = 0;

  for (const entry of queue) {
    try {
      await send(entry.payload);
      sent += 1;
    } catch (error) {
      if (error instanceof ApiError && error.isValidation) {
        dropped += 1;
        continue;
      }
      remaining.push(entry);
    }
  }

  await writeQueue(remaining);

  return { sent, dropped, remaining: remaining.length };
}

export async function clearOutbox(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEY, LEGACY_KEY]);
  } catch {
    // Best effort.
  }
}
