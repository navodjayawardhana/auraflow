/**
 * Rank correlation, and the rules about when it is allowed to be shown.
 *
 * Pure arithmetic over two arrays, kept away from every screen and every fetch, because a
 * correlation coefficient is the single easiest number in this app to be confidently wrong
 * about: it always produces a value in [-1, 1], it never throws, and nobody re-derives it
 * by hand to check. Every boundary it can get wrong — ties, gaps, a flat signal, too few
 * points — has a fixture next to it with the answer worked out on paper.
 */

/**
 * The fewest paired days that may carry a printed coefficient.
 *
 * Spearman's sampling error is roughly 1/√(n−1): about 0.50 at five pairs, 0.33 at ten,
 * 0.28 at fourteen. The largest effect this project's own validation found between a
 * wearable signal and subjective state is ρ 0.123 (E-015), so even at this floor the error
 * bar is nearly three times the size of the thing being measured.
 *
 * Ten is therefore not a threshold of trustworthiness — nothing computable from a
 * fortnight of one person's data is trustworthy, and the panel says so above the numbers.
 * It is the point below which the coefficient is not worth printing even as an
 * illustration: under ten pairs a single mis-ranked day moves ρ further than the entire
 * effect being looked for, so the figure would be describing that one day.
 */
export const MIN_PAIRED_DAYS = 10;

export type CorrelationOutcome =
  | { kind: 'computed'; rho: number; pairs: number }
  /** Not enough days where both signals were recorded. `pairs` says how many there were. */
  | { kind: 'too-few-pairs'; pairs: number }
  /**
   * One of the two signals never changed across the window.
   *
   * Undefined, not zero. A constant has no ranking to correlate against, and a zero here
   * would read as "these are unrelated" when the truth is "this window cannot tell".
   */
  | { kind: 'no-variation'; pairs: number };

/**
 * Average ranks, ascending, ties sharing the midpoint of the positions they span.
 *
 * The midrank is what makes this Spearman rather than an approximation of it. Two equal
 * values given consecutive integer ranks would encode an ordering the data does not
 * contain, and with a bounded score like recovery — where identical values are common —
 * that invented ordering is a meaningful part of the coefficient.
 *
 * Exported for its own tests: it is the half of the calculation with no obvious symptom
 * when it is wrong.
 */
export function averageRanks(values: readonly number[]): number[] {
  const ascending = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);

  let start = 0;
  while (start < ascending.length) {
    let end = start;
    while (end + 1 < ascending.length && ascending[end + 1].value === ascending[start].value) {
      end += 1;
    }

    // Positions are 1-based, so the midpoint of positions start+1..end+1.
    const midrank = (start + end) / 2 + 1;
    for (let i = start; i <= end; i += 1) ranks[ascending[i].index] = midrank;

    start = end + 1;
  }

  return ranks;
}

/**
 * Spearman's ρ between two series that may each have gaps.
 *
 * **Spearman rather than Pearson**, for four reasons that all apply here:
 *
 *  1. The relationship claimed is monotonic, not linear. Nothing predicts that ten fewer
 *     beats per minute is worth twice what five is.
 *  2. A fortnight is short enough that one atypical day — a fever, a flight, a party —
 *     would dominate a Pearson coefficient. Ranks cap what any single day can contribute.
 *  3. The recovery score is bounded at 0 and 100 and compresses near both ends, so equal
 *     differences in score are not equal differences in state.
 *  4. E-015 reports ρ, so a coefficient computed the same way is comparable to the figure
 *     the project measured against PMData. A Pearson r here would look like the same
 *     quantity and quietly not be.
 *
 * Days where either value is missing are dropped as a pair, never filled and never treated
 * as zero: a night that was not logged is not a night of no sleep.
 *
 * @param xs values in date order, null on days that signal was not recorded
 * @param ys the same, aligned index-for-index with `xs`
 */
export function spearman(
  xs: readonly (number | null)[],
  ys: readonly (number | null)[],
): CorrelationOutcome {
  const pairedX: number[] = [];
  const pairedY: number[] = [];

  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue;

    pairedX.push(x);
    pairedY.push(y);
  }

  const pairs = pairedX.length;

  if (pairs < MIN_PAIRED_DAYS) return { kind: 'too-few-pairs', pairs };

  const rankX = averageRanks(pairedX);
  const rankY = averageRanks(pairedY);

  const meanX = rankX.reduce((sum, r) => sum + r, 0) / pairs;
  const meanY = rankY.reduce((sum, r) => sum + r, 0) / pairs;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;

  for (let i = 0; i < pairs; i += 1) {
    const dx = rankX[i] - meanX;
    const dy = rankY[i] - meanY;

    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  // Pearson over the ranks, not the 1 − 6Σd²/(n(n²−1)) shortcut. That closed form assumes
  // every rank is distinct, and silently returns the wrong number as soon as two days tie
  // — which, on a 0–100 score over a fortnight, they routinely do.
  if (varianceX === 0 || varianceY === 0) return { kind: 'no-variation', pairs };

  const rho = covariance / Math.sqrt(varianceX * varianceY);

  // Floating-point drift can push a perfect correlation a hair past 1.
  return { kind: 'computed', rho: Math.min(1, Math.max(-1, rho)), pairs };
}
