/*
 * AuraFlow — IoT Wellbeing Node
 * CMP 7003 · PRAC1 · W10.13
 *
 * Board  : ESP32 DevKitC (38-pin)
 * Frame  : Arduino
 *
 * Built against the parts that actually arrived (2026-08-12): ESP32 DevKitC (38-pin),
 * MAX30102, SSD1306 0.96" SPI, TP4056. Three jobs, down from four:
 *
 *   SENSE (biometrics)   MAX30102 -> live HR + SpO2. The Huawei Fit exposes no
 *                        0x180D Heart Rate service (measured 2026-08-08), so
 *                        this is the system's only live biometric stream, and
 *                        the reference we validate the watch's Health Connect
 *                        samples against.
 *
 *   ACT (circadian lamp) The DevKit's onboard LED under PWM, driven by
 *                        geofence / break / bedtime / posture-alert events from
 *                        the app. The WS2812 ring never arrived, so the modes
 *                        are carried by brightness and motion instead of hue.
 *
 *   SHOW (OLED)          SSD1306 mirrors HR / SpO2 and the lamp mode so the
 *                        node can be demoed without a phone in shot.
 *
 * Deliberately NOT here: room temperature, humidity, ambient light and noise.
 * The DHT22, LDR and mic never arrived, and rather than publish a stand-in
 * dressed up as a room measurement the environment topic is gone. What used to
 * be `telemetry/environment` is now `telemetry/device` and carries only node
 * health — every field in it is something the ESP32 genuinely knows.
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
#include "ble.h"
#include "light.h"
#include "sensors.h"
#include "display.h"

// ---------------------------------------------------------------- topics
String topicLightSet;
String topicLightState;
String topicDevice;
String topicBio;
String topicStatus;

WiFiClient   net;
PubSubClient mqtt(net);

// ---------------------------------------------------------------- state
LightMode   publishedMode       = LIGHT_OFF;
uint8_t     publishedBrightness = 255;   // impossible value -> forces first publish
const char* pendingSource       = "boot";

// Mirrored separately for BLE, because that path publishes whether or not MQTT is up.
LightMode   bleMode             = LIGHT_OFF;
uint8_t     bleBrightness       = 255;   // as above, forces the first mirror

BioReading    lastBio          = {};
bool          haveBio          = false;
bool          lastFingerState  = false;
unsigned long lastDeviceMs     = 0;
unsigned long lastBioMs        = 0;
unsigned long lastIdleLogMs    = 0;
unsigned long lastReconnectMs  = 0;

// ---------------------------------------------------------------- networking
// Whether this build has a network at all. An empty SSID is a supported configuration —
// see secrets.example.h. Tested here rather than in config.h because that header is
// included before secrets.h, and by four translation units that have no business seeing
// credentials.
constexpr bool WIFI_CONFIGURED = sizeof(WIFI_SSID) > 1;

unsigned long lastWifiAttemptMs = 0;
unsigned long mqttRetryMs       = MQTT_RETRY_MIN_MS;
bool          wasWifiUp         = false;

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

// Node health, not room environment. Every field here is something the board
// measures about itself — there is no sensor on this build that can see the
// room, and nothing in this payload pretends to.
void publishDevice() {
  const bool online = mqtt.connected();

  // The serial line goes out whichever way, because on a node with no broker it is the
  // only health report there is, and "is the sensor still there?" is the question the
  // watchdog exists to answer.
  Serial.printf("[device] %s heap=%lu uptime=%lus pulse=%d rate=%.2f dropped=%lu\n",
                online ? "online" : (WIFI_CONFIGURED ? "no broker" : "ble-only"),
                (unsigned long)ESP.getFreeHeap(),
                (unsigned long)(millis() / 1000),
                Sensors::pulseSensorPresent(),
                Sensors::sampleRateHz(),
                (unsigned long)Sensors::droppedSamples());

  if (!online) return;

  JsonDocument doc;
  doc["rssi"]           = WiFi.RSSI();
  doc["ip"]             = WiFi.localIP().toString();
  doc["uptime_s"]       = millis() / 1000;
  doc["heap_free_b"]    = ESP.getFreeHeap();
  doc["light_mode"]     = Light::nameOf(Light::mode());
  doc["pulse_sensor"]   = Sensors::pulseSensorPresent();

  // The measured sample rate, not the nominal 25 Hz. Drifting from it is the earliest
  // visible sign the loop is falling behind the sensor, and `dropped_samples` is what
  // that has already cost — both belong on the health topic rather than in a serial log
  // nobody is watching during a demo.
  doc["sample_rate_hz"]  = round(Sensors::sampleRateHz() * 100) / 100.0;
  doc["dropped_samples"] = Sensors::droppedSamples();

  // MAX30102 on-die temperature: a diagnostic that shows the LEDs warming, NOT
  // a skin or body temperature. Named so it cannot be mistaken for one, and
  // skipped entirely while a finger is on the sensor — see sensors.h.
  float dieC;
  if (Sensors::readDieTemperature(dieC)) {
    doc["sensor_die_temp_c"] = round(dieC * 100) / 100.0;
  }
#if SIMULATE_BIO
  doc["simulated"] = true;      // the API must be able to keep this out of the
                                // training set — see config.h
#endif

  char buf[256];
  const size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topicDevice.c_str(), (const uint8_t*)buf, n, false);

  Serial.printf("[device] rssi=%d heap=%lu uptime=%lus\n",
                WiFi.RSSI(), (unsigned long)ESP.getFreeHeap(),
                (unsigned long)(millis() / 1000));
}

void publishBiometrics(const BioReading& b) {
  JsonDocument doc;
  doc["finger"]  = b.fingerPresent;
  doc["settled"] = b.settled;                // finger down long enough to mean anything
  doc["ir_mean"] = b.irMean;                 // contact quality

  // Two rates from one signal. `hr_bpm` is the beat-interval estimate and the one any
  // consumer should read; `hr_bpm_maxim` is the reference algorithm, kept alongside it
  // so the evaluation can measure them against each other as well as against the watch.
  // One decimal, because the whole reason for the second estimator is that the first
  // cannot express a value between its steps.
  if (b.heartRateValid)      doc["hr_bpm"] = round(b.heartRate * 10) / 10.0;
  if (b.heartRateMaximValid) doc["hr_bpm_maxim"] = b.heartRateMaxim;
  if (b.spo2Valid)           doc["spo2_pct"] = b.spo2;
  /*
   * How many beat intervals the estimator is holding, out of the three it reports on.
   *
   * Published because the wait is the complaint. A finger goes down and nothing appears for
   * something over six seconds -- a second before beats are even looked for, three
   * intervals to collect, then up to a publish period -- and a card that says only
   * "measuring" for all of it gives no way to tell a slow measurement from a stalled one.
   *
   * It is also the diagnosis. If this keeps falling back to zero the intervals are being
   * discarded rather than accumulated, which is a signal problem the person holding the
   * sensor can act on and nobody else can see.
   */
  {
    float medianMs, loMs, hiMs;
    int intervals;
    Sensors::beatDebug(intervals, medianMs, loMs, hiMs);
    doc["beats"] = intervals;
    doc["beats_needed"] = HR_BEAT_MIN_INTERVALS;
  }

  doc["hr_valid"]       = b.heartRateValid;
  doc["hr_maxim_valid"] = b.heartRateMaximValid;
  doc["spo2_valid"]     = b.spo2Valid;
  doc["uptime_s"]       = millis() / 1000;
