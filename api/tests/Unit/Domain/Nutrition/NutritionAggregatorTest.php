<?php

namespace Tests\Unit\Domain\Nutrition;

use App\Domain\Nutrition\Service\NutritionAggregator;
use App\Domain\Nutrition\ValueObject\DateRange;
use App\Domain\Nutrition\ValueObject\LoggedMeal;
use App\Domain\Nutrition\ValueObject\MealSource;
use App\Domain\Nutrition\ValueObject\Period;
use App\Domain\Nutrition\ValueObject\PeriodTotals;
use PHPUnit\Framework\TestCase;

/**
 * Every total in here was worked out by hand before the code was run.
 *
 * That is the point of the file. A food diary's totals are never checked by the person
 * reading them, so an aggregator that is wrong is indistinguishable from one that is
 * right until somebody adds up a month of meals on paper. These fixtures are that paper.
 *
 * The dates are real: August 2026 begins on a Saturday and ends on a Monday, which makes
 * it an unusually good month for catching an off-by-one at a week boundary.
 */
class NutritionAggregatorTest extends TestCase
{
    private NutritionAggregator $aggregator;

    protected function setUp(): void
    {
        $this->aggregator = new NutritionAggregator();
    }

    private function estimate(string $date, int $kcal): LoggedMeal
    {
        return LoggedMeal::on($date, $kcal, MealSource::Estimate);
    }

    private function lookup(string $date, int $kcal): LoggedMeal
    {
        return LoggedMeal::on($date, $kcal, MealSource::Lookup);
    }

    private function photo(string $date, int $kcal): LoggedMeal
    {
        return LoggedMeal::on($date, $kcal, MealSource::Photo);
    }

    /** @param  list<PeriodTotals>  $buckets */
    private function kcalByStart(array $buckets): array
    {
        $out = [];

        foreach ($buckets as $bucket) {
            $out[$bucket->span->fromIso()] = $bucket->totals->kcal;
        }

        return $out;
    }

    // --- Slice A: several meals a day ---

    public function test_should_total_four_meals_eaten_on_the_same_day(): void
    {
        // 320 + 610 + 180 + 740 = 1,850.
        $meals = [
            $this->estimate('2026-08-19', 320),
            $this->estimate('2026-08-19', 610),
            $this->estimate('2026-08-19', 180),
            $this->estimate('2026-08-19', 740),
        ];

        $totals = $this->aggregator->total($meals, DateRange::ofDay('2026-08-19'));

        $this->assertSame(1850, $totals->kcal);
        $this->assertSame(4, $totals->mealCount);
    }

    public function test_should_ignore_meals_outside_the_range_it_was_asked_about(): void
    {
        $meals = [$this->estimate('2026-08-18', 500), $this->estimate('2026-08-19', 320)];

        $totals = $this->aggregator->total($meals, DateRange::ofDay('2026-08-19'));

        $this->assertSame(320, $totals->kcal);
    }

    // --- Slice B: days, including the ones with nothing on them ---

    public function test_should_return_one_bucket_per_day_including_days_with_no_meals(): void
    {
        // Monday 17th to Sunday 23rd, with meals on three of the seven days.
        $meals = [
            $this->estimate('2026-08-17', 400),
            $this->estimate('2026-08-17', 650),
            $this->estimate('2026-08-20', 900),
            $this->estimate('2026-08-23', 210),
        ];

        $days = $this->aggregator->summarise(
            $meals,
            DateRange::of('2026-08-17', '2026-08-23'),
            Period::Day,
        );

        $this->assertCount(7, $days);
        $this->assertSame([
            '2026-08-17' => 1050,
            '2026-08-18' => 0,
            '2026-08-19' => 0,
            '2026-08-20' => 900,
            '2026-08-21' => 0,
            '2026-08-22' => 0,
            '2026-08-23' => 210,
        ], $this->kcalByStart($days));
    }

    public function test_should_report_a_day_with_no_meals_as_zero_rather_than_absent(): void
    {
        $days = $this->aggregator->summarise([], DateRange::ofDay('2026-08-19'), Period::Day);

        $this->assertCount(1, $days);
        $this->assertTrue($days[0]->totals->isEmpty());
        $this->assertSame(0, $days[0]->totals->kcal);
        // Nothing logged is not the same claim as everything logged being measured.
        $this->assertFalse($days[0]->totals->isWhollyMeasured());
    }

    // --- Slice C: week boundaries ---

    public function test_should_start_a_week_on_monday(): void
    {
        // Sunday 23 August closes the week that opened on Monday the 17th; Monday the 24th
        // opens the next one. Getting this backwards would move a Sunday dinner a week.
        $meals = [
            $this->estimate('2026-08-23', 700),
            $this->estimate('2026-08-24', 300),
        ];

        $weeks = $this->aggregator->summarise(
            $meals,
            DateRange::of('2026-08-17', '2026-08-30'),
            Period::Week,
        );

        $this->assertSame([
            '2026-08-17' => 700,
            '2026-08-24' => 300,
        ], $this->kcalByStart($weeks));
    }

