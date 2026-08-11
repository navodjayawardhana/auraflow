/*
 * AuraFlow — IoT Wellbeing Node
 * CMP 7003 · PRAC1 · W10.13
 *
 * Board  : ESP32 DevKit v1
 * Frame  : Arduino
 *
 * One node, three jobs:
 *
 *   SENSE (environment)  DHT22 + LDR + electret mic
 *                        -> room temperature / humidity / light / noise, the
 *                           sleep-quality features the wrist device has no
 *                           sensor for. Feeds the Week 8 ML model.
 *
 *   SENSE (biometrics)   MAX30102 -> live HR + SpO2, MAX30205 -> skin temp.
 *                        The Huawei Fit exposes no 0x180D Heart Rate service
 *                        (measured 2026-08-08), so this is the system's only
 *                        live biometric stream, and the reference we validate
 *                        the watch's Health Connect samples against.
 *
 *   ACT (circadian lamp) WS2812 ring driven by geofence / break / bedtime /
 *                        posture-alert events from the app.
 *
 *   SHOW (OLED)          SSD1306 mirrors HR / SpO2 / skin temp / lamp mode so
 *                        the node can be demoed without a phone in shot.
 *
 * The node stays deliberately dumb: it reports and it obeys. All the deciding
 * happens in the app and the Laravel API, which is what keeps the ML model and
 * the user's rules in one place instead of smeared across firmware.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

#include "config.h"
#include "secrets.h"
#include "light.h"
#include "sensors.h"
#include "display.h"

// ---------------------------------------------------------------- topics
String topicLightSet;
String topicLightState;
String topicEnv;
String topicBio;
String topicStatus;

WiFiClient   net;
PubSubClient mqtt(net);

// ---------------------------------------------------------------- state
LightMode   publishedMode       = LIGHT_OFF;
uint8_t     publishedBrightness = 255;   // impossible value -> forces first publish
const char* pendingSource       = "boot";

BioReading    lastBio          = {};
bool          haveBio          = false;
bool          lastFingerState  = false;
unsigned long lastEnvMs        = 0;
unsigned long lastBioMs        = 0;
unsigned long lastReconnectMs  = 0;

// ---------------------------------------------------------------- publishing
void publishLightState() {
  if (!mqtt.connected()) return;

  JsonDocument doc;
  doc["mode"]       = Light::nameOf(Light::mode());
  doc["brightness"] = Light::brightness();
  doc["source"]     = pendingSource;        // mqtt | button | boot | alert-expired
  doc["rssi"]       = WiFi.RSSI();
  doc["uptime_s"]   = millis() / 1000;

  char buf[192];
  const size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topicLightState.c_str(), (const uint8_t*)buf, n, true);  // retained

  publishedMode       = Light::mode();
  publishedBrightness = Light::brightness();

  Serial.printf("[light] %s @ %u%% (%s)\n",
                Light::nameOf(Light::mode()), Light::brightness(), pendingSource);
}

void publishEnvironment() {
  const EnvReading e = Sensors::readEnvironment();

  JsonDocument doc;
  if (e.dhtOk) {
    doc["temperature_c"] = round(e.temperatureC * 10) / 10.0;
    doc["humidity_pct"]  = round(e.humidityPct * 10) / 10.0;
  } else {
    doc["dht_error"] = true;      // be honest rather than publishing NaN as 0
  }
  doc["ambient_pct"] = e.ambientPct;
  doc["noise_pct"]   = e.noisePct;
  doc["light_mode"]  = Light::nameOf(Light::mode());
  doc["uptime_s"]    = millis() / 1000;
#if SIMULATE_ENV
  doc["simulated"] = true;      // the API must be able to keep this out of the
                                // training set — see config.h
#endif

  char buf[256];
  const size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topicEnv.c_str(), (const uint8_t*)buf, n, false);

  Serial.printf("[env] %.1fC %.0f%%RH light=%u noise=%u\n",
                e.temperatureC, e.humidityPct, e.ambientPct, e.noisePct);
}

void publishBiometrics(const BioReading& b) {
  JsonDocument doc;
  doc["finger"]  = b.fingerPresent;
  doc["ir_mean"] = b.irMean;                 // contact quality
  if (b.heartRateValid) doc["hr_bpm"] = b.heartRate;
  if (b.spo2Valid)      doc["spo2_pct"] = b.spo2;
  // Fingertip SKIN temperature, deliberately not called body_temp: it runs
  // several degrees under core and must not be reported as a fever reading.
  if (b.bodyTempValid)  doc["skin_temp_c"] = round(b.bodyTempC * 100) / 100.0;
  doc["hr_valid"]        = b.heartRateValid;
  doc["spo2_valid"]      = b.spo2Valid;
  doc["skin_temp_valid"] = b.bodyTempValid;
  doc["uptime_s"]        = millis() / 1000;
#if SIMULATE_BIO
  doc["simulated"] = true;
#endif

  char buf[256];
  const size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topicBio.c_str(), (const uint8_t*)buf, n, false);

  if (b.fingerPresent) {
    Serial.printf("[bio] hr=%ld(%d) spo2=%ld(%d) skin=%.2f(%d) ir=%lu\n",
                  (long)b.heartRate, b.heartRateValid,
                  (long)b.spo2, b.spo2Valid,
                  b.bodyTempC, b.bodyTempValid, (unsigned long)b.irMean);
  }
}

// ---------------------------------------------------------------- MQTT
void onMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[mqtt] bad JSON on %s: %s\n", topic, err.c_str());
    return;
  }

  const char* modeStr = doc["mode"] | "";
  LightMode m;
  if (!Light::parseMode(modeStr, m)) {
    Serial.printf("[mqtt] unknown mode '%s'\n", modeStr);
    return;
  }

  int pct = doc["brightness"] | (int)Light::brightness();
  pct = constrain(pct, 0, 100);

  pendingSource = "mqtt";
  Light::set(m, (uint8_t)pct);
}

bool connectMqtt() {
  const String clientId =
      String("auraflow-") + DEVICE_ID + "-" + String(random(0xffff), HEX);

  Serial.printf("[mqtt] connecting to %s:%d ... ", MQTT_HOST, MQTT_PORT);

  const bool ok = mqtt.connect(
      clientId.c_str(),
      strlen(MQTT_USER) ? MQTT_USER : nullptr,
      strlen(MQTT_PASS) ? MQTT_PASS : nullptr,
      topicStatus.c_str(), /* willQos */ 1, /* willRetain */ true, "offline");

  if (!ok) {
    Serial.printf("failed, rc=%d\n", mqtt.state());
    return false;
  }

  Serial.println("connected");
  mqtt.publish(topicStatus.c_str(), "online", true);
  mqtt.subscribe(topicLightSet.c_str(), 1);

  pendingSource = "boot";
  publishLightState();
  return true;
}

