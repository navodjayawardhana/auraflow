# AuraFlow — IoT Wellbeing Node

**CMP 7003 · PRAC1** — one ESP32 that senses the sleep environment, senses live
biometrics, and acts as a circadian lamp. The superset of `auraflow-light`.

> **Why it matters for the marks:** the Huawei Fit exposes no `0x180D` Heart Rate
> GATT service (measured 2026-08-08), so this node is the system's **only live
> biometric stream** — and the independent reference the watch's Health Connect
> samples get validated against in the evaluation section. That validation is a
> real result you can put a number on, which is exactly what §5 wants.

---

## 1. Build it before the parts arrive

`config.h` carries two simulation switches:

```cpp
#define SIMULATE_BIO 1   // MAX30102 + MAX30205
#define SIMULATE_ENV 1   // DHT22 + LDR + mic
```

With these on, the node synthesises a slow random walk — HR wandering 55–95,
SpO₂ 94–99, skin temp 32.5–34.5 °C, a plausible Colombo bedroom — and publishes
it over real WiFi to the real broker. So the whole
**WiFi → MQTT → Laravel → RN app** chain can be built, debugged and demoed with
nothing but a bare ESP32 on the desk.

Set each flag to `0` the moment that part is physically wired in. Debugging a
pipeline bug and a sensor bug at the same time is what eats the days.

> ⚠️ **Every simulated payload carries `"simulated": true`** and the OLED shows a
> `SIM` tag. Filter that field out server-side before anything reaches the
> training set, and never screenshot a `SIM` frame as evidence. Simulated data
> presented as measured data is an academic misconduct finding, not a bug.

## 2. Parts

| Part | Qty | Feeds |
|---|---|---|
| **ESP32 DevKit v1** (30-pin) | 1 | — |
| **MAX30102** breakout | 1 | HR + SpO₂ |
| **MAX30205** breakout | 1 | fingertip skin temperature |
| **SSD1306 0.96" OLED**, I²C | 1 | local demo readout |
| **DHT22** | 1 | room temp / humidity |
| **LDR** + 10 kΩ | 1 | ambient light |
| **Electret mic module** (AO) | 1 | night-time noise |
| **WS2812B ring**, 8 px + 330 Ω | 1 | circadian lamp |
| **Push button** | 1 | manual override |
| Breadboard + jumpers | — | — |

## 3. Wiring

![wiring](../../docs/diagrams/03-wiring.jpg)

Full-size figure: `docs/diagrams/03-wiring.jpg`, regenerated with
`python docs/diagrams/generate_wiring.py`. Crossing wires in the figure are not
joined — only the dots are connections.

Three digital sensors, one bus, no address collisions:

| ESP32 | goes to |
|---|---|
| `21` (SDA) | MAX30102 SDA · MAX30205 SDA · OLED SDA |
| `22` (SCL) | MAX30102 SCL · MAX30205 SCL · OLED SCL |
| `3V3` | all three modules VIN/VCC, DHT22 VCC, LDR leg |
| `GND` | every module GND, button, strip GND |
| `13` | DHT22 DATA (4k7 pull-up to 3V3) |
| `34` | LDR / 10 kΩ divider midpoint |
| `35` | mic module AO |
| `5` | 330 Ω → WS2812 DIN |
| `4` | button leg 1 (other leg → GND) |
| `VIN` (5 V) | WS2812 5 V |

All three I²C modules are 3.3 V native — **no level shifter**, and the pull-ups
are already on the breakouts.

**Mount the MAX30205 against skin.** Left flat on the breadboard it reports room
temperature, and `SIMULATE_BIO 0` will happily publish that as a biometric.
Extend it on wires so it sits beside the finger on the MAX30102 pad — the
firmware only trusts it while the pulse sensor reports a finger, which is the
guard against exactly this.

### Running on battery

18650 → TP4056 → **MT3608 boost set to 5 V** → ESP32 `VIN`.

The 18650 delivers 3.0–4.2 V but the board's AMS1117 needs ~1 V of headroom, so
feeding `VIN` directly gives you a node that browns out and reboots below ~4.4 V
— mid-demo, on stage. USB-only? Then skip the boost module entirely.

