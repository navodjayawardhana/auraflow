# AuraFlow — IoT Ambient Light Node

**CMP 7003 · PRAC1 · W10.13** — *"IoT: MQTT → smart light on geofence"*, built as real
hardware on the Arduino framework instead of a commercial smart bulb.

> **Why hardware helps the marks:** the brief asks for an *"intelligent ecosystem"* and
> *"real-time data processing"*. A bulb you bought is one API call. A node you built —
> that subscribes, publishes its own state back, reads a sensor, and has a physical
> override — is a genuine IoT subsystem you can put in the report and demo live.

---

## 1. What it does

```
Huawei Watch ──▶ Phone (AuraFlow RN app)
                     │  geofence enter "desk" / break timer / posture alert
                     ▼
                 Laravel API  ──MQTT publish──▶  Broker  ──▶  ESP32 node
                     ▲                                            │
                     └────────── state + ambient sensor ──────────┘
```

| Trigger in the app | Command sent | Lamp becomes |
|---|---|---|
| Geofence **enter** study desk | `{"mode":"focus","brightness":85}` | cool daylight white |
| Break reminder fires | `{"mode":"break","brightness":60}` | warm amber |
| Wind-down / bedtime window | `{"mode":"sleep","brightness":30}` | deep red, blue-light safe |
| Posture slouch alert (W10.5) | `{"mode":"alert"}` | 6 s red pulse, then restores |
| Geofence **exit** | `{"mode":"off"}` | fades off |

It is **bidirectional** — that is the part examiners look for:

| Topic | Direction | Payload |
|---|---|---|
| `auraflow/<id>/light/set` | app → device | `{"mode":"focus","brightness":85}` |
| `auraflow/<id>/light/state` | device → app | `{"mode":"focus","brightness":85,"source":"button","rssi":-52,"uptime_s":410}` *(retained)* |
| `auraflow/<id>/sensor/ambient` | device → app | `{"ambient":12,"raw":480,"mode":"sleep"}` every 10 s |
| `auraflow/<id>/status` | device → app | `online` / `offline` *(retained, Last-Will)* |

The LDR feed closes the loop: a dark room can push the app toward a wind-down
suggestion, which is a nicer story than a one-way remote control.

---

## 2. Parts

| Part | Qty | Notes |
|---|---|---|
| **ESP32 DevKit v1** (or NodeMCU ESP8266) | 1 | needs WiFi — see §7 for a plain Uno |
| **WS2812B ring / strip, 8 px** | 1 | any NeoPixel-compatible |
| **LDR (photoresistor)** | 1 | ambient light |
| **10 kΩ resistor** | 1 | LDR divider |
| **330 Ω resistor** | 1 | in series with the LED data line |
| **Push button** | 1 | manual override |
| 1000 µF capacitor | 1 | across the LED strip 5 V/GND — optional but recommended |
| Breadboard + jumpers | — | |

Total ≈ LKR 2,000–2,500 locally.

## 3. Wiring (ESP32)

| ESP32 pin | goes to |
|---|---|
| `5` | 330 Ω → WS2812 **DIN** |
| `4` | button leg 1 (other leg → **GND**) |
| `34` | LDR / 10 kΩ divider midpoint |
| `3V3` | LDR other leg |
| `GND` | 10 kΩ other leg, button, strip GND |
| `VIN` (5 V) | strip **5 V** |

NodeMCU ESP8266 equivalent: data `D5`, button `D6`, LDR `A0`. The sketch
switches pins automatically with `#if defined(ESP32)`.

```
        3V3 ──[ LDR ]──┬──[ 10k ]── GND
                       │
                     GPIO34            GPIO4 ──[ button ]── GND
        5V ─────────────────── WS2812 5V
        GPIO5 ──[330Ω]───────── WS2812 DIN
        GND ─────────────────── WS2812 GND
```

> ⚠️ 8 pixels at full white pull ~480 mA. Powering from USB is fine at the
> brightness values above; if you push a longer strip, feed it from a separate
> 5 V supply and tie the grounds together.

## 4. Build & flash

1. **Arduino IDE 2.x** → Boards Manager → install **esp32 by Espressif** (or
   *esp8266 by ESP8266 Community*).
