<?php

namespace App\Domain\Planning\Service;

use App\Domain\Profile\ValueObject\Sex;

/**
 * How much to drink in a day, in millilitres.
 *
 * Two published pieces, because the published guidance and the thing the app actually
 * counts are not the same quantity:
 *
 *   Need       Holliday MA, Segar WE. "The maintenance need for water in parenteral
 *              fluid therapy." Pediatrics. 1957;19(5):823-832. 100 mL/kg/day for the
 *              first 10 kg, 50 mL/kg/day for the next 10, 20 mL/kg/day thereafter.
 *   Fraction   Institute of Medicine. "Dietary Reference Intakes for Water, Potassium,
 *              Sodium, Chloride, and Sulfate." Washington DC: National Academies Press;
 *              2004. About 80% of total water intake comes from drinks, 20% from food.
 *   Fallback   EFSA Panel on Dietetic Products, Nutrition and Allergies. "Scientific
 *              Opinion on Dietary Reference Values for water." EFSA Journal
 *              2010;8(3):1459. Total water adequate intake 2.0 L/day for adult women,
 *              2.5 L/day for adult men.
 *
 * Holliday-Segar gives a *total* water need; the water tracker counts glasses. Reporting
 * the total as a drinking target would overstate it by a fifth, which is why the IOM
 * beverage fraction is applied rather than assumed away.
 *
 * The arithmetic is worth noticing: 70 kg through Holliday-Segar is 2,500 mL of total
 * water, and 80% of that is 2,000 mL -- the constant the app already ships. The mass
 * scaling does not move the reference person, it moves everyone else off them.
 *
 * Ambient temperature is *not* applied, and that is deliberate. The EFSA values are
 * explicitly stated for moderate environmental temperature, and no source consulted
 * gives a per-degree coefficient to adjust them by; inventing one would be exactly the
 * kind of number this phase exists to refuse. See `basis.water_source`.
 */
final class HydrationGoalCalculator
{
    private const FIRST_TIER_KG = 10.0;
    private const SECOND_TIER_KG = 10.0;

    private const FIRST_TIER_ML_PER_KG = 100.0;
    private const SECOND_TIER_ML_PER_KG = 50.0;
    private const REMAINDER_ML_PER_KG = 20.0;

    /** IOM: roughly four fifths of total water intake arrives as drink. */
    private const BEVERAGE_FRACTION = 0.80;

    /**
     * The app's existing constant, kept as the answer when neither mass nor sex is known.
     *
     * "Roughly eight glasses", as mobile's goals.ts puts it -- and, conveniently, the
     * figure the mass-scaled calculation returns for a 70 kg adult, so the cold-start
     * user and the reference user are told the same thing.
     */
    public const POPULATION_DEFAULT_ML = 2000;

    /** Rounded to a quarter of a 250 mL glass; the tracker cannot log finer than that. */
    private const ROUNDING_ML = 50;

    /** Total water maintenance need in mL/day for a body mass, by Holliday-Segar. */
    public function maintenanceNeedMl(float $weightKg): float
    {
        $firstTier = min($weightKg, self::FIRST_TIER_KG);
        $secondTier = max(0.0, min($weightKg - self::FIRST_TIER_KG, self::SECOND_TIER_KG));
        $remainder = max(0.0, $weightKg - self::FIRST_TIER_KG - self::SECOND_TIER_KG);

        return $firstTier * self::FIRST_TIER_ML_PER_KG
            + $secondTier * self::SECOND_TIER_ML_PER_KG
            + $remainder * self::REMAINDER_ML_PER_KG;
    }

    /**
     * What to drink, in mL/day.
     *
     * Mass first, because it is the personal number. Sex second, because EFSA's values
     * are the best available answer for a body of unknown mass. Neither, and the app's
     * own default stands.
     */
    public function dailyGoalMl(?float $weightKg, Sex $sex): int
    {
        $totalWaterMl = $weightKg !== null
            ? $this->maintenanceNeedMl($weightKg)
            : $sex->efsaTotalWaterAdequateIntakeMl();

        if ($totalWaterMl === null) {
            return self::POPULATION_DEFAULT_ML;
        }

        $drinkMl = $totalWaterMl * self::BEVERAGE_FRACTION;

        return (int) (round($drinkMl / self::ROUNDING_ML) * self::ROUNDING_ML);
    }
}
