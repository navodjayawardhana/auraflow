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
import { AppState } from 'react-native';

import {
  BLE_UNAVAILABLE,
  connect,
  permissionState,
  radioState,
  requestPermissions,
  scan,
  type BleConnection,
  type BleLightState,
  type DiscoveredPeripheral,
} from '@/services/ble-client';
import type { TransportFrame } from '@/services/vitals-merge';
import type { BiometricsTelemetry, LightMode } from '@/types';

/**
 * The app's one Bluetooth link to the node.
 *
 * A provider rather than a hook for the same reason `IotProvider` is one: a hook that owns
 * a connection opens one per caller, and five screens showing a heart rate would mean five
 * connections to a peripheral that accepts one. Mounted once, in `(app)/_layout`, beneath
 * `IotProvider` — so `useLiveVitals` can see both transports and no screen has to.
 *
 * It is kept *separate* from `IotProvider` rather than folded into it because the two
 * transports share almost no state and have entirely different lifecycles. MQTT connects
 * itself to a remembered device id and stays up; BLE needs a runtime permission, a radio
 * that is switched on, a scan, and an explicit choice — and each of those is a state a
 * person has to be shown and can act on. What has to be single here is the connection, and
 * that is made single by mounting the provider once, not by how many providers there are.
 */

/** Why a scan cannot start, if it cannot. Each value has a different thing to tell a user. */
export type BleReadiness =
  | 'unknown'
  | 'ready'
  | 'off'
  | 'permission-denied'
  | 'permission-blocked'
  | 'unsupported'
  | 'unavailable';

export type BleLinkStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'reconnecting';

const PAIRED_DEVICE_KEY = 'auraflow.ble.pairedDevice';

/**
 * Backoff for a disconnect nobody asked for: the node lost power, or the phone walked out
 * of range. Starts fast because most drops are momentary, and caps well short of a minute
 * because by then the node may have come back and nobody is going to keep waiting.
 */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000];

/**
 * How often the merge's clock advances while BLE has a reading to age.
 *
 * Fast enough that the hold-off expires on time, and stopped outright when there is no BLE
 * frame to age — otherwise a session running on MQTT alone, which is every Expo Go
 * session, would re-render the app once a second to arrive at the same answer.
 */
const TICK_MS = 1_000;

interface BleContextValue {
  readiness: BleReadiness;
  status: BleLinkStatus;
  /** Something went wrong that a person may need to read. Cleared when they retry. */
  error: string | null;
  nearby: DiscoveredPeripheral[];
  connectedId: string | null;
  isConnected: boolean;

  /** What BLE last delivered, for the merge. Screens read `useLiveVitals`, not this. */
  vitals: TransportFrame;
  lamp: BleLightState | null;

  /** Shared clock, so every `useLiveVitals` ages the same reading at the same instant. */
  now: number;

  checkReadiness: () => Promise<BleReadiness>;
  startScan: () => Promise<void>;
  stopScan: () => void;
  connectTo: (deviceId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** False when there is no link, which is the caller's cue to use the other transport. */
  setLight: (mode: LightMode, brightness?: number) => boolean;
}

const BleContext = createContext<BleContextValue | null>(null);

export function BleProvider({ children }: { children: ReactNode }) {
  const [readiness, setReadiness] = useState<BleReadiness>('unknown');
  const [status, setStatus] = useState<BleLinkStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<DiscoveredPeripheral[]>([]);
  const [connectedId, setConnectedId] = useState<string | null>(null);

  const [frame, setFrame] = useState<BiometricsTelemetry | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [lamp, setLamp] = useState<BleLightState | null>(null);

  const [now, setNow] = useState(() => Date.now());

  const connection = useRef<BleConnection | null>(null);
  const stopScanRef = useRef<(() => void) | null>(null);

  /**
   * The node the user asked for, which is not the same as the one currently held.
   *
   * It is what separates a drop from a departure: while it is set, a disconnect is
   * something to recover from; once it is cleared, the same event is the user getting
   * exactly what they asked for and nothing should reconnect.
   */
  const wanted = useRef<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);

