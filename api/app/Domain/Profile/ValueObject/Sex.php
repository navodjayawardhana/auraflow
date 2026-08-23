<?php

namespace App\Domain\Profile\ValueObject;

/**
 * Biological sex, and only because two formulas need it.
 *
 * Mifflin-St Jeor carries a sex term (+5 for men, -161 for women) and the EFSA water
 * reference values are stated per sex. Nothing else in the app asks, and nothing is
 * inferred from it beyond those two numbers.
 *
 * `Unspecified` is a first-class member rather than a null, because it has to survive
 * into the plan: a profile that declines to say does not get a BMR guessed from the
 * midpoint of the two constants -- it gets no BMR, and `sex` in `basis.missing`.
 */
enum Sex: string
{
    case Female = 'female';
    case Male = 'male';
    case Unspecified = 'unspecified';

    /**
     * The constant term of Mifflin-St Jeor, in kcal/day.
     *
     * Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. "A new predictive
     * equation for resting energy expenditure in healthy individuals." Am J Clin Nutr.
     * 1990;51(2):241-247.
     *
     * Null for Unspecified: the paper offers no term for it, and averaging the two would
     * be a coefficient this project invented.
     */
    public function mifflinStJeorConstant(): ?float
    {
        return match ($this) {
            self::Male => 5.0,
            self::Female => -161.0,
            self::Unspecified => null,
        };
    }

    /**
     * EFSA adequate intake for *total* water in millilitres per day, for adults under
     * moderate ambient temperature and moderate physical activity.
     *
     * EFSA Panel on Dietetic Products, Nutrition and Allergies. "Scientific Opinion on
     * Dietary Reference Values for water." EFSA Journal 2010;8(3):1459.
     *
     * Total water, not water drunk -- see HydrationGoalCalculator, which converts.
     */
    public function efsaTotalWaterAdequateIntakeMl(): ?int
    {
        return match ($this) {
            self::Male => 2500,
            self::Female => 2000,
            self::Unspecified => null,
        };
    }
}
