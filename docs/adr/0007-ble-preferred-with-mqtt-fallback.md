# 7. BLE preferred, MQTT as fallback, one reading in the UI

Date: 2026-08-22

## Status

Accepted.

## Context

The IoT node already publishes biometrics over MQTT to a public broker
([ADR 0003](0003-public-mqtt-broker-for-the-prototype.md)), and the app reads them through
`IotProvider`. That works, and it has a property worth keeping: the phone and the node do
not need to be in the same room, only both online.

It also has two properties that are wrong for the movement session:

- **It needs the internet.** Both ends must reach `broker.hivemq.com`. A session in a gym
  basement gets no heart rate at all.
- **It goes the long way round.** A reading travels phone → internet → broker → internet →
  node and back, for two devices that are a metre apart.

The user's framing was direct: it should behave like a fitness watch. A watch does not
route your pulse through a datacentre.

The firmware side already exists — `iot/auraflow-node/ble.h` and `ble.cpp` expose the
standard Bluetooth **Heart Rate Service `0x180D`** alongside a custom AuraFlow service — but
it has not been flashed, and the app has no BLE code at all.

The question is what happens to the existing MQTT path once BLE exists. Three options:

1. **Replace MQTT with BLE.** Simplest code, but loses remote monitoring and throws away
   working infrastructure. It also makes the node useless whenever the phone is out of
   Bluetooth range, which is most of the day.
2. **Keep both, let each screen choose.** Every screen then has to know about transports,
   and the same number could be shown differently in two places.
3. **Keep both behind one reading.** Screens ask for "the heart rate" and are told which
   transport supplied it, but never have to choose.

## Decision

Option 3. A hook — `use-live-vitals` — exposes a single reading with an explicit
`source: 'ble' | 'mqtt' | null`, preferring BLE whenever a BLE connection is live and
falling back to MQTT otherwise.

Two details are load-bearing:

- **A hold-off before switching source.** A Bluetooth link at the edge of range connects and
  drops repeatedly. Without a hold-off the displayed number would flicker between two
  transports reporting the same heart at slightly different times, which reads as a broken
  sensor rather than a weak link.
- **`source` is exposed, not hidden.** The device screen tells the user which path is live,
  because "no reading" has a different fix depending on whether Bluetooth or Wi-Fi is the
  problem. Screens that only want the number ignore the field.

BLE stays behind `src/services/ble-client.ts` as the only file importing the BLE library,
mirroring how `mqtt-client.ts` isolates MQTT.

The node advertises the **standard** Heart Rate Service rather than a custom characteristic
for heart rate. That costs nothing and buys an independent check: any generic BLE heart-rate
app can read the node, which is evidence the values are right and not just self-consistent.

## Consequences

**Good.**

- The movement session works with no internet at either end.
- Latency drops from a broker round trip to a local notification, which matters when the
  number is meant to correspond to the squat happening now.
- Remote monitoring survives — the lamp and the diagnostics still work from anywhere.
- Screens got simpler, not more complex: `live-biometrics-card`, `device` and the Today
  screen each read one hook and no longer touch `IotProvider`'s biometrics directly.

**Bad, and accepted.**

- **Two transports to the same device is genuinely more code**, and a class of bug —
  disagreement between sources — that did not exist before. The hold-off is a mitigation,
  not a proof.
- **BLE is a native module**, so it requires the development build. That cost is already
  being paid for the camera ([ADR 0006](0006-native-pose-estimation-and-the-end-of-expo-go.md));
  batching both into one build is why the two decisions were taken together.
- **BLE and Wi-Fi coexisting on an ESP32 is tight on memory.** The node reports
  `heap_free_b` on its device topic and the diagnostics card already shows it, so the number
  to watch after flashing is visible. If it becomes a problem the OLED refresh rate is the
  thing to cut before either radio.
- Android's Bluetooth permissions differ across versions: `BLUETOOTH_SCAN` with
  `neverForLocation` on Android 12+, and `ACCESS_FINE_LOCATION` on Android 11 and below. Both
  have to be declared and requested, and a refusal has to be a stated state rather than an
  empty list.
