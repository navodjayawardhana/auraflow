<?php

namespace App\Domain\Planning\ValueObject;

/**
 * Why every number in the plan is the number it is.
 *
 * Rendered by the app, not logged: a step goal of 7,500 with "your seven-day median is
 * 6,940" beside it is a different product from a step goal of 7,500 on its own. The
 * phase brief calls this the honesty rule and it is the reason the whole object exists.
 *
 * `missing` is the other half of the same idea. It lists the profile fields that would
 * have changed an answer and were not there, which is what lets the app ask for a date
 * of birth at the moment the user can see what withholding it costs them.
 */
final class PlanBasis
{
    /**
     * @param  string[]  $missing  profile fields whose absence degraded the plan
     * @param  array{float, float}|null  $sleepNeedRange  the NSF band, as published
     */
    public function __construct(
        public readonly ?float $bmrKcal,
        public readonly ?float $tdeeKcal,
        public readonly ?float $activityFactor,
        public readonly ?int $maxHrBpm,
        public readonly ?int $restingHrBpm,
        public readonly ?string $restingHrSource,
        public readonly string $stepGoalSource,
        public readonly string $waterSource,
        public readonly string $sleepNeedSource,
        public readonly ?array $sleepNeedRange,
        public readonly array $missing,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'bmr_kcal' => $this->bmrKcal,
            'tdee_kcal' => $this->tdeeKcal,
            // Named rather than described. A client showing "Mifflin-St Jeor" can link
            // the paper; a client shown "estimated" cannot show anything.
            'bmr_formula' => $this->bmrKcal === null ? null : 'mifflin_st_jeor',
            'max_hr_formula' => $this->maxHrBpm === null ? null : 'tanaka',
            'hr_zone_formula' => $this->maxHrBpm === null ? null : 'karvonen',
            'activity_factor' => $this->activityFactor,
            'max_hr_bpm' => $this->maxHrBpm,
            'resting_hr_bpm' => $this->restingHrBpm,
            'resting_hr_source' => $this->restingHrSource,
            'step_goal_source' => $this->stepGoalSource,
            'water_source' => $this->waterSource,
            'sleep_need_source' => $this->sleepNeedSource,
            'sleep_need_range' => $this->sleepNeedRange,
            'missing' => $this->missing,
        ];
    }

    /**
     * @param  array<string, mixed>  $stored
     */
    public static function fromArray(array $stored): self
    {
        return new self(
            $stored['bmr_kcal'] ?? null,
            $stored['tdee_kcal'] ?? null,
            $stored['activity_factor'] ?? null,
            $stored['max_hr_bpm'] ?? null,
            $stored['resting_hr_bpm'] ?? null,
            $stored['resting_hr_source'] ?? null,
            $stored['step_goal_source'] ?? PlanSource::POPULATION_DEFAULT,
            $stored['water_source'] ?? PlanSource::POPULATION_DEFAULT,
            $stored['sleep_need_source'] ?? PlanSource::POPULATION_DEFAULT,
            // Cast back to float explicitly. The scalar fields are coerced by the typed
            // constructor parameters, but an array is not: JSON stores 7.0 as `7` and a
            // restored [7, 9] would never compare identical to a freshly derived
            // [7.0, 9.0]. hasSameContentAs would then see a change on every
            // recalculation and version the plan for a difference nobody made.
            isset($stored['sleep_need_range'])
                ? array_map(floatval(...), $stored['sleep_need_range'])
                : null,
            $stored['missing'] ?? [],
        );
    }
}
