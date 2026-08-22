/*
 * AuraFlow — identify the spare 3-pin module
 *
 * The third module in the box is silkscreened `HW-477 v0.2`. That marking ships
 * on at least three unrelated boards — a linear Hall sensor, a VS1838B infrared
 * receiver, and a two-colour LED — so it cannot be identified from the print
 * alone, and guessing wrong means wiring a sensor that reads nothing.
 *
 * This sketch does not guess. It prints the raw pin state ten times a second and
 * tells you which physical test separates the candidates. Run it, do the tests
 * in §2 below, and the answer falls out in about a minute.
 *
 * Wiring — three wires, whatever the part turns out to be:
 *
 *   module `-`  ->  GND
 *   module `+`  ->  3V3          (all three candidates are happy at 3.3 V)
 *   module `S`  ->  G34
 *
 * G34 is input-only and on ADC1, so it keeps working with WiFi on and cannot be
 * driven by accident. If the part turns out to be the LED board, move `S` to a
 * real output pin before trying to light it — G34 cannot drive anything.
 *
 * ---------------------------------------------------------------------------
 * 2. The tests
 *
 *   a) Hold a magnet near the black component, then flip the magnet over.
 *      Reading swings up for one pole and down for the other, centred near
 *      half scale  ->  LINEAR HALL SENSOR (49E). Wire it as an analog input.
 *
 *   b) Point any TV / AC remote at it and hold a button down.
 *      Reading slams between the rails, and the "edges" counter below climbs
 *      fast  ->  VS1838B IR RECEIVER. It is a digital demodulated output;
 *      use the IRremote library, not analogRead.
 *
 *   c) Neither test moves it, and the reading sits pinned at one rail.
 *      ->  probably the two-colour LED board, which has no sensing element at
 *      all. Nothing to read; it is an output device.
 *
 * A reading that never moves under ANY of the three is more likely a wiring
 * fault than a fourth kind of module — check `+` and `-` before concluding.
 */

#include <Arduino.h>

constexpr uint8_t PIN_SPARE = 34;      // ADC1_CH6, input only
constexpr int     ADC_MAX   = 4095;

unsigned long lastPrint = 0;
uint32_t      edges     = 0;           // digital transitions since boot
int           lastLevel = -1;
int           seenMin   = ADC_MAX;
int           seenMax   = 0;

void setup() {
  Serial.begin(115200);
  delay(300);
  analogReadResolution(12);
  pinMode(PIN_SPARE, INPUT);

  Serial.println("\n[spare] HW-477 v0.2 identification");
  Serial.printf("[spare] reading GPIO%u — see the header of this sketch\n", PIN_SPARE);
  Serial.println("[spare] test 1: move a magnet past it, both poles");
  Serial.println("[spare] test 2: hold a TV remote button pointed at it");
  Serial.println();
}

void loop() {
  const int raw = analogRead(PIN_SPARE);

  if (raw < seenMin) seenMin = raw;
  if (raw > seenMax) seenMax = raw;

  // Count rail-to-rail transitions. A demodulated IR carrier produces hundreds
  // per burst; a Hall sensor sliding past a magnet produces none, because it
  // moves smoothly through the middle of the range rather than snapping.
  const int level = (raw > ADC_MAX * 3 / 4) ? 1 : (raw < ADC_MAX / 4 ? 0 : -1);
  if (level >= 0 && lastLevel >= 0 && level != lastLevel) edges++;
  if (level >= 0) lastLevel = level;

  if (millis() - lastPrint >= 100) {
    lastPrint = millis();

    // A 20-column bar makes a slow analog swing obvious in a way a scrolling
    // column of numbers does not — that swing is the whole Hall-vs-IR test.
    char bar[21];
    const int fill = raw * 20 / ADC_MAX;
    for (int i = 0; i < 20; i++) bar[i] = (i < fill) ? '#' : '.';
    bar[20] = '\0';

    Serial.printf("raw %4d  [%s]  %.2f V   span %d-%d   edges %lu\n",
                  raw, bar, raw * 3.3f / ADC_MAX, seenMin, seenMax,
                  (unsigned long)edges);
  }
}
