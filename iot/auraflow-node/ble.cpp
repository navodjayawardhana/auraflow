#include "ble.h"

#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

#include "config.h"

namespace {

// ---- standard SIG assignments ---------------------------------------------
// Using the real Heart Rate Service means any generic BLE HR app can read this node,
// which is both a nicer integration story and a way to check our values independently.
constexpr char SVC_HEART_RATE[]      = "0000180d-0000-1000-8000-00805f9b34fb";
constexpr char CHR_HR_MEASUREMENT[]  = "00002a37-0000-1000-8000-00805f9b34fb";
constexpr char CHR_BODY_LOCATION[]   = "00002a38-0000-1000-8000-00805f9b34fb";
constexpr char SVC_DEVICE_INFO[]     = "0000180a-0000-1000-8000-00805f9b34fb";
constexpr char CHR_MANUFACTURER[]    = "00002a29-0000-1000-8000-00805f9b34fb";

// ---- AuraFlow's own service ------------------------------------------------
// Everything the SIG has no lightweight equivalent for.
constexpr char SVC_AURAFLOW[]        = "a17a0000-5f1e-4b2c-9d3a-6c8e21f0b100";
constexpr char CHR_VITALS[]          = "a17a0001-5f1e-4b2c-9d3a-6c8e21f0b100";  // notify
constexpr char CHR_LAMP[]            = "a17a0002-5f1e-4b2c-9d3a-6c8e21f0b100";  // read/write/notify

constexpr uint8_t BODY_LOCATION_FINGER = 3;  // per the SIG's enumeration

BLEServer*         server        = nullptr;
BLECharacteristic* chrHeartRate  = nullptr;
BLECharacteristic* chrVitals     = nullptr;
BLECharacteristic* chrLamp       = nullptr;

volatile bool connected       = false;
volatile bool wasConnected    = false;
unsigned long disconnectedAt  = 0;

// Set when a phone changed the lamp over BLE, so the main loop can attribute the change
// on the MQTT state topic — a remote watcher should see "ble", not a mystery.
volatile bool bleDidSetLight  = false;

/** Restart advertising after a client leaves, so the node is always discoverable. */
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { connected = true; }

  void onDisconnect(BLEServer*) override {
    connected = false;
    disconnectedAt = millis();
  }
};

/**
 * A phone writing `{"mode":"focus","brightness":80}` — the same shape the MQTT command
 * topic accepts, so one payload format serves both transports and the app has one
 * encoder rather than two.
 */
class LampCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    // Arduino String, not std::string: the ESP32 core changed this return type in 3.x,
    // and the old signature is what kept this sketch from building against the installed
    // core at all. Taking whatever getValue() hands back keeps it building across both.
    const String value = characteristic->getValue();
    if (value.isEmpty()) return;

    JsonDocument doc;
    if (deserializeJson(doc, value.c_str()) != DeserializationError::Ok) return;

    // Light::parseMode is the same validator the MQTT path uses, so an unknown mode is
    // rejected identically over either transport rather than each having its own idea.
    LightMode mode = Light::mode();
    const char* requested = doc["mode"] | "";
    if (requested[0] != '\0' && !Light::parseMode(requested, mode)) return;

    const uint8_t brightness =
        (uint8_t)constrain((int)(doc["brightness"] | (int)Light::brightness()), 0, 100);

    Light::set(mode, brightness);
    bleDidSetLight = true;
  }
};

}  // namespace

