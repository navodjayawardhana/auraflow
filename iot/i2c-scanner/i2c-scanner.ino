/*
 * AuraFlow — I2C bus check
 *
 * Run this before the main sketch, every time the wiring changes. It answers
 * the only question worth asking first: is the bus electrically correct?
 *
 * Expected, once everything is wired:
 *
 *   0x3C  SSD1306 OLED          (some modules are 0x3D)
 *   0x48  MAX30205 skin temp    (A0..A2 to GND; some modules are 0x49)
 *   0x57  MAX30102 pulse        (fixed in silicon)
 *
 * Nothing found at all -> SDA/SCL swapped, or a module has no 3V3/GND.
 * One address missing  -> that module's wiring, or it wants a different address;
 *                         put the address it DOES report into config.h.
 */

#include <Wire.h>

constexpr uint8_t PIN_SDA = 21;
constexpr uint8_t PIN_SCL = 22;

struct Known { uint8_t addr; const char* name; };

const Known KNOWN[] = {
    {0x3C, "SSD1306 OLED"},
    {0x3D, "SSD1306 OLED (alt address)"},
    {0x48, "MAX30205 skin temperature"},
    {0x49, "MAX30205 (alt address)"},
    {0x57, "MAX30102 pulse oximeter"},
};

const char* nameFor(uint8_t addr) {
  for (const Known& k : KNOWN) {
    if (k.addr == addr) return k.name;
  }
  return "unknown device";
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  Serial.printf("\n[i2c] scanner on SDA=%u SCL=%u\n", PIN_SDA, PIN_SCL);
}

void loop() {
  int found = 0;

  Serial.println("[i2c] scanning...");
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  0x%02X  %s\n", addr, nameFor(addr));
      found++;
    }
  }

  if (found == 0) {
    Serial.println("  nothing on the bus — check SDA/SCL are not swapped, and");
    Serial.println("  that every module has 3V3 and GND");
  } else {
    Serial.printf("[i2c] %d device%s\n", found, found == 1 ? "" : "s");
  }

  delay(5000);
}
