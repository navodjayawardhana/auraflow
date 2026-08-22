// AuraFlow IoT node — pin map and timing constants.
//
// Built for the parts actually on the bench (2026-08-12):
//   ESP32 DevKitC (38-pin) · MAX30102 · SSD1306 0.96" **SPI** · TP4056
//
// The original BOM assumed a DHT22, an LDR, an electret mic, a WS2812 ring and
// a MAX30205. None of those arrived, so this build drops room-environment
// sensing and skin temperature entirely rather than substituting a part that
// measures something else and labelling it as the missing quantity. See
// README §2 for what each omission costs and what would restore it.
#pragma once

#include <Arduino.h>

#if !defined(ESP32)
  #error "Select an ESP32 board — this node needs SPI + I2C + WiFi together"
#endif

// ---- lamp ------------------------------------------------------------------
// The circadian lamp is the DevKit's own blue LED, driven by LEDC PWM. Without
// the WS2812 there is no colour left to carry the mode, so the modes are
// separated by brightness AND by motion (steady / breathing / pulsing) and the
// OLED names the active mode in large type. See light.cpp.
//
// GPIO2 is a strapping pin. Driving it after boot is fine — this is where the
// DevKit puts its onboard LED — but do not wire anything else to it. On the
// 38-pin board it is also broken out as `G2`; leave that header pin empty.
constexpr uint8_t PIN_LAMP = 2;

// BOOT button, already pulled up on the board, active LOW. Free to use as the
// manual override once the sketch is running.
//
// The 38-pin board also brings GPIO0 out as `G0`. Leave that header pin empty —
// anything driving it fights the button, and holding it low at reset drops the
// chip into download mode.
//
// ⚠️ Holding it down while pressing RST puts the chip in download mode. That is
// how you flash, not a fault — just do not hold it through a reset mid-demo.
constexpr uint8_t PIN_BUTTON = 0;

// ---- I2C bus (MAX30102 only) -----------------------------------------------
// The OLED moved to SPI, so the pulse oximeter is now alone on this bus. The
// scanner in README §4 should report exactly one address.
constexpr uint8_t PIN_SDA = 21;
constexpr uint8_t PIN_SCL = 22;

constexpr uint8_t ADDR_MAX30102 = 0x57;  // fixed in silicon, not strappable

// ---- OLED (SSD1306 128x64, 7-pin SPI module) -------------------------------
// The module that arrived is the 7-pin `GND VDD SCK SDA RES DC CS` variant —
// SPI, not the 4-pin I2C one the first revision of this node assumed. Hardware
// VSPI, so SCK/MOSI are the silicon defaults and only the three control lines
// are a free choice.
//
// The module's `SDA` pin is SPI MOSI. Its `SCK` is the clock. Nothing on this
// header goes to GPIO21/22.
//
// Every one of these is silkscreened with its own number on the 38-pin board
// (`G18`, `G23`, `G5`, `G16`, `G17`), so the labels below are what you read on
// the header. The 30-pin DevKit v1 prints 16 and 17 as `RX2`/`TX2` instead —
// worth knowing only if you ever move this to that board.
constexpr uint8_t PIN_OLED_SCK  = 18;   // VSPI CLK  -> module SCK
constexpr uint8_t PIN_OLED_MOSI = 23;   // VSPI MOSI -> module SDA
constexpr uint8_t PIN_OLED_CS   = 5;    //           -> module CS
constexpr uint8_t PIN_OLED_DC   = 16;   //           -> module DC
constexpr uint8_t PIN_OLED_RST  = 17;   //           -> module RES

// GPIO16/17 are free on a plain ESP-WROOM-32. On an ESP32-**WROVER** they are
// wired to the PSRAM and the panel will stay dark — move DC/RES to 25/26 there.
//
// ⚠️ The 38-pin board also breaks out `SD0 SD1 SD2 SD3 CMD CLK`. Those go to the
// SPI flash holding this firmware. Never assign one of them to anything.
constexpr uint8_t OLED_WIDTH  = 128;
constexpr uint8_t OLED_HEIGHT = 64;

// ---- spare analog input ----------------------------------------------------
// Reserved for the unidentified 3-pin module (silkscreen "HW-477 v0.2" — that
// marking ships on at least three different boards, so it is not wired in until
// the part is known). ADC1 so it keeps working with WiFi on; input-only pin.
constexpr uint8_t PIN_SPARE_ADC = 34;
constexpr int     ADC_MAX       = 4095;

// ---- timing ---------------------------------------------------------------
constexpr unsigned long DEVICE_PUBLISH_MS = 30000;  // node health telemetry
// The algorithm recomputes every 25 samples (~1 s), so publishing every 5 s threw away
// four readings out of five and made the phone look laggy. 1.5 s tracks the sensor
// closely without flooding the broker; the app's staleness window is 15 s, so this still
// leaves ten missed frames of headroom before a reading is called stale.
constexpr unsigned long BIO_PUBLISH_MS    = 1500;   // HR/SpO2 while a finger is on
constexpr unsigned long FADE_INTERVAL_MS  = 15;
constexpr unsigned long ALERT_DURATION_MS = 6000;
constexpr unsigned long RECONNECT_MS      = 3000;
constexpr unsigned long DISPLAY_MS        = 500;    // OLED full frame ~7 ms over SPI
constexpr uint8_t       FADE_STEP         = 6;      // ~0.6 s for a full swing

// ---- biometrics -----------------------------------------------------------
constexpr int      BIO_BUFFER      = 100;    // 4 s @ 25 Hz effective
constexpr int      BIO_STRIDE      = 25;     // recompute once per second
constexpr uint32_t FINGER_IR_FLOOR = 50000;  // below this, nothing is on the sensor

// Maxim's reference HR algorithm occasionally locks onto a harmonic of the true
// rate instead of the rate itself, which shows up as the output alternating
// between two clusters roughly a beat-doubling apart from one recompute to the
// next — a real heart does not swing 50+ bpm in one second. Rather than trust
// each raw estimate, the published value is slew-limited toward it by at most
// this many bpm per recompute (~1 s), which a genuine change comfortably
// clears within a couple of seconds but a one-shot glitch cannot. See
// smoothHeartRate() in sensors.cpp.
constexpr float HR_MAX_STEP_BPM = 6.0f;

// ---- simulation -----------------------------------------------------------
// Lets the whole WiFi -> MQTT -> Laravel -> app chain be built and tested
// before the sensor is physically wired. Set back to 0 the moment it is.
//
// While this is 1 every MQTT payload carries "simulated": true and the OLED
// shows a SIM tag, so a simulated run can never quietly end up as evidence in
// the report or as rows in the training set.
#define SIMULATE_BIO 0   // MAX30102

#if SIMULATE_BIO
  #pragma message("AuraFlow: SIMULATED biometric data is enabled — see config.h")
#endif
