/*
 * AuraFlow — IoT Ambient Light Node
 * CMP 7003 · PRAC1 · W10.13 (MQTT -> smart light on geofence)
 *
 * Board : ESP32 dev board  (or NodeMCU / Wemos D1 mini — ESP8266)
 * Frame : Arduino
 *
 * What it does
 *   - Subscribes to  auraflow/<DEVICE_ID>/light/set     <- commands from the app
 *   - Publishes      auraflow/<DEVICE_ID>/light/state   -> retained, so the app
 *                                                          knows the real state
 *   - Publishes      auraflow/<DEVICE_ID>/sensor/ambient-> LDR reading (the loop
 *                                                          back into the app)
 *   - LWT            auraflow/<DEVICE_ID>/status        -> online / offline
 *
 * Command payload (JSON):
 *   { "mode": "focus" | "break" | "sleep" | "alert" | "off",
 *     "brightness": 0-100 }
 *
 * Physical button = manual override; it publishes state back so the phone UI
 * stays in sync. That two-way flow is what makes this an IoT *system* rather
 * than a remote-controlled LED.
 */

#include <Arduino.h>

#if defined(ESP32)
  #include <WiFi.h>
#elif defined(ESP8266)
  #include <ESP8266WiFi.h>
#else
  #error "Needs an ESP32 or ESP8266 board — a plain Uno has no WiFi (see README)"
#endif

#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>

#include "secrets.h"

// ---------------------------------------------------------------- hardware
#if defined(ESP32)
  const uint8_t PIN_LED    = 5;    // WS2812 data
  const uint8_t PIN_BUTTON = 4;    // to GND, INPUT_PULLUP
  const uint8_t PIN_LDR    = 34;   // ADC1 — input only, no pull-up
  const int     ADC_MAX    = 4095;
#else
  const uint8_t PIN_LED    = 14;   // D5
  const uint8_t PIN_BUTTON = 12;   // D6
  const uint8_t PIN_LDR    = A0;
  const int     ADC_MAX    = 1023;
#endif

const uint8_t NUM_PIXELS = 8;

Adafruit_NeoPixel strip(NUM_PIXELS, PIN_LED, NEO_GRB + NEO_KHZ800);

// ---------------------------------------------------------------- topics
String topicSet;
String topicState;
String topicAmbient;
String topicStatus;

WiFiClient   net;
PubSubClient mqtt(net);

// ---------------------------------------------------------------- state
enum Mode { MODE_OFF, MODE_FOCUS, MODE_BREAK, MODE_SLEEP, MODE_ALERT };

struct Rgb { uint8_t r, g, b; };

Mode    currentMode    = MODE_OFF;
Mode    modeBeforeAlert= MODE_OFF;
uint8_t brightnessPct  = 70;

Rgb  shown  = {0, 0, 0};   // what the LEDs show right now (fades toward target)
Rgb  target = {0, 0, 0};

unsigned long alertUntilMs   = 0;
unsigned long lastFadeMs     = 0;
unsigned long lastAmbientMs  = 0;
unsigned long lastReconnectMs= 0;

const unsigned long FADE_INTERVAL_MS    = 15;
const uint8_t       FADE_STEP           = 6;     // ~0.6 s for a full swing
const unsigned long AMBIENT_INTERVAL_MS = 10000;
const unsigned long ALERT_DURATION_MS   = 6000;
const unsigned long RECONNECT_DELAY_MS  = 3000;

// ---------------------------------------------------------------- helpers
Rgb baseColourFor(Mode m) {
  switch (m) {
    case MODE_FOCUS: return {200, 220, 255};  // cool daylight — alerting
    case MODE_BREAK: return {255, 140,  40};  // warm amber — step away
    case MODE_SLEEP: return {255,  45,   0};  // deep red — low blue light
    case MODE_ALERT: return {255,   0,   0};
    default:         return {  0,   0,   0};
  }
}

const char* nameFor(Mode m) {
  switch (m) {
    case MODE_FOCUS: return "focus";
    case MODE_BREAK: return "break";
    case MODE_SLEEP: return "sleep";
    case MODE_ALERT: return "alert";
    default:         return "off";
  }
}

bool modeFromName(const char* s, Mode& out) {
  if (!strcmp(s, "focus")) { out = MODE_FOCUS; return true; }
  if (!strcmp(s, "break")) { out = MODE_BREAK; return true; }
  if (!strcmp(s, "sleep")) { out = MODE_SLEEP; return true; }
  if (!strcmp(s, "alert")) { out = MODE_ALERT; return true; }
  if (!strcmp(s, "off"))   { out = MODE_OFF;   return true; }
  return false;
}

// Scale the mode colour by the requested brightness, so the fade only ever
// has one target to chase.
void recomputeTarget() {
  Rgb base = baseColourFor(currentMode);
  // Sleep mode is capped — a bright red lamp at 23:00 defeats the point.
  uint8_t pct = (currentMode == MODE_SLEEP) ? min<uint8_t>(brightnessPct, 35)
                                            : brightnessPct;
  target.r = (uint16_t)base.r * pct / 100;
  target.g = (uint16_t)base.g * pct / 100;
  target.b = (uint16_t)base.b * pct / 100;
}

uint8_t stepToward(uint8_t from, uint8_t to) {
  if (from == to)                return to;
  if (to > from)                 return (to - from <= FADE_STEP) ? to : from + FADE_STEP;
  return (from - to <= FADE_STEP) ? to : from - FADE_STEP;
}

