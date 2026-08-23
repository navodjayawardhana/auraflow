import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  DEFAULT_DEVICE_ID,
  DISCOVERY_TOPIC,
  deviceIdFromStatusTopic,
  STALE_AFTER_MS,
  topicsFor,
} from '@/config/iot';
import { isBiometrics, isDeviceTelemetry, isLightState } from '@/services/iot-payloads';
import { connect, parseJson, type MqttConnection } from '@/services/mqtt-client';
import type {
  BiometricsTelemetry,
  DeviceTelemetry,
  DiscoveredDevice,
  IotStatus,
  LightMode,
  LightState,
} from '@/types';

const SELECTED_DEVICE_KEY = 'auraflow.iot.selectedDevice';

/** One publish per this window, so a chip mashed repeatedly cannot flood the broker. */
const PUBLISH_THROTTLE_MS = 300;

interface IotContextValue {
  status: IotStatus;
  /** Every node currently announcing itself on the broker. */
  discovered: DiscoveredDevice[];
  selectedDeviceId: string | null;
  selectDevice: (deviceId: string) => Promise<void>;
  forgetDevice: () => Promise<void>;

  isDeviceOnline: boolean;
  biometrics: BiometricsTelemetry | null;
  /**
   * When the frame above arrived, epoch ms. Published alongside it because the BLE/MQTT
   * merge has to age both transports against one clock, and `isBiometricsStale` is an
   * answer to a different question — this provider's own, asked on its own timer.
   */
  biometricsAt: number | null;
  isBiometricsStale: boolean;
  device: DeviceTelemetry | null;
  light: LightState | null;
  setLight: (mode: LightMode, brightness?: number) => void;
}

const IotContext = createContext<IotContextValue | null>(null);

export function IotProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<IotStatus>('idle');
  const [discovered, setDiscovered] = useState<DiscoveredDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [isRestoringSelection, setIsRestoringSelection] = useState(true);

  const [biometrics, setBiometrics] = useState<BiometricsTelemetry | null>(null);
  const [device, setDevice] = useState<DeviceTelemetry | null>(null);
  const [light, setLight] = useState<LightState | null>(null);
  const [biometricsAt, setBiometricsAt] = useState<number | null>(null);
  const [isBiometricsStale, setIsBiometricsStale] = useState(false);

  const connection = useRef<MqttConnection | null>(null);
  const lastBiometricsAt = useRef<number | null>(null);
  const lastPublishAt = useRef(0);

  // Remember the paired node across launches, the way any device-pairing flow should.
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(SELECTED_DEVICE_KEY);
        setSelectedDeviceId(stored ?? DEFAULT_DEVICE_ID);
      } catch {
        setSelectedDeviceId(DEFAULT_DEVICE_ID);
      } finally {
        setIsRestoringSelection(false);
      }
    })();
  }, []);

  /**
   * One connection, resubscribed when the selected device changes. Discovery runs on the
   * same socket as the selected device's telemetry — a second connection would double
   * the broker sessions for no benefit.
   */
  useEffect(() => {
    if (isRestoringSelection) return;

    // A fresh device means the previous node's readings are not ours any more.
    setBiometrics(null);
    setDevice(null);
    setLight(null);
    setIsBiometricsStale(false);
    setBiometricsAt(null);
    lastBiometricsAt.current = null;

    const topics = selectedDeviceId ? topicsFor(selectedDeviceId) : null;
    const subscriptions = [DISCOVERY_TOPIC, ...(topics ? Object.values(topics) : [])];

    setStatus('connecting');

    const conn = connect(subscriptions, {
      onConnect: () => setStatus('connected'),
      onReconnect: () => setStatus('reconnecting'),
      onClose: () => setStatus((s) => (s === 'connected' ? 'reconnecting' : s)),
      onError: () => setStatus('error'),
      onMessage: (topic, payload) => {
        // Discovery first: a status frame is also how we learn a node exists at all.
        const announcedId = deviceIdFromStatusTopic(topic);
        if (announcedId !== null) {
          const isOnline = payload === 'online';

          setDiscovered((current) => {
            const rest = current.filter((d) => d.id !== announcedId);
            return [...rest, { id: announcedId, isOnline, lastSeenAt: Date.now() }].sort((a, b) =>
              a.id.localeCompare(b.id),
            );
          });
          return;
        }

        if (!topics) return;

        if (topic === topics.biometrics) {
          const frame = parseJson(payload, isBiometrics);
          if (frame) {
            const at = Date.now();
            setBiometrics(frame);
            setBiometricsAt(at);
            lastBiometricsAt.current = at;
            setIsBiometricsStale(false);
          }
          return;
        }

        if (topic === topics.device) {
          const frame = parseJson(payload, isDeviceTelemetry);
          if (frame) setDevice(frame);
          return;
        }

        if (topic === topics.lightState) {
          const frame = parseJson(payload, isLightState);
          if (frame) setLight(frame);
        }
      },
    });

    connection.current = conn;

    return () => {
      conn.disconnect();
      connection.current = null;
      setStatus('idle');
    };
  }, [selectedDeviceId, isRestoringSelection]);

  // Ages the last reading out rather than leaving it on screen looking current. A vital
  // sign is the one number where "probably still true" is not good enough.
  useEffect(() => {
    const timer = setInterval(() => {
      const at = lastBiometricsAt.current;
      if (at !== null && Date.now() - at > STALE_AFTER_MS) {
        setIsBiometricsStale(true);
      }
    }, 2000);

    return () => clearInterval(timer);
  }, []);

  const selectDevice = useCallback(async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    try {
      await AsyncStorage.setItem(SELECTED_DEVICE_KEY, deviceId);
    } catch {
      // The selection still applies for this session.
    }
  }, []);

  const forgetDevice = useCallback(async () => {
    setSelectedDeviceId(null);
    try {
      await AsyncStorage.removeItem(SELECTED_DEVICE_KEY);
    } catch {
      // As above.
    }
  }, []);

  const publishLight = useCallback(
    (mode: LightMode, brightness?: number) => {
      if (!selectedDeviceId) return;

      const now = Date.now();
      if (now - lastPublishAt.current < PUBLISH_THROTTLE_MS) return;
      lastPublishAt.current = now;

      const payload = brightness === undefined ? { mode } : { mode, brightness };

      // Deliberately no optimistic update: the node echoes its real state on the retained
      // light/state topic, and the physical button can change the mode too. Trusting the
      // echo means the UI can never disagree with the lamp in the room.
      connection.current?.publish(topicsFor(selectedDeviceId).lightSet, JSON.stringify(payload));
    },
    [selectedDeviceId],
  );

  const isDeviceOnline =
    selectedDeviceId !== null &&
    discovered.some((d) => d.id === selectedDeviceId && d.isOnline);

  return (
    <IotContext.Provider
      value={{
        status,
        discovered,
        selectedDeviceId,
        selectDevice,
        forgetDevice,
        isDeviceOnline,
        biometrics,
        biometricsAt,
        isBiometricsStale,
        device,
        light,
        setLight: publishLight,
      }}>
      {children}
    </IotContext.Provider>
  );
}

export function useIot(): IotContextValue {
  const context = useContext(IotContext);
  if (!context) {
    throw new Error('useIot must be used within an IotProvider');
  }
  return context;
}
