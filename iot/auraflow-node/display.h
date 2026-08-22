// 0.96" SSD1306 OLED — the node's local face.
//
// It exists for the demo more than for the user: during the live presentation
// the examiner can see HR / SpO2 and the current lamp mode on the device
// itself, without a phone in the frame. It also makes the "is anything actually
// happening?" question answerable at a glance while debugging, which the Serial
// Monitor cannot do once the node is off the USB cable.
//
// It carries more weight in this build than it did in the last one. With the
// WS2812 ring gone the lamp is a single blue LED, so the mode name and the
// brightness bar on this panel ARE the lamp's readable state — see light.cpp.
//
// The module that arrived is the 7-pin **SPI** variant, so this no longer
// shares the I2C bus with the pulse sensor and Display::begin() no longer has
// to run after Sensors::begin().
#pragma once

#include <Arduino.h>

#include "sensors.h"

struct DisplayState {
  bool        wifiUp;
  bool        mqttUp;
  int         rssi;
  bool        haveBio;
  BioReading  bio;
  const char* lightMode;
  uint8_t     brightness;
};

namespace Display {

void begin();

// Call every loop() — rate-limited internally to DISPLAY_MS, so a full frame
// never gets in the way of draining the MAX30102 FIFO.
void update(const DisplayState& s);

// Full-screen single message, for boot and for the blocking WiFi wait.
void message(const char* title, const char* line);

// ⚠️ Over SPI this is optimistic, not measured. An I2C panel either ACKs its
// address or it does not; an SPI panel has no reply path, so begin() only fails
// on a buffer allocation error. A true return with a dark screen means wiring —
// work through README §4.
bool present();

}  // namespace Display