void publishState(const char* source) {
  if (!mqtt.connected()) return;

  JsonDocument doc;
  doc["mode"]       = nameFor(currentMode);
  doc["brightness"] = brightnessPct;
  doc["source"]     = source;              // "mqtt" | "button" | "boot"
  doc["rssi"]       = WiFi.RSSI();
  doc["uptime_s"]   = millis() / 1000;

  char buf[192];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topicState.c_str(), (const uint8_t*)buf, n, true);  // retained
}

void applyCommand(Mode m, uint8_t pct, const char* source) {
  if (m == MODE_ALERT) {
    // Alert is transient: flash, then fall back to whatever we were doing.
    if (currentMode != MODE_ALERT) modeBeforeAlert = currentMode;
    alertUntilMs = millis() + ALERT_DURATION_MS;
  } else {
    alertUntilMs = 0;
  }
  currentMode   = m;
  brightnessPct = pct;
  recomputeTarget();
  publishState(source);

  Serial.printf("[light] mode=%s brightness=%u (%s)\n",
                nameFor(currentMode), brightnessPct, source);
}

// ---------------------------------------------------------------- MQTT
void onMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[mqtt] bad JSON on %s: %s\n", topic, err.c_str());
    return;
  }

  const char* modeStr = doc["mode"] | "";
  Mode m;
  if (!modeFromName(modeStr, m)) {
    Serial.printf("[mqtt] unknown mode '%s'\n", modeStr);
    return;
  }

  int pct = doc["brightness"] | (int)brightnessPct;
  pct = constrain(pct, 0, 100);

  applyCommand(m, (uint8_t)pct, "mqtt");
}

bool connectMqtt() {
  String clientId = String("auraflow-") + DEVICE_ID + "-" + String(random(0xffff), HEX);

  Serial.printf("[mqtt] connecting to %s:%d ... ", MQTT_HOST, MQTT_PORT);

  bool ok = mqtt.connect(
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
  mqtt.subscribe(topicSet.c_str(), 1);
  publishState("boot");
  return true;
}

// ---------------------------------------------------------------- inputs
void handleButton() {
  static bool          lastRaw     = HIGH;
  static bool          stableState = HIGH;
  static unsigned long lastChange  = 0;

  bool raw = digitalRead(PIN_BUTTON);
  if (raw != lastRaw) { lastRaw = raw; lastChange = millis(); return; }

  if (millis() - lastChange < 40) return;      // debounce
  if (raw == stableState) return;

  stableState = raw;
  if (stableState == LOW) {                    // pressed
    Mode next = (currentMode == MODE_OFF) ? MODE_FOCUS : MODE_OFF;
    applyCommand(next, brightnessPct, "button");
  }
}

void publishAmbient() {
  int raw = analogRead(PIN_LDR);
  // 0 = pitch dark, 100 = bright. Rough, but consistent enough for the app to
  // decide "the room is dark, dim the lamp / suggest wind-down".
  int pct = map(raw, 0, ADC_MAX, 0, 100);
  pct = constrain(pct, 0, 100);

  JsonDocument doc;
  doc["ambient"] = pct;
  doc["raw"]     = raw;
  doc["mode"]    = nameFor(currentMode);

  char buf[128];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topicAmbient.c_str(), (const uint8_t*)buf, n, false);
}

// ---------------------------------------------------------------- render
void renderLeds() {
  if (millis() - lastFadeMs < FADE_INTERVAL_MS) return;
  lastFadeMs = millis();

  // Alert overrides the fade with a triangle pulse, then restores.
  if (currentMode == MODE_ALERT) {
    if (millis() > alertUntilMs) {
      applyCommand(modeBeforeAlert, brightnessPct, "alert-expired");
    } else {
      uint16_t phase = millis() % 800;                    // 0.8 s per pulse
      uint8_t  level = (phase < 400) ? (phase * 255 / 400)
                                     : ((800 - phase) * 255 / 400);
      shown = { level, 0, 0 };
      strip.fill(strip.Color(shown.r, shown.g, shown.b));
      strip.show();
      return;
    }
  }

  if (shown.r == target.r && shown.g == target.g && shown.b == target.b) return;

  shown.r = stepToward(shown.r, target.r);
  shown.g = stepToward(shown.g, target.g);
  shown.b = stepToward(shown.b, target.b);

  strip.fill(strip.Color(shown.r, shown.g, shown.b));
  strip.show();
}

// ---------------------------------------------------------------- setup
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[AuraFlow] IoT ambient light node");

  pinMode(PIN_BUTTON, INPUT_PULLUP);
  strip.begin();
  strip.clear();
  strip.show();

  String base  = String("auraflow/") + DEVICE_ID;
  topicSet     = base + "/light/set";
  topicState   = base + "/light/state";
  topicAmbient = base + "/sensor/ambient";
  topicStatus  = base + "/status";

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[wifi] connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print('.');
  }
  Serial.printf("\n[wifi] %s  rssi=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());

  randomSeed(micros());
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30);
  connectMqtt();
}

void loop() {
  if (!mqtt.connected()) {
    if (millis() - lastReconnectMs > RECONNECT_DELAY_MS) {
      lastReconnectMs = millis();
      connectMqtt();
    }
  } else {
    mqtt.loop();
    if (millis() - lastAmbientMs > AMBIENT_INTERVAL_MS) {
      lastAmbientMs = millis();
      publishAmbient();
    }
  }

  handleButton();
  renderLeds();
}
