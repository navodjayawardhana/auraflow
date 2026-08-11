// Circadian lamp — the "act" half of the node.
#pragma once

#include <Arduino.h>

enum LightMode { LIGHT_OFF, LIGHT_FOCUS, LIGHT_BREAK, LIGHT_SLEEP, LIGHT_ALERT };

namespace Light {

void        begin();
void        set(LightMode mode, uint8_t brightnessPct);
void        update();                 // call every loop() — non-blocking fade
LightMode   mode();
uint8_t     brightness();

const char* nameOf(LightMode m);
bool        parseMode(const char* s, LightMode& out);

}  // namespace Light
