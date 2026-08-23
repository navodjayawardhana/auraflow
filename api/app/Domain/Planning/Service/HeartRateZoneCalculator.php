<?php

namespace App\Domain\Planning\Service;

use App\Domain\Planning\ValueObject\HeartRateZones;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;

/**
 * Training zones, in the user's own beats per minute.
 *
 * This is the one place in the phase where the app has something a lookup table cannot
 * have: fourteen days of the person's own resting heart rate, already computed for the
 * recovery score. Karvonen's method is built around heart-rate *reserve* -- the span
 * between rest and maximum -- so feeding it a measured resting rate is not a refinement,
 * it is the input the method was designed for. A resting-48 runner and a resting-78
 * beginner of the same age get genuinely different zones, and a population table gives
 * them the same ones.
 *
 * Three published pieces, kept separate so each can be checked against its source:
 *
 *   Maximum   Tanaka H, Monahan KD, Seals DR. "Age-predicted maximal heart rate
 *             revisited." J Am Coll Cardiol. 2001;37(1):153-156.  HRmax = 208 − 0.7 × age
 *   Zones     Karvonen MJ, Kentala E, Mustala O. "The effects of training on heart rate:
 *             a longitudinal study." Ann Med Exp Biol Fenn. 1957;35(3):307-315.
 *             target = (HRmax − HRrest) × intensity + HRrest
 *   Bands     ACSM's Guidelines for Exercise Testing and Prescription, 10th ed., Table
 *             5.2: light 30-39% HRR, moderate 40-59% HRR, vigorous 60-89% HRR.
 *
 * Not `220 − age`. That figure has no published derivation, and Tanaka's paper exists
 * precisely because it underestimates maximum in older adults badly enough to prescribe
 * the wrong intensity to the people most likely to be harmed by it.
 */
final class HeartRateZoneCalculator
{
    /** Tanaka. */
    private const TANAKA_INTERCEPT = 208.0;
    private const TANAKA_SLOPE_PER_YEAR = 0.7;

    /**
     * ACSM heart-rate-reserve bands, as fractions. The app's three labels map onto the
     * three bands an adult trains in; ACSM's "very light" (<30%) and "near maximal"
     * (>=90%) are omitted because neither is a target anyone is given.
     */
    private const BANDS = [
        'easy' => [0.30, 0.39],
        'moderate' => [0.40, 0.59],
        'hard' => [0.60, 0.89],
    ];

    /**
     * Resting heart rate for someone the app has not measured for long enough.
     *
     * 72 bpm: the mean resting pulse rate for US adults, which plateaus at that value in
     * adulthood. Ostchega Y, Porter KS, Hughes J, Dillon CF, Nwankwo T. "Resting pulse
     * rate reference data for children, adolescents, and adults: United States,
     * 1999-2008." National Health Statistics Reports no. 41. Hyattsville, MD: National
     * Center for Health Statistics; 2011.
     *
     * Used only as a stated fallback. Which of the two answered is reported in
     * `basis.resting_hr_source`, because zones built on a population mean and zones built
     * on a fortnight of the user's own nights are not the same claim.
     */
    public const POPULATION_RESTING_BPM = 72;

    /**
     * Age-predicted maximum heart rate. Null without an age -- there is no population
     * substitute for the one term the equation takes.
     */
    public function maximumHeartRate(?int $ageYears): ?float
    {
        if ($ageYears === null) {
            return null;
        }

        return round(self::TANAKA_INTERCEPT - self::TANAKA_SLOPE_PER_YEAR * $ageYears, 1);
    }

    /**
     * A single Karvonen target: the given fraction of the heart-rate reserve, added back
     * onto the resting rate.
     */
    public function karvonenTarget(float $maximumBpm, float $restingBpm, float $intensity): float
    {
        return ($maximumBpm - $restingBpm) * $intensity + $restingBpm;
    }

    /**
     * The three bands, or null when there is no age to predict a maximum from.
     *
     * `$measured` is the same 14-day baseline the recovery score's autonomic component
     * uses. Passing null is the cold-start path and drops to the population mean; the
     * caller reports which happened.
     */
    public function zonesFor(?int $ageYears, ?RestingHeartRateBaseline $measured): ?HeartRateZones
    {
        $maximum = $this->maximumHeartRate($ageYears);

        if ($maximum === null) {
            return null;
        }

        $resting = $measured?->mean() ?? (float) self::POPULATION_RESTING_BPM;

        $band = fn (array $range): array => [
            (int) round($this->karvonenTarget($maximum, $resting, $range[0])),
            (int) round($this->karvonenTarget($maximum, $resting, $range[1])),
        ];

        return new HeartRateZones(
            $band(self::BANDS['easy']),
            $band(self::BANDS['moderate']),
            $band(self::BANDS['hard']),
            (int) round($resting),
            (int) round($maximum),
        );
    }
}
