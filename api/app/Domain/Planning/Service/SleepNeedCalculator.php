<?php

namespace App\Domain\Planning\Service;

/**
 * How many hours this person should be aiming for.
 *
 * Hirshkowitz M, Whiton K, Albert SM, et al. "National Sleep Foundation's sleep time
 * duration recommendations: methodology and results summary." Sleep Health.
 * 2015;1(1):40-43.
 *
 * The panel published *ranges*, not points, and the range is the honest form of the
 * advice. A single number is what RecoveryScoreCalculator's duration component needs, so
 * the midpoint is taken and the range is kept alongside for anything that wants to show
 * the guidance as it was actually written.
 *
 * This is the value that finally reaches the calculator's `$personalSleepNeedHours` --
 * a parameter that has existed, correctly implemented and unreachable, since the
 * recovery score was written. Until now every user was scored against 8.0 hours,
 * including the 68-year-old for whom the guidance says 7 to 8.
 */
final class SleepNeedCalculator
{
    /**
     * NSF recommended ranges by age band, in hours, ascending by minimum age.
     *
     * Bands below 14 are omitted: nothing in this app is built for children, and a band
     * that cannot be reached is a band that cannot be tested.
     *
     * @var array<int, array{int, float, float}> [minimum age, low, high]
     */
    private const BANDS = [
        [65, 7.0, 8.0],   // older adults
        [26, 7.0, 9.0],   // adults
        [18, 7.0, 9.0],   // young adults
        [14, 8.0, 10.0],  // teenagers
    ];

    /**
     * The value the app has used for everyone until now, and the adult midpoint, so a
     * profile without a date of birth is scored exactly as it was before this phase.
     */
    public const POPULATION_DEFAULT_HOURS = 8.0;

    public function needHours(?int $ageYears): float
    {
        $range = $this->recommendedRange($ageYears);

        if ($range === null) {
            return self::POPULATION_DEFAULT_HOURS;
        }

        return round(($range[0] + $range[1]) / 2, 1);
    }

    /**
     * The published range for an age, or null when no band covers it.
     *
     * @return array{float, float}|null
     */
    public function recommendedRange(?int $ageYears): ?array
    {
        if ($ageYears === null) {
            return null;
        }

        foreach (self::BANDS as [$minimumAge, $low, $high]) {
            if ($ageYears >= $minimumAge) {
                return [$low, $high];
            }
        }

        return null;
    }
}
