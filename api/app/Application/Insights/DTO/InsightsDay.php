<?php

namespace App\Application\Insights\DTO;

/**
 * One calendar day, with every signal the insights screen can draw and a null wherever
 * that signal was not recorded.
 *
 * Nulls rather than zeroes, everywhere, and the distinction is the whole contract. A day
 * with `steps: 0` is a day someone did not move; a day with `steps: null` is a day nobody
 * counted. Collapsing the two would let a fortnight with four step counts in it average
 * as though it had fourteen, which is the exact dishonesty the coverage panel exists to
 * prevent -- and it would do it silently, because the mean of a mostly-zero array still
 * looks like a number.
 */
final class InsightsDay
{
    public function __construct(
        public readonly string $date,
        /** Null when the day could not be scored at all, not when it scored badly. */
        public readonly ?float $recoveryScore,
        /** Meaningless without a score; false when there is none. */
        public readonly bool $recoveryProvisional,
        public readonly ?int $sleepMinutes,
        public readonly ?float $restingHeartRate,
        public readonly ?int $steps,
        /**
         * Whether that count is a day or only the part of one a phone was watching.
         *
         * Carried rather than folded into `steps` for the same reason
         * `estimated_meal_count` is carried beside `meal_count`: a fortnight of iOS
         * totals and a fortnight of Android foreground samples produce identical
         * columns and are not equally known. Null where the count arrived without
         * saying -- an old row, an import -- which the client reads as partial.
         */
        public readonly ?bool $stepsAreComplete,
        public readonly ?int $waterMl,
        public readonly int $mealCount,
        /**
         * How many of them are somebody's guess rather than a manufacturer's label.
         *
         * Carried alongside the count instead of folded into it because a day covered by
         * three barcode lookups and a day covered by three photo estimates are not the
         * same day, and a coverage figure that cannot tell them apart is overstating what
         * it knows.
         */
        public readonly int $estimatedMealCount,
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'date' => $this->date,
            'recovery_score' => $this->recoveryScore === null ? null : round($this->recoveryScore, 1),
            'recovery_provisional' => $this->recoveryProvisional,
            'sleep_minutes' => $this->sleepMinutes,
            'resting_heart_rate' => $this->restingHeartRate,
            'steps' => $this->steps,
            'steps_are_complete' => $this->stepsAreComplete,
            'water_ml' => $this->waterMl,
            'meal_count' => $this->mealCount,
            'estimated_meal_count' => $this->estimatedMealCount,
        ];
    }
}
