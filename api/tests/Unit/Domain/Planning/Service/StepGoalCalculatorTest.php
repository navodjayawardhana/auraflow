<?php

namespace Tests\Unit\Domain\Planning\Service;

use App\Domain\Planning\Service\StepGoalCalculator;
use PHPUnit\Framework\TestCase;

/**
 * Tudor-Locke C, Bassett DR Jr. "How many steps/day are enough? Preliminary pedometer
 * indices for public health." Sports Med. 2004;34(1):1-8. Sedentary below 5,000; low
 * active to 7,499; somewhat active to 9,999; active to 12,499; highly active above.
 */
class StepGoalCalculatorTest extends TestCase
{
    private StepGoalCalculator $calculator;

    protected function setUp(): void
    {
        $this->calculator = new StepGoalCalculator();
    }

    // --- Slice A: not enough history ---

    // Z
    public function test_should_have_no_median_for_an_empty_history(): void
    {
        $this->assertNull($this->calculator->medianDailySteps([]));
    }

    // B
    public function test_should_refuse_a_median_one_day_short_of_a_full_week(): void
    {
        // Six days is not a week. Someone who walks to work Monday to Friday and not at
        // all at the weekend has a five-day median describing a different person.
        $sixDays = array_fill(0, StepGoalCalculator::MIN_DAYS - 1, 8000);

        $this->assertNull($this->calculator->medianDailySteps($sixDays));
    }

    // Z
    public function test_should_fall_back_to_the_recognisable_anchor_with_no_median(): void
    {
        // The familiar 10,000 -- a Japanese pedometer's marketing name, as the paper
        // itself notes, and a recognisable anchor rather than a derived one.
        $this->assertSame(StepGoalCalculator::POPULATION_DEFAULT, $this->calculator->dailyGoal(null));
        $this->assertSame(10000, $this->calculator->dailyGoal(null));
    }

    // --- Slice B: the median itself ---

    // O
    public function test_should_take_the_middle_value_of_an_odd_length_week(): void
    {
        $this->assertSame(6000, $this->calculator->medianDailySteps([3000, 4000, 5000, 6000, 7000, 8000, 26000]));
    }

    // M
    public function test_should_not_let_one_extraordinary_day_move_the_median(): void
    {
        // A 26,000-step wedding, or a day the watch sat on a charger, would drag a mean
        // far enough to set next week's goal wrongly. The median does not notice.
        $typical = [6000, 6200, 6400, 6600, 6800, 7000, 7200];
        $withOutlier = [6000, 6200, 6400, 6600, 6800, 7000, 40000];

        $this->assertSame(
            $this->calculator->medianDailySteps($typical),
            $this->calculator->medianDailySteps($withOutlier),
        );
    }

    // B
    public function test_should_average_the_middle_pair_of_an_even_length_window(): void
    {
        $this->assertSame(6500, $this->calculator->medianDailySteps([5000, 6000, 6000, 7000, 7000, 8000, 9000, 4000]));
    }

    // --- Slice C: the next band up ---

    // O
    public function test_should_ask_a_sedentary_walker_for_the_next_boundary_not_for_ten_thousand(): void
    {
        // 4,200 is sedentary. 10,000 handed to them is a number they miss every day until
        // they stop looking at it; 5,000 is the boundary that changes their class.
        $this->assertSame(5000, $this->calculator->dailyGoal(4200));
    }

    // M
    public function test_should_walk_a_user_up_the_published_bands_one_at_a_time(): void
    {
        $this->assertSame(7500, $this->calculator->dailyGoal(6000));
        $this->assertSame(10000, $this->calculator->dailyGoal(9800));
        $this->assertSame(12500, $this->calculator->dailyGoal(11000));
    }

    // B
    public function test_should_treat_a_median_sitting_exactly_on_a_boundary_as_that_class_achieved(): void
    {
        // Reaching 7,500 is being low active no longer; the goal is the boundary above.
        $this->assertSame(10000, $this->calculator->dailyGoal(7500));
    }

    // E
    public function test_should_hold_at_the_top_band_rather_than_climbing_forever(): void
    {
        // The paper's classification stops at highly active. A goal beyond it would be
        // extrapolating past the evidence rather than reading it.
        $this->assertSame(12500, $this->calculator->dailyGoal(20000));
    }

    // S
    public function test_should_derive_a_goal_from_a_full_measured_week(): void
    {
        $week = [7800, 8100, 6900, 9200, 8400, 5100, 8000];

        $median = $this->calculator->medianDailySteps($week);

        $this->assertSame(8000, $median);
        $this->assertSame(10000, $this->calculator->dailyGoal($median));
    }
}
