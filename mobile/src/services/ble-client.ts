import { Buffer } from 'buffer';
import { BleManager, type Device, type Subscription } from 'react-native-ble-plx';

import { isBiometrics } from '@/services/iot-payloads';
import type { BiometricsTelemetry, LightMode } from '@/types';

/**
 * The only file that imports the BLE library, mirroring how `mqtt-client.ts` isolates
 * MQTT. Everything above this speaks in readings and commands, not in characteristics.
 *
 * The UUIDs and payload shapes here are the firmware's, in `iot/auraflow-node/ble.cpp`.
 * Two of them are worth knowing about:
 *
 * - Heart rate is the **standard** Heart Rate Service, so a generic BLE heart-rate app
 *   reads this node too. That is the independent check that the values are right rather
 *   than merely self-consistent.
 * - The vitals characteristic emits the same JSON the MQTT telemetry topic does, so the
 *   guard that validates one validates the other. One parser, two transports.
 */

const SVC_HEART_RATE = '0000180d-0000-1000-8000-00805f9b34fb';
const CHR_HR_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';

const SVC_AURAFLOW = 'a17a0000-5f1e-4b2c-9d3a-6c8e21f0b100';
const CHR_VITALS = 'a17a0001-5f1e-4b2c-9d3a-6c8e21f0b100';
const CHR_LAMP = 'a17a0002-5f1e-4b2c-9d3a-6c8e21f0b100';

/**
 * The message every path below reports when the BLE native module is not in the build.
 *
 * Worth naming rather than inlining: it is the one BLE failure whose fix is a different
 * binary rather than a different radio state, so a caller that wants to special-case it
 * can compare against this instead of matching on the library's wording.
 */
export const BLE_UNAVAILABLE =
  'Bluetooth needs a development build — it is not available in Expo Go.';

/**
 * Created lazily. Constructing a BleManager turns the radio on, which is a rude thing to
 * do at import time on a screen that may never scan.
 *
 * It also throws outright when the native module is absent, which is what Expo Go gives
 * you. The library's own text there is about `pod install` and rebuilding — true for a
 * developer, useless to a user — so it is translated here.
 */
let manager: BleManager | null = null;

function bleManager(): BleManager {
  if (manager === null) {
    try {
      manager = new BleManager();
    } catch {
      throw new Error(BLE_UNAVAILABLE);
    }
  }

  return manager;
}

export interface DiscoveredPeripheral {
  id: string;
  name: string;
}

export interface BleConnection {
  deviceId: string;
  setLight: (mode: LightMode, brightness?: number) => Promise<void>;
  disconnect: () => Promise<void>;
}

export interface BleHandlers {
  /** Heart rate from the standard service, which notifies on every fresh reading. */
  onHeartRate?: (bpm: number) => void;
  /** The fuller picture — SpO2, contact quality — from the custom service. */
  onVitals?: (vitals: BiometricsTelemetry) => void;
  onDisconnect?: () => void;
  onError?: (message: string) => void;
}

/**
 * Standard Heart Rate Measurement: a flags byte, then the rate.
 *
 * Bit 0 of the flags says whether the rate is one byte or two. The firmware always sends
 * one, but a conformant parser is what makes the "any BLE app can read this" claim true
 * in both directions.
 */
function parseHeartRate(base64: string): number | null {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 2) return null;

  const isUint16 = (bytes[0] & 0x01) === 1;

  if (isUint16) {
    return bytes.length >= 3 ? bytes.readUInt16LE(1) : null;
  }

  return bytes[1];
}

/**
 * Scans for AuraFlow nodes.
 *
 * Filtered by the heart-rate service UUID rather than by name: a node whose name was
 * changed is still a node, and filtering in the radio rather than in JS keeps the phone
 * from waking for every nearby peripheral.
 *
 * @returns a function that stops the scan. Always call it — a scan left running is one of
 *   the fastest ways to flatten a battery.
 */
