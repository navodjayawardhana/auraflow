<?php

namespace Tests\Unit\Domain\Planning\Service;

use App\Domain\Planning\Service\EnergyExpenditureCalculator;
use App\Domain\Profile\ValueObject\ActivityLevel;
use App\Domain\Profile\ValueObject\Sex;
use PHPUnit\Framework\TestCase;

/**
 * Mifflin-St Jeor, and the two figures derived from it.
 *
 * The worked examples are other people's, not this implementation's. A test that only
 * agrees with the code it tests proves the arithmetic was not mistyped and nothing else;
 * these fix the equation itself against numbers published elsewhere, so a coefficient
 * quietly changed here fails against the literature rather than against a copy of itself.
 */
class EnergyExpenditureCalculatorTest extends TestCase
{
    private EnergyExpenditureCalculator $calculator;

    protected function setUp(): void
    {
        $this->calculator = new EnergyExpenditureCalculator();
    }

    // --- Slice A: no equation without every term ---

    // Z
    public function test_should_not_estimate_a_basal_rate_without_an_age(): void
    {
        $this->assertNull($this->calculator->basalMetabolicRate(null, Sex::Male, 180, 80.0));
    }

    // Z
    public function test_should_not_estimate_a_basal_rate_when_sex_is_unspecified(): void
    {
        // The paper offers no constant term for it. Averaging +5 and -161 would be a
        // coefficient this project invented, which is the one thing the phase forbids.
        $this->assertNull($this->calculator->basalMetabolicRate(30, Sex::Unspecified, 180, 80.0));
    }

    // Z
    public function test_should_not_estimate_a_basal_rate_without_a_height_or_a_mass(): void
    {
        $this->assertNull($this->calculator->basalMetabolicRate(30, Sex::Male, null, 80.0));
        $this->assertNull($this->calculator->basalMetabolicRate(30, Sex::Male, 180, null));
    }

    // --- Slice B: the published equation ---

    // O
    public function test_should_match_the_published_worked_example_for_a_man(): void
    {
        // Mifflin-St Jeor, men: 10w + 6.25h - 5a + 5.
        // 30-year-old man, 80 kg, 180 cm -> approximately 1,780 kcal/day.
        // Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. Am J Clin
        // Nutr. 1990;51(2):241-247; example as reproduced at
        // https://mifflinstjeor.com/mifflin-st-jeor-equation/
        $this->assertEqualsWithDelta(
            1780.0,
            $this->calculator->basalMetabolicRate(30, Sex::Male, 180, 80.0),
            0.5,
        );
    }

    // O
    public function test_should_match_the_published_worked_example_for_a_woman(): void
    {
        // Same source, women's constant of -161:
        // 30-year-old woman, 65 kg, 165 cm -> approximately 1,370 kcal/day.
        $this->assertEqualsWithDelta(
            1370.0,
            $this->calculator->basalMetabolicRate(30, Sex::Female, 165, 65.0),
            0.5,
        );
    }

    // M
    public function test_should_separate_the_two_sexes_by_the_published_constants(): void
    {
        // +5 against -161 is a 166 kcal/day gap at identical anthropometry -- the sex
        // term of the equation, isolated.
        $man = $this->calculator->basalMetabolicRate(40, Sex::Male, 170, 70.0);
        $woman = $this->calculator->basalMetabolicRate(40, Sex::Female, 170, 70.0);

        $this->assertEqualsWithDelta(166.0, $man - $woman, 0.001);
    }

    // B
    public function test_should_fall_by_five_kcal_for_each_year_of_age(): void
    {
        $younger = $this->calculator->basalMetabolicRate(30, Sex::Female, 165, 65.0);
        $older = $this->calculator->basalMetabolicRate(50, Sex::Female, 165, 65.0);

        $this->assertEqualsWithDelta(100.0, $younger - $older, 0.001);
    }

    // --- Slice C: total daily expenditure ---

    // I
    public function test_should_multiply_the_basal_rate_by_the_published_activity_factor(): void
    {
        // FAO/WHO/UNU 2004 Table 5.1: the sedentary/light band runs 1.40-1.69, and
        // ActivityLevel::Sedentary takes its floor.
        $tdee = $this->calculator->totalDailyEnergyExpenditure(1780.0, ActivityLevel::Sedentary);

        $this->assertEqualsWithDelta(1780.0 * 1.40, $tdee, 0.05);
    }

    // M
    public function test_should_rank_the_five_activity_levels_in_ascending_order(): void
    {
        $previous = 0.0;

        foreach (ActivityLevel::cases() as $level) {
            $factor = $level->physicalActivityLevel();
            $this->assertGreaterThan($previous, $factor);
            $previous = $factor;
        }
    }

    // B
    public function test_should_keep_every_activity_factor_inside_the_published_bands(): void
    {
        // The report's outer bounds. A factor outside them is not a lifestyle the
        // consultation described, so it would be a number of our own invention.
        foreach (ActivityLevel::cases() as $level) {
            $this->assertGreaterThanOrEqual(1.40, $level->physicalActivityLevel());
            $this->assertLessThanOrEqual(2.40, $level->physicalActivityLevel());
        }
    }

    // --- Slice D: the movement budget ---

    // Z
    public function test_should_offer_no_active_energy_goal_without_a_basal_rate(): void
    {
        // Nullable all the way out to the API on purpose: "burn 400 kcal" is health
        // advice, and there is no population value that makes it true of this person.
        $this->assertNull($this->calculator->activeEnergyGoal(null, null));
    }

    // E
    public function test_should_never_return_a_negative_active_energy_goal(): void
    {
        // A total below the basal rate cannot happen through the public path, but a
        // negative goal would render as a target to burn less than nothing.
        $this->assertSame(0, $this->calculator->activeEnergyGoal(2000.0, 1500.0));
    }

    // S
    public function test_should_leave_the_thermic_effect_of_food_out_of_the_movement_budget(): void
    {
        // BMR 1780, sedentary PAL 1.40 -> TDEE 2492. Above basal that is 712 kcal, of
        // which 10% of the total (249) is the cost of digesting the food rather than
        // moving: 463, rounded to the nearest 10.
        $goal = $this->calculator->activeEnergyGoal(1780.0, 2492.0);

        $this->assertSame(460, $goal);
    }
}