#if SIMULATE_BIO
  doc["simulated"] = true;
#endif

  if (mqtt.connected()) {
    char buf[256];
    const size_t n = serializeJson(doc, buf, sizeof(buf));
    mqtt.publish(topicBio.c_str(), (const uint8_t*)buf, n, false);
  }

  // Below the broker guard on purpose. `iot/analysis/session/log_session.ps1` reads the
  // agreement session off this line, and the session that matters most — a node on a
  // bench with a watch, nowhere near the demo network — is exactly the one with no
  // broker. Silencing the log when MQTT is down would make the evidence unobtainable in
  // the case it is collected in.
  if (b.fingerPresent) {
    // The detector's internals ride along on the serial line only. Tuning the gate or the
    // refractory from the published rate alone is guesswork — what matters is how many
    // intervals the estimator has kept and how far apart they are. Swing and the perfusion
    // gate are gone from here with the detector that owned them; the library's equivalents
    // are internal to it and it offers no way to read them.
    float medianMs, loMs, hiMs;
    int intervals;
    Sensors::beatDebug(intervals, medianMs, loMs, hiMs);

    Serial.printf(
        "[bio] hr=%.1f(%d) maxim=%ld(%d) spo2=%ld(%d) ir=%lu "
        "n=%d med=%.0f lo=%.0f hi=%.0f %s\n",
        b.heartRate, b.heartRateValid,
        (long)b.heartRateMaxim, b.heartRateMaximValid,
        (long)b.spo2, b.spo2Valid, (unsigned long)b.irMean,
        intervals, medianMs, loMs, hiMs,
        b.settled ? "" : "settling");
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
// The BOOT button on GPIO0. It already has a pull-up on the board; INPUT_PULLUP
// is belt and braces. Pressing it during a reset enters download mode, which is
// only a problem if you hold it through one.
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
  Sensors::begin();
  Display::begin();

  // Before Wi-Fi, so a phone can pair and read vitals even where there is no network at
  // all. BLE is the local path; MQTT below is the remote one. They coexist rather than
  // one superseding the other — see ble.h.
  Ble::begin(DEVICE_ID);
  Serial.println("[ble] advertising as " DEVICE_ID);

  if (Sensors::simulated()) {
    Serial.println("[warn] simulated sensor data — payloads carry \"simulated\":true");
  }

  const String base = String("auraflow/") + DEVICE_ID;
  topicLightSet   = base + "/light/set";
  topicLightState = base + "/light/state";
  topicDevice     = base + "/telemetry/device";
  topicBio        = base + "/telemetry/biometrics";
  topicStatus     = base + "/status";

  randomSeed(micros());

  if (!WIFI_CONFIGURED) {
    // Not a failure and not a fallback. A node with no SSID is a sensor with a Bluetooth
    // link, which is a complete product on its own and the one the phone demo uses.
    Serial.println("[wifi] no SSID configured — running BLE only");
    Display::message("AuraFlow", "bluetooth only");
    return;
  }

  // Started, not waited for. This used to spin in a `while` until the access point
  // answered, which meant a node that could not see its network never reached the sensor
  // loop, never lit the lamp, never drew the OLED and never advertised — the entire
  // device held hostage by the one part of it that is optional. Wi-Fi now catches up with
  // a node that is already running.
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptMs = millis();
  Serial.println("[wifi] associating in the background");
  Display::message("AuraFlow", "starting...");

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30);
  // The default socket timeout is 15 seconds and connect() blocks for all of it. The
  // sensor driver buffers 160 ms, so one failed attempt at the default would cost the
  // best part of four hundred samples. Four seconds still clears a slow DNS lookup, and
  // the backoff in `serviceNetwork()` is what stops even four seconds being paid often.
  mqtt.setSocketTimeout(4);
}

