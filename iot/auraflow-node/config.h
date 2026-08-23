// AuraFlow IoT node — pin map and timing constants.
//
// Built for the parts actually on the bench (2026-08-12):
//   ESP32 DevKitC (38-pin) · MAX30102 · SSD1306 0.96" **SPI** · TP4056
//
// The original BOM assumed a DHT22, an LDR, an electret mic, a WS2812 ring and
// a MAX30205. None of those arrived, so this build drops room-environment
// sensing and skin temperature entirely rather than substituting a part that
// measures something else and labelling it as the missing quantity. See
// README §2 for what each omission costs and what would restore it.
#pragma once

#include <Arduino.h>

#if !defined(ESP32)
  #error "Select an ESP32 board — this node needs SPI + I2C + WiFi together"
#endif

// ---- lamp ------------------------------------------------------------------
// The circadian lamp is the DevKit's own blue LED, driven by LEDC PWM. Without
// the WS2812 there is no colour left to carry the mode, so the modes are
// separated by brightness AND by motion (steady / breathing / pulsing) and the
// OLED names the active mode in large type. See light.cpp.
//
// GPIO2 is a strapping pin. Driving it after boot is fine — this is where the
// DevKit puts its onboard LED — but do not wire anything else to it. On the
// 38-pin board it is also broken out as `G2`; leave that header pin empty.
constexpr uint8_t PIN_LAMP = 2;

// BOOT button, already pulled up on the board, active LOW. Free to use as the
// manual override once the sketch is running.
//
// The 38-pin board also brings GPIO0 out as `G0`. Leave that header pin empty —
// anything driving it fights the button, and holding it low at reset drops the
// chip into download mode.
//
// ⚠️ Holding it down while pressing RST puts the chip in download mode. That is
// how you flash, not a fault — just do not hold it through a reset mid-demo.
constexpr uint8_t PIN_BUTTON = 0;

// ---- I2C bus (MAX30102 only) -----------------------------------------------
// The OLED moved to SPI, so the pulse oximeter is now alone on this bus. The
// scanner in README §4 should report exactly one address.
constexpr uint8_t PIN_SDA = 21;
constexpr uint8_t PIN_SCL = 22;

constexpr uint8_t ADDR_MAX30102 = 0x57;  // fixed in silicon, not strappable

// How often to try the pulse sensor again once it has failed to answer.
//
// It fails more often than a soldered part should, and the reason is the reset that
// follows every upload. The ESP32 restarts wherever it happened to be — frequently in the
// middle of an I2C read, because it is reading this sensor 25 times a second — and the
// MAX30102, still clocking out a byte nobody will collect, holds SDA low. A bus in that
// state answers nothing, so begin() fails and the screen says the wiring is wrong when it
// is not. A reset pressed by hand while the bus is idle succeeds, which is exactly why it
// looked intermittent.
//
// Sensors::begin() clears the bus before touching it, and this retries afterwards for the
// cases a clear cannot fix — a wire genuinely reseated mid-session, say. Two seconds is
// far apart enough to cost nothing and close enough that nobody reaches for the reset
// button first.
constexpr unsigned long SENSOR_RETRY_MS = 2000;

// How long the link may go without a single sample before it stops believing in the
// sensor. This is the one number that turns a silent failure into a reported one.
//
// A sensor that answered once used to be trusted forever, and every symptom of losing it
// mid-session was silence: the last reading froze, the drop counter stayed at zero, the
// measured rate stayed at 25 Hz and `pulse_sensor` kept publishing true. Nothing the node
// said was false, and nothing it said was the truth either.
//
// The floor is the longest gap a *healthy* link can show. The driver's ring holds four
// samples — 160 ms — and a pass that takes longer than that already trips the drain-gap
// detector, which drains and carries on; three ring depths leaves room for a die
// temperature conversion (~50 ms) or a slow display frame to land inside one pass without
// ever being mistaken for a dead bus. The ceiling is the publish cadence: at 480 ms the
// loss reaches the OLED within one 500 ms refresh and the broker on the next frame, so
// nobody watching either one sees a stale reading presented as a live one.
constexpr unsigned long SENSOR_LIVENESS_MS = 480;   // 12 sample periods