    public function test_should_span_a_week_from_monday_to_sunday_inclusive(): void
    {
        $weeks = $this->aggregator->summarise(
            [],
            DateRange::of('2026-08-17', '2026-08-23'),
            Period::Week,
        );

        $this->assertCount(1, $weeks);
        $this->assertSame('2026-08-17', $weeks[0]->span->fromIso());
        $this->assertSame('2026-08-23', $weeks[0]->span->toIso());
        $this->assertFalse($weeks[0]->isPartial());
    }

    public function test_should_mark_a_week_the_range_only_partly_covers(): void
    {
        // Thursday to Saturday. The bucket is still the whole week — that is what a week
        // is — but only three days of it were asked about, and a client that shows the
        // figure as "this week" without saying so is reporting a fragment as a total.
        $weeks = $this->aggregator->summarise(
            [$this->estimate('2026-08-20', 900)],
            DateRange::of('2026-08-20', '2026-08-22'),
            Period::Week,
        );

        $this->assertCount(1, $weeks);
        $this->assertTrue($weeks[0]->isPartial());
        $this->assertSame('2026-08-17', $weeks[0]->span->fromIso());
        $this->assertSame('2026-08-23', $weeks[0]->span->toIso());
        $this->assertSame('2026-08-20', $weeks[0]->covered->fromIso());
        $this->assertSame('2026-08-22', $weeks[0]->covered->toIso());
    }

    public function test_should_split_a_week_that_straddles_a_month_end(): void
    {
        // The week of Monday 31 August 2026 runs into September. A week is a week: the
        // month boundary does not cut it in half.
        $meals = [
            $this->estimate('2026-08-31', 500),
            $this->estimate('2026-09-01', 400),
        ];

        $weeks = $this->aggregator->summarise(
            $meals,
            DateRange::of('2026-08-31', '2026-09-06'),
            Period::Week,
        );

        $this->assertCount(1, $weeks);
        $this->assertSame('2026-08-31', $weeks[0]->span->fromIso());
        $this->assertSame('2026-09-06', $weeks[0]->span->toIso());
        $this->assertSame(900, $weeks[0]->totals->kcal);
    }

    // --- Slice D: month boundaries ---

    public function test_should_bucket_by_calendar_month_not_a_rolling_thirty_days(): void
    {
        // 31 August and 1 September are one day apart and in different totals.
        $meals = [
            $this->estimate('2026-08-01', 100),
            $this->estimate('2026-08-31', 250),
            $this->estimate('2026-09-01', 400),
        ];

        $months = $this->aggregator->summarise(
            $meals,
            DateRange::of('2026-08-01', '2026-09-30'),
            Period::Month,
        );

        $this->assertSame([
            '2026-08-01' => 350,
            '2026-09-01' => 400,
        ], $this->kcalByStart($months));
    }

    public function test_should_give_each_month_its_own_length(): void
    {
        $months = $this->aggregator->summarise(
            [],
            DateRange::of('2026-08-01', '2026-09-30'),
            Period::Month,
        );

        $this->assertSame('2026-08-31', $months[0]->span->toIso());
        $this->assertSame('2026-09-30', $months[1]->span->toIso());
        $this->assertFalse($months[0]->isPartial());
        $this->assertFalse($months[1]->isPartial());
    }

    public function test_should_walk_february_without_losing_or_repeating_a_month(): void
    {
        // 31 January + one month is 3 March if the arithmetic is done from the day rather
        // than from the first of the month, which would skip February entirely.
        $months = $this->aggregator->summarise(
            [$this->estimate('2027-02-14', 600)],
            DateRange::of('2027-01-31', '2027-03-02'),
            Period::Month,
        );

        $this->assertSame(['2027-01-01', '2027-02-01', '2027-03-01'], array_map(
            static fn (PeriodTotals $bucket): string => $bucket->span->fromIso(),
            $months,
        ));
        $this->assertSame(600, $months[1]->totals->kcal);
        $this->assertSame('2027-02-28', $months[1]->span->toIso());
    }

    public function test_should_count_a_leap_day(): void
    {
        $months = $this->aggregator->summarise(
            [$this->estimate('2028-02-29', 480)],
            DateRange::of('2028-02-01', '2028-02-29'),
            Period::Month,
        );

        $this->assertCount(1, $months);
        $this->assertSame('2028-02-29', $months[0]->span->toIso());
        $this->assertSame(480, $months[0]->totals->kcal);
        $this->assertFalse($months[0]->isPartial());
    }

    // --- Slice E: a range that spans a month end ---

