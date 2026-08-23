# Rewriting the node's sensor layer

## Context

The OLED shows `no sensor - wiring?` while the serial log prints `[bio] no finger — ir=1579`.
Those two cannot both be true of a healthy node, and tracing why they can appear together is
what this plan is really about.

**Two things are wrong, and only one of them is a design problem.**

**A live format-string bug, introduced today.** `auraflow-node.ino:193-200` has fourteen
conversion specifiers and twelve arguments. When the beat detector was swapped for the
library's, the `swing` and `gate` *arguments* were removed but `swing=%.0f gate=%.0f` was left
in the format string — a `.replace()` that silently did not match, with no assertion behind
it. `swing=%.0f` now consumes `intervals` (an `int`) as a `double`, every specifier after it
shifts by two, and the last two read past the end of the argument list. This is undefined
behaviour on the primary finger-down diagnostic, and on an ESP32 it can reset the board. A
reset while the I²C bus is mid-transfer is exactly the wedge `openI2cBus()` exists to clear —
and a boot where that clear does not take leaves `pulseOk == false`, which is the OLED
message. **This is a one-line fix and it must land and be verified on its own, before any
rewrite, or the rewrite will be blamed for a crash it did not cause.**

**The design problem: the sensor's presence flag is one-way.** `pulseOk` (`sensors.cpp:13`) is
assigned in exactly two places (`:490`, `:515`) and cleared in none. Once the MAX30102 has
answered, the firmware believes it forever. If the part stops answering mid-session — a
browned-out module, a knocked wire, a wedged bus — every symptom is silence:

- `pulse.check()` returns nothing, so `computeBiometrics()` is never called again and
  `lastBio` freezes. `auraflow-node.ino:377` then reprints the same `ir=` value every five
  seconds indefinitely. **That is the `ir=1579` line, alternating 1579/1580 forever.**
- `lastDrainMs` is advanced unconditionally at `sensors.cpp:530-532` *before* any read is
  attempted, so the drain-gap detector never fires and `dropped_samples` stays at 0.
- `updateSampleClock()` is gated on `fresh > 0` (`:575`), so `msPerSample` freezes and
  `sample_rate_hz` keeps publishing ≈25.00.
- `pulse_sensor: true` keeps going out on the device topic.

Every diagnostic the node has says it is fine. That is the defect worth rewriting for: the
sensor layer has no concept of *losing* a sensor it once had.

The scope agreed is the sensor layer only — `sensors.cpp` / `sensors.h`, and the sensor half
of `config.h`. Wi-Fi, MQTT, BLE, the OLED and the lamp are working and are not touched.

## What must not change

The sensor layer is the bottom of a contract with three consumers above it. The rewrite is
free behind `sensors.h` and nowhere else.

**`BioReading` fields**, consumed by `auraflow-node.ino:138-177` (MQTT), `ble.cpp:163-196`
(BLE vitals) and `display.cpp:199-235` (OLED): `fingerPresent`, `settled`, `irMean`,
`heartRate`, `heartRateValid`, `heartRateMaxim`, `heartRateMaximValid`, `spo2`, `spo2Valid`.

**The published JSON shape**, pinned by `mobile/src/services/iot-payloads.ts:25-47` and by
fixtures captured from real hardware in `mobile/src/services/__tests__/iot-payloads.test.ts`.
`finger`, `ir_mean`, `hr_valid`, `spo2_valid`, `uptime_s` are hard-required — a frame missing
any of them is dropped whole and silently. `hr_bpm` must stay **fractional**; the test at
`:148-153` pins that, because rounding it would erase the difference from the reference
estimator. ADR-0003 mitigation 4 names these guards as a documented security control.

**`Sensors::` entry points** called from the sketch: `begin()`, `update()`, `takeBiometrics()`,
`pulseSensorPresent()`, `readDieTemperature()`, `beatDebug()`, and the sample-rate and
dropped-sample accessors behind `auraflow-node.ino:109-113`.

