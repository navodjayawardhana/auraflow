#include "light.h"

#include "config.h"

namespace {

// LEDC: 8-bit duty at 5 kHz. Well above anything the eye or a phone camera
// picks up as flicker, which matters — the lamp ends up in the demo video.
constexpr uint8_t  LEDC_CHANNEL    = 0;
constexpr uint32_t LEDC_FREQ_HZ    = 5000;
constexpr uint8_t  LEDC_RESOLUTION = 8;

// The Arduino-ESP32 3.x core replaced the channel-based LEDC API with a
// pin-based one. Supporting both keeps this compiling on whichever core is
// already installed rather than making the board package a prerequisite.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void lampAttach() { ledcAttach(PIN_LAMP, LEDC_FREQ_HZ, LEDC_RESOLUTION); }
void lampWrite(uint8_t duty) { ledcWrite(PIN_LAMP, duty); }
#else
void lampAttach() {
  ledcSetup(LEDC_CHANNEL, LEDC_FREQ_HZ, LEDC_RESOLUTION);
  ledcAttachPin(PIN_LAMP, LEDC_CHANNEL);
}
void lampWrite(uint8_t duty) { ledcWrite(LEDC_CHANNEL, duty); }
#endif

LightMode currentMode     = LIGHT_OFF;
LightMode modeBeforeAlert = LIGHT_OFF;
uint8_t   brightnessPct   = 70;

uint8_t shown  = 0;   // duty the LED is at right now
uint8_t target = 0;   // where the fade is heading

unsigned long alertUntilMs = 0;
unsigned long lastFadeMs   = 0;

// With one monochrome LED the mode has to live in the brightness and in the
// movement, because there is no hue left to put it in. Focus sits hard on;
// break breathes so it reads as "step away" from the corner of your eye;
// sleep is dim and still.
uint8_t baseLevelFor(LightMode m) {
  switch (m) {
    case LIGHT_FOCUS: return 255;
    case LIGHT_BREAK: return 200;
    case LIGHT_SLEEP: return 255;   // the cap in recomputeTarget() does the work
    case LIGHT_ALERT: return 255;
    default:          return 0;
  }
}

void recomputeTarget() {
  const uint8_t base = baseLevelFor(currentMode);
  // Sleep mode is capped: a bright lamp at 23:00 defeats the whole point.
  const uint8_t pct = (currentMode == LIGHT_SLEEP)
                          ? min<uint8_t>(brightnessPct, 35)
                          : brightnessPct;
  target = (uint16_t)base * pct / 100;
}

uint8_t stepToward(uint8_t from, uint8_t to) {
  if (from == to) return to;
  if (to > from)  return (to - from <= FADE_STEP) ? to : from + FADE_STEP;
  return (from - to <= FADE_STEP) ? to : from - FADE_STEP;
}

// A triangle wave in [floorPct..100] of `level`, period `periodMs`. Cheaper
// than a sine and indistinguishable once it is driving an LED.
uint8_t breathe(uint8_t level, uint16_t periodMs, uint8_t floorPct) {
  const uint16_t phase = millis() % periodMs;
  const uint16_t half  = periodMs / 2;
  const uint16_t up    = (phase < half) ? phase : (periodMs - phase);
  const uint8_t  span  = 100 - floorPct;
  const uint16_t pct   = floorPct + (uint32_t)up * span / half;
  return (uint16_t)level * pct / 100;
}

}  // namespace

namespace Light {

void begin() {
  lampAttach();
  lampWrite(0);
}

void set(LightMode m, uint8_t pct) {
  if (m == LIGHT_ALERT) {
    // Alert is transient: pulse, then fall back to whatever we were doing.
    if (currentMode != LIGHT_ALERT) modeBeforeAlert = currentMode;
    alertUntilMs = millis() + ALERT_DURATION_MS;
  } else {
    alertUntilMs = 0;
  }
  currentMode   = m;
  brightnessPct = constrain(pct, 0, 100);
  recomputeTarget();
}

void update() {
  if (millis() - lastFadeMs < FADE_INTERVAL_MS) return;
  lastFadeMs = millis();

  if (currentMode == LIGHT_ALERT) {
    if (millis() > alertUntilMs) {
      set(modeBeforeAlert, brightnessPct);
    } else {
      // Hard 0->full pulse at 0.8 s. Deliberately not subtle; this is the
      // posture / bedtime nag.
      shown = breathe(255, 800, 0);
      lampWrite(shown);
      return;
    }
  }

  shown = stepToward(shown, target);

  // Break mode keeps moving after the fade has settled, so it stays
  // distinguishable from focus without colour.
  if (currentMode == LIGHT_BREAK && shown == target) {
    lampWrite(breathe(shown, 4000, 45));
    return;
  }

  lampWrite(shown);
}

LightMode mode()       { return currentMode; }
uint8_t   brightness() { return brightnessPct; }

const char* nameOf(LightMode m) {
  switch (m) {
    case LIGHT_FOCUS: return "focus";
    case LIGHT_BREAK: return "break";
    case LIGHT_SLEEP: return "sleep";
    case LIGHT_ALERT: return "alert";
    default:          return "off";
  }
}

bool parseMode(const char* s, LightMode& out) {
  if (!strcmp(s, "focus")) { out = LIGHT_FOCUS; return true; }
  if (!strcmp(s, "break")) { out = LIGHT_BREAK; return true; }
  if (!strcmp(s, "sleep")) { out = LIGHT_SLEEP; return true; }
  if (!strcmp(s, "alert")) { out = LIGHT_ALERT; return true; }
  if (!strcmp(s, "off"))   { out = LIGHT_OFF;   return true; }
  return false;
}

}  // namespace Light
