#include "display.h"

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include "config.h"

namespace {

Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, /* rst */ -1);
bool          oledOk    = false;
unsigned long lastDraw  = 0;

// Right-align a short string on the top status row.
void drawRight(const char* s, int16_t y) {
  const int16_t w = strlen(s) * 6;          // 6 px per char at size 1
  oled.setCursor(OLED_WIDTH - w, y);
  oled.print(s);
}

void drawHeader(const DisplayState& s) {
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.print("AuraFlow");

  if (s.mqttUp) {
    char buf[12];
    snprintf(buf, sizeof(buf), "MQTT %d", s.rssi);
    drawRight(buf, 0);
  } else {
    drawRight(s.wifiUp ? "wifi only" : "offline", 0);
  }

  oled.drawFastHLine(0, 10, OLED_WIDTH, SSD1306_WHITE);
}

void drawBiometrics(const DisplayState& s) {
  if (!s.haveBio || !s.bio.fingerPresent) {
    oled.setTextSize(1);
    oled.setCursor(0, 20);
    oled.print(Sensors::pulseSensorPresent() ? "Place finger on the"
                                             : "No pulse sensor -");
    oled.setCursor(0, 30);
    oled.print(Sensors::pulseSensorPresent() ? "MAX30102 pad" : "check I2C wiring");
    return;
  }

  // Heart rate gets the big type — it is the number anyone watching looks for.
  oled.setTextSize(2);
  oled.setCursor(0, 15);
  if (s.bio.heartRateValid) {
    oled.print(s.bio.heartRate);
    oled.setTextSize(1);
    oled.print(" bpm");
  } else {
    oled.print("--");
    oled.setTextSize(1);
    oled.print(" bpm");
  }

  oled.setTextSize(1);
  oled.setCursor(0, 35);
  if (s.bio.spo2Valid) {
    oled.printf("SpO2 %ld%%", (long)s.bio.spo2);
  } else {
    oled.print("SpO2 --");
  }

  oled.setCursor(66, 35);
  if (s.bio.bodyTempValid) {
    oled.printf("Skin %.1fC", s.bio.bodyTempC);
  } else {
    oled.print("Skin --");
  }
}

void drawFooter(const DisplayState& s) {
  oled.drawFastHLine(0, 46, OLED_WIDTH, SSD1306_WHITE);

  oled.setTextSize(1);
  oled.setCursor(0, 52);
  oled.printf("%s %u%%", s.lightMode, s.brightness);

  // Never let a simulated run look like a real one on the demo screen.
  if (Sensors::simulated()) drawRight("SIM", 52);
}

}  // namespace

namespace Display {

void begin() {
  // periphBegin = false: Sensors::begin() already brought Wire up on 21/22 at
  // 400 kHz, and letting the library re-init it would drop back to the default
  // pins on some cores.
  oledOk = oled.begin(SSD1306_SWITCHCAPVCC, ADDR_OLED, /* reset */ false,
                      /* periphBegin */ false);

  if (!oledOk) {
    Serial.printf("[oled] NOT found at 0x%02X — some modules are 0x3D\n", ADDR_OLED);
    return;
  }

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.display();
  Serial.println("[oled] SSD1306 ready");
}

void message(const char* title, const char* line) {
  if (!oledOk) return;

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.print(title);
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
  drawFooter(s);
  oled.display();
}

bool present() { return oledOk; }

}  // namespace Display
