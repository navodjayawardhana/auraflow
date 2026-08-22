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

  /**
   * Contact has been unbroken for a whole four-second analysis window.
   *
   * It qualifies `hr_bpm_maxim` and `spo2_pct` only. Those read the whole window at once,
   * and until this is true half of it is still no-finger samples — a rate derived from
   * that step is an artefact, and it arrives flagged valid. `hr_bpm` is streaming and
   * carries its own gates, so it is trustworthy before this turns true and usually
   * resolves first.
   *
   * Optional because a node on older firmware does not send it. Absent is not false:
   * treat a frame without it as settled, since that firmware only ever published
   * readings it already considered final.
   */
  settled?: boolean;

  ir_mean: number;

  /**
   * Heart rate in bpm, from beat-interval timing. Fractional, and the one to display.
   */
  hr_bpm?: number;

  /**
   * The same heartbeat measured by Maxim's reference algorithm, which quantises to
   * roughly four-bpm steps at rest. Published alongside rather than instead so the
   * evaluation can measure the two against each other as well as against the watch —
   * not for display.
   */
  hr_bpm_maxim?: number;

  spo2_pct?: number;
  hr_valid: boolean;
  hr_maxim_valid?: boolean;
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

  /**
   * The node's measured effective sample rate, against a nominal 25 Hz. Drift is the
   * first visible sign that its loop is falling behind the sensor.
   */
  sample_rate_hz?: number;

  /** Samples lost to that, cumulative since the node booted. */
  dropped_samples?: number;
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

// --- Profile, and the plan derived from it ---

export type Sex = 'female' | 'male' | 'unspecified';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

/**
 * Which cut-offs a BMI is read against. WHO's 2004 consultation put the South Asian
 * overweight threshold several points below the European one, so the scale is part of the
 * profile rather than a global constant — the same 24.0 means different things by it.
 */
export type BmiScale = 'who_standard' | 'who_asian';
export type BmiBand = 'underweight' | 'healthy' | 'overweight' | 'obese';

/**
 * Everything the plan is derived from. Every field is nullable and none is required to use
 * the app: an empty profile is a normal profile, and the plan degrades rather than refusing.
 */
export interface Profile {
  date_of_birth: string | null;
  sex: Sex;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: ActivityLevel;
  /** Derived server-side and read-only. Null when height or weight is missing. */
  bmi: number | null;
  bmi_band: BmiBand | null;
  bmi_scale: BmiScale;
  updated_at: string;
}

/** Every field optional — a partial save is the ordinary case, not an edge one. */
export interface UpdateProfileInput {
  date_of_birth?: string | null;
  sex?: Sex;
  height_cm?: number | null;
  weight_kg?: number | null;
  activity_level?: ActivityLevel;
}

/** Inclusive bpm bounds. A tuple in the contract, kept as one here. */
export type HeartRateZone = [number, number];

export interface HeartRateZones {
  easy: HeartRateZone;
  moderate: HeartRateZone;
  hard: HeartRateZone;
}

/**
 * Why each target is the number it is.
 *
 * Rendered, not logged. A daily goal the user cannot trace back to a published formula is
 * health advice with no author, which is the one thing this project will not ship.
 */
export interface PlanBasis {
  bmr_kcal: number | null;
  tdee_kcal: number | null;
  bmr_formula: 'mifflin_st_jeor' | null;
  max_hr_formula: 'tanaka' | null;
  hr_zone_formula: 'karvonen' | null;
  resting_hr_bpm: number | null;
  resting_hr_source: 'measured_14d' | 'population_default' | null;
  step_goal_source: 'measured_7d' | 'population_default';
  water_source: 'mass_and_climate' | 'population_default';
  /** Profile fields the plan wanted and did not have, e.g. `["date_of_birth"]`. */
  missing: string[];
}

export interface Plan {
  version: number;
  /** `edited` from the moment the user overrides any single field. */
  source: 'derived' | 'edited';
  step_goal: number;
  water_ml: number;
  active_kcal_goal: number;
  sleep_need_hours: number;
  hr_zones: HeartRateZones;
  basis: PlanBasis;
  created_at: string;
}

export interface PlanVersion extends Plan {
  /** Which fields the user set by hand in this version. */
  edited_fields: string[];
}

/** Only what the user actually changed — the server keeps deriving the rest. */
export interface PlanOverrideInput {
  step_goal?: number;
  water_ml?: number;
  active_kcal_goal?: number;
  sleep_need_hours?: number;
  hr_zones?: HeartRateZones;
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
