// Copy to `secrets.h` and fill in. `secrets.h` is git-ignored.
#pragma once

// ---- WiFi, which is optional ------------------------------------------
// Leave SSID empty to run the node with the radio off. It then boots straight
// to sensing, the lamp, the OLED and BLE, and a phone pairs with it over
// Bluetooth with no network in the room at all.
//
//   #define WIFI_SSID   ""      <- BLE only, no radio, no broker
//
// Fill it in and the node additionally reports to MQTT when it can reach the
// broker, and carries on unbothered when it cannot. Neither the sensor loop nor
// BLE waits for any of it.
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

// ---- MQTT broker ------------------------------------------------------
// Only consulted when WIFI_SSID above is set.
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
