#include "display.h"

#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include "config.h"

namespace {

// Hardware VSPI. The 7-pin module's `SDA` pin is MOSI and its `SCK` is the
// clock; DC / RES / CS are the three control lines we chose in config.h.
Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &SPI,
                      PIN_OLED_DC, PIN_OLED_RST, PIN_OLED_CS);

bool          oledOk    = false;
unsigned long lastDraw  = 0;
bool          heartBeatOn = false;   // toggles once per redraw while a valid HR shows

/**
 * The layout grid, in rows.
 *
 * Written down because the previous pass did not have one and it showed: the unit label
 * sat at y=41, eight pixels tall, and the divider it was supposed to sit above was at
 * y=46. They overlapped by two pixels, and the two metric columns started at different
 * heights — 16 on the left, 14 on the right — so nothing in the middle band lined up with
 * anything else.
 *
 * The proportions mirror the app's biometrics card rather than being chosen here: hero
 * type at three times the base, the secondary metric at two, labels at one, and every
 * value sitting above its own label rather than beside it. 46:28:11 in the app, 24:16:8
 * here, which is as close as three text sizes reach.
 */
constexpr int16_t ROW_EYEBROW  = 0;    // 8 tall
constexpr int16_t RULE_TOP     = 9;
constexpr int16_t ROW_VALUE    = 12;   // hero, 24 tall -> 12..35
constexpr int16_t ROW_LABEL    = 37;   // units, 8 tall -> 37..44
constexpr int16_t RULE_BOTTOM  = 46;
constexpr int16_t ROW_LAMP     = 49;   // 8 tall -> 49..56

// The secondary value is 16 tall and centred against the hero's 24, so the two labels
// beneath them share one baseline. (12 + 24/2) - 16/2 = 16.
constexpr int16_t ROW_VALUE_2  = 16;

constexpr int16_t HERO_X = 12;   // clear of the heart glyph at x=0..7

/** Contact this weak is measurable but not well — the same figure the app's card uses. */
constexpr uint32_t WEAK_SIGNAL_IR = 100000;

int16_t textWidth(const char* s, uint8_t size) {
  return (int16_t)strlen(s) * 6 * size;
}

/**
 * Draws a string a character at a time with a pixel of extra tracking.
 *
 * The app letterspaces its eyebrow and unit labels — 1.6 and 1.4 points against an 11 to
 * 13 point face. One pixel against a 6 pixel cell is the same gesture at this scale, and
 * it is what stops four capitals at size 1 from reading as a single block.
 */
void drawTracked(int16_t x, int16_t y, const char* s) {
  oled.setTextSize(1);
  for (const char* c = s; *c; c++) {
    oled.setCursor(x, y);
    oled.write(*c);
    x += 7;
  }
}

int16_t trackedWidth(const char* s) {
  const int16_t n = (int16_t)strlen(s);
  return n > 0 ? n * 7 - 1 : 0;
}

void drawTrackedRight(const char* s, int16_t y) {
  drawTracked(OLED_WIDTH - trackedWidth(s), y, s);
}

void drawCentred(const char* s, int16_t y, uint8_t size) {
  oled.setTextSize(size);
  oled.setCursor((OLED_WIDTH - textWidth(s, size)) / 2, y);
  oled.print(s);
}

void drawRightSized(const char* s, int16_t y, uint8_t size) {
  oled.setTextSize(size);
  oled.setCursor(OLED_WIDTH - textWidth(s, size), y);
  oled.print(s);
}

// Right-align a short string on a row at the base size.
void drawRight(const char* s, int16_t y) {
  drawRightSized(s, y, 1);
}

// Cheap faux-bold: the font has no bold weight, so a 1 px horizontal repeat
// gives the header a little more presence than a single pass at size 1.
void drawBoldTracked(int16_t x, int16_t y, const char* s) {
  drawTracked(x, y, s);
  drawTracked(x + 1, y, s);
}

// 10x8, plotted directly rather than as a packed bitmap — small enough that
// explicit coordinates stay more readable than a hand-encoded byte array.
// filled=false draws every other pixel, giving a visibly "hollow" beat that
// reads as paused/idle without needing a second icon.
void drawHeart(int16_t x, int16_t y, bool filled) {
  static const uint8_t ROWS[8] = {
      0b01100110, 0b11111111, 0b11111111, 0b11111111,
      0b01111110, 0b00111100, 0b00011000, 0b00001000,
  };
  for (int8_t row = 0; row < 8; row++) {
    for (int8_t col = 0; col < 8; col++) {
      if (!(ROWS[row] & (0x80 >> col))) continue;
      if (filled || ((row + col) & 1) == 0) {
        oled.drawPixel(x + col, y + row, SSD1306_WHITE);
      }
    }
  }
}

