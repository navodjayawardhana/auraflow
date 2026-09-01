#include "sensors.h"

#include <Wire.h>
#include <MAX30105.h>
#include <heartRate.h>
#include <spo2_algorithm.h>

#include "config.h"

/*
 * The peak-to-peak amplitude `checkForBeat` gates on, which it computes and then keeps to
 * itself. These are file-scope globals in the library's heartRate.cpp with external
 * linkage but no declaration in its header, so naming them here is the only way to read
 * the number that decides whether a beat is reported at all.
 *
 * Worth the reach into another translation unit because that number is the entire
 * diagnosis when a rate will not resolve: it separates "the detector never saw a pulse"
 * from "it saw one and something downstream threw it away", and nothing else the node can
 * print tells those apart. If a library update ever makes them static this stops linking,
 * loudly, which is the right way for it to break.
 */
extern int16_t IR_AC_Max;
extern int16_t IR_AC_Min;

namespace {

MAX30105 pulse;

// ---- shared small helpers --------------------------------------------------

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
 * The median rather than the mean: one missed beat counted as a single long interval
 * would drag a mean down for the whole window, where a median simply out-votes it.
 */
float medianOf(const float* sorted, int n) {
  if (n == 0) return 0.0f;
  return (n % 2 == 1) ? sorted[n / 2] : 0.5f * (sorted[n / 2 - 1] + sorted[n / 2]);
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

  /*
   * Wire.end() first, and it is the entire recovery path.
   *
   * begin() on a bus that is already initialised logs "Bus already started in Master
   * Mode.", returns true, and skips initPins() altogether — esp32 core 3.3.11,
   * libraries/Wire/src/Wire.cpp. The pinMode() calls above have just handed SDA and SCL
   * back to plain GPIO in order to bit-bang the bus clear, so from the second call
   * onwards the pins were never routed back to the I2C peripheral and every transaction
   * after that went nowhere.
   *
   * The node therefore found the sensor at boot, lost it once, and then failed every
   * retry for the rest of the session while an i2c scanner flashed onto the same board
   * read the part at 0x57 perfectly. Clearing the bus was leaving it unusable.
   */
  Wire.end();
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

// ============================================================================
// 1. SensorLink — is there a sensor on the other end of the bus, right now?
// ============================================================================

/**
 * Absent -> Present -> Lost -> Absent, and the arrow that matters is the third one.
 *
 * The presence flag this replaces was written in two places and cleared in none: once the
 * MAX30102 had answered, the firmware believed in it until the next reset. Every symptom
 * of losing it mid-session was therefore silence rather than an error — the last reading
 * froze and was reprinted forever, the drop counter stayed at zero because the drain clock
 * was advanced whether or not anything was read, the measured sample rate stayed at its
 * last good figure because it was only recomputed when samples arrived, and
 * `pulse_sensor: true` kept going out on the device topic. Every diagnostic the node had
 * said it was fine.
 *
 * The watchdog below is the whole point of the state machine: silence for
 * SENSOR_LIVENESS_MS while the link believes it is Present is itself the evidence, and it
 * is the only evidence a wedged bus ever produces.
 */
struct SensorLink {
  enum class State : uint8_t { Absent, Present, Lost };

  State         state        = State::Absent;
  unsigned long lastRetryMs  = 0;
  unsigned long lastSampleMs = 0;
  bool          reopened     = false;
  bool          failureLogged = false;

  bool present() const { return state == State::Present; }

  void enterPresent() {
    state = State::Present;
    failureLogged = false;
    // The watchdog measures silence, so it starts counting from the moment the link is
    // believed rather than from boot — otherwise the first pass after Wi-Fi association
    // and the MQTT connect, seconds later, would look exactly like a sensor that stopped
    // answering.
    lastSampleMs = millis();
  }

  void begin() {
    openI2cBus();
    lastRetryMs = millis();

    if (startPulseSensor()) {
      enterPresent();
      Serial.println("[bio] MAX30102 ready");
    } else {
      state = State::Absent;
      Serial.println("[bio] MAX30102 NOT found — clearing the bus and retrying");
    }
  }

  /**
   * True when the sensor may be read this pass; runs the recovery timer when it may not.
   *
   * A sensor that did not answer is usually a bus left stuck by the reset rather than a
   * sensor that is gone — the ESP32 restarts wherever it happened to be, frequently in the
   * middle of one of the twenty-five reads a second it does of this part. Recovering
   * without a power cycle is the difference between a demo that pauses and one that ends.
   */
  bool serviceable() {
    if (state == State::Present) return true;
    if (millis() - lastRetryMs < SENSOR_RETRY_MS) return false;
    lastRetryMs = millis();

    const bool wasLost = state == State::Lost;

    openI2cBus();
    if (!startPulseSensor()) {
      // A link that was Present and cannot be reopened is simply absent now. The
      // distinction only ever mattered for reporting the loss, and that has happened.
      state = State::Absent;

      // Once per run of failures rather than once every SENSOR_RETRY_MS. A retry loop
      // that prints nothing is how a bus left unusable by its own recovery passed for a
      // sensor nobody had wired up; one that prints every pass is how the log that would
      // have shown it becomes unreadable.
      if (!failureLogged) {
        failureLogged = true;
        Serial.println("[bio] MAX30102 did not answer the retry — still retrying");
      }
      return false;
    }

    Serial.println(wasLost ? "[bio] MAX30102 answered again — link recovered"
                           : "[bio] MAX30102 answered on retry");
    enterPresent();
    reopened = true;
    return true;
  }

  /** True once per re-open, so the caller can throw away a window taken across it. */
  bool consumeReopened() {
    const bool was = reopened;
    reopened = false;
    return was;
  }

  /**
   * A deliberate blocking call has just held the loop off the sensor.
   *
   * The watchdog's evidence is silence, and it cannot tell a sensor that stopped
   * answering from one nobody asked. `SampleStream::excuseGap` already made that
   * distinction for the drain budget; the link had no equivalent, so the first
   * `connectMqtt()` — up to four seconds, by design — read as a dead sensor.
   */
  void excuseSilence(unsigned long now) {
    if (state == State::Present) lastSampleMs = now;
  }

  /** Fed the count from every read attempt, including the ones that returned nothing. */
  void observe(int arrived) {
    if (arrived > 0) {
      lastSampleMs = millis();
      return;
    }
    if (state != State::Present) return;

    const unsigned long silence = millis() - lastSampleMs;
    if (silence < SENSOR_LIVENESS_MS) return;

    state = State::Lost;
    Serial.printf("[bio] MAX30102 stopped answering — silent for %lums, link lost\n",
                  silence);
  }
};

// ============================================================================
// 2. SampleStream — the drain clock, the sample clock and the loss accounting
// ============================================================================

/**
 * Everything that depends on samples having arrived when they were supposed to.
 *
 * Three defects lived here and all three were about the same mistake: treating "we came
 * round again" as if it were "we read something".
 */
struct SampleStream {
  uint32_t      dropped    = 0;
  bool          accounting = false;   // false until the first read that returned data
  unsigned long lastReadMs = 0;

  // Anchored by the first sample ever read and never unset, unlike `accounting`. The two
  // answer different questions: loss accounting restarts whenever a window is discarded,
  // but the clock has to keep closing windows through exactly that — a sensor that has
  // gone quiet is the one case `sample_rate_hz` exists to describe, and it can only
  // describe it by continuing to measure while nothing arrives.
  bool          clockAnchored   = false;
  uint32_t      windowSamples   = 0;
  unsigned long windowStartMs   = 0;
  bool          haveMeasurement = false;
  float         measuredMs      = 0.0f;
  float         trustedMs       = 1000.0f / SAMPLE_RATE_NOMINAL_HZ;

  void restartClockWindow() {
    windowSamples = 0;
    windowStartMs = millis();
  }

  /** The time base is no longer trustworthy — start measuring it again from nominal. */
  void restart() {
    restartClockWindow();
    trustedMs = 1000.0f / SAMPLE_RATE_NOMINAL_HZ;

    // The drain mark goes with it, exactly as at boot: whatever gap brought us here has
    // been counted once, and the next gap is measured from the next sample actually read.
    // Without this the same gap is charged again on every pass until something arrives —
    // a wedged bus would book thousands of losses and print a drain-gap line for each of
    // them in the time the liveness watchdog takes to notice, and a link recovered after
    // a minute away would charge the whole minute to the driver's four-sample ring.
    accounting = false;

    // `measuredMs` deliberately survives. It is a report of what the loop did, and a
    // window discarded for a drain gap is exactly the moment someone wants to read it.
  }

  /**
   * How far behind the drain is, and what that has already cost.
   *
   * The gap is measured from the last read that actually returned samples, never from the
   * last time round the loop. Advancing it unconditionally — before a read was even
   * attempted — is what let a frozen sensor report a drain gap of nothing at all, forever,
   * while the driver's ring silently wrapped over everything the sensor produced.
   */
  bool overran(unsigned long now, unsigned long& gapMs, int& lostSamples) const {
    if (!accounting) return false;

    gapMs = now - lastReadMs;
    if (gapMs <= DRAIN_BUDGET_MS) return false;

    const int lost = (int)(gapMs / trustedMs) - FIFO_DRIVER_DEPTH;
    lostSamples = lost > 0 ? lost : 0;
    return true;
  }

  void chargeLoss(int lostSamples) {
    if (lostSamples > 0) dropped += (uint32_t)lostSamples;
  }

  /**
   * Records one read attempt.
   *
   * `usable` is false when the samples arrived but were discarded across a drain gap: they
   * still prove the sensor is answering and still move the drain mark, but they are not
   * part of any window whose rate is being measured.
   *
   * Accounting starts on the first read that returned something rather than in begin().
   * begin() runs seconds before the first drain — Ble::begin(), the blocking Wi-Fi loop
   * and connectMqtt() all sit between them — so a mark stamped there booked around ninety
   * dropped samples before the sensor had been touched, and the `dropped_samples: 0` the
   * report asks for over a session was unreachable by construction.
   */
  void noteRead(int arrived, unsigned long now, bool usable) {
    if (arrived > 0) {
      accounting = true;

      // The clock's first window is anchored here for the same reason: one started in
      // begin() would spend its first five seconds spanning the Wi-Fi connect, and the
      // rate it reported for that span would be a fault the node did not have.
      if (!clockAnchored) {
        clockAnchored = true;
        restartClockWindow();
      }

      lastReadMs = now;
      if (usable) windowSamples += (uint32_t)arrived;
    }

    if (!clockAnchored) return;

    // Closed on elapsed time, not on samples having arrived. A window that only closes
    // when the sensor delivers can never describe a sensor that has stopped delivering,
    // which is the one case the figure exists to expose.
    const unsigned long span = now - windowStartMs;
    if (span < CLOCK_WINDOW_MS) return;

    measuredMs      = windowSamples > 0 ? (float)span / (float)windowSamples : 0.0f;
    haveMeasurement = true;

    const float nominal = 1000.0f / SAMPLE_RATE_NOMINAL_HZ;
    if (measuredMs > 0.0f &&
        fabsf(measuredMs - nominal) / nominal <= CLOCK_MAX_DEVIATION) {
      trustedMs = measuredMs;
    }

    restartClockWindow();
  }

  /**
   * A deliberate blocking call has just eaten part of the drain budget. Charging it to the
   * next read would show up as a phantom loss, so the mark moves with it.
   */
  void excuseGap(unsigned long now) {
    if (accounting) lastReadMs = now;
  }

  float rateHz() const {
    // Before the first window closes there is no measurement to report, and the nominal
    // rate is the honest answer rather than a zero that reads as a fault.
    if (!haveMeasurement) return SAMPLE_RATE_NOMINAL_HZ;
    return measuredMs > 0.0f ? 1000.0f / measuredMs : 0.0f;
  }
};

// ============================================================================
// 3. Contact — the Schmitt trigger and `settled`
// ============================================================================

struct Contact {
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
  int run = 0;
  /** Consecutive samples below the release level. Reset by any sample above it. */
  int gap = 0;

  bool present()   const { return run > 0; }
  bool settled()   const { return run >= BIO_BUFFER; }
  bool beatReady() const { return run >= BEAT_START_SAMPLES; }

  void reset() {
    run = 0;
    gap = 0;
  }

  /** True on the sample where contact is judged to have been lost, and only then. */
  bool observe(uint32_t ir) {
    // Once contact is established the bar drops to the release level, so holding on is
    // easier than getting on. Without that gap a finger sitting exactly at the floor
    // oscillates across it and the reading strobes.
    const uint32_t threshold = run > 0 ? FINGER_IR_RELEASE : FINGER_IR_FLOOR;

    if (ir > threshold) {
      gap = 0;
      if (run < BIO_BUFFER) run++;
      return false;
    }

    if (run == 0) return false;

    // Below the release level, but not for long enough to believe. `run` is left untouched
    // rather than decremented: a blip should cost nothing, and rewinding the settle window
    // would make a four-second measurement unreachable on a restless hand.
    if (++gap < FINGER_LOST_SAMPLES) return false;

    reset();
    return true;
  }
};

// ============================================================================
// 4. BeatEstimator — checkForBeat, and the interval machinery around it
// ============================================================================

/**
 * Detection is the library's PBA algorithm; the timing, the refractory and the median are
 * ours and are detector-independent.
 *
 * The hand-written zero-crossing detector this replaces never resolved a single beat on
 * this hardware. What replaced it did not either, until the signal it was being fed was
 * measured: see the block above BEAT_OVERSAMPLE in config.h for the three things that have
 * to be done to a 25 Hz reading of 130,000 counts before a filter designed for a 100 Hz
 * reading of a few hundred can see a pulse in it.
 */
struct BeatEstimator {
  // ---- conditioning of the signal handed to checkForBeat ----
  float   dcLevel  = 0.0f;
  bool    dcSeeded = false;
  int32_t prevFed  = 0;
  bool    havePrevFed = false;

  // ---- the interval ring ----
  uint32_t sampleIndex    = 0;
  uint32_t lastBeatSample = 0;
  bool     haveLastBeat   = false;
  float    intervals[HR_BEAT_WINDOW];
  uint32_t stamps[HR_BEAT_WINDOW];    // sample index each interval was recorded at
  int      count = 0;
  int      head  = 0;

  // ---- what the serial line reports, and why each one is there ----
  //
  // These three separate the only two ways this estimator can fail to produce a rate, and
  // no published value distinguishes them. `detections` counting up while `count` stays at
  // zero means beats are being found and then discarded, and `rejected` / `reseeded` say
  // by which rule. `detections` frozen at zero with `gateAmp` sitting under 20 means the
  // detector is not seeing a pulse at all, and no amount of tuning down here will help.
  uint32_t detections = 0;   // raw beats out of checkForBeat since the last reset
  uint32_t rejected   = 0;   // ... discarded by the refractory as a notch
  uint32_t reseeded   = 0;   // ... too far apart to be one interval, so a beat was missed
  int      gateAmp    = 0;   // the peak-to-peak the library's own gate last compared
  float    floorMs    = 0.0f;

  void reset() {
    haveLastBeat = false;
    count        = 0;
    head         = 0;
    dcSeeded     = false;
    havePrevFed  = false;
    detections   = 0;
    rejected     = 0;
    reseeded     = 0;

    // The library's detector keeps static state it offers no way to clear. It re-converges
    // within a few samples of a new contact, and the intervals it produces before it does
    // are caught by the bounds in record().
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
  int fresh(float* out, float msPerSample) const {
    if (count == 0) return 0;

    const uint32_t maxAge = (uint32_t)((float)HR_BEAT_MAX_AGE_MS / msPerSample);
    int n = 0;

    for (int i = 0; i < count; i++) {
      if (sampleIndex - stamps[i] <= maxAge) out[n++] = intervals[i];
    }

    sortAscending(out, n);
    return n;
  }

  void record(float msPerSample) {
    if (!haveLastBeat) {
      lastBeatSample = sampleIndex;
      haveLastBeat   = true;
      return;
    }

    const float intervalMs = (float)(sampleIndex - lastBeatSample) * msPerSample;

    if (intervalMs > (float)HR_BEAT_MAX_MS) {
      // Too long to be one interval, so it is two or more with a beat missed between them.
      // Re-seed rather than record: this interval is not measurable, the next one is.
      reseeded++;
      lastBeatSample = sampleIndex;
      return;
    }

    float recent[HR_BEAT_WINDOW];
    const int n = fresh(recent, msPerSample);

    floorMs = n >= HR_BEAT_MIN_INTERVALS
                  ? fminf(HR_BEAT_REFRACTORY_MAX_MS,
                          fmaxf((float)HR_BEAT_MIN_MS,
                                medianOf(recent, n) * HR_BEAT_REFRACTORY_RATIO))
                  : (float)HR_BEAT_MIN_MS;

    // Deliberately without advancing lastBeatSample. A rejected crossing is a notch rather
    // than a beat, so the real interval is still running — moving the mark here would make
    // the next measurement notch-to-beat, wrong in the other direction and harder to spot.
    if (intervalMs < floorMs) {
      rejected++;
      return;
    }

    lastBeatSample = sampleIndex;

    intervals[head] = intervalMs;
    stamps[head]    = sampleIndex;
    head = (head + 1) % HR_BEAT_WINDOW;
    if (count < HR_BEAT_WINDOW) count++;
  }

  /** Fed every contact sample, in order. Carries state between calls. */
  void observe(uint32_t ir, float msPerSample) {
    sampleIndex++;

    if (!dcSeeded) {
      dcLevel  = (float)ir;
      dcSeeded = true;
    }
    dcLevel += BEAT_DC_ALPHA * ((float)ir - dcLevel);

    // Re-centred rather than merely scaled. `averageDCEstimator` takes its argument as a
    // uint16_t, so the residual has to be carried on a positive pedestal; the detector
    // then removes that pedestal itself, which is the part it is good at, having been
    // relieved of the ramp, which is the part it is not.
    const int32_t scaled =
        (int32_t)lroundf(((float)ir - dcLevel) / (float)(1 << BEAT_SAMPLE_SHIFT));
    const int32_t fed = constrain(BEAT_DC_CENTRE + scaled, (int32_t)0, (int32_t)65535);

    if (!havePrevFed) {
      prevFed     = fed;
      havePrevFed = true;
    }

    // Straight-line interpolation between the last sample and this one. The detector's
    // low-pass was sized for 100 Hz and loses 94% of a 115 bpm pulse at 25 Hz; handing it
    // intermediate points puts the beat back inside its passband. Beats are still stamped
    // at the real sample index, so this buys detection and not resolution — the timing
    // stays quantised to one 40 ms sample either way.
    bool beat = false;
    for (int k = 1; k <= BEAT_OVERSAMPLE; k++) {
      const int32_t step = prevFed + (fed - prevFed) * k / BEAT_OVERSAMPLE;
      if (checkForBeat(step)) beat = true;
    }
    prevFed = fed;

    gateAmp = (int)IR_AC_Max - (int)IR_AC_Min;

    if (beat) {
      detections++;
      record(msPerSample);
    }
  }

  bool rate(float& outBpm, float msPerSample) const {
    float recent[HR_BEAT_WINDOW];
    const int n = fresh(recent, msPerSample);

    if (n < HR_BEAT_MIN_INTERVALS) return false;

    const float median = medianOf(recent, n);
    if (median <= 0.0f) return false;

    outBpm = 60000.0f / median;
    return outBpm > 30.0f && outBpm < 220.0f;
  }
};

// ============================================================================
// 5. Spo2Filter — a 5-wide median
// ============================================================================

/**
 * SpO2 comes out of a lookup table indexed by an integer ratio, so one noisy window can
 * move it several points in a single step. Deliberately no slew limiter alongside it: a
 * genuine desaturation is the one event that must not be slowed.
 */
struct Spo2Filter {
  int32_t history[SPO2_MEDIAN_WINDOW];
  int     count = 0;
  int     head  = 0;

  void reset() {
    count = 0;
    head  = 0;
  }

  int32_t push(int32_t value) {
    history[head] = value;
    head = (head + 1) % SPO2_MEDIAN_WINDOW;
    if (count < SPO2_MEDIAN_WINDOW) count++;

    float sorted[SPO2_MEDIAN_WINDOW];
    for (int i = 0; i < count; i++) sorted[i] = (float)history[i];
    sortAscending(sorted, count);

    return (int32_t)lroundf(sorted[count / 2]);
  }
};

// ---- the units ------------------------------------------------------------

SensorLink    sensorLink;
SampleStream  stream;
Contact       contact;
BeatEstimator beat;
Spo2Filter    spo2Filter;

// ---- the analysis window --------------------------------------------------

uint32_t irBuffer[BIO_BUFFER];
uint32_t redBuffer[BIO_BUFFER];
int      sampleCount      = 0;
int      sinceLastCompute = 0;

BioReading latest      = {};
bool       latestFresh = false;

bool          hrSmoothInit     = false;
float         hrSmoothed       = 0.0f;
unsigned long lastMaximValidMs = 0;

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

/** Everything that has to start again when the time base is no longer trustworthy. */
void restartWindow() {
  sampleCount      = 0;
  sinceLastCompute = 0;
  contact.reset();
  beat.reset();
  spo2Filter.reset();
  stream.restart();
}

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

/**
 * The detector's own internals, on their own line.
 *
 * A separate line rather than more fields on `[bio]` because `[bio]` is parsed by
 * iot/analysis/session/log_session.ps1 and belongs to the sketch that prints it. This one
 * is nobody's contract, which is what makes it free to say whatever the next question
 * needs it to.
 */
void reportBeatInternals(uint32_t irMean) {
  // `ring` and not `n`: the `[bio]` line's `n` is the count still inside the freshness
  // window, and two lines using one key for two different numbers is how a log starts
  // lying to whoever reads it fastest.
  Serial.printf("[beat] amp=%d(gate 21..999) det=%lu rej=%lu long=%lu ring=%d floor=%.0f "
                "dc=%lu ir=%lu ms=%.2f\n",
                beat.gateAmp,
                (unsigned long)beat.detections, (unsigned long)beat.rejected,
                (unsigned long)beat.reseeded, beat.count, beat.floorMs,
                (unsigned long)lroundf(beat.dcLevel), (unsigned long)irMean,
                stream.trustedMs);
}

void computeBiometrics() {
  uint64_t sum = 0;
  for (int i = 0; i < BIO_BUFFER; i++) sum += irBuffer[i];
  const uint32_t irMean = (uint32_t)(sum / BIO_BUFFER);

  BioReading r = {};
  r.irMean        = irMean;
  r.fingerPresent = contact.present();
  r.settled       = contact.settled();

  // The beat estimator reports as soon as it has intervals, settled or not. It is a
  // streaming estimator carrying its own gates — the detector's amplitude window, the
  // refractory, and a median over recent intervals only — so the four-second window is not
  // what makes its answer trustworthy, and waiting for one put three seconds in front of
  // every measurement without changing what the measurement was worth.
  float bpm = 0.0f;
  r.heartRateValid = r.fingerPresent && beat.rate(bpm, stream.trustedMs);
  r.heartRate      = r.heartRateValid ? bpm : 0.0f;

  if (r.fingerPresent) reportBeatInternals(irMean);

  if (!r.settled) {
    // The other two do read the whole buffer, and half of it is still no-finger data with
    // a step edge through the middle. Maxim's peak finder locks onto that edge and returns
    // a rate inside the plausible range — a wrong number carrying a valid flag, which is
    // the failure this guard exists for.
    if (!r.fingerPresent) {
      smoothHeartRate(0, false);
      spo2Filter.reset();
      lastMaximValidMs = 0;
    }

    latest      = r;
    latestFresh = true;
    return;
  }

  int32_t spo2 = 0, hrMaxim = 0;
  int8_t  spo2Valid = 0, hrValid = 0;
  // Maxim's reference implementation, shipped with the SparkFun library.
  // It expects exactly FS*4 samples at 25 Hz — see the sensor setup above.
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

  // Zero rather than the algorithm's -999 sentinel when there is no answer. Nothing reads
  // these without checking the flag beside them today, but DisplayState carries a whole
  // BioReading by value and only that flag stands between -999 and the OLED — an
  // out-of-band value in a struct is a trap set for whoever adds the next reader.
  r.heartRateMaximValid = maximOk;
  r.heartRateMaxim      = maximOk ? smoothHeartRate(hrMaxim, true) : 0;

  const bool spo2Ok = spo2Valid && spo2 >= 70 && spo2 <= 100;
  r.spo2Valid       = spo2Ok;
  r.spo2            = spo2Ok ? spo2Filter.push(spo2) : 0;

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

#if SIMULATE_BIO
  openI2cBus();
  Serial.println("[bio] SIMULATED — MAX30102 not read");
#else
  sensorLink.begin();
#endif

  // Deliberately nothing stamped on the drain clock here. The first update() is seconds
  // away — Ble::begin(), the blocking Wi-Fi loop and connectMqtt() are all still to come —
  // and a mark laid down now would be charged as a sample loss the node never suffered.
  stream.restartClockWindow();
}

void update() {
#if SIMULATE_BIO
  simulateBiometrics();
#else
  if (!sensorLink.serviceable()) return;

  if (sensorLink.consumeReopened()) {
    // Whatever is in the buffers describes a sensor that has since been re-initialised,
    // and the interval either side of the break is not a beat interval.
    restartWindow();
    return;
  }

  unsigned long gapMs = 0;
  int  lostSamples    = 0;
  const bool overran  = stream.overran(millis(), gapMs, lostSamples);

  int arrived = 0;
  pulse.check();

  if (overran) {
    // Drain and discard: what is still in the driver is the tail of a window whose head no
    // longer exists. Stitching those together is what produces the fast-reading artefact —
    // Maxim's rate is a sample count divided into a constant, so a window missing samples
    // reads as a faster heart rather than as an error.
    stream.chargeLoss(lostSamples);
    while (pulse.available()) {
      pulse.nextSample();
      arrived++;
    }
  } else {
    while (pulse.available()) {
      const uint32_t ir  = pulse.getFIFOIR();
      const uint32_t red = pulse.getFIFORed();

      pushSample(red, ir);
      if (contact.observe(ir)) beat.reset();

      // Settled-enough contact only. Before it, the reading is a step of two orders of
      // magnitude that no follower slow enough to sit through a beat can track, and the
      // crossings it produces would still be in the median window when the real ones
      // arrived. See BEAT_START_SAMPLES.
      if (contact.beatReady()) beat.observe(ir, stream.trustedMs);

      arrived++;
      pulse.nextSample();
    }
  }

  // Both branches, and unconditionally: a read that returned nothing is the only evidence
  // a wedged bus ever produces, and the branch that discards a window is exactly where a
  // dying sensor spends its time.
  stream.noteRead(arrived, millis(), /*usable=*/!overran);
  sensorLink.observe(arrived);

  if (overran) {
    restartWindow();
    Serial.printf("[bio] drain gap %lums (budget %lums) — ~%d samples lost, %lu total\n",
                  gapMs, DRAIN_BUDGET_MS, lostSamples,
                  (unsigned long)stream.dropped);
    return;
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

float sampleRateHz() {
#if SIMULATE_BIO
  return SAMPLE_RATE_NOMINAL_HZ;
#else
  return stream.rateHz();
#endif
}

uint32_t droppedSamples() {
  return stream.dropped;
}

void excuseStall() {
  const unsigned long now = millis();
  stream.excuseGap(now);
  sensorLink.excuseSilence(now);
}

void beatDebug(int& intervals, float& medianMs, float& loMs, float& hiMs) {
  float recent[HR_BEAT_WINDOW];

  // The fresh count rather than the ring occupancy: it is the one the estimator gates on,
  // so a log showing four while nothing is reported would be the log lying.
  intervals = beat.fresh(recent, stream.trustedMs);
  medianMs  = medianOf(recent, intervals);

  // fresh() returns them sorted, so the ends are the extremes.
  loMs = intervals > 0 ? recent[0] : 0.0f;
  hiMs = intervals > 0 ? recent[intervals - 1] : 0.0f;
}

bool readDieTemperature(float& outC) {
#if SIMULATE_BIO
  return false;      // there is no die to read — do not invent a number
#else
  if (!sensorLink.present()) return false;
  // Never stall the sample stream mid-measurement; the reading is only a
  // diagnostic and can wait for the finger to come off.
  if (latest.fingerPresent) return false;

  const float t = pulse.readTemperature();   // one-shot, blocks ~50 ms

  stream.excuseGap(millis());

  if (isnan(t) || t < -20.0f || t > 90.0f) return false;

  outC = t;
  return true;
#endif
}

bool pulseSensorPresent() {
#if SIMULATE_BIO
  return true;
#else
  return sensorLink.present();
#endif
}

bool simulated() {
  return SIMULATE_BIO;
}

}  // namespace Sensors