// Wi-Fi and the broker, both without ever blocking the sensor loop.
//
// Called once a pass. Everything here is on a timer; nothing here waits for anything
// except the one `mqtt.connect()` that is worth up to four seconds, and the backoff
// makes that rare.
void serviceNetwork() {
  if (!WIFI_CONFIGURED) return;

  const unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (wasWifiUp) {
      wasWifiUp = false;
      Serial.println("[wifi] lost");
    }
    // `setAutoReconnect` covers a network that dropped and came back. Re-issuing
    // `begin()` covers the case it does not: an access point that was not there when the
    // node booted.
    if (now - lastWifiAttemptMs > WIFI_RETRY_MS) {
      lastWifiAttemptMs = now;
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
    return;
  }

  if (!wasWifiUp) {
    wasWifiUp = true;
    // Reset the backoff: a fresh network is a genuinely new chance for the broker, and
    // making it wait out a minute earned on a different network is just a slow demo.
    mqttRetryMs = MQTT_RETRY_MIN_MS;
    lastReconnectMs = 0;
    Serial.printf("[wifi] %s  rssi=%d\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
  }

  if (mqtt.connected()) {
    mqtt.loop();
    return;
  }

  if (lastReconnectMs != 0 && now - lastReconnectMs < mqttRetryMs) return;
  lastReconnectMs = now;

  if (connectMqtt()) {
    mqttRetryMs = MQTT_RETRY_MIN_MS;
  } else {
    // Doubling rather than a flat interval, because a broker that refused one attempt
    // usually refuses the next twenty, and each refusal is paid for in samples.
    mqttRetryMs = min(mqttRetryMs * 2, MQTT_RETRY_MAX_MS);
  }
}

void loop() {
  // Drained three times a pass: here, after the MQTT block, and after BLE. The driver
  // holds four samples — 160 ms — and either of those sections can exceed that on a slow
  // network or during a reconnect. Draining around them rather than only after keeps the
  // gap inside the budget in the cases that would otherwise lose signal silently.
  Sensors::update();

  serviceNetwork();

  // Everything below used to sit in the `else` of `if (!mqtt.connected())`, which made
  // the broker the gatekeeper of the node's own behaviour: without it the cadence timers
  // never ran, the serial `[bio]` line the analysis scripts parse never printed, and the
  // idle IR log — the one thing that tells you a sensor is alive and merely untouched —
  // was silent in precisely the situation where someone is asking why nothing is
  // happening. The publishes are gated individually now, and the node is not.

  // The lamp can change from MQTT, from the button, or on its own when an
  // alert expires. One comparison here covers all three.
  if (Light::mode() != publishedMode ||
      Light::brightness() != publishedBrightness) {
    if (publishedMode == LIGHT_ALERT && Light::mode() != LIGHT_ALERT) {
      pendingSource = "alert-expired";
    }
    // Off-broker this only records what was published, so a node that later connects
    // sends its current state rather than replaying a change nobody heard.
    if (mqtt.connected()) {
      publishLightState();
    } else {
      publishedMode       = Light::mode();
      publishedBrightness = Light::brightness();
    }
  }

  if (millis() - lastDeviceMs > DEVICE_PUBLISH_MS) {
    lastDeviceMs = millis();
    publishDevice();
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

  // Serial only, and only while idle. An empty sensor publishes nothing — correctly,
  // there is nothing to say — but that leaves the log silent in exactly the case where
  // someone is asking why nothing is happening. The IR level answers it outright.
  if (haveBio && !lastBio.fingerPresent && millis() - lastIdleLogMs > IDLE_LOG_MS) {
    lastIdleLogMs = millis();
    Serial.printf("[bio] no finger — ir=%lu (contact floor %lu)\n",
                  (unsigned long)lastBio.irMean, (unsigned long)FINGER_IR_FLOOR);
  }

  Sensors::update();

  if (Sensors::takeBiometrics(lastBio)) {
    haveBio = true;

    // Deliberately outside the MQTT branch above, and deliberately unthrottled: BLE is
    // the local path, so a paired phone gets every reading the sensor produces (~1 Hz)
    // whether or not there is a network. That is what makes it feel like a watch rather
    // than a web page, and it is the whole reason both transports exist.
    Ble::publishBiometrics(lastBio);
  }

  handleButton();
  Light::update();
  Ble::update();
  Sensors::update();

  // A phone can drive the lamp over BLE too, so the remote state topic has to hear about
  // it rather than reporting a change it cannot explain.
  if (Ble::consumeLightWriteFlag()) {
    pendingSource = "ble";
  }

  // Mirrored to BLE only on a change: rebuilding the JSON every loop would burn the heap
  // for nothing, and a characteristic holds its last value for a late-connecting phone.
  if (Light::mode() != bleMode || Light::brightness() != bleBrightness) {
    bleMode       = Light::mode();
    bleBrightness = Light::brightness();
    Ble::publishLightState(bleMode, bleBrightness);
  }

  DisplayState ds;
  ds.networkEnabled = WIFI_CONFIGURED;
  ds.wifiUp     = WIFI_CONFIGURED && WiFi.status() == WL_CONNECTED;
  ds.mqttUp     = mqtt.connected();
  // Meaningless while disassociated, and the panel would draw a bar count from it.
  ds.rssi       = ds.wifiUp ? WiFi.RSSI() : 0;
  ds.bleConnected = Ble::isConnected();
  ds.haveBio    = haveBio;
  ds.bio        = lastBio;
  ds.lightMode  = Light::nameOf(Light::mode());
  ds.brightness = Light::brightness();
  Display::update(ds);      // self-rate-limited to DISPLAY_MS
}
