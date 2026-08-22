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
  if (value.spo2_pct !== undefined && !isFiniteNumber(value.spo2_pct)) return false;

  return true;
}

export function isDeviceTelemetry(value: unknown): value is DeviceTelemetry {
  if (!isRecord(value)) return false;

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
 * A reading is only usable when the firmware says its algorithm converged. The keys can
 * be present on a frame the device itself considers invalid.
 */
export function usableHeartRate(b: BiometricsTelemetry | null): number | null {
  return b?.hr_valid && b.hr_bpm !== undefined ? b.hr_bpm : null;
}

export function usableSpo2(b: BiometricsTelemetry | null): number | null {
  return b?.spo2_valid && b.spo2_pct !== undefined ? b.spo2_pct : null;
}
