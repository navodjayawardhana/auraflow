<?php

namespace Tests\Unit\Domain\Planning\Service;

use App\Domain\Planning\Service\SleepNeedCalculator;
use PHPUnit\Framework\TestCase;

/**
 * Hirshkowitz M, Whiton K, Albert SM, et al. "National Sleep Foundation's sleep time
 * duration recommendations: methodology and results summary." Sleep Health.
 * 2015;1(1):40-43. Teenagers 8-10 h, young adults and adults 7-9 h, older adults 7-8 h.
 */
class SleepNeedCalculatorTest extends TestCase
{
    private SleepNeedCalculator $calculator;

    protected function setUp(): void
    {
        $this->calculator = new SleepNeedCalculator();
    }

    // --- Slice A: no age ---

    // Z
    public function test_should_fall_back_to_the_value_the_app_already_used_for_everyone(): void
    {
        // 8.0 is both the adult midpoint and the calculator's existing constant, so a
        // profile without a date of birth is scored exactly as it was before this phase.
        $this->assertSame(SleepNeedCalculator::POPULATION_DEFAULT_HOURS, $this->calculator->needHours(null));
        $this->assertSame(8.0, $this->calculator->needHours(null));
    }

    // Z
    public function test_should_publish_no_range_without_an_age(): void
    {
        $this->assertNull($this->calculator->recommendedRange(null));
    }

    // --- Slice B: the published bands ---

    // O
    public function test_should_give_a_teenager_the_eight_to_ten_hour_band(): void
    {
        $this->assertSame([8.0, 10.0], $this->calculator->recommendedRange(16));
        $this->assertSame(9.0, $this->calculator->needHours(16));
    }

    // M
    public function test_should_give_young_adults_and_adults_the_seven_to_nine_hour_band(): void
    {
        $this->assertSame([7.0, 9.0], $this->calculator->recommendedRange(22));
        $this->assertSame([7.0, 9.0], $this->calculator->recommendedRange(45));
        $this->assertSame(8.0, $this->calculator->needHours(45));
    }

    // O
    public function test_should_give_an_older_adult_the_seven_to_eight_hour_band(): void
    {
        // The band that made the wiring worth doing: a 68-year-old was being scored
        // against 8.0 hours, half an hour above what the guidance says they need.
        $this->assertSame([7.0, 8.0], $this->calculator->recommendedRange(68));
        $this->assertSame(7.5, $this->calculator->needHours(68));
    }

    // --- Slice C: the boundaries ---

    // B
    public function test_should_move_bands_on_the_published_ages_and_not_a_year_either_side(): void
    {
        $this->assertSame(9.0, $this->calculator->needHours(17));
        $this->assertSame(8.0, $this->calculator->needHours(18));

        $this->assertSame(8.0, $this->calculator->needHours(64));
        $this->assertSame(7.5, $this->calculator->needHours(65));
    }

    // E
    public function test_should_publish_no_range_below_the_youngest_band_it_models(): void
    {
        // Nothing in this app is built for children, and a band that cannot be reached is
        // a band that cannot be tested. The need still resolves, to the default.
        $this->assertNull($this->calculator->recommendedRange(9));
        $this->assertSame(8.0, $this->calculator->needHours(9));
    }

    // S
    public function test_should_always_return_a_need_inside_its_own_published_range(): void
    {
        foreach ([15, 20, 40, 64, 70, 95] as $age) {
            $range = $this->calculator->recommendedRange($age);
            $need = $this->calculator->needHours($age);

            $this->assertGreaterThanOrEqual($range[0], $need);
            $this->assertLessThanOrEqual($range[1], $need);
        }
    }
}
