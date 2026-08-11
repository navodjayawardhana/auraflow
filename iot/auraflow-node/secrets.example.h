// Copy to `secrets.h` and fill in. `secrets.h` is git-ignored.
#pragma once

// ---- WiFi -------------------------------------------------------------
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

// ---- MQTT broker ------------------------------------------------------
// Demo:   broker.hivemq.com : 1883   (public, no auth)
// Report: a local Mosquitto on your laptop — then you can claim in the
//         privacy section that biometric data never leaves the LAN.
#define MQTT_HOST       "broker.hivemq.com"
#define MQTT_PORT       1883
#define MQTT_USER       ""            // "" = anonymous
#define MQTT_PASS       ""

// ---- Device identity --------------------------------------------------
// Must match the device_id stored against the user in Laravel.
// On a public broker make this unique, or a stranger's traffic lands here.
#define DEVICE_ID       "auraflow-node-01"
