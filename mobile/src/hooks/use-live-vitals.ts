import { useCallback } from 'react';

import { useBle } from '@/context/ble-context';
import { useIot } from '@/context/iot-context';
import { usableHeartRate, usableSpo2 } from '@/services/iot-payloads';
import { mergeVitals, type VitalsSource } from '@/services/vitals-merge';
import type { BiometricsTelemetry, LightMode } from '@/types';

/**
 * One live reading from the node, whichever way it arrived.
 *
 * The app has two paths to the same hardware and they answer different questions — BLE
 * works in a basement at watch-like latency, MQTT works from anywhere. Screens should not
 * have to know which won, so this exposes a single frame plus the `source` that produced
 * it, preferring BLE whenever BLE has something current. See docs/adr/0007.
 *
 * Deliberately owns nothing. Both connections live in providers mounted once, and every
 * value below is derived from them, so calling this from five screens costs five
 * subscriptions to state that already exists rather than five links to the node. That is
 * the whole reason the merge is a hook and the transports are not.
 */

export type { VitalsSource };

/** The lamp as the live transport reports it. `source` is MQTT-only — see below. */
export interface LiveLamp {
  mode: LightMode;
  brightness: number;
  /**
   * Who last changed it, where that is known. Null over BLE: the characteristic carries
   * the lamp's state and not its provenance, and inventing "app" for it would be a claim
   * rather than a reading — the physical button changes the lamp too.
   */
  source: string | null;
}

export interface LiveVitals {
  /**
   * The winning transport's latest frame, stale or not. Whole, rather than reduced to two
   * numbers, because the card built on it needs contact quality and beat progress as much
   * as it needs a rate — and those have to come from the same frame as the rate, not from
   * whichever transport happens to be holding them.
   */
  frame: BiometricsTelemetry | null;
  /** Exposed, not hidden: "no reading" has a different fix per transport. */
  source: VitalsSource;
  /** `frame` is too old to present as current. The number below is already null when so. */
  isStale: boolean;

  /** The rate to show, or null. Already accounts for staleness and the validity flags. */
  heartRate: number | null;
  spo2: number | null;

  /** The node is answering over at least one transport. */
  isNodeReachable: boolean;
  /** Nothing is reachable yet, but a transport is still trying. Not the same as offline. */
  isConnecting: boolean;
  /** A node is paired at all, over either transport. */
  hasNode: boolean;

  lamp: LiveLamp | null;
  /** Goes over BLE when a link is up, MQTT otherwise. Callers never choose. */
  setLight: (mode: LightMode, brightness?: number) => void;
}

export function useLiveVitals(): LiveVitals {
  const iot = useIot();
  const ble = useBle();

  // Recomputed rather than memoised: it is a handful of comparisons, and both providers
  // hand out a fresh context value on every render anyway, so a memo here would miss every
  // time while implying it did not.
  const merged = mergeVitals(
    ble.vitals,
    { frame: iot.biometrics, receivedAt: iot.biometricsAt },
    ble.now,
  );

  // Pulled out of the context objects so this closes over two stable functions rather than
  // over two values that are new on every render. The movement session passes its lamp
  // callback into an effect's dependencies, and a `setLight` with a fresh identity each
  // render would restart that effect on every frame of a reading.
  const { setLight: writeOverBle } = ble;
  const { setLight: publishOverMqtt } = iot;

  const setLight = useCallback(
    (mode: LightMode, brightness?: number) => {
      // Asked rather than inferred from `isConnected`: the link can drop between a render
      // and a thumb, and the provider is the only thing that knows whether the write went
      // anywhere. A false answer means fall back, not fail.
      if (writeOverBle(mode, brightness)) return;

      publishOverMqtt(mode, brightness);
    },
    [writeOverBle, publishOverMqtt],
  );

  const lamp: LiveLamp | null =
    ble.isConnected && ble.lamp !== null
      ? { mode: ble.lamp.mode, brightness: ble.lamp.brightness, source: null }
      : iot.light !== null
        ? { mode: iot.light.mode, brightness: iot.light.brightness, source: iot.light.source }
        : null;

  const isNodeReachable = ble.isConnected || iot.isDeviceOnline;

  return {
    frame: merged.frame,
    source: merged.source,
    isStale: merged.isStale,

    heartRate: merged.isStale ? null : usableHeartRate(merged.frame),
    spo2: merged.isStale ? null : usableSpo2(merged.frame),

    isNodeReachable,
    isConnecting:
      !isNodeReachable &&
      (iot.status === 'connecting' ||
        ble.status === 'connecting' ||
        ble.status === 'reconnecting'),
    hasNode: iot.selectedDeviceId !== null || ble.connectedId !== null,

    lamp,
    setLight,
  };
}
