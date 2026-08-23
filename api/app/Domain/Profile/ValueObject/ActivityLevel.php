<?php

namespace App\Domain\Profile\ValueObject;

/**
 * How much the person moves, as they describe it themselves.
 *
 * Self-reported, and treated as such: the factor it maps to multiplies a whole day's
 * energy estimate, so the five labels are pinned to a published table rather than to the
 * gym-calculator set (1.2 / 1.375 / 1.55 / 1.725 / 1.9) that circulates without a source.
 */
enum ActivityLevel: string
{
    case Sedentary = 'sedentary';
    case Light = 'light';
    case Moderate = 'moderate';
    case Active = 'active';
    case VeryActive = 'very_active';

    /**
     * The conservative reading of "we were never told".
     *
     * Sedentary rather than moderate, because this factor only ever inflates an energy
     * figure: assuming the lowest band means an unfilled profile cannot hand someone a
     * calorie target larger than their life justifies.
     */
    public const DEFAULT = self::Sedentary;

    /**
     * Physical activity level (PAL) -- the multiple of BMR that a day's total energy
     * expenditure comes to.
     *
     * FAO/WHO/UNU Expert Consultation. "Human energy requirements." FAO Food and
     * Nutrition Technical Report Series 1, Rome, 2004, Table 5.1, which gives three
     * lifestyle bands: sedentary or light activity 1.40-1.69, moderately active or
     * active 1.70-1.99, vigorously active 2.00-2.40.
     *
     * Five labels against three bands, so the mapping is stated rather than implied:
     * Sedentary takes the band floor, Light and Moderate the midpoints of the first two
     * bands, Active the floor of the third and VeryActive its midpoint. Every value is a
     * boundary or a midpoint of that table; none was chosen to make a number look right.
     */
    public function physicalActivityLevel(): float
    {
        return match ($this) {
            self::Sedentary => 1.40,
            self::Light => 1.55,
            self::Moderate => 1.85,
            self::Active => 2.00,
            self::VeryActive => 2.20,
        };
    }
}
