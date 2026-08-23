<?php

namespace App\Application\Wellbeing\DTO;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\SleepArchitectureBaseline;

/**
 * Everything the preceding fortnight says about a user, read once.
 *
 * The three figures come from the same rows and were being fetched by two callers with
 * two copies of the same query. One reader, one window, one DTO -- the daily-brief
 * controller has a docblock about what happens when a lookup exists in two places.
 */
final class TrailingWindow
{
    /**
     * @param  int[]  $dailySteps  step counts from the window, oldest first, days without
     *                             a count omitted
     */
    public function __construct(
        public readonly ?RestingHeartRateBaseline $restingHeartRate,
        public readonly ?SleepArchitectureBaseline $sleepArchitecture,
        public readonly array $dailySteps,
    ) {
    }

    public static function empty(): self
    {
        return new self(null, null, []);
    }
}