## 4. Check the bus first

Flash `../i2c-scanner` before the main sketch, every time the wiring changes:

```
[i2c] scanning...
  0x3C  SSD1306 OLED
  0x48  MAX30205 skin temperature
  0x57  MAX30102 pulse oximeter
[i2c] 3 devices
```

An address that reports differently (`0x3D`, `0x49`) is fine — put the value it
actually reports into `config.h`. Nothing at all means SDA/SCL are swapped or a
module is missing power.

## 5. Build & flash

1. **Arduino IDE 2.x** → Boards Manager → **esp32 by Espressif**.
2. Library Manager:
   - `PubSubClient` (Nick O'Leary)
   - `ArduinoJson` **v7.x** (Benoit Blanchon) — v6 will not compile, the sketch
     uses the v7 `JsonDocument` API
   - `Adafruit NeoPixel`
   - `SparkFun MAX3010x Pulse and Proximity Sensor Library`
   - `Adafruit SSD1306` + `Adafruit GFX Library`
   - `DHT sensor library` (Adafruit) + `Adafruit Unified Sensor`

   The MAX30205 needs no library — it is two registers, implemented inline in
   `sensors.cpp`.
3. `cp secrets.example.h secrets.h`, fill in WiFi + broker + `DEVICE_ID`. On a
   public broker make `DEVICE_ID` unique or a stranger's traffic lands on your
   lamp.
4. No COM port in Device Manager → install the **CP2102** or **CH340** driver,
   depending on the USB chip on your board.
5. Upload, Serial Monitor at **115200**.

```
[AuraFlow] IoT wellbeing node
[bio] SIMULATED — MAX30102 + MAX30205 not read
[env] SIMULATED — DHT22 + LDR + mic not read
[oled] SSD1306 ready
[warn] simulated sensor data — payloads carry "simulated":true
[wifi] 192.168.1.42  rssi=-51
[mqtt] connecting to broker.hivemq.com:1883 ... connected
```

## 6. Topics

| Topic | Direction | Payload |
|---|---|---|
| `auraflow/<id>/light/set` | app → device | `{"mode":"focus","brightness":85}` |
| `auraflow/<id>/light/state` | device → app | `{"mode":"focus","brightness":85,"source":"button","rssi":-52,"uptime_s":410}` *(retained)* |
| `auraflow/<id>/telemetry/environment` | device → app | `{"temperature_c":27.4,"humidity_pct":74,"ambient_pct":12,"noise_pct":6,...}` every 30 s |
| `auraflow/<id>/telemetry/biometrics` | device → app | `{"finger":true,"hr_bpm":72,"spo2_pct":97,"skin_temp_c":33.41,...}` every 5 s while a finger is on |
| `auraflow/<id>/status` | device → app | `online` / `offline` *(retained, Last-Will)* |

Biometrics also publish **once immediately** on finger-on and finger-off, so the
app can show "measuring…" without waiting out the interval.

`skin_temp_c` is deliberately **not** named `body_temp`: a fingertip runs several
degrees below core, and reporting it as core temperature is a claim the report
cannot defend.

## 7. Test without the app

```bash
mosquitto_sub -h broker.hivemq.com -t 'auraflow/auraflow-desk-01/#' -v

mosquitto_pub -h broker.hivemq.com -t 'auraflow/auraflow-desk-01/light/set' \
  -m '{"mode":"focus","brightness":85}'
```

## 8. Evidence to capture

- [ ] I²C scanner output showing all three addresses (proves the bus)
- [ ] `mosquitto_sub -v` screenshot: `light/set` → `light/state` round trip
- [ ] `"source":"button"` state message — the bidirectional-control proof
- [ ] `status: offline` after pulling power — Last-Will / resilience
- [ ] Photo of the OLED showing live HR + SpO₂ + skin temp, **no `SIM` tag**
- [ ] Node HR vs Huawei Fit HR, same wrist, 20 simultaneous samples → Bland-Altman
      plot (`../analysis/validate_hr.py`). This is the number §5 wants.
- [ ] Latency: geofence crossing → lamp change, target < 2 s
