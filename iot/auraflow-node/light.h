// Circadian lamp — the "act" half of the node.
//
// The WS2812 ring in the original BOM never arrived, so the lamp is the
// DevKit's own LED on GPIO2 under LEDC PWM. That costs the colour coding, so
// the modes are carried by brightness plus motion instead — see light.cpp — and
// the OLED names the active mode so the demo is still readable across a room.
//
// The public interface is unchanged from the WS2812 version on purpose: the
// MQTT contract, the app and the Laravel service all keep working, and swapping
// a ring back in is a change to this file alone.
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
