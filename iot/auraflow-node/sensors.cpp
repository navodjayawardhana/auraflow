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

/**
 * Consecutive samples above the contact floor, capped at a full window.
 *
 * Contact used to be decided from the mean of the whole buffer, which meant it flipped
 * true about two seconds into a measurement — while half the window was still no-finger
 * data with a step edge through the middle of it. Maxim's peak finder locks onto that
 * edge and returns a rate inside the plausible range, so the first readings of every
 * session were confidently wrong. Counting an unbroken run instead makes "settled" mean
 * what the algorithm actually needs: every sample in the window is signal.
 */
int fingerRun = 0;

BioReading latest      = {};
bool       latestFresh = false;

bool          hrSmoothInit     = false;
float         hrSmoothed       = 0.0f;
unsigned long lastMaximValidMs = 0;

uint32_t      droppedTotal      = 0;
unsigned long lastDrainMs       = 0;
unsigned long lastSensorRetryMs = 0;

// ---- sample clock ---------------------------------------------------------
//
// Two problems, one fix. Timing beats by millis() at the moment a sample is *processed*
// measures when the FIFO happened to be drained, not when the sample was taken — the
// driver hands them over in bursts of up to four, which at 75 bpm would put 160 ms of
// jitter on an 800 ms interval. And the 25 Hz the whole pipeline assumes is nominal: it
// comes from the MAX30102's own oscillator, which is not the ESP32's crystal.
//
// Counting samples gives a jitter-free clock; dividing elapsed millis() by that count
// measures what the rate really is. Beats are timed in sample indices converted through
// the measured period, so burst jitter averages out over the calibration span instead of
// landing on individual intervals.
uint32_t      clockSamples = 0;
unsigned long clockStartMs = 0;
float         msPerSample  = 1000.0f / SAMPLE_RATE_NOMINAL_HZ;

void resetSampleClock() {
  clockSamples = 0;
  clockStartMs = millis();
  msPerSample  = 1000.0f / SAMPLE_RATE_NOMINAL_HZ;
}

void updateSampleClock(int fresh) {
  clockSamples += (uint32_t)fresh;

  const unsigned long span = millis() - clockStartMs;
  if (span < CLOCK_MIN_SPAN_MS || clockSamples == 0) return;

  const float measured = (float)span / (float)clockSamples;
  const float nominal  = 1000.0f / SAMPLE_RATE_NOMINAL_HZ;

  if (fabsf(measured - nominal) / nominal > CLOCK_MAX_DEVIATION) return;

  msPerSample = measured;
}

// ---- beat-interval heart rate ---------------------------------------------

uint32_t beatSampleIndex = 0;
uint32_t lastBeatSample  = 0;
bool     haveLastBeat    = false;
float    beatIntervals[HR_BEAT_WINDOW];
uint32_t beatStamps[HR_BEAT_WINDOW];   // sample index each interval was recorded at
int      beatCount = 0;
int      beatHead  = 0;

// Detector state. See BEAT_DC_ALPHA in config.h for why this is ours rather than the
// library's — in short, `checkForBeat` truncates its sample to sixteen bits and this
// sensor reads six times that with a finger on it.
float    dcEstimate = 0.0f;
float    dcSlope    = 0.0f;   // counts per sample; what makes a ramp trackable
bool     dcSeeded   = false;
uint32_t dcSamples  = 0;      // since seeding, for the fast-attack schedule
float acSmoothed = 0.0f;
float acPrevious = 0.0f;
float cycleMax   = 0.0f;
float cycleMin   = 0.0f;

/** The last cycle's swing, kept only so beatDebug() can report what the gate saw. */
float lastSwing = 0.0f;

void resetBeatDetector() {
  haveLastBeat = false;
  beatCount    = 0;
  beatHead     = 0;

  dcSeeded   = false;
  dcSamples  = 0;
  dcSlope    = 0.0f;
  acSmoothed = 0.0f;
  acPrevious = 0.0f;
  cycleMax   = 0.0f;
  cycleMin   = 0.0f;
}

/** Insertion sort — at most eight floats, where qsort would cost more than it saves. */
void sortAscending(float* v, int n) {
  for (int i = 1; i < n; i++) {
    const float key = v[i];
    int j = i - 1;
    while (j >= 0 && v[j] > key) {
      v[j + 1] = v[j];
      j--;
    }
    v[j + 1] = key;
  }
}