// Concentric rings — a placement target rather than a literal finger, which
// reads clearly at this resolution where a literal fingertip glyph did not.
void drawTargetRing(int16_t cx, int16_t cy) {
  oled.drawCircle(cx, cy, 9, SSD1306_WHITE);
  oled.drawCircle(cx, cy, 4, SSD1306_WHITE);
  oled.drawPixel(cx, cy, SSD1306_WHITE);
}

// Signal bars replace the old "MQTT -77" text with something readable at a
// glance from across the room during the demo. Bar count encodes RSSI
// strength; the dot beside them is solid once MQTT — not just WiFi — is up,
// since a device that joined WiFi but never reached the broker is a distinct,
// worth-noticing state on this screen.
void drawSignalIcon(const DisplayState& s) {
  constexpr int16_t barX = OLED_WIDTH - 12;
  constexpr int16_t baseY = 7;
  const int16_t heights[3] = {2, 4, 6};

  int bars = 0;
  if (s.wifiUp) {
    if (s.rssi > -60) bars = 3;
    else if (s.rssi > -75) bars = 2;
    else bars = 1;
  }

  for (int8_t i = 0; i < 3; i++) {
    const int16_t bx = barX + i * 4;
    const int16_t h  = heights[i];
    if (i < bars) {
      oled.fillRect(bx, baseY - h, 2, h, SSD1306_WHITE);
    } else {
      oled.drawRect(bx, baseY - h, 2, h, SSD1306_WHITE);
    }
  }

  const int16_t dotX = barX - 6;
  if (s.mqttUp) {
    oled.fillCircle(dotX, baseY - 2, 2, SSD1306_WHITE);
  } else if (s.wifiUp) {
    oled.drawCircle(dotX, baseY - 2, 2, SSD1306_WHITE);
  }
}

void drawHeader(const DisplayState& s) {
  // All caps and letterspaced, which is the app's eyebrow treatment rather than its
  // wordmark. On a device that is the only screen in the room the product name is doing
  // the eyebrow's job — saying what this readout belongs to, quietly.
  drawBoldTracked(0, ROW_EYEBROW, "AURAFLOW");
  drawSignalIcon(s);
  oled.drawFastHLine(0, RULE_TOP, OLED_WIDTH, SSD1306_WHITE);
}

/**
 * What to tell someone who is looking at the screen and not seeing a number.
 *
 * Deliberately the same ladder the app's card walks, in the same order and saying the
 * same things — someone holding a finger on this sensor with the phone beside them should
 * not be reading two different diagnoses of one situation. Shortened to the 21 characters
 * a centred line fits here, and lowercase because at size 1 all-caps is harder to read at
 * arm's length, not easier.
 */
const char* statusLine(const DisplayState& s) {
  // Twenty-one characters is what a centred line fits at size 1; every string here is
  // written to that, which is why none of them reads quite like the app's longer one.
  if (!Sensors::pulseSensorPresent()) return "no sensor - wiring?";
  if (!s.haveBio || !s.bio.fingerPresent) return "rest a finger here";
  if (!s.bio.settled) return "measuring, hold still";
  if (s.bio.irMean < WEAK_SIGNAL_IR) return "press a bit firmer";
  return "finding your pulse";
}

/** The placement target and one line of guidance, for when there is no reading yet. */
void drawSearching(const DisplayState& s) {
  drawTargetRing(OLED_WIDTH / 2, 23);
  drawCentred(statusLine(s), ROW_LABEL, 1);
}

