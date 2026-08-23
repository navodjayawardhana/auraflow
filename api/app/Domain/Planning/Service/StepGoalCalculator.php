<?php

namespace App\Domain\Planning\Service;

/**
 * A step target that is reachable from where the person actually is.
 *
 * Tudor-Locke C, Bassett DR Jr. "How many steps/day are enough? Preliminary pedometer
 * indices for public health." Sports Med. 2004;34(1):1-8, which classifies adults as
 * sedentary below 5,000 steps/day, low active to 7,499, somewhat active to 9,999, active
 * to 12,499 and highly active above that.
 *
 * The goal is the next boundary above the user's measured median -- so someone averaging
 * 4,200 is asked for 5,000 rather than 10,000. That is not a softer target, it is the
 * only one that means anything: 10,000 handed to a sedentary walker is a number they
 * miss every day until they stop looking at it, and the boundary above them is the one
 * that actually moves their classification.
 *
 * The 10,000 in the fallback is the same paper's observation that the figure originated
 * with a Japanese pedometer marketed as *manpo-kei*, "10,000 steps meter" -- a
 * recognisable anchor rather than a derived one, which is how mobile's goals.ts already
 * describes it.
 */
final class StepGoalCalculator
{
    /** The Tudor-Locke class boundaries, ascending. */
    private const BAND_BOUNDARIES = [5000, 7500, 10000, 12500];

    /** The anchor, used until there is enough history to do better. */
    public const POPULATION_DEFAULT = 10000;

    /**
     * Days of step history before a median is trusted.
     *
     * Seven, so the window spans a full week: someone who walks to work Monday to Friday
     * and not at all at the weekend has a five-day median that describes a different
     * person from the one living the week.
     */
    public const MIN_DAYS = 7;

    /**
     * The median of a week's step counts, or null when the week is not there.
     *
     * Median rather than mean, because one 26,000-step wedding, or one day the watch sat
     * on a charger, would drag a mean far enough to set next week's goal wrongly.
     *
     * @param  int[]  $dailySteps
     */
    public function medianDailySteps(array $dailySteps): ?int
    {
        $counts = array_values(array_filter($dailySteps, static fn ($value) => $value !== null));

        if (count($counts) < self::MIN_DAYS) {
            return null;
        }

        sort($counts);
        $middle = intdiv(count($counts), 2);

        return count($counts) % 2 === 1
            ? $counts[$middle]
            : (int) round(($counts[$middle - 1] + $counts[$middle]) / 2);
    }

    /**
     * The goal for a measured median, or the anchor when there is no median.
     *
     * Already highly active holds at the top boundary rather than climbing without limit:
     * the paper's classification stops there, so a goal beyond it would be extrapolating
     * past the evidence rather than reading it.
     */
    public function dailyGoal(?int $medianDailySteps): int
    {
        if ($medianDailySteps === null) {
            return self::POPULATION_DEFAULT;
        }

        foreach (self::BAND_BOUNDARIES as $boundary) {
            if ($medianDailySteps < $boundary) {
                return $boundary;
            }
        }

        return self::BAND_BOUNDARIES[count(self::BAND_BOUNDARIES) - 1];
    }
}
