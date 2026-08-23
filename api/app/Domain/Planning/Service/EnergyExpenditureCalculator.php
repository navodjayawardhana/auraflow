<?php

namespace App\Domain\Planning\Service;

use App\Domain\Profile\ValueObject\ActivityLevel;
use App\Domain\Profile\ValueObject\Sex;

/**
 * Energy: what the body spends at rest, over a day, and on moving.
 *
 * Three numbers, one chain, and each link returns null the moment the profile stops
 * supplying it. Nothing here substitutes a population value for a personal one -- a
 * calorie target is the kind of number the phase brief calls health advice, and a
 * plausible-looking BMR built from a guessed sex is exactly the estimate wearing the
 * clothes of a measurement that this project has avoided everywhere else.
 */
final class EnergyExpenditureCalculator
{
    /**
     * Mifflin-St Jeor coefficients, kcal/day per unit.
     *
     * Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. "A new predictive
     * equation for resting energy expenditure in healthy individuals." Am J Clin Nutr.
     * 1990;51(2):241-247.
     *
     * The rounded form the paper reports and clinical practice uses:
     *   men   = 10 × mass(kg) + 6.25 × height(cm) − 5 × age(y) + 5
     *   women = 10 × mass(kg) + 6.25 × height(cm) − 5 × age(y) − 161
     *
     * Chosen over Harris-Benedict on the paper's own finding: it predicted RMR within
     * 10% of measured in more subjects, obese and not, than any competing equation.
     */
    private const PER_KG = 10.0;
    private const PER_CM = 6.25;
    private const PER_YEAR = -5.0;

    /**
     * Diet-induced thermogenesis, as a fraction of total daily energy expenditure.
     *
     * About 10% of energy intake for a mixed diet -- FAO/WHO/UNU Expert Consultation,
     * "Human energy requirements", Rome 2004, §3.3; Westerterp KR, "Diet induced
     * thermogenesis", Nutr Metab (Lond). 2004;1:5.
     *
     * Subtracted because digesting food is not moving. Leave it in and a sedentary day
     * of eating reads as two hundred kilocalories of activity that never happened.
     */
    private const THERMIC_EFFECT_OF_FOOD = 0.10;

    /**
     * Basal metabolic rate in kcal/day, or null when the equation is missing a term.
     *
     * Null rather than a partial estimate: dropping the age term is not "Mifflin-St Jeor
     * without age", it is a different equation nobody validated.
     */
    public function basalMetabolicRate(?int $ageYears, Sex $sex, ?int $heightCm, ?float $weightKg): ?float
    {
        $sexConstant = $sex->mifflinStJeorConstant();

        if ($ageYears === null || $sexConstant === null || $heightCm === null || $weightKg === null) {
            return null;
        }

        return round(
            self::PER_KG * $weightKg
            + self::PER_CM * $heightCm
            + self::PER_YEAR * $ageYears
            + $sexConstant,
            1,
        );
    }

    /**
     * Total daily energy expenditure in kcal/day: BMR times the physical activity level.
     *
     * The PAL factors are the FAO/WHO/UNU lifestyle bands -- see ActivityLevel, which
     * owns that mapping because it is a property of the self-reported label rather than
     * of the arithmetic here.
     */
    public function totalDailyEnergyExpenditure(?float $basalMetabolicRate, ActivityLevel $activityLevel): ?float
    {
        if ($basalMetabolicRate === null) {
            return null;
        }

        return round($basalMetabolicRate * $activityLevel->physicalActivityLevel(), 1);
    }

    /**
     * The day's movement budget in kcal: everything above basal metabolism that is not
     * the cost of digesting the food.
     *
     * Deliberately null-able all the way out to the API. A watch that shows "0 of 400
     * active kcal" to someone who never told it their body mass is showing a target
     * derived from nothing, and the honest response to an unfillable field is an absent
     * one plus an entry in `basis.missing`.
     */
    public function activeEnergyGoal(?float $basalMetabolicRate, ?float $totalDailyEnergyExpenditure): ?int
    {
        if ($basalMetabolicRate === null || $totalDailyEnergyExpenditure === null) {
            return null;
        }

        $active = $totalDailyEnergyExpenditure
            - $basalMetabolicRate
            - self::THERMIC_EFFECT_OF_FOOD * $totalDailyEnergyExpenditure;

        // Rounded to 10 kcal. The equation's own error is in the hundreds; a goal
        // reading 387 would claim a precision the estimate does not have.
        return (int) max(0, round($active / 10) * 10);
    }
}
