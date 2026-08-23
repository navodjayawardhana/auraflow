<?php

namespace App\Application\Planning\UseCase;

use App\Application\Planning\DTO\PlanView;
use App\Domain\Planning\Repository\WellbeingPlanRepository;
use App\Domain\Wellbeing\ValueObject\UserId;

final class ListPlanHistoryUseCase
{
    /**
     * The contract's cap. A history screen shows a list; a user who has recalculated
     * four hundred times is not helped by four hundred rows, and the query has to be
     * bounded by something the client cannot raise.
     */
    public const MAX_VERSIONS = 50;

    public function __construct(private readonly WellbeingPlanRepository $plans)
    {
    }

    /**
     * @return PlanView[] newest first
     */
    public function execute(string $userId): array
    {
        return array_map(
            PlanView::fromDomain(...),
            $this->plans->history(UserId::fromString($userId), self::MAX_VERSIONS),
        );
    }
}