    public function test_should_split_a_range_spanning_a_month_end_into_both_months(): void
    {
        // 28 August to 3 September: 4 days in August, 3 in September.
        // August   28th 700 + 30th 550                    = 1,250
        // September 1st 300 + 1st 220 + 3rd 900           = 1,420
        $meals = [
            $this->estimate('2026-08-28', 700),
            $this->estimate('2026-08-30', 550),
            $this->estimate('2026-09-01', 300),
            $this->estimate('2026-09-01', 220),
            $this->estimate('2026-09-03', 900),
        ];

        $range = DateRange::of('2026-08-28', '2026-09-03');
        $months = $this->aggregator->summarise($meals, $range, Period::Month);

        $this->assertSame([
            '2026-08-01' => 1250,
            '2026-09-01' => 1420,
        ], $this->kcalByStart($months));

        // Both are fragments of their month, and both say so.
        $this->assertTrue($months[0]->isPartial());
        $this->assertSame('2026-08-28', $months[0]->covered->fromIso());
        $this->assertSame('2026-08-31', $months[0]->covered->toIso());
        $this->assertTrue($months[1]->isPartial());
        $this->assertSame('2026-09-01', $months[1]->covered->fromIso());
        $this->assertSame('2026-09-03', $months[1]->covered->toIso());

        // And the whole-range total is the two of them together, 2,670.
        $this->assertSame(2670, $this->aggregator->total($meals, $range)->kcal);
    }

    public function test_should_agree_with_itself_across_the_three_groupings(): void
    {
        $meals = [
            $this->estimate('2026-08-28', 700),
            $this->lookup('2026-08-30', 550),
            $this->photo('2026-09-01', 300),
            $this->estimate('2026-09-03', 900),
        ];

        $range = DateRange::of('2026-08-28', '2026-09-03');
        $expected = $this->aggregator->total($meals, $range)->kcal;

        foreach ([Period::Day, Period::Week, Period::Month] as $period) {
            $summed = array_sum(array_map(
                static fn (PeriodTotals $bucket): int => $bucket->totals->kcal,
                $this->aggregator->summarise($meals, $range, $period),
            ));

            $this->assertSame($expected, $summed, "{$period->value} buckets lost energy");
        }
    }

    // --- Slice F: provenance surviving the sum ---

    public function test_should_keep_measured_and_estimated_energy_apart_in_a_total(): void
    {
        // Three barcode lookups and three guesses reaching the same 1,800 kcal must not
        // read as the same claim. 600 measured, 1,200 not.
        $meals = [
            $this->lookup('2026-08-19', 200),
            $this->lookup('2026-08-19', 250),
            $this->lookup('2026-08-19', 150),
            $this->estimate('2026-08-19', 500),
            $this->estimate('2026-08-19', 400),
            $this->photo('2026-08-19', 300),
        ];

        $totals = $this->aggregator->total($meals, DateRange::ofDay('2026-08-19'));

        $this->assertSame(1800, $totals->kcal);
        $this->assertSame(600, $totals->measuredKcal);
        $this->assertSame(1200, $totals->estimatedKcal);
        $this->assertSame(3, $totals->measuredCount);
        $this->assertSame(3, $totals->estimatedCount);
        $this->assertFalse($totals->isWhollyMeasured());
    }

    public function test_should_count_a_photo_estimate_as_estimated_not_measured(): void
    {
        // A model reading a photograph with no scale in it is the least certain figure the
        // app holds. Folding it into the measured half would be the exact laundering the
        // split exists to prevent.
        $totals = $this->aggregator->total(
            [$this->photo('2026-08-19', 640)],
            DateRange::ofDay('2026-08-19'),
        );

        $this->assertSame(0, $totals->measuredKcal);
        $this->assertSame(640, $totals->estimatedKcal);
    }

    public function test_should_call_a_day_of_lookups_wholly_measured(): void
    {
        $totals = $this->aggregator->total(
            [$this->lookup('2026-08-19', 200), $this->lookup('2026-08-19', 410)],
            DateRange::ofDay('2026-08-19'),
        );

        $this->assertTrue($totals->isWhollyMeasured());
        $this->assertSame(610, $totals->measuredKcal);
        $this->assertSame(0, $totals->estimatedKcal);
    }

    public function test_should_carry_provenance_into_every_bucket_not_only_the_grand_total(): void
    {
        $days = $this->aggregator->summarise(
            [$this->lookup('2026-08-17', 400), $this->estimate('2026-08-18', 900)],
            DateRange::of('2026-08-17', '2026-08-18'),
            Period::Day,
        );

        $this->assertTrue($days[0]->totals->isWhollyMeasured());
        $this->assertFalse($days[1]->totals->isWhollyMeasured());
        $this->assertSame(900, $days[1]->totals->estimatedKcal);
    }

    // --- Slice G: macros ---

    public function test_should_sum_macros_over_the_rows_that_carry_them_and_say_how_many(): void
    {
        // Two of three rows have a breakdown: 31 + 12 protein, 40 + 30 carbs, 9 + 4 fat.
        $meals = [
            LoggedMeal::on('2026-08-19', 620, MealSource::Lookup, 31, 40, 9),
            LoggedMeal::on('2026-08-19', 210, MealSource::Lookup, 12, 30, 4),
            LoggedMeal::on('2026-08-19', 400, MealSource::Estimate),
        ];

        $totals = $this->aggregator->total($meals, DateRange::ofDay('2026-08-19'));

        $this->assertSame(43, $totals->proteinG);
        $this->assertSame(70, $totals->carbsG);
        $this->assertSame(13, $totals->fatG);
        $this->assertSame(2, $totals->mealsWithMacros);
        $this->assertSame(3, $totals->mealCount);
    }
}