// ---- OLED (SSD1306 128x64, 7-pin SPI module) -------------------------------
// The module that arrived is the 7-pin `GND VDD SCK SDA RES DC CS` variant —
// SPI, not the 4-pin I2C one the first revision of this node assumed. Hardware
// VSPI, so SCK/MOSI are the silicon defaults and only the three control lines
// are a free choice.
//
// The module's `SDA` pin is SPI MOSI. Its `SCK` is the clock. Nothing on this
// header goes to GPIO21/22.
//
// Every one of these is silkscreened with its own number on the 38-pin board
// (`G18`, `G23`, `G5`, `G16`, `G17`), so the labels below are what you read on
// the header. The 30-pin DevKit v1 prints 16 and 17 as `RX2`/`TX2` instead —
// worth knowing only if you ever move this to that board.
constexpr uint8_t PIN_OLED_SCK  = 18;   // VSPI CLK  -> module SCK
constexpr uint8_t PIN_OLED_MOSI = 23;   // VSPI MOSI -> module SDA
constexpr uint8_t PIN_OLED_CS   = 5;    //           -> module CS
constexpr uint8_t PIN_OLED_DC   = 16;   //           -> module DC
constexpr uint8_t PIN_OLED_RST  = 17;   //           -> module RES

// GPIO16/17 are free on a plain ESP-WROOM-32. On an ESP32-**WROVER** they are
// wired to the PSRAM and the panel will stay dark — move DC/RES to 25/26 there.
//
// ⚠️ The 38-pin board also breaks out `SD0 SD1 SD2 SD3 CMD CLK`. Those go to the
// SPI flash holding this firmware. Never assign one of them to anything.
constexpr uint8_t OLED_WIDTH  = 128;
constexpr uint8_t OLED_HEIGHT = 64;

// ---- spare analog input ----------------------------------------------------
// Reserved for the unidentified 3-pin module (silkscreen "HW-477 v0.2" — that
// marking ships on at least three different boards, so it is not wired in until
// the part is known). ADC1 so it keeps working with WiFi on; input-only pin.
constexpr uint8_t PIN_SPARE_ADC = 34;
constexpr int     ADC_MAX       = 4095;

// ---- timing ---------------------------------------------------------------
constexpr unsigned long DEVICE_PUBLISH_MS = 30000;  // node health telemetry
// The algorithm recomputes every 25 samples (~1 s), so publishing every 5 s threw away
// four readings out of five and made the phone look laggy. 1.5 s tracks the sensor
// closely without flooding the broker; the app's staleness window is 15 s, so this still
// leaves ten missed frames of headroom before a reading is called stale.
constexpr unsigned long BIO_PUBLISH_MS    = 1500;   // HR/SpO2 while a finger is on
constexpr unsigned long FADE_INTERVAL_MS  = 15;
constexpr unsigned long ALERT_DURATION_MS = 6000;
constexpr unsigned long RECONNECT_MS      = 3000;
constexpr unsigned long DISPLAY_MS        = 500;    // OLED full frame ~7 ms over SPI

// How often to log the idle IR level when nothing is on the sensor.
//
// Worth having rather than staying silent: "no readings" and "no finger" look identical
// from outside, and they have completely different fixes. The number separates them —
// a few thousand counts is an empty sensor, six figures is a finger the contact test is
// somehow not seeing.
constexpr unsigned long IDLE_LOG_MS      = 5000;
constexpr uint8_t       FADE_STEP         = 6;      // ~0.6 s for a full swing

// ---- biometrics -----------------------------------------------------------
constexpr int      BIO_BUFFER      = 100;    // 4 s @ 25 Hz effective
constexpr int      BIO_STRIDE      = 25;     // recompute once per second
// Contact is a Schmitt trigger, not a line.
//
// A finger resting still is not a steady IR reading: it shifts, it changes pressure, it
// lets a little ambient light past. With one threshold and no debounce a single sample of
// that took `fingerRun` to zero, which dropped `finger` and `settled` and threw away the
// beat detector's interval history -- a reading that cut out mid-measurement while the
// finger had never actually left.
//
// Arriving is judged strictly and leaving is judged loosely, with a gap between the two so
// noise cannot cross both.
constexpr uint32_t FINGER_IR_FLOOR   = 50000;  // above this, a finger has arrived
constexpr uint32_t FINGER_IR_RELEASE = 35000;  // below this it may have gone -- but not yet

