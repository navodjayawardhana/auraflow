// The "pair" half of the node — a phone talking to the hardware directly.
//
// MQTT gets telemetry off the device and to anywhere with internet. BLE does the
// opposite job: it works with no network at all, at watch-like latency, and it is what
// a phone expects a wearable to speak. Both run together rather than one replacing the
// other, because they answer different questions:
//
//   BLE   live vitals, in the room, offline. Notifies on every fresh reading.
//   MQTT  remote control and remote monitoring, from anywhere, with retained state.
//
// The heart rate is exposed as the *standard* Heart Rate Service (0x180D) rather than
// something bespoke. That is deliberate: it is the same service a Polar strap or a
// Garmin exposes, so a generic BLE heart-rate app can read this node without knowing
// anything about AuraFlow — which is also how we validate that the values leaving the
// device are correct rather than merely self-consistent.
//
// SpO2 has no equally simple standard equivalent (0x1822 Pulse Oximeter is a heavyweight
// spec built around stored records), so it, the contact quality and the lamp live on a
// small custom service instead.
#pragma once

#include <Arduino.h>

#include "light.h"
#include "sensors.h"

namespace Ble {

void begin(const char* deviceName);

// Push a fresh reading to any subscribed phone. Cheap when nobody is connected.
void publishBiometrics(const BioReading& reading);

// Mirror the lamp so a phone that changed it — or that connected after the physical
// button did — reads the truth rather than its own last guess.
void publishLightState(LightMode mode, uint8_t brightness);

// True while a phone holds a connection. The OLED shows this so the node can be
// demonstrated without looking at the phone.
bool isConnected();

// True once if a phone changed the lamp over BLE since the last call, so the MQTT state
// topic can attribute the change honestly instead of reporting a mystery.
bool consumeLightWriteFlag();

// Restarts advertising after a disconnect. Call from loop(); it self-throttles.
void update();

}  // namespace Ble
