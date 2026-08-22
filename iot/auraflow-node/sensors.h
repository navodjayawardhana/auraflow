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
  bool    fingerPresent;   // contact right now, from the newest sample

  // True once contact has been unbroken for a whole 4 s window. Everything below is
  // meaningless until it is: for the first two seconds after a finger goes down the
  // buffer is still half no-finger data with a step edge through the middle, and Maxim's
  // peak finder locks onto that edge and returns a rate inside the plausible range —
  // a wrong number wearing the same validity flag as a right one.
  bool    settled;

  // Two independent heart rates from the same signal, published side by side.
  //
  //  heartRate       beat intervals timed against the measured sample clock, median
  //                  filtered. Sub-bpm resolution; this is the one to use.
  //  heartRateMaxim  Maxim's reference algorithm, slew-limited. Quantised to roughly
  //                  4 bpm steps at rest, and kept because it is the published,
  //                  citable method the evaluation compares the other against.
  float   heartRate;         // bpm
  bool    heartRateValid;
  int32_t heartRateMaxim;    // bpm
  bool    heartRateMaximValid;

  int32_t spo2;         // %, median filtered
  bool    spo2Valid;
  uint32_t irMean;      // contact quality — useful when debugging a bad reading
};

namespace Sensors {

void begin();
void update();                        // call every loop() — non-blocking

bool takeBiometrics(BioReading& out);  // true once per fresh 1 s window
bool pulseSensorPresent();

// The measured effective sample rate, not the nominal one. Published on the device
// health topic: a figure drifting from 25 Hz is the earliest visible sign that the loop
// is no longer keeping up with the sensor.
float sampleRateHz();

// What the beat detector is seeing, for tuning and for the serial log. Not published:
// these are the internals of one estimator, and the payload carries results.
//
//  swing      peak-to-peak of the last cycle evaluated, in raw counts
//  dc         the running DC estimate those counts sit on
//  intervals  how many are in the median window right now (needs 4 to report)
//  medianMs   the median interval, or 0 before there is one
//  loMs/hiMs  the shortest and longest in that window
//
// The spread is the diagnostic that separates the two ways a rate can be wrong. Intervals
// clustered tightly around a median twice the true one means beats are being missed;
// intervals alternating short and long means something other than a beat — a dicrotic
// notch — is being counted between them.
void beatDebug(float& swing, float& dc, int& intervals, float& medianMs,
               float& loMs, float& hiMs);

// Samples the driver's four-deep ring dropped before they could be read, cumulative
// since boot. Every drop also discards the window it landed in, so this is a count of
// measurement opportunities lost rather than of readings corrupted — but a number that
// climbs during a session means the loop is stalling and the session is thin.
uint32_t droppedSamples();

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
