<?php

namespace App\Domain\Profile\ValueObject;

/**
 * Which population's BMI cut-offs a band was read against.
 *
 * Two scales exist because one set of numbers does not fit both. The WHO expert
 * consultation found Asian populations carry a higher proportion of body fat and a
 * higher cardiometabolic risk at the same BMI as European populations, and identified
 * public-health action points at 23.0 and 27.5 rather than 25 and 30.
 *
 * WHO Expert Consultation. "Appropriate body-mass index for Asian populations and its
 * implications for policy and intervention strategies." Lancet. 2004;363(9403):157-163.
 *
 * The consultation deliberately did not replace the international classification, which
 * is why both scales are reported rather than one silently swapped for the other. What
 * would be an error is showing only the European scale to users in Sri Lanka: a BMI of
 * 24 reads as "healthy" there and as "overweight, act now" on the scale written for this
 * population.
 */
enum BmiScale: string
{
    case WhoStandard = 'who_standard';
    case WhoAsian = 'who_asian';

    /**
     * The scale the app leads with. Asian, because that is where its users are; the
     * standard bands are reported alongside so the choice is visible rather than tacit.
     */
    public const DEFAULT = self::WhoAsian;

    /**
     * Lower bounds of the overweight and obese bands, in kg/m².
     *
     * Underweight sits below 18.5 on both scales -- the consultation kept that boundary.
     *
     * @return array{overweight: float, obese: float}
     */
    public function upperBands(): array
    {
        return match ($this) {
            self::WhoStandard => ['overweight' => 25.0, 'obese' => 30.0],
            self::WhoAsian => ['overweight' => 23.0, 'obese' => 27.5],
        };
    }
}
