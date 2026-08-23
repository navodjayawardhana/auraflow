<?php

namespace App\Application\Planning\DTO;

use App\Domain\Planning\Model\WellbeingPlan;

/**
 * What leaves the application layer for the plan and history screens.
 *
 * `basis` is part of the payload rather than beside it, because the contract treats the
 * explanation as product: a goal without its provenance is the thing this phase set out
 * not to ship.
 */
final class PlanView
{
    private function __construct(
        public readonly int $version,
        public readonly string $source,
        public readonly int $stepGoal,
        public readonly int $waterMl,
        public readonly ?int $activeKcalGoal,
        public readonly float $sleepNeedHours,
        public readonly ?array $hrZones,
        public readonly array $basis,
        public readonly array $editedFields,
        public readonly ?string $createdAt,
    ) {
    }

    public static function fromDomain(WellbeingPlan $plan): self
    {
        return new self(
            $plan->version(),
            $plan->source()->value,
            $plan->stepGoal(),
            $plan->waterMl(),
            $plan->activeKcalGoal(),
            $plan->sleepNeedHours(),
            $plan->heartRateZones()?->toArray(),
            $plan->basis()->toArray(),
            $plan->editedFields(),
            $plan->createdAt()?->format(DATE_ATOM),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'version' => $this->version,
            'source' => $this->source,
            'step_goal' => $this->stepGoal,
            'water_ml' => $this->waterMl,
            'active_kcal_goal' => $this->activeKcalGoal,
            'sleep_need_hours' => $this->sleepNeedHours,
            'hr_zones' => $this->hrZones,
            'basis' => $this->basis,
            'edited_fields' => $this->editedFields,
            'created_at' => $this->createdAt,
        ];
    }
}
