import { MIN_PAIRED_DAYS, averageRanks, spearman } from '@/services/correlation';

/**
 * Every expected value below was worked out on paper before the code ran.
 *
 * That is the point of the file. A correlation coefficient always returns something in
 * [-1, 1], never throws, and cannot be sanity-checked by eye, so a test that asserts
 * "whatever the implementation currently prints" would pass forever while the number on
 * the screen was wrong.
 */

describe('averageRanks', () => {
  it('ranks a distinct ascending series 1..n', () => {
    expect(averageRanks([10, 20, 30])).toEqual([1, 2, 3]);
  });

  it('keeps ranks with the value, not the position', () => {
    expect(averageRanks([30, 20, 10])).toEqual([3, 2, 1]);
  });

  it('gives tied values the midpoint of the positions they span', () => {
    // 20 and 20 occupy positions 2 and 3, so both take (2 + 3) / 2.
    expect(averageRanks([10, 20, 20, 40])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('gives an entirely tied series one shared midrank', () => {
    // Positions 1, 2 and 3 → 2. A constant has no ordering, and this is what says so.
    expect(averageRanks([5, 5, 5])).toEqual([2, 2, 2]);
  });

  it('handles a tie that runs to the end of the series', () => {
    expect(averageRanks([1, 7, 7, 7])).toEqual([1, 3, 3, 3]);
  });
});

describe('spearman', () => {
  const ascending = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('returns 1 for a perfectly ordered pair', () => {
    const result = spearman(ascending, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);

    expect(result).toEqual({ kind: 'computed', rho: 1, pairs: 10 });
  });

  it('returns -1 for a perfectly reversed pair', () => {
    const result = spearman(ascending, [...ascending].reverse());

    expect(result).toEqual({ kind: 'computed', rho: -1, pairs: 10 });
  });

  /**
   * The case the tie-blind closed form gets wrong.
   *
   * Worked by hand: midranks are [2,2,2,5,5,5,8,8,8,10] and
   * [1.5,1.5,3.5,3.5,5.5,5.5,7.5,7.5,9.5,9.5], both with mean 5.5. Covariance 74,
   * rank variances 76.5 and 80, so rho = 74 / sqrt(6120) = 0.945923.
   *
   * The 1 − 6Σd²/(n(n²−1)) shortcut gives 0.948485 on the same numbers, because it assumes
   * every rank is distinct. A third decimal place of drift is what a wrong Spearman looks
   * like — never an exception, never an obviously silly figure.
   */
  it('uses midranks rather than the tie-blind closed form', () => {
    const result = spearman(
      [1, 1, 1, 2, 2, 2, 3, 3, 3, 4],
      [5, 5, 6, 6, 7, 7, 8, 8, 9, 9],
    );

    expect(result.kind).toBe('computed');
    if (result.kind !== 'computed') return;

    expect(result.rho).toBeCloseTo(0.9459, 4);
    expect(result.rho).not.toBeCloseTo(0.9485, 4);
  });

  it('drops a day where either signal is missing, and keeps the rest paired', () => {
    // Twelve days, two of them holed on opposite sides — ten pairs survive, and they are
    // still the *matching* ten. A shift by one here would correlate Monday with Tuesday.
    const xs = [1, 2, null, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const ys = [1, 2, 3, 4, 5, null, 7, 8, 9, 10, 11, 12];

    const result = spearman(xs, ys);

    expect(result).toEqual({ kind: 'computed', rho: 1, pairs: 10 });
  });

  it('refuses a coefficient below the floor rather than printing a meaningless one', () => {
    const nine = ascending.slice(0, 9);

    expect(spearman(nine, nine)).toEqual({ kind: 'too-few-pairs', pairs: 9 });
    expect(MIN_PAIRED_DAYS).toBe(10);
  });

  it('counts pairs, not days, when deciding it has too few', () => {
    // Fourteen days, five of them with a gap on one side: nine pairs, so no coefficient
    // even though the window looks comfortably long.
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, null, null, null, null];
    const ys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

    expect(spearman(xs, ys)).toEqual({ kind: 'too-few-pairs', pairs: 9 });
  });

  it('calls a constant signal undefined rather than uncorrelated', () => {
    const flat = new Array(10).fill(60);

    // Zero would read as "these are unrelated". The truth is that a signal that never
    // moved has no ordering for the other one to agree or disagree with.
    expect(spearman(ascending, flat)).toEqual({ kind: 'no-variation', pairs: 10 });
    expect(spearman(flat, ascending)).toEqual({ kind: 'no-variation', pairs: 10 });
  });

  it('treats an all-tied pair as undefined on both sides', () => {
    const flat = new Array(10).fill(7);

    expect(spearman(flat, flat)).toEqual({ kind: 'no-variation', pairs: 10 });
  });

  it('reports no pairs at all when the two series never overlap', () => {
    const xs = [1, 2, 3, null, null, null];
    const ys = [null, null, null, 4, 5, 6];

    expect(spearman(xs, ys)).toEqual({ kind: 'too-few-pairs', pairs: 0 });
  });

  it('ignores a value that is not a finite number', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, Number.NaN];
    const ys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

    expect(spearman(xs, ys)).toEqual({ kind: 'computed', rho: 1, pairs: 10 });
  });

  /**
   * One day out of order in an otherwise perfect ten-day run.
   *
   * By hand: ranks differ only at positions 5 and 6, each by 1, so Σd² = 2 and
   * rho = 1 − 12/990 = 0.987879. Distinct ranks throughout, so the closed form agrees here
   * and can be used as an independent check on the Pearson-over-ranks path.
   */
  it('agrees with the closed form when no value is tied', () => {
    const result = spearman(ascending, [1, 2, 3, 4, 6, 5, 7, 8, 9, 10]);

    expect(result.kind).toBe('computed');
    if (result.kind !== 'computed') return;

    expect(result.rho).toBeCloseTo(0.987879, 6);
  });
});