/**
 * Copies the intervals still recent enough to describe the rate *now*, sorted.
 *
 * The ring on its own has no notion of age, and on a poor signal intervals are accepted
 * far apart — one from when the hand was still would sit in the median beside one from a
 * moment ago and the result would describe no particular minute. On a clean signal every
 * entry is a few seconds old and this costs nothing; it earns its place exactly when the
 * signal is bad, which is when a wrong number is easiest to believe.
 */
int freshIntervals(float* out) {
  if (beatCount == 0) return 0;

  const uint32_t maxAge = (uint32_t)((float)HR_BEAT_MAX_AGE_MS / msPerSample);
  int n = 0;

  for (int i = 0; i < beatCount; i++) {
    if (beatSampleIndex - beatStamps[i] <= maxAge) out[n++] = beatIntervals[i];
  }

  sortAscending(out, n);
  return n;
}

/**
 * The median rather than the mean: one missed beat counted as a single long interval
 * would drag a mean down for the whole window, where a median simply out-votes it.
 */
float medianOf(const float* sorted, int n) {
  if (n == 0) return 0.0f;
  return (n % 2 == 1) ? sorted[n / 2] : 0.5f * (sorted[n / 2 - 1] + sorted[n / 2]);
}


void recordBeat() {
  if (!haveLastBeat) {
    lastBeatSample = beatSampleIndex;
    haveLastBeat   = true;
    return;
  }

  const float intervalMs = (float)(beatSampleIndex - lastBeatSample) * msPerSample;

  if (intervalMs > (float)HR_BEAT_MAX_MS) {
    // Too long to be one interval, so it is two or more with a beat missed between them.
    // Re-seed rather than record: this interval is not measurable, the next one is.
    lastBeatSample = beatSampleIndex;
    return;
  }

  float fresh[HR_BEAT_WINDOW];
  const int freshCount = freshIntervals(fresh);

  const float floorMs =
      freshCount >= 3
          ? fminf(HR_BEAT_REFRACTORY_MAX_MS,
                  fmaxf((float)HR_BEAT_MIN_MS,
                        medianOf(fresh, freshCount) * HR_BEAT_REFRACTORY_RATIO))
          : (float)HR_BEAT_MIN_MS;

  // Deliberately without advancing lastBeatSample. A rejected crossing is a notch rather
  // than a beat, so the real interval is still running — moving the mark here would make
  // the next measurement notch-to-beat, wrong in the other direction and harder to spot.
  if (intervalMs < floorMs) return;

  lastBeatSample = beatSampleIndex;

  beatIntervals[beatHead] = intervalMs;
  beatStamps[beatHead]    = beatSampleIndex;
  beatHead = (beatHead + 1) % HR_BEAT_WINDOW;
  if (beatCount < HR_BEAT_WINDOW) beatCount++;
}

/** Fed every contact sample, in order. Carries state between calls. */
void observeBeat(uint32_t ir) {
  beatSampleIndex++;

  const float sample = (float)ir;

  if (!dcSeeded) {
    dcEstimate = sample;
    dcSlope    = 0.0f;
    dcSeeded   = true;
    dcSamples  = 0;
    return;
  }

  // Predict first, then correct from what the prediction missed. On a baseline moving at
  // a steady rate the prediction is already right and the correction is only the beat,
  // which is the whole point: the tracker follows the drift without following the pulse.
  dcEstimate += dcSlope;
  const float residual = sample - dcEstimate;

  if (fabsf(residual) > dcEstimate * BEAT_DC_RESEED_FRACTION) {
    // Somewhere else entirely — a finger landing, or one lifted and put back. No pulse
    // moves the reading by a fifth of itself, so this is the baseline being wrong rather
    // than the signal being interesting. Jump, drop the slope, and take the fast gains
    // again. The intervals already collected are left alone: they age out on their own,
    // and discarding them here would throw away a good measurement every time a hand
    // shifted.
    dcEstimate = sample;
    dcSlope    = 0.0f;
    dcSamples  = 0;
    acSmoothed = 0.0f;
    acPrevious = 0.0f;
    cycleMax   = 0.0f;
    cycleMin   = 0.0f;
    return;
  }

  dcSamples++;
  const bool fast = dcSamples < BEAT_DC_FAST_SAMPLES;
  dcEstimate += residual * (fast ? BEAT_DC_FAST_ALPHA : BEAT_DC_ALPHA);
  dcSlope    += residual * (fast ? BEAT_DC_FAST_BETA  : BEAT_DC_BETA);

  acPrevious = acSmoothed;
  acSmoothed += ((sample - dcEstimate) - acSmoothed) * BEAT_SMOOTH_ALPHA;

  // The rising zero crossing is the fiducial, not the peak. A peak detector is pulled
  // about by the dicrotic notch, which rides the falling edge and often never crosses
  // zero at all; a crossing is also the sharpest, most repeatable point on the waveform,
  // which is what timing an interval to a fraction of a sample needs.
  if (acPrevious < 0.0f && acSmoothed >= 0.0f) {
    const float swing = cycleMax - cycleMin;
    cycleMax = 0.0f;
    cycleMin = 0.0f;
    lastSwing = swing;

    if (swing > dcEstimate * BEAT_MIN_PERFUSION &&
        swing < dcEstimate * BEAT_MAX_PERFUSION) {
      recordBeat();
    }
  }

  if (acSmoothed > cycleMax) cycleMax = acSmoothed;
  if (acSmoothed < cycleMin) cycleMin = acSmoothed;
}

