#include "light.h"

#include <Adafruit_NeoPixel.h>

#include "config.h"

namespace {

struct Rgb { uint8_t r, g, b; };

Adafruit_NeoPixel strip(NUM_PIXELS, PIN_LED_DATA, NEO_GRB + NEO_KHZ800);

LightMode currentMode     = LIGHT_OFF;
LightMode modeBeforeAlert = LIGHT_OFF;
uint8_t   brightnessPct   = 70;

Rgb shown  = {0, 0, 0};   // what the pixels show right now
Rgb target = {0, 0, 0};   // where the fade is heading

unsigned long alertUntilMs = 0;
unsigned long lastFadeMs   = 0;

Rgb baseColourFor(LightMode m) {
  switch (m) {
    case LIGHT_FOCUS: return {200, 220, 255};  // cool daylight — alerting
    case LIGHT_BREAK: return {255, 140,  40};  // warm amber — step away
    case LIGHT_SLEEP: return {255,  45,   0};  // deep red — low blue light
    case LIGHT_ALERT: return {255,   0,   0};
    default:          return {  0,   0,   0};
  }
}

void recomputeTarget() {
  const Rgb base = baseColourFor(currentMode);
  // Sleep mode is capped: a bright lamp at 23:00 defeats the whole point.
  const uint8_t pct = (currentMode == LIGHT_SLEEP)
                          ? min<uint8_t>(brightnessPct, 35)
                          : brightnessPct;
  target.r = (uint16_t)base.r * pct / 100;
  target.g = (uint16_t)base.g * pct / 100;
  target.b = (uint16_t)base.b * pct / 100;
}

uint8_t stepToward(uint8_t from, uint8_t to) {
  if (from == to) return to;
  if (to > from)  return (to - from <= FADE_STEP) ? to : from + FADE_STEP;
  return (from - to <= FADE_STEP) ? to : from - FADE_STEP;
}

void paint(const Rgb& c) {
  strip.fill(strip.Color(c.r, c.g, c.b));
  strip.show();
}

}  // namespace

namespace Light {

void begin() {
  strip.begin();
  strip.clear();
  strip.show();
}

void set(LightMode m, uint8_t pct) {
  if (m == LIGHT_ALERT) {
    // Alert is transient: flash, then fall back to whatever we were doing.
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
      const uint16_t phase = millis() % 800;                 // 0.8 s per pulse
      const uint8_t  level = (phase < 400) ? (phase * 255 / 400)
                                           : ((800 - phase) * 255 / 400);
      shown = {level, 0, 0};
      paint(shown);
      return;
    }
  }

  if (shown.r == target.r && shown.g == target.g && shown.b == target.b) return;

  shown.r = stepToward(shown.r, target.r);
  shown.g = stepToward(shown.g, target.g);
  shown.b = stepToward(shown.b, target.b);
  paint(shown);
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
