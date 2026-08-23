<?php

namespace App\Domain\Nutrition\ValueObject;

use DateTimeImmutable;

/**
 * The three sizes of bucket nutrition history is totalled into.
 *
 * Both of the ambiguous ones are pinned here, once, because a total the user cannot
 * reproduce by adding up their own meals is worse than no total at all:
 *
 *   Week   Monday to Sunday. ISO-8601, and the same start the mobile calendar draws
 *          (`month-grid.ts`), so the week a total covers is the week the user was
 *          looking at when they asked for it.
 *   Month  The calendar month — 1 August to 31 August — never a rolling thirty days.
 *          A rolling window would make "this month" mean something different every day
 *          it was opened.
 */
enum Period: string
{
    case Day = 'day';

    case Week = 'week';

    case Month = 'month';

    /** The first day of the bucket `$date` falls in. */
    public function startOf(DateTimeImmutable $date): DateTimeImmutable
    {
        return match ($this) {
            self::Day => $date,
            // `N` is 1 for Monday, so this walks back to the Monday at or before $date.
            self::Week => $date->modify('-'.((int) $date->format('N') - 1).' days'),
            self::Month => $date->modify('first day of this month'),
        };
    }

    /** The last day of the bucket `$date` falls in, inclusive. */
    public function endOf(DateTimeImmutable $date): DateTimeImmutable
    {
        return match ($this) {
            self::Day => $date,
            self::Week => $this->startOf($date)->modify('+6 days'),
            self::Month => $date->modify('last day of this month'),
        };
    }

    /**
     * The bucket after the one starting at `$start`.
     *
     * Walked from the start rather than by adding a month to an arbitrary day: `+1 month`
     * from the 31st lands in the month after next, because PHP rolls the overflow forward.
     * From the 1st there is nothing to overflow.
     */
    public function next(DateTimeImmutable $start): DateTimeImmutable
    {
        return match ($this) {
            self::Day => $start->modify('+1 day'),
            self::Week => $start->modify('+7 days'),
            self::Month => $start->modify('first day of next month'),
        };
    }

    /** The whole natural bucket `$date` sits in, both ends inclusive. */
    public function rangeAround(DateTimeImmutable $date): DateRange
    {
        return new DateRange($this->startOf($date), $this->endOf($date));
    }
}
