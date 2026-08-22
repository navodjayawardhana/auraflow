// The "sense" half of the node.
//
//  Biometrics   MAX30102 -> live HR / SpO2. The Huawei Fit exposes no 0x180D
//               Heart Rate service (measured 2026-08-08), so this is the only
//               live biometric stream in the system, and the reference we
//               validate the watch's Health Connect samples against.
//
// What this build does NOT sense, and why nothing here pretends otherwise:
//
//  Room environment   The DHT22, LDR and electret mic never arrived. There is
//                     no temperature / humidity / light / noise stream, and no
//                     substitute is dressed up as one. The Week 8 sleep-quality
//                     model loses those features — README §2.
//
//  Skin temperature   The MAX30205 never arrived. The MAX30102 does expose an
//                     on-die temperature register, but that is the temperature
//                     of the sensor's own silicon — it exists to compensate the
//                     LEDs, it sits above ambient because those LEDs heat it,
//                     and it is not a fingertip reading. It is published as
//                     `sensor_die_temp_c` on the device-health topic and is
//                     never called a body or skin temperature.
#pragma once

#include <Arduino.h>

struct BioReading {
  bool    fingerPresent;
  int32_t heartRate;    // bpm
  bool    heartRateValid;
  int32_t spo2;         // %
  bool    spo2Valid;
  uint32_t irMean;      // contact quality — useful when debugging a bad reading
};

namespace Sensors {

void begin();
void update();                        // call every loop() — non-blocking

bool takeBiometrics(BioReading& out);  // true once per fresh 1 s window
bool pulseSensorPresent();

// MAX30102 die temperature — a diagnostic, NOT a biometric. See the header
// note above before putting this number anywhere near the report.
//
// The one-shot conversion blocks for up to ~50 ms, which would punch a hole in
// the 25 Hz sample stream, so this returns false while a finger is on the
// sensor. Call it on the slow telemetry cadence, not every loop.
bool readDieTemperature(float& outC);

// True when any part of the stream is synthesised (see SIMULATE_BIO in
// config.h). Everything that leaves the node — MQTT payloads, the OLED — has
// to say so.
bool simulated();

}  // namespace Sensors
