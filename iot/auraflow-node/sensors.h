// The "sense" half of the node.
//
//  Environment  DHT22 + LDR + electret mic  -> features the watch cannot give us
//               (room temperature, humidity, light level, noise) which feed the
//               Week 8 sleep-quality model.
//
//  Biometrics   MAX30102 -> live HR / SpO2. The Huawei Fit exposes no 0x180D
//               Heart Rate service (measured 2026-08-08), so this is the only
//               live biometric stream in the system, and the reference we
//               validate the watch's Health Connect samples against.
//
//               MAX30205 -> fingertip skin temperature, read on the same I2C
//               bus and stamped onto each biometric reading. It is only trusted
//               while the MAX30102 says a finger is present, because off-skin
//               the part is just measuring the room.
#pragma once

#include <Arduino.h>

struct EnvReading {
  bool  dhtOk;
  float temperatureC;
  float humidityPct;
  uint8_t ambientPct;   // 0 = pitch dark, 100 = bright
  uint8_t noisePct;     // peak-to-peak over the last window
};

struct BioReading {
  bool    fingerPresent;
  int32_t heartRate;    // bpm
  bool    heartRateValid;
  int32_t spo2;         // %
  bool    spo2Valid;
  uint32_t irMean;      // contact quality — useful when debugging a bad reading
  float   bodyTempC;    // fingertip SKIN temperature, not core — see config.h
  bool    bodyTempValid;
};

namespace Sensors {

void begin();
void update();                        // call every loop() — non-blocking

EnvReading readEnvironment();         // safe to call every 30 s
bool       takeBiometrics(BioReading& out);  // true once per fresh 1 s window
bool       pulseSensorPresent();
bool       tempSensorPresent();

// True when any part of the stream is synthesised (see SIMULATE_* in config.h).
// Everything that leaves the node — MQTT payloads, the OLED — has to say so.
bool       simulated();

}  // namespace Sensors