**The serial `[bio]` line**, which `iot/analysis/session/log_session.ps1:58-71` parses with
regexes for `hr=(-?[\d.]+)\((\d)\)`, `maxim=(-?\d+)\((\d)\)` and the literal `settling`. That
script silently captured nothing for a whole session once already when the format drifted.

**Reuse rather than rewrite**: `checkForBeat()` from the installed SparkFun library (the
`>> BEAT_SAMPLE_SHIFT` scaling in `sensors.cpp:203-210` is the part that made it work here),
`maxim_heart_rate_and_oxygen_saturation()` from `spo2_algorithm.h`, and `openI2cBus()`'s
nine-pulse recovery (`sensors.cpp:337-361`), which is a correctly diagnosed fix.

## The rewrite

Replace 29 file-scope mutables and four implicit state machines with five named units in
`sensors.cpp`, each owning its own state and testable by reading it.

**1. `SensorLink` — presence as a real state machine.** `Absent → Present → Lost → Absent`,
replacing the one-way `pulseOk`. Owns `openI2cBus()`, `startPulseSensor()` and the
`SENSOR_RETRY_MS` timer. The new transition is the point of the exercise: **a liveness
watchdog.** If no sample has arrived for a threshold while the link believes it is `Present`,
the link goes `Lost`, `pulse_sensor` starts publishing `false`, the OLED can say so, and the
recovery path runs. Pick the threshold from the FIFO cadence — several times the ~40 ms
sample period, comfortably under the 1.5 s publish — and justify it in the constant's comment.

**2. `SampleStream` — the drain, the clock and the accounting.** Fixes three defects that all
live here:
- `lastDrainMs` is advanced **only after a read is actually attempted**, so a freeze produces a
  growing gap instead of a permanent zero.
- The boot phantom: `Sensors::begin()` stamps `lastDrainMs` seconds before the first
  `update()` (across `Ble::begin()`, the blocking Wi-Fi loop and `connectMqtt()`), booking
  roughly 96 dropped samples before anything is touched. `README.md:412` asks for
  `dropped_samples: 0` over a session; as written that is unreachable. Start the accounting on
  the first successful read, not in `begin()`.
- The clock: `CLOCK_MAX_DEVIATION = 0.20` *rejects* any measurement more than 20% off nominal,
  so `sample_rate_hz` can only ever report 20–30 Hz — it cannot show the stalled loop it exists
  to reveal. Record the measurement and publish it; use the deviation band to decide whether to
  *trust* it for interval timing, not whether to *see* it. Re-anchor the accumulator on a
  window rather than running cumulatively from the last restart.

**3. `Contact` — the Schmitt trigger and `settled`.** Keep the current behaviour intact:
`FINGER_IR_FLOOR` 50000 to acquire, `FINGER_IR_RELEASE` 35000 to release,
`FINGER_LOST_SAMPLES` 8. It is well-reasoned and was fixed against an observed symptom.

**4. `BeatEstimator` — `checkForBeat` plus the interval machinery.** The detector is the
library's; the median-of-8, the ≥3 fresh intervals, the 10 s freshness window, the adaptive
refractory with its 400 ms ceiling and the 273–2000 ms bounds are all detector-independent and
stay. Keep `HR_BEAT_REFRACTORY_MAX_MS` — `config.h:287-299` records the observed harmonic lock
(nineteen frames at 41.7 bpm while the reference read 83–137) that it exists to prevent.

**5. `Spo2Filter`** — the existing 5-wide median, unchanged.

**Out-of-band values stop entering the struct.** `sensors.cpp:438,442` store Maxim's `-999`
sentinel into `heartRateMaxim`/`spo2` when invalid. Nothing leaks today because the validity
flags gate every reader, but `DisplayState` carries `lastBio` by value and only those flags
stand between `-999` and the OLED. Leave the fields at zero when invalid.

## Documentation that must be corrected with the code

These are contradictions in the tree right now, not tidying:

- `config.h:234-239` says the detector "is ours rather than the library's `checkForBeat`".
  `sensors.cpp:91-103` says the opposite. The first describes deleted code.
