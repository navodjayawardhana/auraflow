#include "sensors.h"

#include <Wire.h>
#include <DHT.h>
#include <MAX30105.h>
#include <spo2_algorithm.h>

#include "config.h"

namespace {

// ---- environment ----------------------------------------------------------
DHT dht(PIN_DHT, DHT22);

uint16_t      noiseMin      = 4095;
uint16_t      noiseMax      = 0;
uint8_t       noiseLatest   = 0;
unsigned long noiseWindowMs = 0;

// ---- biometrics -----------------------------------------------------------
MAX30105 pulse;
bool     pulseOk = false;

uint32_t irBuffer[BIO_BUFFER];
uint32_t redBuffer[BIO_BUFFER];
int      sampleCount     = 0;
int      sinceLastCompute = 0;

BioReading latest      = {};
bool       latestFresh = false;

// ---- MAX30205 -------------------------------------------------------------
// Two registers is the whole driver, so there is no library dependency here.
// Datasheet: temperature is 16-bit two's complement, 0.00390625 C per LSB.
constexpr uint8_t MAX30205_REG_TEMP   = 0x00;
constexpr uint8_t MAX30205_REG_CONFIG = 0x01;

bool  tempOk    = false;
float bodyTempC = NAN;
unsigned long lastTempMs = 0;

bool tempBegin() {
  Wire.beginTransmission(ADDR_MAX30205);
  Wire.write(MAX30205_REG_CONFIG);
  Wire.write(0x00);              // continuous conversion, comparator mode
  return Wire.endTransmission() == 0;
}

bool tempRead(float& outC) {
  Wire.beginTransmission(ADDR_MAX30205);
  Wire.write(MAX30205_REG_TEMP);
  if (Wire.endTransmission(false) != 0) return false;      // repeated start
  if (Wire.requestFrom((int)ADDR_MAX30205, 2) != 2) return false;

  const uint8_t msb = Wire.read();
  const uint8_t lsb = Wire.read();
  outC = (int16_t)((msb << 8) | lsb) * 0.00390625f;
  return true;
}

void pushSample(uint32_t red, uint32_t ir) {
  if (sampleCount < BIO_BUFFER) {
    redBuffer[sampleCount] = red;
    irBuffer[sampleCount]  = ir;
    sampleCount++;
  } else {
    memmove(redBuffer, redBuffer + 1, (BIO_BUFFER - 1) * sizeof(uint32_t));
    memmove(irBuffer,  irBuffer  + 1, (BIO_BUFFER - 1) * sizeof(uint32_t));
    redBuffer[BIO_BUFFER - 1] = red;
    irBuffer[BIO_BUFFER - 1]  = ir;
  }
  sinceLastCompute++;
}

// Skin temperature is only meaningful while something is actually on the pad,
// so the finger flag from the MAX30102 gates the MAX30205 reading. Off-skin the
// part reports room temperature, which would quietly poison the training set.
void stampBodyTemp(BioReading& r) {
  r.bodyTempC     = bodyTempC;
  r.bodyTempValid = tempOk && r.fingerPresent && !isnan(bodyTempC) &&
                    bodyTempC > BODY_TEMP_MIN_C && bodyTempC < BODY_TEMP_MAX_C;
}

void computeBiometrics() {
  uint64_t sum = 0;
  for (int i = 0; i < BIO_BUFFER; i++) sum += irBuffer[i];
  const uint32_t irMean = (uint32_t)(sum / BIO_BUFFER);

  BioReading r = {};
  r.irMean        = irMean;
  r.fingerPresent = irMean > FINGER_IR_FLOOR;

  if (r.fingerPresent) {
    int32_t spo2 = 0, hr = 0;
    int8_t  spo2Valid = 0, hrValid = 0;
    // Maxim's reference implementation, shipped with the SparkFun library.
    // It expects exactly FS*4 samples at 25 Hz — see the sensor setup below.
    maxim_heart_rate_and_oxygen_saturation(
        irBuffer, BIO_BUFFER, redBuffer, &spo2, &spo2Valid, &hr, &hrValid);

    // The algorithm returns -999 for "could not resolve"; treat physiologically
    // impossible values as invalid too rather than publishing noise.
    r.heartRate      = hr;
    r.heartRateValid = hrValid && hr > 30 && hr < 220;
    r.spo2           = spo2;
    r.spo2Valid      = spo2Valid && spo2 >= 70 && spo2 <= 100;
  }

  stampBodyTemp(r);

  latest      = r;
  latestFresh = true;
}

#if SIMULATE_BIO
// A slow random walk rather than white noise, so the app, the chart and the
// OLED all get something that behaves like a trace and not like static.
void simulateBiometrics() {
  static unsigned long last = 0;
  static float hr = 68.0f, spo2 = 97.0f, temp = 33.4f;

  if (millis() - last < 1000) return;
  last = millis();

  hr   = constrain(hr   + random(-15, 16) / 10.0f, 55.0f, 95.0f);
  spo2 = constrain(spo2 + random(-3, 4)   / 10.0f, 94.0f, 99.0f);
  temp = constrain(temp + random(-2, 3)   / 100.0f, 32.5f, 34.5f);

  BioReading r     = {};
  r.fingerPresent  = true;
  r.irMean         = 85000;
  r.heartRate      = (int32_t)lroundf(hr);
  r.heartRateValid = true;
  r.spo2           = (int32_t)lroundf(spo2);
  r.spo2Valid      = true;
  r.bodyTempC      = temp;
  r.bodyTempValid  = true;

  bodyTempC   = temp;      // so the OLED shows the same number
  latest      = r;
  latestFresh = true;
}
#endif

}  // namespace

