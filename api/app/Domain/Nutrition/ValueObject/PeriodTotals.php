<?php

namespace App\Domain\Nutrition\ValueObject;

/**
 * One bucket of history: which calendar period, how much of it was asked for, and the sum.
 *
 * `period` is the whole natural period — the full Monday-to-Sunday week, the full calendar
 * month. `covered` is the part of it the request actually spanned. They differ whenever a
 * range stops mid-period, and when they differ the total is of a fragment. Saying so is
 * the difference between "you ate 9,400 kcal this week" and the same sentence about four
 * days of it.
 */
final class PeriodTotals
{
    public function __construct(
        public readonly Period $period,
        public readonly DateRange $span,
        public readonly DateRange $covered,
        public readonly NutritionTotals $totals,
    ) {
    }

    /** True when the request did not span the whole period, so the sum is of part of it. */
    public function isPartial(): bool
    {
        return $this->covered->fromIso() !== $this->span->fromIso()
            || $this->covered->toIso() !== $this->span->toIso();
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'period' => $this->period->value,
            // The bucket's identity, and the key the client groups on.
            'start' => $this->span->fromIso(),
            'end' => $this->span->toIso(),
            'covered_from' => $this->covered->fromIso(),
            'covered_to' => $this->covered->toIso(),
            'partial' => $this->isPartial(),
        ] + $this->totals->toArray();
    }
}
