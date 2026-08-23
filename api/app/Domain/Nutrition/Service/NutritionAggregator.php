<?php

namespace App\Domain\Nutrition\Service;

use App\Domain\Nutrition\ValueObject\CalendarDate;
use App\Domain\Nutrition\ValueObject\DateRange;
use App\Domain\Nutrition\ValueObject\LoggedMeal;
use App\Domain\Nutrition\ValueObject\NutritionTotals;
use App\Domain\Nutrition\ValueObject\Period;
use App\Domain\Nutrition\ValueObject\PeriodTotals;

/**
 * Meals in, per-period totals out.
 *
 * This is the part of the feature that can be silently wrong. A total that is off by one
 * meal, or that puts Sunday in the wrong week, looks exactly like a total that is right —
 * nobody re-adds their own food diary to check. So the arithmetic lives here, away from
 * both the query and the screen, taking a plain list and returning plain values, and every
 * boundary it can get wrong has a fixture with a hand-worked answer next to it.
 *
 * Bucketing is done in PHP rather than in SQL on purpose. `GROUP BY YEARWEEK` means
 * something different in MySQL, SQLite and Postgres, and none of the three agrees with
 * `month-grid.ts` about which day a week starts on without being told. One definition,
 * written down in `Period`, applied everywhere.
 */
final class NutritionAggregator
{
    /**
     * Every bucket of `$period` that the range touches, in order, including empty ones.
     *
     * The empty buckets are the reason this walks the calendar instead of grouping the
     * meals it was given: a week with Wednesday missing should show Wednesday at zero, not
     * close the gap and let six days look like seven.
     *
     * @param  list<LoggedMeal>  $meals
     * @return list<PeriodTotals>
     */
    public function summarise(array $meals, DateRange $range, Period $period): array
    {
        $byBucket = [];

        foreach ($meals as $meal) {
            if (! $range->contains($meal->eatenOn)) {
                // A meal outside the window the caller asked about cannot belong to any
                // bucket it will be shown. Dropped rather than trusted, so a query that
                // over-fetches cannot inflate a total the user can see the parts of.
                continue;
            }

            $byBucket[CalendarDate::toIso($period->startOf($meal->eatenOn))][] = $meal;
        }

        $buckets = [];

        for (
            $start = $period->startOf($range->from);
            $start <= $range->to;
            $start = $period->next($start)
        ) {
            $span = $period->rangeAround($start);
            $covered = $span->intersect($range);

            if ($covered === null) {
                continue;
            }

            $buckets[] = new PeriodTotals(
                period: $period,
                span: $span,
                covered: $covered,
                totals: NutritionTotals::of($byBucket[CalendarDate::toIso($start)] ?? []),
            );
        }

        return $buckets;
    }

    /**
     * The whole range as one sum.
     *
     * Not derived by adding the buckets up: a range that starts mid-week has a first
     * bucket wider than the range, and adding bucket totals is only equal to this because
     * the buckets are already clipped to the range. Summing the meals once is both cheaper
     * and impossible to get out of step with them.
     *
     * @param  list<LoggedMeal>  $meals
     */
    public function total(array $meals, DateRange $range): NutritionTotals
    {
        $within = [];

        foreach ($meals as $meal) {
            if ($range->contains($meal->eatenOn)) {
                $within[] = $meal;
            }
        }

        return NutritionTotals::of($within);
    }
}