namespace Sensors {

void begin() {
  analogReadResolution(12);
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

#if SIMULATE_BIO
  Serial.println("[bio] SIMULATED — MAX30102 + MAX30205 not read");
#else
  pulseOk = pulse.begin(Wire, I2C_SPEED_FAST);
  if (pulseOk) {
    // ledBrightness 60, sampleAverage 4, ledMode 2 (red+IR),
    // sampleRate 100, pulseWidth 411, adcRange 4096
    //   -> 100 / 4 = 25 Hz effective, which is what the SpO2 algorithm assumes.
    pulse.setup(60, 4, 2, 100, 411, 4096);
    pulse.setPulseAmplitudeRed(0x0A);
    pulse.setPulseAmplitudeGreen(0);   // MAX30102 has no green LED
    Serial.println("[bio] MAX30102 ready");
  } else {
    Serial.println("[bio] MAX30102 NOT found — check SDA=21 SCL=22 and 3V3");
  }

  tempOk = tempBegin();
  Serial.printf("[bio] MAX30205 %s at 0x%02X\n",
                tempOk ? "ready" : "NOT found — run the I2C scanner, it may be 0x49",
                ADDR_MAX30205);
#endif

#if SIMULATE_ENV
  Serial.println("[env] SIMULATED — DHT22 + LDR + mic not read");
#else
  dht.begin();
#endif

  noiseWindowMs = millis();
  lastTempMs    = millis();
}

void update() {
#if !SIMULATE_ENV
  // --- noise: track peak-to-peak over a 1 s window -------------------------
  const uint16_t s = analogRead(PIN_SOUND);
  if (s < noiseMin) noiseMin = s;
  if (s > noiseMax) noiseMax = s;

  if (millis() - noiseWindowMs >= NOISE_WINDOW_MS) {
    const int p2p = (int)noiseMax - (int)noiseMin;
    // Half of full scale is already a very loud room, so that is our 100%.
    noiseLatest   = constrain(map(p2p, 0, ADC_MAX / 2, 0, 100), 0, 100);
    noiseMin      = 4095;
    noiseMax      = 0;
    noiseWindowMs = millis();
  }
#endif

#if SIMULATE_BIO
  simulateBiometrics();
#else
  // --- skin temperature: far slower than the pulse, so its own cadence -----
  if (tempOk && millis() - lastTempMs >= BODY_TEMP_READ_MS) {
    lastTempMs = millis();
    float t;
    if (tempRead(t)) {
      bodyTempC = t;
    } else {
      tempOk = false;              // bus fault — stop claiming a reading
      Serial.println("[bio] MAX30205 read failed, marking absent");
    }
  }

  // --- biometrics: drain the FIFO, recompute once per second ---------------
  if (!pulseOk) return;

  pulse.check();
  while (pulse.available()) {
    pushSample(pulse.getFIFORed(), pulse.getFIFOIR());
    pulse.nextSample();
  }

  if (sampleCount >= BIO_BUFFER && sinceLastCompute >= BIO_STRIDE) {
    sinceLastCompute = 0;
    computeBiometrics();
  }
#endif
}

EnvReading readEnvironment() {
  EnvReading e = {};

#if SIMULATE_ENV
  // A plausible Colombo bedroom, drifting slowly so the sleep-quality model
  // sees variation instead of a flat line.
  static float t = 27.5f, h = 74.0f;
  t = constrain(t + random(-2, 3) / 10.0f, 24.0f, 31.0f);
  h = constrain(h + random(-5, 6) / 10.0f, 60.0f, 88.0f);

  e.dhtOk        = true;
  e.temperatureC = t;
  e.humidityPct  = h;
  e.ambientPct   = (uint8_t)random(0, 101);
  e.noisePct     = (uint8_t)random(0, 35);
  return e;
#else
  const float t = dht.readTemperature();
  const float h = dht.readHumidity();
  e.dhtOk = !isnan(t) && !isnan(h);
  if (e.dhtOk) {
    e.temperatureC = t;
    e.humidityPct  = h;
  }

  const int raw = analogRead(PIN_LDR);
  e.ambientPct = constrain(map(raw, 0, ADC_MAX, 0, 100), 0, 100);
  e.noisePct   = noiseLatest;
  return e;
#endif
}

bool takeBiometrics(BioReading& out) {
  if (!latestFresh) return false;
  out         = latest;
  latestFresh = false;
  return true;
}

bool pulseSensorPresent() {
#if SIMULATE_BIO
  return true;
#else
  return pulseOk;
#endif
}

bool tempSensorPresent() {
#if SIMULATE_BIO
  return true;
#else
  return tempOk;
#endif
}

bool simulated() {
  return SIMULATE_BIO || SIMULATE_ENV;
}

}  // namespace Sensors
