import { useCallback, useEffect, useRef, useState } from 'react';

import { useIot } from '@/context/iot-context';
import { connect, scan, type BleConnection, type DiscoveredPeripheral } from '@/services/ble-client';
import { usableHeartRate, usableSpo2 } from '@/services/iot-payloads';
import type { LightMode } from '@/types';

/**
 * One live reading from the node, whichever way it arrived.
 *
 * The app has two paths to the same hardware and they answer different questions — BLE
 * works in a basement at watch-like latency, MQTT works from anywhere. Screens should not
 * have to know which won, so this hook exposes a single number plus the `source` that
 * produced it, and prefers BLE whenever a BLE link is live. See docs/adr/0007.
 */

/**
 * How long BLE stays "the source" after its last notification before MQTT is allowed to
 * take over.
 *
 * A link at the edge of range connects and drops repeatedly. Without this hold-off the
 * displayed number would flip between two transports reporting the same heart a second
 * apart, which reads as a broken sensor rather than a weak link. Longer than the node's
 * 1.5 s publish interval, shorter than the MQTT staleness window.
 */
const BLE_HOLD_OFF_MS = 6_000;

export type VitalsSource = 'ble' | 'mqtt' | null;

export type BleStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface LiveVitals {
  heartRate: number | null;
  spo2: number | null;
  /** Exposed, not hidden: "no reading" has a different fix per transport. */
  source: VitalsSource;

  bleStatus: BleStatus;
  bleError: string | null;
  nearby: DiscoveredPeripheral[];
  startScan: () => void;
  stopScan: () => void;
  connectTo: (deviceId: string) => Promise<void>;
  disconnectBle: () => Promise<void>;

  /** Goes over BLE when connected, MQTT otherwise. Callers never choose. */
  setLight: (mode: LightMode, brightness?: number) => void;
}

export function useLiveVitals(): LiveVitals {
  const iot = useIot();

  const [bleStatus, setBleStatus] = useState<BleStatus>('idle');
  const [bleError, setBleError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<DiscoveredPeripheral[]>([]);

  const [bleHeartRate, setBleHeartRate] = useState<number | null>(null);
  const [bleSpo2, setBleSpo2] = useState<number | null>(null);
  const [bleLastAt, setBleLastAt] = useState<number | null>(null);

  const connection = useRef<BleConnection | null>(null);
  const stopScanRef = useRef<(() => void) | null>(null);

  // Recomputed on a timer rather than only on notification, so the source falls back
  // when BLE goes quiet rather than only when it explicitly disconnects.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      stopScanRef.current?.();
      connection.current?.disconnect();
    };
  }, []);

  const startScan = useCallback(() => {
    setBleError(null);
    setNearby([]);
    setBleStatus('scanning');

    stopScanRef.current = scan(
      (device) => setNearby((found) => (found.some((d) => d.id === device.id) ? found : [...found, device])),
      (message) => {
        setBleError(message);
        setBleStatus('error');
      },
    );
  }, []);

  const stopScan = useCallback(() => {
    stopScanRef.current?.();
    stopScanRef.current = null;
    setBleStatus((s) => (s === 'scanning' ? 'idle' : s));
  }, []);

  const connectTo = useCallback(
    async (deviceId: string) => {
      stopScan();
      setBleStatus('connecting');
      setBleError(null);

      try {
        connection.current = await connect(deviceId, {
          onHeartRate: (bpm) => {
            setBleHeartRate(bpm);
            setBleLastAt(Date.now());
          },
          onVitals: (vitals) => {
            // The validity flags stay the authority, exactly as on the MQTT path.
            setBleSpo2(usableSpo2(vitals));
            setBleLastAt(Date.now());
          },
          onDisconnect: () => {
            connection.current = null;
            setBleStatus('idle');
            setBleHeartRate(null);
            setBleSpo2(null);
          },
        });

        setBleStatus('connected');
      } catch (error) {
        setBleError(error instanceof Error ? error.message : 'Could not connect.');
        setBleStatus('error');
      }
    },
    [stopScan],
  );

  const disconnectBle = useCallback(async () => {
    await connection.current?.disconnect();
    connection.current = null;
    setBleStatus('idle');
    setBleHeartRate(null);
    setBleSpo2(null);
    setBleLastAt(null);
  }, []);

  const setLight = useCallback(
    (mode: LightMode, brightness?: number) => {
      if (connection.current !== null) {
        // Fire and forget, matching the MQTT path's shape. A failed write surfaces as the
        // lamp not changing, which is the same feedback either way.
        connection.current.setLight(mode, brightness).catch(() => setBleError('Lamp write failed.'));
        return;
      }

      iot.setLight(mode, brightness);
    },
    [iot],
  );

  const isBleFresh = bleLastAt !== null && now - bleLastAt < BLE_HOLD_OFF_MS;
  const isBleLive = bleStatus === 'connected' && isBleFresh && bleHeartRate !== null;

  const mqttHeartRate = iot.isBiometricsStale ? null : usableHeartRate(iot.biometrics);
  const mqttSpo2 = iot.isBiometricsStale ? null : usableSpo2(iot.biometrics);

  const heartRate = isBleLive ? bleHeartRate : mqttHeartRate;
  const spo2 = isBleLive ? bleSpo2 : mqttSpo2;

  return {
    heartRate,
    spo2,
    source: heartRate === null ? null : isBleLive ? 'ble' : 'mqtt',
    bleStatus,
    bleError,
    nearby,
    startScan,
    stopScan,
    connectTo,
    disconnectBle,
    setLight,
  };
}
