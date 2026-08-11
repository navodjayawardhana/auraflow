// 0.96" SSD1306 OLED — the node's local face.
//
// It exists for the demo more than for the user: during the live presentation
// the examiner can see HR / SpO2 / skin temperature and the current lamp mode
// on the device itself, without a phone in the frame. It also makes the
// "is anything actually happening?" question answerable at a glance while
// debugging, which the Serial Monitor cannot do once the node is on battery.
//
// The panel shares the I2C bus with both sensors, so Display::begin() must run
// after Sensors::begin() has brought Wire up.
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

bool present();

}  // namespace Display
