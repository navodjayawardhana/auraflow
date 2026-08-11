// Copy this file to `secrets.h` and fill in your own values.
// `secrets.h` is git-ignored — never commit real credentials.
#pragma once

// ---- WiFi -------------------------------------------------------------
// Wokwi simulator: SSID "Wokwi-GUEST", password "" , channel 6
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

// ---- MQTT broker ------------------------------------------------------
// Public test brokers (no auth, fine for the demo):
//   broker.hivemq.com : 1883
//   test.mosquitto.org: 1883
// For the report, a local Mosquitto on your laptop looks better (§privacy).
#define MQTT_HOST       "broker.hivemq.com"
#define MQTT_PORT       1883
#define MQTT_USER       ""            // "" = anonymous
#define MQTT_PASS       ""

// ---- Device identity --------------------------------------------------
// Must match the id the mobile app / Laravel API publishes to.
// Keep it unique on a public broker (add random chars).
#define DEVICE_ID       "auraflow-desk-01"