bool beatHeartRate(float& outBpm) {
  float fresh[HR_BEAT_WINDOW];
  const int n = freshIntervals(fresh);

  if (n < HR_BEAT_MIN_INTERVALS) return false;

  const float median = medianOf(fresh, n);
  if (median <= 0.0f) return false;

  outBpm = 60000.0f / median;
  return outBpm > 30.0f && outBpm < 220.0f;
}

// ---- SpO2 median ----------------------------------------------------------

int32_t spo2History[SPO2_MEDIAN_WINDOW];
int     spo2Count = 0;
int     spo2Head  = 0;

void resetSpo2Filter() {
  spo2Count = 0;
  spo2Head  = 0;
}

int32_t medianSpo2(int32_t fresh) {
  spo2History[spo2Head] = fresh;
  spo2Head = (spo2Head + 1) % SPO2_MEDIAN_WINDOW;
  if (spo2Count < SPO2_MEDIAN_WINDOW) spo2Count++;

  float sorted[SPO2_MEDIAN_WINDOW];
  for (int i = 0; i < spo2Count; i++) sorted[i] = (float)spo2History[i];
  sortAscending(sorted, spo2Count);

  return (int32_t)lroundf(sorted[spo2Count / 2]);
}

// ---- Maxim heart rate -----------------------------------------------------

/**
 * Slew-limits the raw per-second HR estimate — see HR_MAX_STEP_BPM in config.h for why.
 * Resets on finger-off so a fresh contact starts from its own first reading rather than
 * crawling up from whatever the last session last showed.
 */
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

// ---- window ---------------------------------------------------------------

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

void observeContact(uint32_t ir) {
  if (ir > FINGER_IR_FLOOR) {
    if (fingerRun < BIO_BUFFER) fingerRun++;
    return;
  }

  if (fingerRun != 0) {
    fingerRun = 0;
    // The interval spanning a break in contact is not a beat interval.
    resetBeatDetector();
  }
}

/** Everything that has to start again when the time base is no longer trustworthy. */
void restartWindow() {
  sampleCount      = 0;
  sinceLastCompute = 0;
  fingerRun        = 0;
  resetBeatDetector();
  resetSpo2Filter();
  resetSampleClock();
}

/**
 * Frees an I2C bus a device is holding, then opens it.
 *
 * A peripheral interrupted mid-byte keeps SDA low waiting for clocks that never come, and
 * every subsequent transfer on that bus fails. Nine clock pulses is one byte plus its ack
 * — enough for any device to finish the transfer it believes is in progress and let go —
 * followed by a STOP, which is SDA rising while SCL is high, to leave everything idle.
 *
 * Done by bit-banging the pins before handing them to Wire, because Wire cannot do it:
 * the peripheral has no notion of a bus that is stuck before it starts.
 */
void openI2cBus() {
  pinMode(PIN_SDA, INPUT_PULLUP);
  pinMode(PIN_SCL, OUTPUT);

  for (int i = 0; i < 9 && digitalRead(PIN_SDA) == LOW; i++) {
    digitalWrite(PIN_SCL, LOW);
    delayMicroseconds(5);
    digitalWrite(PIN_SCL, HIGH);
    delayMicroseconds(5);
  }

  pinMode(PIN_SDA, OUTPUT);
  digitalWrite(PIN_SDA, LOW);
  delayMicroseconds(5);
  digitalWrite(PIN_SCL, HIGH);
  delayMicroseconds(5);
  digitalWrite(PIN_SDA, HIGH);   // STOP
  delayMicroseconds(5);

  pinMode(PIN_SDA, INPUT);
  pinMode(PIN_SCL, INPUT);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
}

