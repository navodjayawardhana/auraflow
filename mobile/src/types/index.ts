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
 * overweight threshold several points below the European one, so the scale is stored on
 * the profile rather than chosen per device — the same body must not read healthy on a
 * phone and overweight on a tablet. The server defaults it to `who_asian`.
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
  /** The band on `bmi_scale`. `bmi_bands` carries every scale's reading of the same value. */
  bmi_band: BmiBand | null;
  bmi_scale: BmiScale;
  bmi_bands: Record<BmiScale, BmiBand> | null;
  updated_at: string;
}

/**
 * Every field optional, and the difference between absent and null is load-bearing: the
 * server merges on the keys present, leaves absent ones alone, and clears explicit nulls.
 * Clearing `sex` returns `unspecified` rather than null.
 */
export interface UpdateProfileInput {
  date_of_birth?: string | null;
  sex?: Sex | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  activity_level?: ActivityLevel | null;
  bmi_scale?: BmiScale;
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
/** `user_edited` displaces the formula the moment someone types over the number. */
export type StepGoalSource = 'measured_7d' | 'population_default' | 'user_edited';

/**
 * `mass_only` is Holliday–Segar scaled by body mass; `sex_reference_intake` is the EFSA
 * adult figure for a known sex. There is no climate term — the server declined to invent
 * a per-degree coefficient no source publishes.
 */
export type WaterSource =
  | 'mass_only'
  | 'sex_reference_intake'
  | 'population_default'
  | 'user_edited';

export type SleepNeedSource = 'age_band' | 'population_default' | 'user_edited';

export interface PlanBasis {
  bmr_kcal: number | null;
  tdee_kcal: number | null;
  bmr_formula: 'mifflin_st_jeor' | null;
  max_hr_formula: 'tanaka' | null;
  hr_zone_formula: 'karvonen' | null;
  /** Reported even with no BMR to multiply — it is a fact about what the user answered. */
  activity_factor: number | null;
  max_hr_bpm: number | null;
  resting_hr_bpm: number | null;
  resting_hr_source: 'measured_14d' | 'population_default' | null;
  step_goal_source: StepGoalSource;
  water_source: WaterSource;
  sleep_need_source: SleepNeedSource;
  /** The NSF band as published. The single figure above it is our midpoint of this. */
  sleep_need_range: [number, number] | null;
  /** Profile fields the plan wanted and did not have, e.g. `["date_of_birth"]`. */
  missing: string[];
}

/**
 * One version of the targets. Immutable server-side: an override produces the next plan
 * rather than changing this one, which is what makes the history readable.
 *
 * Two figures are nullable, and they are the two that would be health advice if they were
 * guessed: an energy target needs age, sex, height and mass, and a heart-rate zone needs an
 * age. There is no population substitute for either that is not a fabricated person, so the
 * server sends null and names the gap in `basis.missing`.
 */
export interface Plan {
  version: number;
  /** `edited` from the moment the user overrides any single field, and sticky after that. */
  source: 'derived' | 'edited';
  step_goal: number;
  water_ml: number;
  active_kcal_goal: number | null;
  sleep_need_hours: number;
  hr_zones: HeartRateZones | null;
  basis: PlanBasis;
  /** Which fields the user set by hand in *this* version. Present on every plan. */
  edited_fields: string[];
  created_at: string;
}

/** The four goals the server will accept by hand. Heart-rate zones are not among them. */
export const OVERRIDABLE_FIELDS = [
  'step_goal',
  'water_ml',
  'active_kcal_goal',
  'sleep_need_hours',
] as const;

export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

/**
 * Only what the user actually changed — the server keeps deriving the rest, and records
 * the difference as `edited_fields`.
 */
export type PlanOverrideInput = Partial<Record<OverridableField, number>> & {
  /**
   * This device's id for the edit. With it, a replay from the outbox returns the version
   * the key already produced instead of minting a second one.
   */
  client_uuid?: string;
};

export interface LastKnownScore {
  date: string;
  score: number;
  provisional: boolean;
}

export type RecoveryReading =
  | {
      date: string;
      available: false;
      score: null;
      reason: string;
      /**
       * The most recent day that could be scored, or null when nothing in the last
       * fortnight could. Never rendered without its date — it describes that night, not
       * this one.
       */
      last_known: LastKnownScore | null;
    }
  | {
      date: string;
      available: true;
      score: number;
      provisional: boolean;
      components_used: number;
      illness_warning: boolean;
    };