  // Held in a ref as well as returned, because the reconnect timer and the AppState
  // listener both have to reach the current `connectTo` from effects that must not
  // re-subscribe every time its identity changes.
  const connectRef = useRef<(deviceId: string) => Promise<void>>(async () => {});

  const isConnected = status === 'connected';
  const hasBleData = receivedAt !== null || status === 'connected' || status === 'reconnecting';

  useEffect(() => {
    if (!hasBleData) return;

    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [hasBleData]);

  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const scheduleRetry = useCallback(() => {
    const delay = RECONNECT_DELAYS_MS[Math.min(retryCount.current, RECONNECT_DELAYS_MS.length - 1)];
    retryCount.current += 1;

    retryTimer.current = setTimeout(() => {
      const target = wanted.current;
      if (target !== null) connectRef.current(target);
    }, delay);
  }, []);

  const checkReadiness = useCallback(async (): Promise<BleReadiness> => {
    const radio = await radioState();

    // Asked first and short-circuited on: there is nothing a permission grant can do for a
    // build with no radio bindings compiled into it.
    if (radio === 'unavailable' || radio === 'unsupported') {
      setReadiness(radio);
      return radio;
    }

    const held = await permissionState();
    if (held === 'denied') {
      // Not necessarily a refusal — a check cannot tell a first run from one. It only
      // decides what the picker offers; the scan path prompts before it gives up.
      setReadiness('permission-denied');
      return 'permission-denied';
    }

    const next: BleReadiness =
      radio === 'ready' ? 'ready' : radio === 'off' ? 'off' : 'permission-blocked';

    setReadiness(next);
    return next;
  }, []);

  const stopScan = useCallback(() => {
    stopScanRef.current?.();
    stopScanRef.current = null;
    setStatus((s) => (s === 'scanning' ? 'idle' : s));
  }, []);

  const startScan = useCallback(async () => {
    setError(null);
    setNearby([]);

    const radio = await radioState();
    if (radio !== 'ready') {
      // A radio that is off and a build that has none both end with nothing to scan. The
      // picker reads `readiness` to say which, because the two have different fixes.
      setReadiness(radio === 'unauthorised' ? 'permission-blocked' : radio);
      setStatus('idle');
      return;
    }

    // Asked at the moment of scanning rather than at launch, so the system prompt arrives
    // while the person is looking at the screen that explains what it is for.
    const granted = await requestPermissions();
    if (granted === 'denied' || granted === 'blocked') {
      setReadiness(granted === 'blocked' ? 'permission-blocked' : 'permission-denied');
      setStatus('idle');
      return;
    }

    setReadiness('ready');
    setStatus('scanning');

    stopScanRef.current = scan(
      (device) =>
        setNearby((found) => (found.some((d) => d.id === device.id) ? found : [...found, device])),
      (message) => {
        setError(message);
        setStatus('idle');
      },
    );
  }, []);

  const connectTo = useCallback(
    async (deviceId: string) => {
      stopScan();
      clearRetry();

      wanted.current = deviceId;
      setError(null);
      setStatus((s) => (s === 'reconnecting' ? s : 'connecting'));

      try {
        connection.current = await connect(deviceId, {
          // Deliberately does not feed the reading. The standard characteristic carries the
          // same rate rounded to a whole bpm and with no validity flag of its own, so
          // preferring it would let BLE and MQTT disagree about a number they both got from
          // one sensor. It stays subscribed because parsing it is what makes the "any
          // generic heart-rate app can read this node" claim true in both directions.
          onHeartRate: () => {},
          onVitals: (vitals) => {
            const at = Date.now();
            setFrame(vitals);
            setReceivedAt(at);
            // Advanced with the frame so the merge never evaluates a reading against a
            // clock that is already a tick behind it.
            setNow(at);
          },
          onLight: setLamp,
          onDisconnect: () => {
            connection.current = null;
            setConnectedId(null);
            setLamp(null);

            // The reading is left alone rather than cleared. Blanking it here would throw
            // away a frame that is still seconds old and still true, which is the flicker
            // the hold-off exists to prevent — it ages out on its own instead.
            if (wanted.current === null) {
              setStatus('idle');
              return;
            }

            setStatus('reconnecting');
            scheduleRetry();
          },
        });

        retryCount.current = 0;
        setConnectedId(deviceId);
        setStatus('connected');
        setReadiness('ready');

        try {
          await AsyncStorage.setItem(PAIRED_DEVICE_KEY, deviceId);
        } catch {
          // The pairing still holds for this session.
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Could not connect.';
        setError(message);

        // A build with no radio bindings will never succeed, so this stops rather than
        // retrying forever. The fix is a different binary, and the picker says so.
        if (message === BLE_UNAVAILABLE) {
          wanted.current = null;
          setReadiness('unavailable');
          setStatus('idle');
          return;
        }

        if (wanted.current === null) {
          setStatus('idle');
          return;
        }

        setStatus('reconnecting');
        scheduleRetry();
      }
    },
    [clearRetry, scheduleRetry, stopScan],
  );

  connectRef.current = connectTo;

  const disconnect = useCallback(async () => {
    wanted.current = null;
    retryCount.current = 0;
    clearRetry();

    await connection.current?.disconnect();
    connection.current = null;

    setConnectedId(null);
    setStatus('idle');
    setLamp(null);

    // Asked for, so the reading goes at once rather than ageing out. Holding it would leave
    // a number on screen that the user has just said they are done with.
    setFrame(null);
    setReceivedAt(null);

    try {
      await AsyncStorage.removeItem(PAIRED_DEVICE_KEY);
    } catch {
      // Worst case the next launch tries a node that is not there, and falls back.
    }
  }, [clearRetry]);

  const setLight = useCallback((mode: LightMode, brightness?: number): boolean => {
    if (connection.current === null) return false;

    // Fire and forget, matching the MQTT path. A failed write shows up as the lamp not
    // changing, which is the same feedback either way.
    connection.current.setLight(mode, brightness).catch(() => setError('Lamp write failed.'));
    return true;
  }, []);

  /**
   * Reconnect to the remembered node on launch, but only when nothing has to be asked.
   *
   * A permission prompt or a "turn Bluetooth on" dialog appearing merely because the app
   * started is the wrong way round: the person has not said they want a session yet. So
   * this is silent where it can be and does nothing at all where it cannot — the picker is
   * where the asking belongs.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await AsyncStorage.getItem(PAIRED_DEVICE_KEY).catch(() => null);
      if (stored === null || cancelled) return;

      const radio = await radioState();
      const held = await permissionState();
      if (cancelled || radio !== 'ready' || held === 'denied' || held === 'blocked') return;

      setReadiness('ready');
      connectRef.current(stored);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Android tears links down while an app is backgrounded, and it does so quietly — the
   * disconnect can land during a stretch where none of our timers are running. Returning
   * to the foreground is therefore the one moment worth re-checking by hand.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      if (wanted.current === null || connection.current !== null) return;

      clearRetry();
      retryCount.current = 0;
      connectRef.current(wanted.current);
    });

    return () => subscription.remove();
  }, [clearRetry]);

  useEffect(() => {
    return () => {
      stopScanRef.current?.();
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
      // Cleared before disconnecting so the teardown does not look like a drop and start
      // reconnecting to a node nobody is watching any more.
      wanted.current = null;
      connection.current?.disconnect();
    };
  }, []);

  return (
    <BleContext.Provider
      value={{
        readiness,
        status,
        error,
        nearby,
        connectedId,
        isConnected,
        vitals: { frame, receivedAt },
        lamp,
        now,
        checkReadiness,
        startScan,
        stopScan,
        connectTo,
        disconnect,
        setLight,
      }}>
      {children}
    </BleContext.Provider>
  );
}

export function useBle(): BleContextValue {
  const context = useContext(BleContext);
  if (!context) {
    throw new Error('useBle must be used within a BleProvider');
  }
  return context;
}
