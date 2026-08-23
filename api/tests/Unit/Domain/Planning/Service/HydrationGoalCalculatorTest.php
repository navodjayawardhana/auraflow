<?php

namespace Tests\Unit\Domain\Planning\Service;

use App\Domain\Planning\Service\HydrationGoalCalculator;
use App\Domain\Profile\ValueObject\Sex;
use PHPUnit\Framework\TestCase;

class HydrationGoalCalculatorTest extends TestCase
{
    private HydrationGoalCalculator $calculator;

    protected function setUp(): void
    {
        $this->calculator = new HydrationGoalCalculator();
    }

    // --- Slice A: Holliday-Segar ---

    // O
    public function test_should_match_the_published_holliday_segar_worked_example(): void
    {
        // Holliday MA, Segar WE. "The maintenance need for water in parenteral fluid
        // therapy." Pediatrics. 1957;19(5):823-832. 100 mL/kg/day for the first 10 kg,
        // 50 for the next 10, 20 thereafter.
        // The textbook 25 kg example: 1000 + 500 + (5 x 20) = 1,600 mL/day.
        $this->assertEqualsWithDelta(1600.0, $this->calculator->maintenanceNeedMl(25.0), 0.001);
    }

    // O
    public function test_should_reach_two_and_a_half_litres_for_a_seventy_kilogram_adult(): void
    {
        // 1000 + 500 + (50 x 20) = 2,500 mL/day of total water.
        $this->assertEqualsWithDelta(2500.0, $this->calculator->maintenanceNeedMl(70.0), 0.001);
    }

    // B
    public function test_should_stay_inside_the_first_tier_below_ten_kilograms(): void
    {
        $this->assertEqualsWithDelta(800.0, $this->calculator->maintenanceNeedMl(8.0), 0.001);
    }

    // --- Slice B: total water is not water drunk ---

    // I
    public function test_should_return_the_apps_existing_constant_for_the_reference_adult(): void
    {
        // 2,500 mL of total water, of which the IOM puts roughly 80% in drinks:
        // 2,000 mL -- the figure mobile's goals.ts already ships. The mass scaling does
        // not move the reference person, it moves everyone else off them.
        // Institute of Medicine. "Dietary Reference Intakes for Water, Potassium, Sodium,
        // Chloride, and Sulfate." National Academies Press; 2004.
        $this->assertSame(2000, $this->calculator->dailyGoalMl(70.0, Sex::Male));
    }

    // M
    public function test_should_scale_the_goal_with_body_mass(): void
    {
        $lighter = $this->calculator->dailyGoalMl(55.0, Sex::Female);
        $heavier = $this->calculator->dailyGoalMl(95.0, Sex::Female);

        $this->assertGreaterThan($lighter, $heavier);
    }

    // I
    public function test_should_ignore_sex_once_a_body_mass_is_known(): void
    {
        // Mass is the personal number; the EFSA values are a stand-in for a body whose
        // mass is unknown. Once there is a mass, the stand-in has nothing to add.
        $this->assertSame(
            $this->calculator->dailyGoalMl(68.0, Sex::Male),
            $this->calculator->dailyGoalMl(68.0, Sex::Female),
        );
    }

    // --- Slice C: falling back ---

    // O
    public function test_should_fall_back_to_the_efsa_reference_intake_when_only_sex_is_known(): void
    {
        // EFSA Journal 2010;8(3):1459: total water adequate intake 2.0 L/day for adult
        // women and 2.5 L/day for adult men, at 80% from drinks.
        $this->assertSame(1600, $this->calculator->dailyGoalMl(null, Sex::Female));
        $this->assertSame(2000, $this->calculator->dailyGoalMl(null, Sex::Male));
    }

    // Z
    public function test_should_fall_back_to_the_apps_own_constant_when_nothing_is_known(): void
    {
        $this->assertSame(
            HydrationGoalCalculator::POPULATION_DEFAULT_ML,
            $this->calculator->dailyGoalMl(null, Sex::Unspecified),
        );
        $this->assertSame(2000, $this->calculator->dailyGoalMl(null, Sex::Unspecified));
    }

    // S
    public function test_should_round_to_something_the_tracker_can_actually_log(): void
    {
        // A goal of 2,347 mL implies a precision neither the equation nor a 250 mL glass
        // has. Every answer lands on a 50 mL step.
        foreach ([42.0, 57.3, 63.8, 81.5, 104.2] as $mass) {
            $this->assertSame(0, $this->calculator->dailyGoalMl($mass, Sex::Female) % 50);
        }
    }
}