/** Opens the sensor and applies the acquisition settings. False if it does not answer. */
bool startPulseSensor() {
  if (!pulse.begin(Wire, I2C_SPEED_FAST)) return false;

  // ledBrightness 60, sampleAverage 4, ledMode 2 (red+IR),
  // sampleRate 100, pulseWidth 411, adcRange 4096
  //   -> 100 / 4 = 25 Hz effective, which is what the SpO2 algorithm assumes.
  pulse.setup(60, 4, 2, 100, 411, 4096);

  // setup() already drives both LEDs at 60. The SpO2 ratio compares Red to IR amplitude,
  // so leave Red matched to IR rather than dimming it — an unmatched pair reads as a
  // degenerate ratio (SpO2 pinned near 100% regardless of the actual reading) rather than
  // a real measurement.
  pulse.setPulseAmplitudeGreen(0);   // MAX30102 has no green LED
  return true;
}

void computeBiometrics() {
  uint64_t sum = 0;
  for (int i = 0; i < BIO_BUFFER; i++) sum += irBuffer[i];
  const uint32_t irMean = (uint32_t)(sum / BIO_BUFFER);

  BioReading r = {};
  r.irMean        = irMean;
  r.fingerPresent = fingerRun > 0;
  r.settled       = fingerRun >= BIO_BUFFER;

  // The beat estimator reports as soon as it has intervals, settled or not. It is a
  // streaming estimator carrying its own gates — a perfusion band on every cycle, a
  // refractory, a median over recent intervals only — so the four-second window is not
  // what makes its answer trustworthy, and waiting for one put three seconds in front of
  // every measurement without changing what the measurement was worth.
  float bpm = 0.0f;
  r.heartRateValid = r.fingerPresent && beatHeartRate(bpm);
  r.heartRate      = r.heartRateValid ? bpm : 0.0f;

  if (!r.settled) {
    // The other two do read the whole buffer, and half of it is still no-finger data with
    // a step edge through the middle. Maxim's peak finder locks onto that edge and returns
    // a rate inside the plausible range — a wrong number carrying a valid flag, which is
    // the failure this guard exists for.
    if (!r.fingerPresent) {
      smoothHeartRate(0, false);
      resetSpo2Filter();
      lastMaximValidMs = 0;
    }

    latest      = r;
    latestFresh = true;
    return;
  }

  int32_t spo2 = 0, hrMaxim = 0;
  int8_t  spo2Valid = 0, hrValid = 0;
  // Maxim's reference implementation, shipped with the SparkFun library.
  // It expects exactly FS*4 samples at 25 Hz — see the sensor setup below.
  maxim_heart_rate_and_oxygen_saturation(
      irBuffer, BIO_BUFFER, redBuffer, &spo2, &spo2Valid, &hrMaxim, &hrValid);

  // The algorithm returns -999 for "could not resolve"; treat physiologically
  // impossible values as invalid too rather than publishing noise.
  const bool maximOk = hrValid && hrMaxim > 30 && hrMaxim < 220;

  if (maximOk) {
    lastMaximValidMs = millis();
  } else if (lastMaximValidMs != 0 &&
             millis() - lastMaximValidMs > HR_INVALID_RESET_MS) {
    // Long enough without a lock that the next estimate is not continuous with the last.
    // Crawling to it at HR_MAX_STEP_BPM would report a rate the wearer had several
    // seconds ago as if it were current, so start the filter from wherever it lands.
    hrSmoothInit     = false;
    lastMaximValidMs = 0;
  }

  r.heartRateMaximValid = maximOk;
  r.heartRateMaxim      = maximOk ? smoothHeartRate(hrMaxim, true) : hrMaxim;

  const bool spo2Ok = spo2Valid && spo2 >= 70 && spo2 <= 100;
  r.spo2Valid       = spo2Ok;
  r.spo2            = spo2Ok ? medianSpo2(spo2) : spo2;

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
  r.settled        = true;
  r.irMean         = 85000;
  r.heartRate      = hr;
  r.heartRateValid = true;
  // Rounded to whole bpm, because the whole point of publishing both is that one of
  // them is quantised. A simulator that hid that would make the comparison meaningless.
  r.heartRateMaxim      = (int32_t)lroundf(hr);
  r.heartRateMaximValid = true;
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
  openI2cBus();

#if SIMULATE_BIO
  Serial.println("[bio] SIMULATED — MAX30102 not read");
#else
  pulseOk = startPulseSensor();
  if (pulseOk) {
    Serial.println("[bio] MAX30102 ready");
  } else {
    Serial.println("[bio] MAX30102 NOT found — clearing the bus and retrying");
  }
#endif

  resetSampleClock();
  lastDrainMs       = millis();
  lastSensorRetryMs = millis();
}

