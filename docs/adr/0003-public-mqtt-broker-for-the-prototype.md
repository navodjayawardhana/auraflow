# 3. Accept a public MQTT broker for the prototype, and say so

Date: 2026-08-21

## Status

Accepted, with a named production path.

## Context

The AuraFlow node (ESP32 + MAX30102) publishes heart rate and SpO₂ to
`broker.hivemq.com` — HiveMQ's free public broker. It is unauthenticated, and its topics
are world-readable **and world-writable**. Anyone who subscribes to
`auraflow/auraflow-node-01/#` sees the heart rate; anyone who publishes to
`auraflow/auraflow-node-01/light/set` drives the lamp.

The mobile app needed a way to show that data live. Two designs were possible:

1. **Direct subscribe** — the app connects to the broker over MQTT-over-WebSocket.
2. **Server bridge** — Laravel subscribes, persists telemetry, and the app polls an
   authenticated endpoint.

A transport spike settled the feasibility question: `mqtt` is pure JavaScript, bundles in
Expo Go with `Buffer`/`process` shimmed, and delivered real frames from the node
(`hr_bpm: 113`, `spo2_pct: 99`) plus working lamp commands. The bridge would have meant a
long-running `php artisan` consumer, a new table, and losing the property that the live
view keeps working when the API is down.

## Decision

Direct subscribe from the app, over **`wss://broker.hivemq.com:8884/mqtt`**, with the
broker's exposure accepted as a documented prototype risk rather than pretended away.

Mitigations actually applied:

1. **TLS, not cleartext.** `wss` on 8884 rather than `ws` on 8000. This encrypts the link
   and satisfies iOS App Transport Security on a physical device. It does **not** make
   the data private — a subscriber to the same topic still sees every frame — and the
   code comments say so rather than letting TLS imply confidentiality it does not
   provide here.
2. **Random client id per session** (`auraflow-app-<8 hex>`). A stable id on a public
   broker would let an observer correlate this phone across connections.
3. **No PII on the wire.** The payloads carry vitals, uptime and signal strength — no user
   id, name, email or token. Topics are keyed on a device id, never on an account.
4. **Untrusted-input parsing.** Every frame passes a shape guard
   (`mobile/src/services/iot-payloads.ts`) before it reaches state, because on a public
   broker a frame is input from the internet rather than a message from our own hardware.
   Tests pin this — a vital sent as a string is rejected.
5. **A bounded blast radius.** The lamp is the only actuator and it can only change
   light. The worst an attacker achieves by writing to `light/set` is an annoying lamp.
   That, not the mitigations above, is what makes the residual risk acceptable for a
   coursework prototype.

## Consequences

**Good.** Live biometrics work with no server involved, so the feature survives the API
being down; the app can command the lamp; nothing native was added, so Expo Go still
runs the build.

**Bad, and stated plainly.** Anyone who knows the device id can read this user's heart
rate. Rotating the device id to a long random string raises the cost of a drive-by from
trivial to impractical, but that is security by obscurity and is labelled as such — it is
not a control.

**The production path**, were this to ship: a private broker (HiveMQ Cloud or
self-hosted Mosquitto) with per-device credentials and client certificates; per-topic
ACLs so a device may publish only its own telemetry and subscribe only to its own command
topic; and a server-side bridge, so the phone authenticates to Laravel with the token it
already holds rather than carrying broker credentials in a bundle that is readable from
the APK.

Naming the weakness is deliberate. A design that quietly shipped health data over an open
broker would be worse than this one, and harder to defend.
