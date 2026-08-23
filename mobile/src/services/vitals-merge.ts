import { STALE_AFTER_MS } from '@/config/iot';
import type { BiometricsTelemetry } from '@/types';

/**
 * Which of the two transports gets to be "the reading", given what each last delivered.
 *
 * Pure on purpose. The rule it encodes is the one place where a flapping Bluetooth link
 * turns into a flickering number on a health dashboard, and that is not something to work
 * out by holding a phone at the edge of range — see `__tests__/vitals-merge.test.ts` and
 * docs/adr/0007.
 */

/**
 * How long BLE stays the preferred transport after its last frame, before MQTT is allowed
 * to take over.
 *
 * A link at the edge of range connects and drops repeatedly. Without this the displayed
 * number would flip between two transports reporting the same heart a moment apart, which
 * reads as a broken sensor rather than a weak link. Longer than the node's 1.5 s publish
 * interval so an ordinary gap of a frame or two changes nothing.
 *
 * It has to stay *under* `STALE_AFTER_MS`, and that bound is the load-bearing half: past
 * the staleness window the held frame is no longer current, so a longer hold-off would be
 * insisting on a transport that has nothing true left to say while a live one waits.
 */
export const BLE_HOLD_OFF_MS = 4_000;

export type VitalsSource = 'ble' | 'mqtt' | null;

/** What one transport last handed over. `receivedAt` is epoch ms, null when never. */
export interface TransportFrame {
  frame: BiometricsTelemetry | null;
  receivedAt: number | null;
}

export interface MergedVitals {
  frame: BiometricsTelemetry | null;
  source: VitalsSource;
  /** True when `frame` is too old to present as current. Never true while `frame` is null. */
  isStale: boolean;
}

const NEVER = Number.POSITIVE_INFINITY;

function ageOf(transport: TransportFrame, now: number): number {
  return transport.receivedAt === null ? NEVER : now - transport.receivedAt;
}

export function mergeVitals(
  ble: TransportFrame,
  mqtt: TransportFrame,
  now: number,
): MergedVitals {
  const bleAge = ageOf(ble, now);
  const mqttAge = ageOf(mqtt, now);

  // Preference is decided before staleness, and only then is the winner aged. Doing it the
  // other way round — picking whichever frame is freshest — would hand the choice back to
  // whichever transport happened to publish last, which is exactly the coin-flip the
  // hold-off exists to prevent.
  const prefersBle = ble.frame !== null && bleAge < BLE_HOLD_OFF_MS;

  if (prefersBle) {
    return { frame: ble.frame, source: 'ble', isStale: bleAge >= STALE_AFTER_MS };
  }

  if (mqtt.frame !== null) {
    return { frame: mqtt.frame, source: 'mqtt', isStale: mqttAge >= STALE_AFTER_MS };
  }

  // BLE past its hold-off with no MQTT frame to fall back to. Kept rather than blanked:
  // the card needs a frame to say whether a finger is even on the pad, and `isStale` is
  // what stops the number inside it being read as current.
  if (ble.frame !== null) {
    return { frame: ble.frame, source: 'ble', isStale: bleAge >= STALE_AFTER_MS };
  }

  return { frame: null, source: null, isStale: false };
}