namespace Ble {

void begin(const char* deviceName) {
  BLEDevice::init(deviceName);

  server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  // ---- Heart Rate Service (standard) ----
  BLEService* heartRate = server->createService(SVC_HEART_RATE);

  chrHeartRate = heartRate->createCharacteristic(
      CHR_HR_MEASUREMENT, BLECharacteristic::PROPERTY_NOTIFY);
  chrHeartRate->addDescriptor(new BLE2902());

  BLECharacteristic* location = heartRate->createCharacteristic(
      CHR_BODY_LOCATION, BLECharacteristic::PROPERTY_READ);
  uint8_t finger = BODY_LOCATION_FINGER;
  location->setValue(&finger, 1);

  heartRate->start();

  // ---- AuraFlow service ----
  BLEService* auraflow = server->createService(SVC_AURAFLOW);

  chrVitals = auraflow->createCharacteristic(
      CHR_VITALS, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  chrVitals->addDescriptor(new BLE2902());

  chrLamp = auraflow->createCharacteristic(
      CHR_LAMP,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE |
          BLECharacteristic::PROPERTY_NOTIFY);
  chrLamp->addDescriptor(new BLE2902());
  chrLamp->setCallbacks(new LampCallbacks());

  auraflow->start();

  // ---- Device Information ----
  BLEService* info = server->createService(SVC_DEVICE_INFO);
  BLECharacteristic* manufacturer =
      info->createCharacteristic(CHR_MANUFACTURER, BLECharacteristic::PROPERTY_READ);
  manufacturer->setValue("AuraFlow");
  info->start();

  // Advertise the heart-rate service UUID so a phone scanning for wearables finds this
  // node the same way it would find a chest strap.
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SVC_HEART_RATE);
  advertising->addServiceUUID(SVC_AURAFLOW);
  advertising->setScanResponse(true);
  // Apple's connection-interval guidance; harmless on Android and avoids a stall on iOS.
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);

  BLEDevice::startAdvertising();
}

void publishBiometrics(const BioReading& reading) {
  if (!connected) return;

  // Standard Heart Rate Measurement layout: a flags byte, then the rate. Bit 0 clear
  // means "uint8 bpm", bits 1-2 say whether sensor contact is supported and detected.
  if (chrHeartRate != nullptr && reading.heartRateValid) {
    uint8_t frame[2];
    frame[0] = 0b00000110;  // uint8 value, contact supported, contact detected
    // The standard characteristic carries a whole number, so the decimal the node now
    // resolves is rounded away here and survives only on the JSON path. That is the
    // right trade: a generic heart-rate app reading this service is the independent
    // check that the value is right, and it can only read the standard layout.
    frame[1] = (uint8_t)constrain(lroundf(reading.heartRate), 0L, 255L);
    chrHeartRate->setValue(frame, sizeof(frame));
    chrHeartRate->notify();
  }

  // The rest of the picture, in the same JSON shape the MQTT topic uses so the app has
  // one parser rather than two. Optional keys are omitted when invalid, exactly as MQTT
  // does — the validity flags stay the authority.
  if (chrVitals != nullptr) {
    String json = "{\"finger\":";
    json += reading.fingerPresent ? "true" : "false";
    json += ",\"settled\":";
    json += reading.settled ? "true" : "false";
    json += ",\"ir_mean\":";
    json += reading.irMean;

    if (reading.heartRateValid) {
      json += ",\"hr_bpm\":";
      json += String(reading.heartRate, 1);
    }
    if (reading.heartRateMaximValid) {
      json += ",\"hr_bpm_maxim\":";
      json += reading.heartRateMaxim;
    }
    if (reading.spo2Valid) {
      json += ",\"spo2_pct\":";
      json += reading.spo2;
    }

    json += ",\"hr_valid\":";
    json += reading.heartRateValid ? "true" : "false";
    json += ",\"hr_maxim_valid\":";
    json += reading.heartRateMaximValid ? "true" : "false";
    json += ",\"spo2_valid\":";
    json += reading.spo2Valid ? "true" : "false";
    json += ",\"uptime_s\":";
    json += millis() / 1000;
    json += "}";

    chrVitals->setValue(json.c_str());
    chrVitals->notify();
  }
}

void publishLightState(LightMode mode, uint8_t brightness) {
  if (chrLamp == nullptr) return;

  String json = "{\"mode\":\"";
  json += Light::nameOf(mode);
  json += "\",\"brightness\":";
  json += brightness;
  json += "}";

  // Set even when nobody is listening: a phone that connects later reads the current
  // state rather than waiting for the next change.
  chrLamp->setValue(json.c_str());
  if (connected) chrLamp->notify();
}

bool isConnected() { return connected; }

bool consumeLightWriteFlag() {
  if (!bleDidSetLight) return false;
  bleDidSetLight = false;
  return true;
}

void update() {
  // The stack needs a moment to settle before it will advertise again; restarting
  // immediately after a disconnect is the classic way to end up invisible.
  if (!connected && wasConnected && millis() - disconnectedAt > 500) {
    BLEDevice::startAdvertising();
    wasConnected = false;
  }

  if (connected) wasConnected = true;
}

}  // namespace Ble
