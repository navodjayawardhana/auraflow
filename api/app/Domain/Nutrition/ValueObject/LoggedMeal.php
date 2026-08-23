<?php

namespace App\Domain\Nutrition\ValueObject;

use DateTimeImmutable;

/**
 * One meal, reduced to the parts that aggregate.
 *
 * Deliberately not the Eloquent row: the aggregator is arithmetic over a list, and a list
 * of these can be written out by hand in a test with the expected totals worked out
 * alongside it. A name, an id and a barcode change nothing about a sum.
 *
 * The day is `eaten_on`, not the date part of `eaten_at`. The two can disagree by a day
 * either way — the column is written from the eater's own clock while the timestamp is
 * stored as an instant — and the day a meal belongs to is the one the person was living
 * in when they ate it.
 */
final class LoggedMeal
{
    public function __construct(
        public readonly DateTimeImmutable $eatenOn,
        public readonly int $kcal,
        public readonly MealSource $source,
        public readonly ?int $proteinG = null,
        public readonly ?int $carbsG = null,
        public readonly ?int $fatG = null,
    ) {
    }

    /** `Y-m-d`, the shape the column and every test fixture use. */
    public static function on(
        string $isoDate,
        int $kcal,
        MealSource $source,
        ?int $proteinG = null,
        ?int $carbsG = null,
        ?int $fatG = null,
    ): self {
        return new self(
            CalendarDate::fromIso($isoDate),
            $kcal,
            $source,
            $proteinG,
            $carbsG,
            $fatG,
        );
    }

    /** True when the row carries a macro breakdown at all, which most estimates do not. */
    public function hasMacros(): bool
    {
        return $this->proteinG !== null || $this->carbsG !== null || $this->fatG !== null;
    }
}
