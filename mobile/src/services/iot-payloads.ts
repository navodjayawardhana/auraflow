import type { BiometricsTelemetry, DeviceTelemetry, LightMode, LightState } from '@/types';

/**
 * Shape guards for everything arriving off the broker.
 *
 * These exist because the broker is public and unauthenticated: any client can publish
 * to these topics, so a frame is untrusted input rather than a message from our own
 * hardware. Anything that does not match is dropped.
 */

const LIGHT_MODES: LightMode[] = ['off', 'focus', 'break', 'sleep', 'alert'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLightMode(value: unknown): value is LightMode {
  return typeof value === 'string' && (LIGHT_MODES as string[]).includes(value);
}

export function isBiometrics(value: unknown): value is BiometricsTelemetry {
  if (!isRecord(value)) return false;

  if (typeof value.finger !== 'boolean') return false;
  if (!isFiniteNumber(value.ir_mean)) return false;
  if (typeof value.hr_valid !== 'boolean') return false;
  if (typeof value.spo2_valid !== 'boolean') return false;
  if (!isFiniteNumber(value.uptime_s)) return false;

  // Optional, but if present must be usable — a string "113" would render fine and then
  // poison any arithmetic downstream.
  if (value.hr_bpm !== undefined && !isFiniteNumber(value.hr_bpm)) return false;
  if (value.hr_bpm_maxim !== undefined && !isFiniteNumber(value.hr_bpm_maxim)) return false;
  if (value.spo2_pct !== undefined && !isFiniteNumber(value.spo2_pct)) return false;
  if (value.settled !== undefined && typeof value.settled !== 'boolean') return false;
  if (value.hr_maxim_valid !== undefined && typeof value.hr_maxim_valid !== 'boolean') {
    return false;
  }

  return true;
}

export function isDeviceTelemetry(value: unknown): value is DeviceTelemetry {
  if (!isRecord(value)) return false;

  if (value.sample_rate_hz !== undefined && !isFiniteNumber(value.sample_rate_hz)) {
    return false;
  }
  if (value.dropped_samples !== undefined && !isFiniteNumber(value.dropped_samples)) {
    return false;
  }

  return (
    isFiniteNumber(value.rssi) &&
    typeof value.ip === 'string' &&
    isFiniteNumber(value.uptime_s) &&
    isFiniteNumber(value.heap_free_b) &&
    isLightMode(value.light_mode) &&
    typeof value.pulse_sensor === 'boolean'
  );
}

export function isLightState(value: unknown): value is LightState {
  if (!isRecord(value)) return false;

  return (
    isLightMode(value.mode) &&
    isFiniteNumber(value.brightness) &&
    typeof value.source === 'string' &&
    isFiniteNumber(value.rssi) &&
    isFiniteNumber(value.uptime_s)
  );
}

/**
 * `settled` says the node had a full four-second window of unbroken contact.
 *
 * That matters to the two estimators that read the whole window at once: until it is
 * true, half their buffer is still no-finger data with a step edge through the middle,
 * and the rate they derive from it is plausible, wrong, and flagged valid. It does not
 * matter to `hr_bpm`, which is a streaming estimator gating every cycle on its own
 * perfusion band and reporting a median of recent intervals — its `hr_valid` already
 * means what a validity flag should.
 *
 * Absent means firmware older than the flag, which only published readings it already
 * considered final — so those frames are trusted rather than discarded.
 */
function isSettled(b: BiometricsTelemetry): boolean {
  return b.settled !== false;
}

export function usableHeartRate(b: BiometricsTelemetry | null): number | null {
  if (!b || !b.hr_valid || b.hr_bpm === undefined) return null;
  return b.hr_bpm;
}

/**
 * The reference algorithm's own answer, for the agreement analysis rather than the UI.
 * Quantised to roughly four-bpm steps at rest — see `hr_bpm_maxim`.
 */
export function usableHeartRateMaxim(b: BiometricsTelemetry | null): number | null {
  if (!b || b.hr_maxim_valid !== true || b.hr_bpm_maxim === undefined || !isSettled(b)) {
    return null;
  }
  return b.hr_bpm_maxim;
}

export function usableSpo2(b: BiometricsTelemetry | null): number | null {
  if (!b || !b.spo2_valid || b.spo2_pct === undefined || !isSettled(b)) return null;
  return b.spo2_pct;
}

/**
 * Contact made but nothing to show yet. Distinct from "no finger" and from "a reading" —
 * it is the state a UI should label "measuring…" rather than showing dashes.
 *
 * Keyed on the absence of a heart rate rather than on `settled` alone: the streaming
 * estimator often resolves before the window fills, and a card reading "measuring…" over
 * a live number would be describing the other two estimators, which is not what the
 * person holding their finger there is asking about.
 */
export function isSettling(b: BiometricsTelemetry | null): boolean {
  return b !== null && b.finger && usableHeartRate(b) === null;
}
