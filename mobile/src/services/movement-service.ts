import { apiGet, apiPost } from '@/services/api-client';

/** Mirrors SessionIntensity in `@/ml/session-prescription` and the API's enum. */
export type PrescribedIntensity = 'full' | 'reduced' | 'mobility' | 'unknown';

export interface LogExerciseSessionInput {
  exercise: 'squat';
  total_reps: number;
  good_form_reps: number;
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
  performed_on: string;
  performed_at: string;
  total_reps: number;
  good_form_reps: number;
  duration_seconds: number;
  mean_heart_rate: number | null;
  prescribed_intensity: PrescribedIntensity;
  recovery_score: number | null;
}

export interface ExerciseHistory {
  sessions: ExerciseSessionEntry[];
  totalReps: number;
  goodFormReps: number;
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
    meta: { total_reps: number; good_form_reps: number };
  }>(date === undefined ? '/exercise-sessions' : `/exercise-sessions?date=${date}`);

  return {
    sessions: payload.data,
    totalReps: payload.meta.total_reps,
    goodFormReps: payload.meta.good_form_reps,
  };
}