2. Library Manager → install:
   - `PubSubClient` (Nick O'Leary)
   - `ArduinoJson` **v7.x** (Benoit Blanchon) — the sketch uses the v7 `JsonDocument` API
   - `Adafruit NeoPixel`
3. `cp secrets.example.h secrets.h` and fill in WiFi + broker + `DEVICE_ID`.
   On a public broker, make `DEVICE_ID` unique (`auraflow-desk-01-x7k2`) or a
   stranger's traffic will land on your lamp.
4. Select the board + port, upload, open Serial Monitor at **115200**.

Expected boot output:

```
[AuraFlow] IoT ambient light node
[wifi] connecting.....
[wifi] 192.168.1.42  rssi=-51
[mqtt] connecting to broker.hivemq.com:1883 ... connected
[light] mode=off brightness=70 (boot)
```

## 5. Test it without the app

```bash
# watch everything the node says
mosquitto_sub -h broker.hivemq.com -t 'auraflow/auraflow-desk-01/#' -v

# drive it
mosquitto_pub -h broker.hivemq.com -t 'auraflow/auraflow-desk-01/light/set' \
  -m '{"mode":"focus","brightness":85}'

mosquitto_pub -h broker.hivemq.com -t 'auraflow/auraflow-desk-01/light/set' \
  -m '{"mode":"sleep","brightness":30}'

mosquitto_pub -h broker.hivemq.com -t 'auraflow/auraflow-desk-01/light/set' \
  -m '{"mode":"off"}'
```

Then press the physical button and watch `light/state` change with
`"source":"button"` — that is your screenshot for the bidirectional claim.
Pull the USB and watch `status` flip to `offline` — that is your Last-Will evidence.

## 6. Wiring it into AuraFlow

**Recommended path: app → Laravel → MQTT.** Keeps broker credentials off the
phone, gives you an audit row per trigger (useful in §5 evaluation), and still
fires when the app is backgrounded.

```php
// composer require php-mqtt/laravel-client
// app/Services/AmbientLightService.php
public function setMode(User $user, string $mode, int $brightness = 70): void
{
    $deviceId = $user->iotDevice?->device_id;
    if (! $deviceId) { return; }

    MQTT::publish(
        "auraflow/{$deviceId}/light/set",
        json_encode(['mode' => $mode, 'brightness' => $brightness]),
        qos: 1
    );

    IotEvent::create([                    // evidence trail for the report
        'user_id' => $user->id,
        'device_id' => $deviceId,
        'mode' => $mode,
        'trigger' => request()->input('trigger'),   // geofence_enter, break, posture
    ]);
}
```

```ts
// RN side — hook it to the W10.12 geofence handler
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';

TaskManager.defineTask(GEOFENCE_TASK, async ({ data: { eventType, region } }) => {
  if (region.identifier !== 'study-desk') return;

  const entering = eventType === Location.GeofencingEventType.Enter;
  await api.post('/iot/light', {
    mode: entering ? 'focus' : 'off',
    brightness: 85,
    trigger: entering ? 'geofence_enter' : 'geofence_exit',
  });
});
```

Subscribe the app to `light/state` and `sensor/ambient` (retained messages mean
the UI is correct the instant it connects) and you have a live device card in
the Settings screen.

## 7. Fallbacks

**Only have an Arduino Uno?** The Uno has no networking. Two options:
- Uno + **ESP-01** on SoftwareSerial with `WiFiEspAT` — works, but fiddly and
  the demo is more fragile. Not recommended two weeks before submission.
- Uno over **USB serial** to a small Node/PHP bridge on your laptop that holds
  the MQTT connection. Honest, but say so in the report — the Uno is then a
  peripheral, not a network node.

**No hardware at all / need a backup for the presentation?** This sketch runs
unmodified on **[Wokwi](https://wokwi.com)** — ESP32 + NeoPixel ring + LDR +
button, with real MQTT out to `broker.hivemq.com`. Use SSID `Wokwi-GUEST`,
empty password. Record it as your backup demo video in case the hardware
misbehaves on the day.

**Local broker for the privacy section:** `mosquitto` on your laptop, app and
node on the same WiFi. Then you can claim in §4.4 that no ambient/behavioural
data leaves the LAN — which pairs well with the AR "no frame upload" evidence
(W10.9).

## 8. Evidence to capture (for the report / presentation)

- [ ] Photo of the wired breadboard, lamp lit in **focus** and **sleep** modes
- [ ] `mosquitto_sub -v` terminal screenshot showing set → state round trip
- [ ] Screenshot of `"source":"button"` state message (bidirectional proof)
- [ ] `status: offline` retained message after pulling power (Last-Will / resilience)
- [ ] Latency measurement: geofence crossing → lamp change (target < 2 s) — the
      §5 evaluation section wants numbers, not adjectives
- [ ] 20–30 s demo clip: walk to the desk → lamp turns focus-white by itself
- [ ] Sequence diagram: watch → phone → API → broker → node → back
