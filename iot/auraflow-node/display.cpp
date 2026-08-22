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

// Right-align a short string on a row.
void drawRight(const char* s, int16_t y) {
  const int16_t w = strlen(s) * 6;          // 6 px per char at size 1
  oled.setCursor(OLED_WIDTH - w, y);
  oled.print(s);
}

// Cheap faux-bold: the font has no bold weight, so a 1 px horizontal repeat
// gives the header a little more presence than a single pass at size 1.
void drawBold(int16_t x, int16_t y, const char* s) {
  oled.setCursor(x, y);
  oled.print(s);
  oled.setCursor(x + 1, y);
  oled.print(s);
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
  oled.setTextSize(1);
  drawBold(0, 0, "AuraFlow");
  drawSignalIcon(s);
  oled.drawFastHLine(0, 10, OLED_WIDTH, SSD1306_WHITE);
}

void drawBiometrics(const DisplayState& s) {
  if (!s.haveBio || !s.bio.fingerPresent) {
    drawTargetRing(OLED_WIDTH / 2, 24);

    oled.setTextSize(1);
    const char* l1 = Sensors::pulseSensorPresent() ? "place finger on"
                                                    : "no pulse sensor -";
    const char* l2 = Sensors::pulseSensorPresent() ? "MAX30102 pad"
                                                    : "check wiring";
    oled.setCursor((OLED_WIDTH - (int16_t)strlen(l1) * 6) / 2, 42);
    oled.print(l1);
    oled.setCursor((OLED_WIDTH - (int16_t)strlen(l2) * 6) / 2, 52);
    oled.print(l2);
    return;
  }

  heartBeatOn = !heartBeatOn;
  drawHeart(2, 19, s.bio.heartRateValid ? heartBeatOn : false);

  // Heart rate gets the big type — it is the number anyone watching looks for.
  oled.setTextSize(3);
  oled.setCursor(16, 16);
  if (s.bio.heartRateValid) {
    oled.print(s.bio.heartRate);
  } else {
    oled.print("--");
  }

  oled.setTextSize(1);
  oled.setCursor(16, 41);
  oled.print("bpm");

  // Right column: label above value rather than one wide "SpO2 97%" pill —
  // the pill overflowed past column 128 on this panel's width in an earlier
  // pass, and stacking two short lines fits comfortably instead.
  constexpr int16_t rx = 84;
  oled.setCursor(rx, 14);
  oled.print("SpO2");

  oled.setTextSize(2);
  oled.setCursor(rx, 23);
  if (s.bio.spo2Valid) {
    oled.printf("%ld%%", (long)s.bio.spo2);
  } else {
    oled.print("--");
  }
}

void drawLampRow(const DisplayState& s) {
  oled.drawFastHLine(0, 46, OLED_WIDTH, SSD1306_WHITE);

  oled.setTextSize(1);
  oled.setCursor(0, 52);
  oled.print(s.lightMode);

  const bool    sim  = Sensors::simulated();
  constexpr int16_t barY = 52;
  constexpr int16_t barH = 8;
  const int16_t barX = 44;
  const int16_t barW = (sim ? OLED_WIDTH - 22 : OLED_WIDTH) - barX;  // leave room for SIM

  oled.drawRoundRect(barX, barY, barW, barH, 3, SSD1306_WHITE);
  const int16_t fill = (int32_t)(barW - 2) * s.brightness / 100;
  if (fill > 2) oled.fillRoundRect(barX + 1, barY + 1, fill, barH - 2, 2, SSD1306_WHITE);

  // Never let a simulated run look like a real one on the demo screen.
  if (sim) drawRight("SIM", 52);
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
  oled.setTextSize(1);
  drawBold(0, 0, title);
  oled.drawFastHLine(0, 10, OLED_WIDTH, SSD1306_WHITE);
  oled.setCursor(0, 24);
  oled.print(line);
  if (Sensors::simulated()) drawRight("SIM", 52);
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