// How long it must stay below the release level before it counts as gone. Eight samples is
// about a third of a second at the effective rate: far longer than a shift in grip, far
// shorter than anyone can lift a finger and not notice the number stop.
constexpr int      FINGER_LOST_SAMPLES = 8;

// The nominal effective rate: 100 Hz from the sensor, averaged four to one in its
// FIFO. Nominal because it comes from the MAX30102's own oscillator, which is neither
// the ESP32's crystal nor trimmed against it — sensors.cpp measures the real figure
// and every beat interval is timed through that rather than through this.
constexpr float SAMPLE_RATE_NOMINAL_HZ = 25.0f;

// ---- sample loss -----------------------------------------------------------
// SparkFun's driver keeps a ring of STORAGE_SIZE = 4 samples (MAX30105.h). check()
// reads every entry the sensor has pending into it and wraps its own head silently, so
// a fifth arrival overwrites the first and available() reports a count that has already
// forgotten it. Four samples is 160 ms of signal.
//
// That matters more than a gap normally would. Maxim's algorithm computes the rate as
// FreqS*60 divided by a mean peak interval measured in *samples*, so a window missing
// samples has a compressed time base and reads as a faster heart rather than as an
// error — a wrong number that looks entirely reasonable. Any drain gap longer than the
// driver can hold discards the window instead. See Sensors::update().
constexpr int           FIFO_DRIVER_DEPTH = 4;
constexpr unsigned long DRAIN_BUDGET_MS =
    (unsigned long)(FIFO_DRIVER_DEPTH * 1000.0f / SAMPLE_RATE_NOMINAL_HZ);   // 160 ms

// ---- sample clock ----------------------------------------------------------
// The span each measurement of the sample period is taken over. The driver hands samples
// over in bursts, so a short window measures the burst pattern; over five seconds that
// jitter is under a percent of the total.
//
// A window rather than a running total since the last restart: a cumulative average is
// dominated by however long it has already been running, so a loop that starts stalling
// after ten minutes barely moves it. Re-anchoring means `sample_rate_hz` describes the
// last five seconds, which is the question anyone reading it is actually asking. The
// window closes on elapsed time whether or not samples arrived, so a sensor that has gone
// quiet reports the rate it is now achieving instead of freezing at its last good figure.
constexpr unsigned long CLOCK_WINDOW_MS = 5000;

// A measured period this far from nominal is not oscillator trim — it is loss, or a
// stalled loop. Such a measurement is still *published*: showing the stalled loop is the
// whole reason `sample_rate_hz` is on the health topic, and a band that rejected the
// reading meant the field could only ever report 20–30 Hz and could never reveal the
// fault it exists for. What the band gates is whether the figure is *trusted* for timing
// beat intervals, where baking a stall into every heart rate would turn a visible
// problem into an invisible one.
constexpr float CLOCK_MAX_DEVIATION = 0.20f;

// ---- beat-interval heart rate ----------------------------------------------
// Maxim's algorithm divides a whole number of samples by a whole number of beats and
// divides that into 1500, so at rest the only values it can return are 60, 62, 65, 68,
// 71, 75, 78, 83, 88, 93 and 100 bpm. It cannot express 73. Timing individual beats
// against the sample clock has no such step; both are published so the evaluation can
// compare them against each other as well as against the watch.

