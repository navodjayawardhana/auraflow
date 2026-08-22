export interface User {
  id: number;
  name: string;
  email: string;
}

export interface AuthPayload {
  user: User;
  token: string;
}

export interface ApiEnvelope<T> {
  data: T;
}

/**
 * One night's raw signals. Every field but the date is nullable: a watch worn by day
 * but not overnight reports a resting heart rate with no sleep, and the recovery
 * score's components degrade independently by design.
 */
export interface HealthSnapshot {
  date: string;
  sleep_minutes: number | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  resting_heart_rate: number | null;
  steps: number | null;
  water_ml: number | null;
}

/**
 * Every field but the date is optional, and the server merges rather than replaces — so a
 * water tap sends only `water_ml` and cannot clear the night's sleep. Omitting a field
 * means "leave it alone", not "clear it".
 */
export interface RecordHealthSnapshotInput {
  recorded_on: string;
  sleep_minutes?: number;
  deep_sleep_minutes?: number;
  rem_sleep_minutes?: number;
  resting_heart_rate?: number;
  steps?: number;
  water_ml?: number;
}

// --- IoT node ---

export type LightMode = 'off' | 'focus' | 'break' | 'sleep' | 'alert';

/**
 * `hr_bpm` and `spo2_pct` are optional because the firmware omits them entirely when the
 * algorithm has not converged — the `*_valid` flags are the authority, not the presence
 * of the key.
 */
export interface BiometricsTelemetry {
  finger: boolean;
  ir_mean: number;
  hr_bpm?: number;
  spo2_pct?: number;
  hr_valid: boolean;
  spo2_valid: boolean;
  uptime_s: number;
}

export interface DeviceTelemetry {
  rssi: number;
  ip: string;
  uptime_s: number;
  heap_free_b: number;
  light_mode: LightMode;
  pulse_sensor: boolean;
  sensor_die_temp_c?: number;
}

export interface LightState {
  mode: LightMode;
  brightness: number;
  /** How the change happened — the physical button counts, so the UI must follow it. */
  source: 'mqtt' | 'button' | 'boot' | 'alert-expired';
  rssi: number;
  uptime_s: number;
}

export type IotStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/**
 * A node found on the broker. Discovered rather than configured: every node announces
 * itself on a retained status topic, so the app can list what is actually out there
 * instead of asking the user to type an identifier.
 */
export interface DiscoveredDevice {
  id: string;
  isOnline: boolean;
  lastSeenAt: number;
}

export type RecoveryReading =
  | {
      date: string;
      available: false;
      score: null;
      reason: string;
    }
  | {
      date: string;
      available: true;
      score: number;
      provisional: boolean;
      components_used: number;
      illness_warning: boolean;
    };
