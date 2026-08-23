<?php

namespace App\Domain\Advice\ValueObject;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;

/**
 * One past day, as much of it as was recorded.
 *
 * Nulls, never zeroes, for exactly the reason `InsightsDay` gives: a day with `steps: 0`
 * is a day someone did not move, and a day with `steps: null` is a day nobody counted.
 * A model handed zeroes for the second kind will describe a fortnight of missing data as
 * a fortnight of inactivity, and it will do so fluently.
 *
 * Every figure that can be two different measurements carries which one it is, because
 * the whole risk of giving a language model a history is that it will average across the
 * distinction: a seated resting rate beside an overnight one, a foreground step sample
 * beside an operating system's day total, a photograph's calorie guess beside a barcode.
 */
final class HistoryDay
{
    public function __construct(
        public readonly string $date,
        /** Null where the day could not be scored at all, not where it scored badly. */
        public readonly ?int $recoveryScore = null,
        /** Meaningless without a score; a provisional one was computed without a personal baseline. */
        public readonly bool $recoveryIsProvisional = false,
        public readonly ?int $sleepMinutes = null,
        public readonly ?float $restingHeartRate = null,
        /** How that rate was taken. Two readings of the same heart, not one of varying quality. */
        public readonly ?RestingHeartRateSource $restingHeartRateSource = null,
        public readonly ?int $steps = null,
        /** Null is read as partial, the same way it is everywhere else in the app. */
        public readonly ?bool $stepsAreComplete = null,
        public readonly ?int $waterMl = null,
        /** Null where nothing was logged; 0 would claim a day of fasting. */
        public readonly ?int $kcal = null,
        public readonly int $mealCount = 0,
        /** How many of those calories nobody but the user or a vision model put a number on. */
        public readonly int $estimatedKcal = 0,
        public readonly int $estimatedMealCount = 0,
    ) {
    }

    /** True when nothing at all was recorded, so the day is a gap rather than a row. */
    public function isEmpty(): bool
    {
        return $this->recoveryScore === null
            && $this->sleepMinutes === null
            && $this->restingHeartRate === null
            && $this->steps === null
            && $this->waterMl === null
            && $this->kcal === null;
    }
}
