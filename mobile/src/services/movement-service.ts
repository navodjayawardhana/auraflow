import { apiGet, apiPost } from '@/services/api-client';
import type { GuidedExerciseId } from '@/services/guided-routine';

/**
 * Squat is the only thing the pose counter reads; the march exists only as something the
 * guided figure can demonstrate, which the API enforces rather than trusts.
 */
export type ExerciseId = GuidedExerciseId;

/** Mirrors SessionIntensity in `@/ml/session-prescription` and the API's enum. */
export type PrescribedIntensity = 'full' | 'reduced' | 'mobility' | 'unknown';

/** Mirrors ExerciseSession::SOURCE_* on the API. */
export type SessionSource = 'pose' | 'guided';

export interface LogExerciseSessionInput {
  exercise: ExerciseId;
  /**
   * Whether the reps were observed or assumed. The camera counts each one and grades its
   * depth; the guided figure keeps a tempo and trusts the user kept up. Two different
   * claims, so the record says which it is holding.
   */
  source: SessionSource;
  total_reps: number;
  /** Null for a guided session -- nothing watched the form, so there is nothing to report. */
  good_form_reps: number | null;
  duration_seconds: number;
  /** Null whenever the node was not connected, which is most sessions. Never 0. */
  mean_heart_rate: number | null;
  prescribed_intensity: PrescribedIntensity;
  /** Null only when the intensity is `unknown` — the two travel together. */
  recovery_score: number | null;
  /**
   * This device's own id for the session, so a write replayed from the outbox lands once.
   * Unlike a night's sleep there is no natural key here: two identical sets in one morning
   * are genuinely two sessions, so only the client can tell a replay from a repeat.
   */
  client_uuid: string;
  performed_at?: string;
}

export interface ExerciseSessionEntry {
  id: number;
  exercise: string;
  source: SessionSource;
  performed_on: string;
  performed_at: string;
  total_reps: number;
  good_form_reps: number | null;
  duration_seconds: number;
  mean_heart_rate: number | null;
  prescribed_intensity: PrescribedIntensity;
  recovery_score: number | null;
}

/**
 * Kept apart rather than added up.
 *
 * One number covering both would read as "you did this many reps and we watched them",
 * which is only true of the counted half. The screens that show a total show two.
 */
export interface ExerciseHistory {
  sessions: ExerciseSessionEntry[];
  counted: { sessions: number; totalReps: number; goodFormReps: number };
  guided: { sessions: number; totalReps: number };
}

/**
 * No crypto.randomUUID in Hermes, and a real UUID is more than this needs: the id only
 * has to be unique within one account, and the server treats it as opaque.
 */
export function newSessionId(): string {
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function logExerciseSession(
  input: LogExerciseSessionInput,
): Promise<ExerciseSessionEntry> {
  const payload = await apiPost<{ data: ExerciseSessionEntry }>('/exercise-sessions', input);

  return payload.data;
}

export async function fetchExerciseHistory(date?: string): Promise<ExerciseHistory> {
  const payload = await apiGet<{
    data: ExerciseSessionEntry[];
    meta: {
      counted: { sessions: number; total_reps: number; good_form_reps: number };
      guided: { sessions: number; total_reps: number };
    };
  }>(date === undefined ? '/exercise-sessions' : `/exercise-sessions?date=${date}`);

  return {
    sessions: payload.data,
    counted: {
      sessions: payload.meta.counted.sessions,
      totalReps: payload.meta.counted.total_reps,
      goodFormReps: payload.meta.counted.good_form_reps,
    },
    guided: {
      sessions: payload.meta.guided.sessions,
      totalReps: payload.meta.guided.total_reps,
    },
  };
}
