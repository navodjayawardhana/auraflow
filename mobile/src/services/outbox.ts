import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError } from '@/services/api-client';
import { recordHealthSnapshot } from '@/services/health-snapshot-service';
import { logExerciseSession, type LogExerciseSessionInput } from '@/services/movement-service';
import type { RecordHealthSnapshotInput } from '@/types';

/**
 * A durable queue for writes made while offline.
 *
 * Every kind in here has to be safe to send twice, because the queue cannot tell a write
 * that failed from one whose response was lost. The two kinds earn that differently: a
 * health snapshot is idempotent per (user, date) on the server, and an exercise session
 * carries a client-generated id the server dedupes on. Nothing may be added to this queue
 * that lacks one of those properties.
 */

const KEY = 'auraflow.outbox.v2';

/** v1 held bare snapshot payloads. Read once, on the first flush after an update. */
const LEGACY_KEY = 'auraflow.outbox.v1';

export type QueuedPayload =
  | { kind: 'health-snapshot'; body: RecordHealthSnapshotInput }
  | { kind: 'exercise-session'; body: LogExerciseSessionInput };

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
 * Two entries are the same write only when replaying both would be wrong.
 *
 * Snapshots collapse per date: logging the same night twice offline should send the later
 * figures, not two conflicting writes. Sessions never collapse — two sets before lunch are
 * two sessions — and their client id is what keeps a *replay* from becoming a third.
 */
function isSupersededBy(existing: QueuedPayload, incoming: QueuedPayload): boolean {
  return (
    existing.kind === 'health-snapshot' &&
    incoming.kind === 'health-snapshot' &&
    existing.body.recorded_on === incoming.body.recorded_on
  );
}

export async function enqueue(payload: QueuedPayload): Promise<void> {
  const queue = await readQueue();

  const kept = queue.filter((q) => !isSupersededBy(q.payload, payload));

  kept.push({
    id: `${payload.kind}-${Date.now()}-${kept.length}`,
    createdAt: new Date().toISOString(),
    payload,
  });

  await writeQueue(kept);
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
