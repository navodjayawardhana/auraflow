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
constexpr uint32_t FINGER_IR_FLOOR = 50000;  // below this, nothing is on the sensor

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
// How long to watch before believing a measured sample period. The driver hands samples
// over in bursts, so a short span measures the burst pattern; over five seconds that
// jitter is under a percent of the total.
constexpr unsigned long CLOCK_MIN_SPAN_MS = 5000;

// A measured period this far from nominal is not oscillator trim — it is loss, or a
// stalled loop. Trusting it would bake the fault into every heart rate, so the nominal
// period stands and the drop detector is left to speak.
constexpr float CLOCK_MAX_DEVIATION = 0.20f;

// ---- beat-interval heart rate ----------------------------------------------
// Maxim's algorithm divides a whole number of samples by a whole number of beats and
// divides that into 1500, so at rest the only values it can return are 60, 62, 65, 68,
// 71, 75, 78, 83, 88, 93 and 100 bpm. It cannot express 73. Timing individual beats
// against the sample clock has no such step; both are published so the evaluation can
// compare them against each other as well as against the watch.
constexpr int HR_BEAT_WINDOW = 8;    // intervals held for the median

// How many of them it takes to report. Three is a median that still out-votes one bad
// interval, which is the whole job; four cost an extra beat — the better part of a second
// — at the front of every measurement for no more certainty than that.
constexpr int HR_BEAT_MIN_INTERVALS = 3;

// Contact needed before the detector starts looking, in samples: one second.
//
// Not the four the window algorithms wait for. Those read the whole buffer and half of it
// is still no-finger data until then; this one is streaming and gates each cycle on its
// own perfusion band, so all it needs is for the sensor to be seeing skin. Waiting with
// them put three seconds in front of every reading and bought nothing.
constexpr int BEAT_START_SAMPLES = BIO_STRIDE;

// A fast attack on the DC follower for its first ~1.5 s, then the slow constant above.
//
// A ten-second follower started from one sample would take most of a minute to sit
// properly under a signal, and every cycle until then measures a swing that is mostly
// baseline error. Converging fast first and then slowing down gives both: a usable
// estimate within a second or two, and no gain at the pulse frequency thereafter.
constexpr float    BEAT_DC_FAST_ALPHA   = 0.30f;
constexpr float    BEAT_DC_FAST_BETA    = 0.01f;
constexpr uint32_t BEAT_DC_FAST_SAMPLES = 38;

// And a re-seed when the baseline is simply somewhere else.
//
// A finger settling onto this sensor does not step once and stop. The IR reading was
// measured climbing from 80,000 to 182,000 over thirteen seconds — about 7,700 counts a
// second, against a pulse of some 4,000 counts peak to peak. While that is happening the
// baseline moves further in one beat than the beat itself does, the AC signal never
// returns below zero, and a crossing detector sees nothing at all: the instrumented log
// showed a swing frozen at one value and not a single interval recorded.
//
// A ten-second follower crawling from 80,000 to 182,000 would take most of a minute to
// arrive. But no pulse can move the reading by a fifth of itself, so a residual that
// large is not signal — the baseline is in the wrong place, and putting it where the
// signal is costs one cycle instead of thirty seconds of blank screen.
constexpr float BEAT_DC_RESEED_FRACTION = 0.2f;

// How long an interval may stay in that window.
//
// The ring alone has no notion of age. On a poor signal — a finger shifting, the swing
// gate rejecting most cycles — intervals are accepted minutes apart, and one from when
// the hand was still would sit in the median beside one from just now. The median would
// then describe no particular minute. Ten seconds is long enough to hold a full window at
// any resting rate and short enough that everything in it is the same measurement.
constexpr unsigned long HR_BEAT_MAX_AGE_MS = 10000;

// The detector's own constants. It is ours rather than the library's `checkForBeat`,
// which passes its sample through `averageDCEstimator(int32_t*, uint16_t)` and so
// truncates anything above 65535 before it does arithmetic on it. With a finger on this
// sensor the raw IR reading is about 195,000; every intermediate value in that detector
// was garbage, and the first session on this firmware showed exactly that — hr_bpm never
// resolved once, while the 32-bit reference algorithm reported throughout.

// The baseline tracker: position gain and slope gain.
//
// A plain exponential follower cannot do this job. Set it fast enough to keep up with the
// baseline and it subtracts the beat along with it; set it slow and it runs behind. On
// this hardware the finger does not settle — the IR reading was measured climbing from
// 53,000 to 194,000 across a thirty-five second session without ever levelling — and a
// follower of any single rate ends up sitting thousands of counts below a signal whose
// pulse is worth about a thousand, so the AC never returns below zero and no crossing is
// ever seen. The instrumented log showed exactly one interval recorded in 35 seconds.
//
// The fix is to estimate the slope as well as the level. A tracker carrying both has no
// steady-state lag on a ramp — it predicts forwards each step and corrects from what is
// left — while a heartbeat, whose average slope over a cycle is zero, moves the slope
// estimate almost not at all. BEAT_DC_ALPHA sets the level correction, BEAT_DC_BETA the
// slope; beta near alpha squared is the critically damped pairing, which is what stops the
// tracker ringing at the beat frequency it is supposed to ignore.
//
// Alpha at 0.02 puts the level corner near 0.08 Hz, an order of magnitude below the 1 Hz
// it must not follow, and the slope estimate converges in about three seconds.
constexpr float BEAT_DC_ALPHA = 0.02f;
constexpr float BEAT_DC_BETA  = 0.0002f;

// AC smoother, ~160 ms. Takes the sensor's high-frequency noise off without rounding the
// systolic upstroke, which is what the beat is timed from.
constexpr float BEAT_SMOOTH_ALPHA = 0.25f;

// Smallest peak-to-peak swing a cycle can have and still be a beat, as a fraction of the
// DC level. Relative rather than in counts so it survives a change of LED current or a
// differently perfused finger without being retuned; 0.2% sits well under a healthy
// perfusion index and well above the sensor's noise floor.
constexpr float BEAT_MIN_PERFUSION = 0.002f;

// And a ceiling, for the same reason the floor exists. A finger landing on the sensor
// takes the IR reading from about 1,400 to about 150,000, and no DC follower slow enough
// to sit through a beat can also keep up with that. The first instrumented session showed
// a measured swing of 127,424 counts on a DC of 148,677 — 86% of it, which is not a pulse
// by any definition. A cycle swinging more than this fraction of DC is the finger moving,
// and counting it as a beat is worse than waiting for the next one.
constexpr float BEAT_MAX_PERFUSION = 0.15f;

// A dicrotic notch — the small second bump as the aortic valve closes — arrives roughly a
// third of a cycle after the beat. That clears HR_BEAT_MIN_MS at any realistic rate, so
// an absolute floor cannot reject it and every interval would come out halved. Rejecting
// anything shorter than this fraction of the running median does.
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
