import mqtt, { type MqttClient } from 'mqtt';

import { KEEPALIVE_SECONDS, MQTT_URL } from '@/config/iot';

/**
 * The only file that imports `mqtt`.
 *
 * Keeping the dependency behind one thin wrapper means swapping transports later — a
 * different client library, or a server-side bridge the app polls — touches this file
 * and nothing else.
 */

export interface MqttHandlers {
  onConnect?: () => void;
  onReconnect?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
  onMessage?: (topic: string, payload: string) => void;
}

export interface MqttConnection {
  publish: (topic: string, payload: string) => void;
  disconnect: () => void;
}

export function connect(topics: string[], handlers: MqttHandlers): MqttConnection {
  const client: MqttClient = mqtt.connect(MQTT_URL, {
    // Random per session, never a stable identifier. On a public broker a fixed client
    // id would let anyone watching correlate this phone across connections.
    clientId: `auraflow-app-${Math.random().toString(16).slice(2, 10)}`,
    clean: true,
    keepalive: KEEPALIVE_SECONDS,
    reconnectPeriod: 4000,
    connectTimeout: 10_000,
  });

  client.on('connect', () => {
    client.subscribe(topics, { qos: 1 });
    handlers.onConnect?.();
  });

  client.on('reconnect', () => handlers.onReconnect?.());
  client.on('close', () => handlers.onClose?.());
  client.on('error', (error) => handlers.onError?.(error as Error));

  client.on('message', (topic, payload) => {
    handlers.onMessage?.(topic, payload.toString());
  });

  return {
    publish: (topic, payload) => client.publish(topic, payload, { qos: 1 }),
    disconnect: () => client.end(true),
  };
}

/**
 * Parses a frame from a *public* broker, where anyone can publish anything to these
 * topics. A malformed or hostile payload must be dropped, never allowed to reach state
 * and crash a render.
 */
export function parseJson<T>(payload: string, isValid: (value: unknown) => value is T): T | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