void update() {
#if SIMULATE_BIO
  simulateBiometrics();
#else
  if (!pulseOk) {
    // Keep trying. A sensor that did not answer at boot is usually a bus left stuck by the
    // reset rather than a sensor that is gone, and recovering without a power cycle is the
    // difference between a demo that pauses and one that ends.
    if (millis() - lastSensorRetryMs < SENSOR_RETRY_MS) return;
    lastSensorRetryMs = millis();

    openI2cBus();
    pulseOk = startPulseSensor();
    if (!pulseOk) return;

    Serial.println("[bio] MAX30102 answered on retry");
    restartWindow();
    lastDrainMs = millis();
    return;
  }

  // How long since the driver's ring was last emptied. Anything past its four-sample
  // depth is already gone — check() wraps its head over the oldest entries and
  // available() cannot tell us. See DRAIN_BUDGET_MS in config.h for why that loss is
  // worse than a plain gap: it compresses the window's time base, and Maxim's rate is a
  // sample count divided into a constant, so the reading comes back high rather than
  // absent.
  const unsigned long now = millis();
  const unsigned long gap = now - lastDrainMs;
  lastDrainMs = now;

  if (gap > DRAIN_BUDGET_MS) {
    const int lost = (int)(gap / msPerSample) - FIFO_DRIVER_DEPTH;
    if (lost > 0) droppedTotal += (uint32_t)lost;

    // Drain and discard: what is still in the driver is the tail of a window whose head
    // no longer exists, and stitching those two together is what produces the
    // fast-reading artefact in the first place.
    pulse.check();
    while (pulse.available()) pulse.nextSample();
    restartWindow();

    Serial.printf("[bio] drain gap %lums (budget %lums) — ~%d samples lost, %lu total\n",
                  gap, DRAIN_BUDGET_MS, lost > 0 ? lost : 0,
                  (unsigned long)droppedTotal);
    return;
  }

  pulse.check();

  int fresh = 0;
  while (pulse.available()) {
    const uint32_t ir  = pulse.getFIFOIR();
    const uint32_t red = pulse.getFIFORed();

    pushSample(red, ir);
    observeContact(ir);

    // Settled contact only — the same gate the published readings use, and for a stronger
    // reason here. The detector carries its own DC estimate, and the four seconds after a
    // finger lands are a step of two orders of magnitude that no follower slow enough to
    // sit through a beat can track. Feeding it that ramp puts a swing of most of the DC
    // through a gate meant to see a percent or two of it. Before contact the objection is
    // different but the answer is the same: the estimate wanders on noise until a crossing
    // reads as a beat, and those intervals would still be in the median window when a real
    // finger arrived.
    if (fingerRun >= BEAT_START_SAMPLES) observeBeat(ir);

    fresh++;
    pulse.nextSample();
  }

  if (fresh > 0) updateSampleClock(fresh);

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

float sampleRateHz() {
#if SIMULATE_BIO
  return SAMPLE_RATE_NOMINAL_HZ;
#else
  return msPerSample > 0.0f ? 1000.0f / msPerSample : 0.0f;
#endif
}

uint32_t droppedSamples() {
  return droppedTotal;
}

void beatDebug(float& swing, float& dc, int& intervals, float& medianMs,
               float& loMs, float& hiMs) {
  float fresh[HR_BEAT_WINDOW];

  swing     = lastSwing;
  dc        = dcEstimate;
  // The fresh count rather than the ring occupancy: it is the one the estimator gates on,
  // so a log showing four while nothing is reported would be the log lying.
  intervals = freshIntervals(fresh);
  medianMs  = medianOf(fresh, intervals);

  // freshIntervals() returns them sorted, so the ends are the extremes.
  loMs = intervals > 0 ? fresh[0] : 0.0f;
  hiMs = intervals > 0 ? fresh[intervals - 1] : 0.0f;
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

  // That one-shot just ate a third of the drain budget. Charging it to the next drain
  // would show up as a phantom sample loss, so the clock restarts here instead.
  lastDrainMs = millis();

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
