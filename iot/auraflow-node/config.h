// AuraFlow IoT node — pin map and timing constants.
// ESP32 only: we need 2 free ADC1 channels (ADC2 is unusable while WiFi is on)
// plus I2C, which an ESP8266 cannot give us at the same time.
#pragma once

#include <Arduino.h>

#if !defined(ESP32)
  #error "Select an ESP32 board — this node needs 2x ADC1 + I2C + WiFi together"
#endif

// ---- pins (ESP32 DevKit v1, 30-pin) ---------------------------------------
constexpr uint8_t PIN_LED_DATA = 5;    // WS2812 DIN (through 330R)
constexpr uint8_t PIN_BUTTON   = 4;    // to GND, INPUT_PULLUP
constexpr uint8_t PIN_LDR      = 34;   // ADC1_CH6 — input only
constexpr uint8_t PIN_SOUND    = 35;   // ADC1_CH7 — mic module AO
constexpr uint8_t PIN_DHT      = 13;   // DHT22 DATA (4k7 pull-up to 3V3)

constexpr uint8_t NUM_PIXELS = 8;
constexpr int     ADC_MAX    = 4095;

// ---- I2C bus (shared by all three digital sensors) ------------------------
// No address collisions, so all three hang off the same two pins. Run the
// scanner in README §4 after wiring: you should see exactly these three.
constexpr uint8_t PIN_SDA = 21;
constexpr uint8_t PIN_SCL = 22;

constexpr uint8_t ADDR_MAX30102 = 0x57;  // fixed in silicon, not strappable
constexpr uint8_t ADDR_MAX30205 = 0x48;  // A0..A2 to GND; some modules ship 0x49
constexpr uint8_t ADDR_OLED     = 0x3C;  // a few 128x64 modules are 0x3D

constexpr uint8_t OLED_WIDTH  = 128;
constexpr uint8_t OLED_HEIGHT = 64;

// ---- timing ---------------------------------------------------------------
constexpr unsigned long ENV_PUBLISH_MS    = 30000;  // sleep-environment features
constexpr unsigned long BIO_PUBLISH_MS    = 5000;   // HR/SpO2 while a finger is on
constexpr unsigned long FADE_INTERVAL_MS  = 15;
constexpr unsigned long ALERT_DURATION_MS = 6000;
constexpr unsigned long RECONNECT_MS      = 3000;
constexpr unsigned long NOISE_WINDOW_MS   = 1000;
constexpr unsigned long BODY_TEMP_READ_MS = 1000;   // MAX30205 settles slower than this
constexpr unsigned long DISPLAY_MS        = 500;    // OLED full-frame ~30 ms @ 400 kHz
constexpr uint8_t       FADE_STEP         = 6;      // ~0.6 s for a full swing

// ---- biometrics -----------------------------------------------------------
constexpr int      BIO_BUFFER      = 100;    // 4 s @ 25 Hz effective
constexpr int      BIO_STRIDE      = 25;     // recompute once per second
constexpr uint32_t FINGER_IR_FLOOR = 50000;  // below this, nothing is on the sensor

// Skin temperature at the fingertip, NOT core body temperature — a healthy
// finger sits well below 37 C. The window is a sanity check for "is the sensor
// actually against skin", not a clinical range. Say this in the report; a
// marker who spots skin temp reported as core temp will take marks for it.
constexpr float BODY_TEMP_MIN_C = 20.0f;
constexpr float BODY_TEMP_MAX_C = 45.0f;

// ---- simulation -----------------------------------------------------------
// Lets the whole WiFi -> MQTT -> Laravel -> app chain be built and tested
// before the sensors physically arrive. Set each back to 0 the moment the real
// part is wired in.
//
// While either is 1 every MQTT payload carries "simulated": true, and the OLED
// shows a SIM tag, so a simulated run can never quietly end up as evidence in
// the report or as rows in the training set.
#define SIMULATE_BIO 1   // MAX30102 + MAX30205
#define SIMULATE_ENV 1   // DHT22 + LDR + mic

#if SIMULATE_BIO || SIMULATE_ENV
  #pragma message("AuraFlow: SIMULATED sensor data is enabled — see config.h")
#endif
