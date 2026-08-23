/**
 * Turning a minute of live heart rates into one number worth calling a resting rate.
 *
 * The node publishes roughly every 1.5 s and each frame is an estimate over a short window,
 * so the instantaneous value wanders: a swallow, a shift in finger pressure or a missed beat
 * moves it several bpm. Reading whichever frame happened to be on screen when a button was
 * pressed is therefore a coin toss across a range wider than the effect any of this is
 * trying to detect.
 *
 * What a wearable reports overnight is not the lowest beat it saw either -- it is the lowest
 * rate the heart *held*. That distinction is the whole reduction here: the minimum of a
 * sustained window, never the minimum of a sample. A single spurious 41 inside a stretch of
 * 58s barely moves a ten-second mean, and cannot win on its own.
 */

export interface HeartRateSample {
  /** `Date.now()` when the frame arrived. */
  at: number;
  bpm: number;
}

/**
 * How long the capture runs.
 *
 * Long enough to hold several independent windows, short enough that a person will actually
 * sit still for it every morning. A check-in nobody repeats produces no baseline at all,
 * which is worse than a slightly noisier one they do.
 */
export const CAPTURE_MS = 60_000;

/**
 * What counts as "sustained".
 *
 * Ten seconds spans six or seven of the node's frames and several heartbeats, so a mean over
 * it survives one bad estimate. Much shorter and a single frame starts to dominate again;
 * much longer and a genuine quiet stretch inside a fidgety minute gets averaged away.
 */
export const SUSTAIN_MS = 10_000;

/**
 * Frames a window needs before its mean is trusted.
 *
 * Time span alone is not enough: if contact breaks, two frames ten seconds apart still span
 * the window, and a mean of two would let one poor estimate through as the answer. Four is
 * comfortably under the six or seven an unbroken ten seconds produces, so a little jitter in
 * publish timing does not disqualify a good window.
 */
export const MIN_SAMPLES_PER_WINDOW = 4;

/**
 * The lowest rate the heart held for a full sustained window, or null when the capture never
 * held one.
 *
 * Null is a real outcome rather than an error: a finger that kept lifting produces plenty of
 * samples and no ten-second stretch among them, and the honest answer there is to ask for the
 * minute again rather than to average whatever arrived.
 *
 * @param samples oldest first, as the capture appended them.
 */
export function lowestSustainedBpm(samples: HeartRateSample[]): number | null {
  let lowest: number | null = null;

  for (let start = 0; start < samples.length; start++) {
    // The window is closed by the first frame that puts it over the duration, so it always
    // covers at least SUSTAIN_MS rather than falling just short of it. A window that runs off
    // the end of the capture is not a short window -- it is not a window.
    let end = start;
    while (end < samples.length && samples[end].at - samples[start].at < SUSTAIN_MS) {
      end++;
    }

    if (end >= samples.length) break;

    const window = samples.slice(start, end + 1);
    if (window.length < MIN_SAMPLES_PER_WINDOW) continue;

    const mean = window.reduce((sum, sample) => sum + sample.bpm, 0) / window.length;

    if (lowest === null || mean < lowest) lowest = mean;
  }

  // One decimal, matching what the API stores. Rounding to a whole bpm here would throw away
  // resolution the reduction just spent a minute earning.
  return lowest === null ? null : Math.round(lowest * 10) / 10;
}

/**
 * How much of the capture has produced usable signal, as a 0–1 fraction.
 *
 * Deliberately measured in samples held rather than seconds elapsed. A minute spent with the
 * finger half on the pad is a minute of nothing, and a progress bar that fills anyway would
 * be telling the one person who needs to adjust something that everything is fine.
 */
export function captureCoverage(samples: HeartRateSample[]): number {
  if (samples.length === 0) return 0;

  const held = samples[samples.length - 1].at - samples[0].at;

  return Math.min(held / CAPTURE_MS, 1);
}
