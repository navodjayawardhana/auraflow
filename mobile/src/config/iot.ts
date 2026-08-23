/**
 * Where AuraFlow nodes publish, and what they listen on.
 *
 * Topic strings mirror the firmware exactly (iot/auraflow-node/auraflow-node.ino) — a
 * mismatch here fails silently as "no data" rather than as an error, so they are derived
 * from one place rather than typed out per call site.
 */

/**
 * wss, not ws. iOS App Transport Security blocks cleartext WebSockets on a physical
 * device, and TLS is the honest answer regardless — though note it only protects the
 * data in transit. The broker itself is public (see docs/adr/0003), so anyone
 * subscribing to the same topic still sees these frames.
 */
export const MQTT_URL = process.env.EXPO_PUBLIC_MQTT_URL ?? 'wss://broker.hivemq.com:8884/mqtt';

/** Pre-selected for a fresh install, so the demo device is reachable without pairing. */
export const DEFAULT_DEVICE_ID = process.env.EXPO_PUBLIC_IOT_DEVICE_ID ?? 'auraflow-node-01';

export const NAMESPACE = 'auraflow';

/**
 * Every node announces itself on a retained status topic, so subscribing to the wildcard
 * yields the currently-online devices immediately on connect rather than after waiting
 * for one to publish. That retention is what makes discovery feel instant.
 */
export const DISCOVERY_TOPIC = `${NAMESPACE}/+/status`;

export function topicsFor(deviceId: string) {
  const base = `${NAMESPACE}/${deviceId}`;

  return {
    lightSet: `${base}/light/set`,
    lightState: `${base}/light/state`,
    biometrics: `${base}/telemetry/biometrics`,
    device: `${base}/telemetry/device`,
    status: `${base}/status`,
  } as const;
}

/** `auraflow/<id>/status` -> `<id>`, or null for anything that is not a status topic. */
export function deviceIdFromStatusTopic(topic: string): string | null {
  const parts = topic.split('/');

  if (parts.length !== 3 || parts[0] !== NAMESPACE || parts[2] !== 'status') {
    return null;
  }

  return parts[1] || null;
}

/**
 * Three missed frames at the firmware's 1.5s biometric cadence (`BIO_PUBLISH_MS`). A stale
 * vital sign displayed as live is the failure mode worth designing against, and fifteen
 * seconds — which this was, from when the node published every five — is ten frames of a
 * number that may have stopped being true.
 *
 * Kept at three rather than one because the fix for a reading that flickers belongs in the
 * node's contact detection, not in a client that hides the flicker by holding old values
 * for longer.
 */
export const STALE_AFTER_MS = 5_000;

/** Matches the firmware's own keepalive, so both ends agree on when a peer is gone. */
export const KEEPALIVE_SECONDS = 30;
