import {
  captureCoverage,
  lowestSustainedBpm,
  MIN_SAMPLES_PER_WINDOW,
  SUSTAIN_MS,
  type HeartRateSample,
} from '@/services/resting-capture';

/**
 * The reduction is the only part of the check-in that can be quietly wrong.
 *
 * Everything else fails loudly — no node, no finger, no samples. This turns a minute of
 * wandering estimates into the one number that goes into a baseline and is then compared
 * against for a fortnight, so a reduction that picks up a dropped-beat artefact does not
 * produce an error, it produces a baseline that is a few bpm too low and an app that
 * reports elevated recovery-relevant readings for two weeks.
 */

/** Frames at the node's real cadence, so window sizes here match window sizes there. */
const PUBLISH_MS = 1_500;

function stream(bpms: number[], startAt = 1_000, everyMs = PUBLISH_MS): HeartRateSample[] {
  return bpms.map((bpm, index) => ({ at: startAt + index * everyMs, bpm }));
}

describe('lowestSustainedBpm', () => {
  it('returns nothing when the capture never held a full window', () => {
    // Five seconds of contact. There is a mean to be had, and it would be an answer to a
    // question nobody asked.
    expect(lowestSustainedBpm(stream([60, 61, 59, 60]))).toBeNull();
  });

  it('returns nothing at all when there were no samples', () => {
    expect(lowestSustainedBpm([])).toBeNull();
  });

  it('ignores a single low frame that the heart never held', () => {
    // Twenty seconds at a steady 60 with one 41 in the middle — the shape of a missed beat.
    // Taking the minimum sample would report 41; the lowest ten-second stretch is barely
    // moved by it.
    const withArtefact = stream([60, 60, 60, 60, 60, 41, 60, 60, 60, 60, 60, 60, 60, 60]);

    const result = lowestSustainedBpm(withArtefact);

    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(56);
  });

  it('finds a genuine sustained dip rather than the average of the minute', () => {
    // Half a minute settling at 68, then a quiet half-minute at 56. The mean of the whole
    // capture is 62 and describes neither stretch; the resting figure is the second one.
    const settling = new Array(20).fill(68);
    const quiet = new Array(20).fill(56);

    expect(lowestSustainedBpm(stream([...settling, ...quiet]))).toBe(56);
  });

  it('refuses a window that spans the time but not the beats', () => {
    // Contact lost: two frames straddling a twelve-second gap. They span a window and mean
    // nothing, and one of them is low enough to win if the count is not checked.
    const sparse: HeartRateSample[] = [
      { at: 0, bpm: 44 },
      { at: 12_000, bpm: 62 },
      { at: 13_500, bpm: 62 },
    ];

    expect(lowestSustainedBpm(sparse)).toBeNull();
  });

  it('accepts a window holding exactly the minimum number of frames', () => {
    // The boundary the rule above is drawn at: same gap, one more frame inside it.
    const spread = SUSTAIN_MS / (MIN_SAMPLES_PER_WINDOW - 1) + 1;
    const samples = stream([58, 58, 58, 58], 0, spread);

    expect(samples).toHaveLength(MIN_SAMPLES_PER_WINDOW);
    expect(lowestSustainedBpm(samples)).toBe(58);
  });

  it('reports a tenth of a bpm rather than rounding the reduction away', () => {
    // A real window rarely averages to a whole number, and the API column keeps a decimal.
    expect(lowestSustainedBpm(stream([57, 58, 57, 58, 57, 58, 57, 58]))).toBe(57.5);
  });
});

describe('captureCoverage', () => {
  it('is zero before anything has been held', () => {
    expect(captureCoverage([])).toBe(0);
  });

  it('measures signal held rather than time elapsed', () => {
    // Thirty seconds of frames. Half a minute of contact, half the bar — regardless of how
    // long the person has been sitting there fiddling with the pad.
    expect(captureCoverage(stream(new Array(21).fill(60)))).toBeCloseTo(0.5, 2);
  });

  it('never exceeds a full bar when the capture overruns', () => {
    expect(captureCoverage(stream(new Array(80).fill(60)))).toBe(1);
  });
});
