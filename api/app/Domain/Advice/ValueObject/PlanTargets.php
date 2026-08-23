<?php

namespace App\Domain\Advice\ValueObject;

/**
 * The targets the day's figures are measured against, and where each came from.
 *
 * Without these the assistant can say what someone did and not whether it was enough,
 * which is most of what anyone asks. With them and without their provenance it would say
 * "your target is 7,500 steps" about a population default that has nothing to do with
 * this person — the plan carries a `basis` precisely so that a goal is never shown
 * without its reason, and that rule does not stop applying because the reader is a model.
 *
 * Two of the five are nullable and stay nullable: an active-kilocalorie goal and a
 * heart-rate range both need profile fields a user may not have given, and there is no
 * population substitute that would not amount to prescribing for somebody else.
 */
final class PlanTargets
{
    /**
     * @param  string  $stepGoalSource      one of PlanSource's provenance strings
     * @param  string  $waterSource         as above
     * @param  string  $sleepNeedSource     as above
     * @param  string[]  $missingFromProfile fields whose absence degraded the plan
     */
    public function __construct(
        public readonly int $stepGoal,
        public readonly int $waterMl,
        public readonly float $sleepNeedHours,
        public readonly ?int $activeKcalGoal,
        public readonly ?string $heartRateZoneSummary,
        public readonly string $stepGoalSource,
        public readonly string $waterSource,
        public readonly string $sleepNeedSource,
        public readonly array $missingFromProfile = [],
    ) {
    }
}
