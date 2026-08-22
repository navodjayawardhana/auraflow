#include "sensors.h"

#include <Wire.h>
#include <MAX30105.h>
#include <spo2_algorithm.h>

#include "config.h"

namespace {

MAX30105 pulse;
bool     pulseOk = false;

uint32_t irBuffer[BIO_BUFFER];
uint32_t redBuffer[BIO_BUFFER];
int      sampleCount     = 0;
int      sinceLastCompute = 0;

BioReading latest      = {};
bool       latestFresh = false;

bool  hrSmoothInit = false;
float hrSmoothed   = 0.0f;

// Slew-limits the raw per-second HR estimate — see HR_MAX_STEP_BPM in
// config.h for why. Resets on finger-off so a fresh contact starts from its
// own first reading rather than crawling up from whatever the last session
// last showed.
int32_t smoothHeartRate(int32_t rawHr, bool fingerPresent) {
  if (!fingerPresent) {
    hrSmoothInit = false;
    return rawHr;
  }
  if (!hrSmoothInit) {
    hrSmoothed   = (float)rawHr;
    hrSmoothInit = true;
    return rawHr;
  }
  const float delta = constrain((float)rawHr - hrSmoothed,
                                 -HR_MAX_STEP_BPM, HR_MAX_STEP_BPM);
  hrSmoothed += delta;
  return lroundf(hrSmoothed);
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
    r.heartRateValid = hrValid && hr > 30 && hr < 220;
    r.heartRate = r.heartRateValid ? smoothHeartRate(hr, true) : hr;
    r.spo2           = spo2;
    r.spo2Valid      = spo2Valid && spo2 >= 70 && spo2 <= 100;
  } else {
    smoothHeartRate(0, false);   // finger off — reset the filter for next time
  }

  latest      = r;
  latestFresh = true;
}

#if SIMULATE_BIO
// A slow random walk rather than white noise, so the app, the chart and the
// OLED all get something that behaves like a trace and not like static.
void simulateBiometrics() {
  static unsigned long last = 0;
  static float hr = 68.0f, spo2 = 97.0f;

  if (millis() - last < 1000) return;
  last = millis();

  hr   = constrain(hr   + random(-15, 16) / 10.0f, 55.0f, 95.0f);
  spo2 = constrain(spo2 + random(-3, 4)   / 10.0f, 94.0f, 99.0f);

  BioReading r     = {};
  r.fingerPresent  = true;
  r.irMean         = 85000;
  r.heartRate      = (int32_t)lroundf(hr);
  r.heartRateValid = true;
  r.spo2           = (int32_t)lroundf(spo2);
  r.spo2Valid      = true;

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
  Serial.println("[bio] SIMULATED — MAX30102 not read");
#else
  pulseOk = pulse.begin(Wire, I2C_SPEED_FAST);
  if (pulseOk) {
    // ledBrightness 60, sampleAverage 4, ledMode 2 (red+IR),
    // sampleRate 100, pulseWidth 411, adcRange 4096
    //   -> 100 / 4 = 25 Hz effective, which is what the SpO2 algorithm assumes.
    pulse.setup(60, 4, 2, 100, 411, 4096);
    // setup() already drives both LEDs at 60. The SpO2 ratio compares Red to IR
    // amplitude, so leave Red matched to IR rather than dimming it — an
    // unmatched pair reads as a degenerate ratio (SpO2 pinned near 100%
    // regardless of the actual reading) rather than a real measurement.
    pulse.setPulseAmplitudeGreen(0);   // MAX30102 has no green LED
    Serial.println("[bio] MAX30102 ready");
  } else {
    Serial.println("[bio] MAX30102 NOT found — check SDA=21 SCL=22 and 3V3");
  }
#endif
}

void update() {
#if SIMULATE_BIO
  simulateBiometrics();
#else
  // Drain the FIFO, recompute once per second.
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

bool takeBiometrics(BioReading& out) {
  if (!latestFresh) return false;
  out         = latest;
  latestFresh = false;
  return true;
}

bool readDieTemperature(float& outC) {
#if SIMULATE_BIO
  return false;      // there is no die to read — do not invent a number
#else
  if (!pulseOk) return false;
  // Never stall the sample stream mid-measurement; the reading is only a
  // diagnostic and can wait for the finger to come off.
  if (latest.fingerPresent) return false;

  const float t = pulse.readTemperature();   // one-shot, blocks ~50 ms
  if (isnan(t) || t < -20.0f || t > 90.0f) return false;
  outC = t;
  return true;
#endif
}

bool pulseSensorPresent() {
#if SIMULATE_BIO
  return true;
#else
  return pulseOk;
#endif
}

bool simulated() {
  return SIMULATE_BIO;
}

}  // namespace Sensors
