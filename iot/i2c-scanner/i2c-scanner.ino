/*
 * AuraFlow — I2C bus check
 *
 * Run this before the main sketch, every time the wiring changes. It answers
 * the two questions worth asking first: is the bus electrically correct, and is
 * the part on it the one we think it is?
 *
 * Expected on this build:
 *
 *   0x57  MAX30102 pulse oximeter   (fixed in silicon)
 *   part id 0x15  rev 0x03          (0x15 == MAX30102, not MAX30100)
 *
 * That is the whole list. The OLED that arrived is the 7-pin SPI variant, so it
 * is NOT on this bus and will never show up here — a scan that finds one device
 * is a pass, not a half-failure.
 *
 * Nothing found at all -> SDA/SCL swapped, the module has no 3V3/GND, or the
 *                         1.8 V pull-up problem described below.
 * Found but part id 0x11 -> that is a MAX30100, not a MAX30102. Different chip,
 *                         different library; the node's firmware will not drive
 *                         it. Say so in the report rather than quietly swapping
 *                         libraries and hoping.
 */

#include <Wire.h>

constexpr uint8_t PIN_SDA = 21;
constexpr uint8_t PIN_SCL = 22;

constexpr uint8_t ADDR_MAX3010X  = 0x57;
constexpr uint8_t REG_REV_ID     = 0xFE;
constexpr uint8_t REG_PART_ID    = 0xFF;
constexpr uint8_t PART_MAX30102  = 0x15;
constexpr uint8_t PART_MAX30100  = 0x11;

struct Known { uint8_t addr; const char* name; };

const Known KNOWN[] = {
    {0x57, "MAX3010x pulse oximeter"},
    // Not expected on this build, but worth naming if one ever appears: an I2C
    // OLED would land here, and a MAX30205 would land at 0x48/0x49.
    {0x3C, "SSD1306 OLED (I2C variant — this build's panel is SPI)"},
    {0x3D, "SSD1306 OLED (I2C, alt address)"},
    {0x48, "MAX30205 skin temperature (not in this build)"},
    {0x49, "MAX30205 (alt address)"},
};

const char* nameFor(uint8_t addr) {
  for (const Known& k : KNOWN) {
    if (k.addr == addr) return k.name;
  }
  return "unknown device";
}

// Single-register read. Returns false on a bus fault rather than handing back a
// stale or zeroed value that would read as a real part id.
bool readReg(uint8_t addr, uint8_t reg, uint8_t& out) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;     // repeated start
  if (Wire.requestFrom((int)addr, 1) != 1) return false;
  out = Wire.read();
  return true;
}

// The part id is the only way to tell a MAX30102 from a MAX30100 — they share
// address 0x57, the same breakout silkscreen and the same pin names, so an
// address scan alone cannot distinguish them.
void identifyPulseSensor() {
  uint8_t part = 0, rev = 0;

  if (!readReg(ADDR_MAX3010X, REG_PART_ID, part)) {
    Serial.println("        part id read FAILED — device ACKs but will not talk");
    return;
  }
  readReg(ADDR_MAX3010X, REG_REV_ID, rev);

  Serial.printf("        part id 0x%02X  rev 0x%02X  -> ", part, rev);
  if (part == PART_MAX30102) {
    Serial.println("MAX30102, correct part for this build");
  } else if (part == PART_MAX30100) {
    Serial.println("MAX30100 — WRONG PART, the node firmware cannot drive it");
  } else {
    Serial.println("unrecognised — not a MAX3010x");
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  Serial.printf("\n[i2c] scanner on SDA=%u SCL=%u\n", PIN_SDA, PIN_SCL);
  Serial.println("[i2c] expecting exactly one device: 0x57, part id 0x15");
}

void loop() {
  int found = 0;

  Serial.println("[i2c] scanning...");
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  0x%02X  %s\n", addr, nameFor(addr));
      if (addr == ADDR_MAX3010X) identifyPulseSensor();
      found++;
    }
  }

  if (found == 0) {
    Serial.println("  nothing on the bus. In order of likelihood:");
    Serial.println("   1. SDA/SCL swapped, or the module has no 3V3 / GND");
    Serial.println("   2. this breakout pulls SDA/SCL up to its internal 1.8 V");
    Serial.println("      rail instead of 3V3 — 1.8 V never reaches the ESP32's");
    Serial.println("      2.475 V logic-high threshold, so the bus looks dead.");
    Serial.println("      Fix: add 4.7k from SDA and SCL to 3V3 on the breadboard.");
  } else {
    Serial.printf("[i2c] %d device%s\n", found, found == 1 ? "" : "s");
  }

  delay(5000);
}
