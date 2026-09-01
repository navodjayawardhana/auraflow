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
// Up to three networks, tried in turn on each retry. The SSID is compiled in, so a
// node that knows only one network cannot be re-pointed without a laptop, a cable and
// a reflash. List the alternates instead.
//
// The first is the one the demo is meant to run on. An empty SSID skips that slot;
// leaving the FIRST empty turns the radio off altogether (see above).
//
// SSIDs are case-sensitive and spaces are significant — copy the name exactly as the
// phone shows it. And an ESP32 has no 5 GHz radio: an iPhone 12 or newer runs Personal
// Hotspot at 5 GHz unless "Maximize Compatibility" is on, and until it is, the node
// cannot see the network at all.
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

#define WIFI_SSID_2     ""
#define WIFI_PASSWORD_2 ""

#define WIFI_SSID_3     ""
#define WIFI_PASSWORD_3 ""

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
