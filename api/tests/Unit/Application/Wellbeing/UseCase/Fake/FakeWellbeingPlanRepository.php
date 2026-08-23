<?php

namespace Tests\Unit\Application\Wellbeing\UseCase\Fake;

use App\Domain\Planning\Model\WellbeingPlan;
use App\Domain\Planning\Repository\WellbeingPlanRepository;
use App\Domain\Wellbeing\ValueObject\UserId;

/**
 * In-memory plans, so a use-case test can prove the recovery score reads a personal
 * sleep need without a database or a derivation behind it.
 */
final class FakeWellbeingPlanRepository implements WellbeingPlanRepository
{
    /** @var WellbeingPlan[] */
    private array $plans = [];

    public function add(WellbeingPlan $plan): void
    {
        $this->plans[] = $plan;
    }

    public function findCurrent(UserId $userId): ?WellbeingPlan
    {
        $mine = array_values(array_filter(
            $this->plans,
            static fn (WellbeingPlan $plan) => $plan->userId()->equals($userId),
        ));

        usort($mine, static fn (WellbeingPlan $a, WellbeingPlan $b) => $b->version() <=> $a->version());

        return $mine[0] ?? null;
    }

    public function history(UserId $userId, int $limit): array
    {
        $mine = array_values(array_filter(
            $this->plans,
            static fn (WellbeingPlan $plan) => $plan->userId()->equals($userId),
        ));

        usort($mine, static fn (WellbeingPlan $a, WellbeingPlan $b) => $b->version() <=> $a->version());

        return array_slice($mine, 0, $limit);
    }

    public function findByClientUuid(UserId $userId, string $clientUuid): ?WellbeingPlan
    {
        foreach ($this->plans as $plan) {
            if ($plan->userId()->equals($userId) && $plan->clientUuid() === $clientUuid) {
                return $plan;
            }
        }

        return null;
    }

    public function save(WellbeingPlan $plan): void
    {
        $this->plans[] = $plan;
    }
}
