<?php

namespace App\Application\Planning\UseCase;

use App\Application\Planning\DTO\PlanView;
use App\Domain\Planning\Repository\WellbeingPlanRepository;
use App\Domain\Wellbeing\ValueObject\UserId;

final class GetCurrentPlanUseCase
{
    public function __construct(private readonly WellbeingPlanRepository $plans)
    {
    }

    /** Null until something has derived one. A read does not write. */
    public function execute(string $userId): ?PlanView
    {
        $plan = $this->plans->findCurrent(UserId::fromString($userId));

        return $plan === null ? null : PlanView::fromDomain($plan);
    }
}