// Detection is `checkForBeat` from the SparkFun library — a zero-crossing detector
// wrapped in two filters that were sized for a MAX30105 sampled at 100 Hz. Three things
// have to be done to the raw reading before it sees it, and each of them was measured
// against a bit-exact model of heartRate.cpp rather than guessed at.
//
// **Interpolation, because the filter is running at a quarter of its design rate.** This
// node samples at 25 Hz effective — 100 Hz averaged four to one in the sensor's own FIFO,
// which is what the SpO2 algorithm needs — and at a quarter of the rate the detector's
// 23-tap low-pass has its corner sitting on the heart rate itself. Its response relative
// to DC, from the shipped coefficients:
//
//        bpm      50    60    75    90   105   115   127
//   at 100 Hz   0.97  0.96  0.94  0.92  0.89  0.87  0.84
//   at  25 Hz   0.65  0.53  0.36  0.22  0.11  0.06  0.02
//
// The detector then gates on a filtered peak-to-peak amplitude between 20 and 1000 counts,
// so from about 90 bpm upward the pulse arrives underneath the floor and the beat is
// simply never seen. Driving one synthetic 115 bpm trace through the whole estimator, the
// 25 Hz path resolved a rate on 0 frames out of 56 and the 100 Hz path on 56 — and that
// matches the bench, where the node recorded intervals of 1038–1238 ms, two beats' worth,
// while the reference algorithm read 83–127 bpm from the same samples.
//
// Interpolating each sample in two puts the beat back in the passband without touching the
// sensor's configuration or the SpO2 window. Two and not four: at four the filter also
// passes the dicrotic notch, and the same model then reported 115 bpm for a 60 bpm trace —
// trading a rate that will not resolve for one that is confidently double, which is worse.
constexpr int BEAT_OVERSAMPLE = 2;

// **A DC follower in front of it, because the library's own cannot climb.**
// `averageDCEstimator` is a one-pole with a fixed gain of 1/16 per sample, which leaves it
// fifteen samples behind a rising baseline. A finger settling on this sensor does not step
// once and stop: the IR reading was measured climbing 80,000 to 182,000 counts over
// thirteen seconds, and 53,000 to 194,000 across a thirty-five second session without ever
// levelling — some 7,700 counts a second, against a pulse worth perhaps 1,500. At that
// slope the estimate sits so far below the signal that the AC never returns through zero,
// no crossing is ever seen, and the model resolves nothing at all.
//
// Subtracting a slow follower of our own first turns that ramp into a constant offset,
// which is the one thing the library's estimator does handle. It does not need to be
// lag-free — it needs to hand on a signal whose baseline is still. 0.02 puts the corner at
// 0.08 Hz, an order of magnitude below the 0.8 Hz of the slowest rate worth reporting, so
// it cannot follow a beat.
constexpr float BEAT_DC_ALPHA = 0.02f;

// Where that residual is re-centred before the detector sees it. Mid-scale, because
// `averageDCEstimator` takes its sample as a `uint16_t` and a negative one would wrap.
constexpr int32_t BEAT_DC_CENTRE = 32768;

// **And a shift, because the gate is a window rather than a floor.** This sets a perfusion
// band, not a sensitivity. Modelled across 48–150 bpm, three bits puts a peak-to-peak of
// 0.5% of DC at the bottom of the gate and 6% at the top — a cold fingertip to a firmly
// pressed one. Shifting less would buy the cold end by giving up the firm one, where
// exceeding the gate's 1000 ceiling loses beats on the *strongest* signal available.
constexpr int BEAT_SAMPLE_SHIFT = 3;

// The three together, run end to end through the model against synthetic traces from 48 to
// 145 bpm: every rate resolved to within the estimator's own 40 ms quantisation at any
// perfusion from 0.6% upward, under 15% noise, and through a baseline ramping at the
// 7,800 counts a second measured off a landing finger — which the raw shifted sample
// cannot do at any rate at all. What is still not measured is a real fingertip, which is
// the only thing that can say whether the perfusion band is centred where fingers are.

constexpr int HR_BEAT_WINDOW = 8;    // intervals held for the median

// How many of them it takes to report. Three is a median that still out-votes one bad
// interval, which is the whole job; four cost an extra beat — the better part of a second
// — at the front of every measurement for no more certainty than that.
constexpr int HR_BEAT_MIN_INTERVALS = 3;

// Contact needed before the detector starts looking, in samples: one second.
//
// Not the four the window algorithms wait for. Those read the whole buffer and half of it
// is still no-finger data until then; this one is streaming and carries its own gates, so
// all it needs is for the sensor to be seeing skin. Waiting with them put three seconds in
// front of every reading and bought nothing.
//
// It cannot be zero either. A finger landing takes the IR reading from about 1,400 to
// about 150,000, and the first instrumented session measured a swing of 127,424 counts on
// a DC of 148,677 — 86% of it, which is not a pulse by any definition. One second of
// contact is enough for the DC follower to be sitting under skin rather than under a step
// edge, and the intervals from any crossing before that would still be in the median
// window when the real ones arrived.
constexpr int BEAT_START_SAMPLES = BIO_STRIDE;