// ---------------------------------------------------------------- input
void handleButton() {
  static bool          lastRaw     = HIGH;
  static bool          stableState = HIGH;
  static unsigned long lastChange  = 0;

  const bool raw = digitalRead(PIN_BUTTON);
  if (raw != lastRaw) {
    lastRaw    = raw;
    lastChange = millis();
    return;
  }

  if (millis() - lastChange < 40) return;   // debounce
  if (raw == stableState) return;

  stableState = raw;
  if (stableState == LOW) {                 // pressed
    pendingSource = "button";
    Light::set(Light::mode() == LIGHT_OFF ? LIGHT_FOCUS : LIGHT_OFF,
               Light::brightness());
  }
}

// ---------------------------------------------------------------- setup
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[AuraFlow] IoT wellbeing node");

  pinMode(PIN_BUTTON, INPUT_PULLUP);
  Light::begin();
  Sensors::begin();     // brings up Wire — must run before Display::begin()
  Display::begin();

  if (Sensors::simulated()) {
    Serial.println("[warn] simulated sensor data — payloads carry \"simulated\":true");
  }

  const String base = String("auraflow/") + DEVICE_ID;
  topicLightSet   = base + "/light/set";
  topicLightState = base + "/light/state";
  topicEnv        = base + "/telemetry/environment";
  topicBio        = base + "/telemetry/biometrics";
  topicStatus     = base + "/status";

  Display::message("AuraFlow", "connecting wifi...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[wifi] connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print('.');
  }
  Serial.printf("\n[wifi] %s  rssi=%d\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());

  randomSeed(micros());
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30);
  connectMqtt();
}

void loop() {
  if (!mqtt.connected()) {
    if (millis() - lastReconnectMs > RECONNECT_MS) {
      lastReconnectMs = millis();
      connectMqtt();
    }
  } else {
    mqtt.loop();

    // The lamp can change from MQTT, from the button, or on its own when an
    // alert expires. One comparison here covers all three.
    if (Light::mode() != publishedMode ||
        Light::brightness() != publishedBrightness) {
      if (publishedMode == LIGHT_ALERT && Light::mode() != LIGHT_ALERT) {
        pendingSource = "alert-expired";
      }
      publishLightState();
    }

    if (millis() - lastEnvMs > ENV_PUBLISH_MS) {
      lastEnvMs = millis();
      publishEnvironment();
    }

    if (haveBio) {
      // Publish on a fixed cadence while a finger is on the sensor, plus once
      // immediately whenever the finger goes on or comes off, so the app can
      // show "measuring…" without waiting out the interval.
      const bool changed = lastBio.fingerPresent != lastFingerState;
      if (changed || (lastBio.fingerPresent && millis() - lastBioMs > BIO_PUBLISH_MS)) {
        lastFingerState = lastBio.fingerPresent;
        lastBioMs       = millis();
        publishBiometrics(lastBio);
      }
    }
  }

  Sensors::update();
  if (Sensors::takeBiometrics(lastBio)) haveBio = true;

  handleButton();
  Light::update();

  DisplayState ds;
  ds.wifiUp     = WiFi.status() == WL_CONNECTED;
  ds.mqttUp     = mqtt.connected();
  ds.rssi       = WiFi.RSSI();
  ds.haveBio    = haveBio;
  ds.bio        = lastBio;
  ds.lightMode  = Light::nameOf(Light::mode());
  ds.brightness = Light::brightness();
  Display::update(ds);      // self-rate-limited to DISPLAY_MS
}