void drawBiometrics(const DisplayState& s) {
  /*
   * Either estimator will do, and the label says which.
   *
   * The node computes two rates from one signal and this screen only ever read the first,
   * so a session where the streaming estimator does not resolve — which is most of them on
   * this hardware — showed `--` here while the phone, which falls back, showed a number.
   * The node's own display contradicting the app about the node's own sensor is the worst
   * of the three ways that could have gone.
   */
  const bool haveStreamed = s.bio.heartRateValid;
  const bool haveReference = s.bio.heartRateMaximValid;
  const bool haveHr = haveStreamed || haveReference;

  const bool haveAny = s.haveBio && (haveHr || s.bio.spo2Valid);
  if (!haveAny) {
    drawSearching(s);
    return;
  }

  heartBeatOn = !heartBeatOn;
  // Centred on the hero's own middle rather than sitting at its cap height, the way the
  // app centres its icon against the number instead of against the line box.
  drawHeart(0, ROW_VALUE + 12 - 4, haveHr ? heartBeatOn : false);

  // Whole bpm even though the payload carries a decimal: three-times type is eighteen
  // pixels a character, and "72.4" costs the width of a reading that has nothing to hide.
  // The decimal is for the evaluation, not for a glance across a desk.
  char hr[8];
  if (haveStreamed) {
    snprintf(hr, sizeof(hr), "%ld", (long)lroundf(s.bio.heartRate));
  } else if (haveReference) {
    snprintf(hr, sizeof(hr), "%ld", (long)s.bio.heartRateMaxim);
  } else {
    strcpy(hr, "--");
  }
  oled.setTextSize(3);
  oled.setCursor(HERO_X, ROW_VALUE);
  oled.print(hr);

  char spo2[8];
  if (s.bio.spo2Valid) {
    snprintf(spo2, sizeof(spo2), "%ld%%", (long)s.bio.spo2);
  } else {
    strcpy(spo2, "--");
  }
  drawRightSized(spo2, ROW_VALUE_2, 2);

  // Both labels on one baseline under their own values — the alignment that was missing.
  //
  // The tilde is the same mark the app puts on a figure it did not measure directly. Here it
  // means the reference algorithm answered and the streaming one did not, so the number is
  // true to within the few bpm that method can express — worth one character to say.
  drawTracked(HERO_X, ROW_LABEL, haveStreamed ? "BPM" : "~BPM");
  drawTrackedRight("SPO2", ROW_LABEL);
}

void drawLampRow(const DisplayState& s) {
  oled.drawFastHLine(0, RULE_BOTTOM, OLED_WIDTH, SSD1306_WHITE);

  oled.setTextSize(1);
  oled.setCursor(0, ROW_LAMP);
  oled.print(s.lightMode);

  const bool sim = Sensors::simulated();
  constexpr int16_t barH = 8;
  const int16_t barX = 44;
  const int16_t barW = (sim ? OLED_WIDTH - 22 : OLED_WIDTH) - barX;

  oled.drawRoundRect(barX, ROW_LAMP, barW, barH, 3, SSD1306_WHITE);
  const int16_t fill = (int32_t)(barW - 2) * s.brightness / 100;
  if (fill > 2) oled.fillRoundRect(barX + 1, ROW_LAMP + 1, fill, barH - 2, 2, SSD1306_WHITE);

  // Never let a simulated run look like a real one on the demo screen.
  if (sim) drawRight("SIM", ROW_LAMP);
}

}  // namespace

namespace Display {

void begin() {
  // Bring VSPI up on our pins first, then tell the library not to re-init the
  // peripheral — its own begin() would fall back to the default pin set.
  SPI.begin(PIN_OLED_SCK, /* miso */ -1, PIN_OLED_MOSI, PIN_OLED_CS);

  // reset = true: the RES line is wired, so let the library pulse it. Over SPI
  // this call cannot detect a missing panel — see the note in display.h.
  oledOk = oled.begin(SSD1306_SWITCHCAPVCC, /* i2caddr, unused */ 0,
                      /* reset */ true, /* periphBegin */ false);

  if (!oledOk) {
    Serial.println("[oled] begin() failed — out of memory for the frame buffer");
    return;
  }

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.display();
  Serial.printf("[oled] SSD1306 over SPI — sck=%u mosi=%u cs=%u dc=%u res=%u\n",
                PIN_OLED_SCK, PIN_OLED_MOSI, PIN_OLED_CS, PIN_OLED_DC, PIN_OLED_RST);
  Serial.println("[oled] blank screen from here means wiring, not this line");
}

void message(const char* title, const char* line) {
  if (!oledOk) return;

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  drawBoldTracked(0, ROW_EYEBROW, title);
  oled.drawFastHLine(0, RULE_TOP, OLED_WIDTH, SSD1306_WHITE);
  drawCentred(line, ROW_VALUE_2 + 4, 1);
  if (Sensors::simulated()) drawRight("SIM", ROW_LAMP);
  oled.display();
}

void update(const DisplayState& s) {
  if (!oledOk) return;
  if (millis() - lastDraw < DISPLAY_MS) return;
  lastDraw = millis();

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  drawHeader(s);
  drawBiometrics(s);
  drawLampRow(s);
  oled.display();
}

bool present() { return oledOk; }

}  // namespace Display