// How long an interval may stay in that window.
//
// The ring alone has no notion of age. On a poor signal — a finger shifting, the swing
// gate rejecting most cycles — intervals are accepted minutes apart, and one from when
// the hand was still would sit in the median beside one from just now. The median would
// then describe no particular minute. Ten seconds is long enough to hold a full window at
// any resting rate and short enough that everything in it is the same measurement.
constexpr unsigned long HR_BEAT_MAX_AGE_MS = 10000;

// A dicrotic notch — the small second bump as the aortic valve closes — arrives roughly a
// third of a cycle after the beat. That clears HR_BEAT_MIN_MS at any realistic rate, so
// an absolute floor cannot reject it and every interval would come out halved. Rejecting
// anything shorter than this fraction of the running median does.
//
// Note what it cannot do, because it was suspected of it once: the ratio needs a median to
// take a fraction of, so below HR_BEAT_MIN_INTERVALS the floor is flatly HR_BEAT_MIN_MS.
// An estimator that never accumulates three intervals has never once applied this rule,
// and the reason it is not accumulating them is upstream of here.
constexpr float HR_BEAT_REFRACTORY_RATIO = 0.6f;

// And a ceiling on what that ratio may produce, which is not a detail.
//
// Without it the rule feeds on itself: let the median once settle on a doubled interval —
// 1440 ms, reported as 41.7 bpm — and the floor becomes 864 ms, which rejects every real
// beat at 85 bpm. Only every second beat is then accepted, which confirms the wrong
// median, and the estimate locks there permanently. A first session with this detector
// showed exactly that: nineteen consecutive frames reporting the identical 41.7 bpm while
// the reference algorithm sat between 83 and 137.
//
// The heart's own absolute refractory period is around 250 ms, so nothing above this is
// physiology in any case — it is only ever notch rejection, and the notch always arrives
// well inside it.
constexpr float HR_BEAT_REFRACTORY_MAX_MS = 400.0f;

// Outside this band it is not a beat interval — it is a missed beat counted as one long
// one, or a dicrotic notch counted as an extra. Dropping it beats making the median
// out-vote it.
constexpr unsigned long HR_BEAT_MIN_MS = 273;    // 220 bpm
constexpr unsigned long HR_BEAT_MAX_MS = 2000;   //  30 bpm

// A long silence with the finger still down means the next valid estimate is not
// continuous with the last one, so the slew limiter must not crawl to it from a rate
// the wearer had several seconds ago. See smoothHeartRate() in sensors.cpp.
constexpr unsigned long HR_INVALID_RESET_MS = 5000;

// SpO2 comes out of a lookup table indexed by an integer ratio, so one noisy window can
// move it several points in a single step. A median rejects that; deliberately no slew
// limiter, because a genuine desaturation is the one event that must not be slowed.
constexpr int SPO2_MEDIAN_WINDOW = 5;

// Maxim's reference HR algorithm occasionally locks onto a harmonic of the true
// rate instead of the rate itself, which shows up as the output alternating
// between two clusters roughly a beat-doubling apart from one recompute to the
// next — a real heart does not swing 50+ bpm in one second. Rather than trust
// each raw estimate, the published value is slew-limited toward it by at most
// this many bpm per recompute (~1 s), which a genuine change comfortably
// clears within a couple of seconds but a one-shot glitch cannot. See
// smoothHeartRate() in sensors.cpp.
constexpr float HR_MAX_STEP_BPM = 6.0f;

// ---- simulation -----------------------------------------------------------
// Lets the whole WiFi -> MQTT -> Laravel -> app chain be built and tested
// before the sensor is physically wired. Set back to 0 the moment it is.
//
// While this is 1 every MQTT payload carries "simulated": true and the OLED
// shows a SIM tag, so a simulated run can never quietly end up as evidence in
// the report or as rows in the training set.
#define SIMULATE_BIO 0   // MAX30102

#if SIMULATE_BIO
  #pragma message("AuraFlow: SIMULATED biometric data is enabled — see config.h")
#endif