export function scan(
  onFound: (device: DiscoveredPeripheral) => void,
  onError?: (message: string) => void,
): () => void {
  const seen = new Set<string>();

  // Acquired up front, and deliberately not inside the teardown too. A missing native
  // module throws from the constructor — synchronously, before any scan exists — so it
  // would escape `onError` and reach the caller as an exception from a plain event
  // handler. Routing it here leaves callers with one failure path rather than a
  // try/catch around this call *and* an error callback.
  let radio: BleManager;
  try {
    radio = bleManager();
  } catch (error) {
    onError?.(error instanceof Error ? error.message : BLE_UNAVAILABLE);
    return () => {};
  }

  radio.startDeviceScan([SVC_HEART_RATE], { allowDuplicates: false }, (error, device) => {
    if (error !== null) {
      onError?.(error.message);
      return;
    }

    if (device === null || seen.has(device.id)) return;

    seen.add(device.id);
    onFound({ id: device.id, name: device.name ?? device.localName ?? 'Unnamed node' });
  });

  return () => radio.stopDeviceScan();
}

export async function connect(
  deviceId: string,
  handlers: BleHandlers = {},
): Promise<BleConnection> {
  bleManager().stopDeviceScan();

  let device: Device = await bleManager().connectToDevice(deviceId);
  device = await device.discoverAllServicesAndCharacteristics();

  const subscriptions: Subscription[] = [];

  subscriptions.push(
    device.monitorCharacteristicForService(
      SVC_HEART_RATE,
      CHR_HR_MEASUREMENT,
      (error, characteristic) => {
        if (error !== null || characteristic?.value == null) return;

        const bpm = parseHeartRate(characteristic.value);
        if (bpm !== null) handlers.onHeartRate?.(bpm);
      },
    ),
  );

  subscriptions.push(
    device.monitorCharacteristicForService(SVC_AURAFLOW, CHR_VITALS, (error, characteristic) => {
      if (error !== null || characteristic?.value == null) return;

      try {
        const parsed: unknown = JSON.parse(Buffer.from(characteristic.value, 'base64').toString());

        // Same guard the MQTT path uses. Anything off a radio is untrusted input.
        if (isBiometrics(parsed)) handlers.onVitals?.(parsed);
      } catch {
        // A malformed notification is a dropped reading, not a broken connection.
      }
    }),
  );

  subscriptions.push(
    bleManager().onDeviceDisconnected(deviceId, () => {
      subscriptions.forEach((s) => s.remove());
      handlers.onDisconnect?.();
    }),
  );

  return {
    deviceId,
    async setLight(mode: LightMode, brightness?: number) {
      // The same JSON the MQTT command topic accepts, so the app has one encoder rather
      // than one per transport.
      const payload = brightness === undefined ? { mode } : { mode, brightness };

      await device.writeCharacteristicWithResponseForService(
        SVC_AURAFLOW,
        CHR_LAMP,
        Buffer.from(JSON.stringify(payload)).toString('base64'),
      );
    },
    async disconnect() {
      subscriptions.forEach((s) => s.remove());
      try {
        await device.cancelConnection();
      } catch {
        // Already gone. Nothing to do, and nothing worth telling the user.
      }
    },
  };
}

/** Bluetooth can be off, unauthorised, or simply unsupported — three different fixes. */
export async function radioState(): Promise<'ready' | 'off' | 'unauthorised' | 'unsupported'> {
  try {
    const state = await bleManager().state();

    switch (state) {
      case 'PoweredOn':
        return 'ready';
      case 'PoweredOff':
        return 'off';
      case 'Unauthorized':
        return 'unauthorised';
      default:
        return 'unsupported';
    }
  } catch {
    // Unlinked rather than unavailable, but from a caller's point of view they are the
    // same answer: this build cannot talk to the radio, and no setting will change that.
    return 'unsupported';
  }
}