- Nine constants for that deleted detector, with ~70 lines of prose: `BEAT_DC_ALPHA`,
  `BEAT_DC_BETA`, `BEAT_DC_FAST_ALPHA/BETA/SAMPLES`, `BEAT_DC_RESEED_FRACTION`,
  `BEAT_SMOOTH_ALPHA`, `BEAT_MIN_PERFUSION`, `BEAT_MAX_PERFUSION` (`config.h:200-279`). The
  *measurements* in that prose are real and worth keeping somewhere — the DC climbing 53,000
  to 194,000 over 35 s, the 86%-of-DC swing — but they justify constants that no longer exist.
- `sensors.h:66-79` documents `beatDebug` with five outputs including `swing` and `dc`; the
  declaration takes four. The same block says "needs 4 to report" while
  `HR_BEAT_MIN_INTERVALS = 3`.
- `sensors.cpp:392-394` credits the current estimator with "a perfusion band on every cycle".
  That band belonged to the deleted detector; the library's gate is internal and unreadable.
- `sensors.h:31-34` and `README.md:359-362` say to ignore every vital on an unsettled frame
  "whatever the validity flags say", and that `usableHeartRate()` already does. It deliberately
  does not (`mobile/src/services/iot-payloads.ts:98-101`) — `hr_bpm` is a streaming estimator
  with its own gates. The firmware is right and both documents are wrong.

## Verification

Run in this order. Each step is a gate; do not proceed past a failure.

1. **The printf fix alone.** `arduino-cli compile --fqbn esp32:esp32:esp32:PartitionScheme=huge_app`,
   upload to COM8, put a finger on the pad and read the serial. A clean `[bio] hr=…` line with
   no garbage after `ir=`, and no reboot, is the gate. If the OLED stops saying
   `no sensor - wiring?` here, the whole symptom was the crash loop.
2. **`iot/i2c-scanner`** before anything else if step 1 still shows the sensor missing. It
   expects `0x57`, part id **`0x15`**, rev `0x03`. Part id `0x11` is a MAX30100 — a different
   chip the firmware cannot drive, with perfect wiring.
3. **After the rewrite, serial.** Finger on: `n=` climbs 0→3 and `hr=` resolves fractional.
   Finger off: contact drops after ~8 samples, not one.
4. **The watchdog, provoked deliberately.** Pull the MAX30102's SDA line with the node running.
   `pulse_sensor` must go `false` on the device topic within the threshold, the OLED must say
   `no sensor - wiring?`, and reconnecting must recover without a reboot. **This is the
   behaviour the rewrite exists for and the one step that cannot be skipped.**
5. **`dropped_samples: 0`** on a `telemetry/device` frame over a full session, and
   `sample_rate_hz` near 25.00 — both listed as report evidence in `README.md:411-413`.
6. **The app.** Reload; the live biometrics card counts `2 of 3 beats`, resolves a rate, and
   holds it while contact continues. `mobile/src/services/__tests__/iot-payloads.test.ts` must
   still pass untouched — it is the contract, and any edit to it means the rewrite broke the
   shape rather than the test being wrong.
7. **A real agreement session.** `iot/analysis/session/log_session.ps1 -Port COM8`, three
   sittings of five minutes at rest plus one after light exercise, then
   `python ..\validate_hr.py node_hr.csv watch_hr.csv --tolerance 10`. This is the outstanding
   evidence for §5 and the only thing that can say whether the node is accurate — the archived
   session holds two rows five minutes apart and is worthless.

## Not in this plan

`auraflow-node.ino`, `ble.cpp`, `display.cpp`, `light.cpp` are out of scope beyond the printf
fix. Worth recording as separate follow-ups: `LampCallbacks::onWrite` (`ble.cpp:59-80`) mutates
`Light` state from the BLE stack task while `loop()` reads it, with no mutex and only
`bleDidSetLight` marked `volatile`; `use-live-vitals.ts` and the entire BLE client path are
imported by no screen, contrary to ADR-0007; and `isDeviceOnline` has no timeout, so a stale
retained `"online"` never expires.
