<?php

namespace App\Application\Planning\UseCase;

use App\Application\Planning\DTO\PlanView;
use App\Domain\Planning\Repository\WellbeingPlanRepository;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * The user's own numbers, in place of the derived ones.
 *
 * Safe to replay, which is what lets the mobile outbox queue a plan edit offline
 * alongside everything else. Two independent guards, because they fail in different
 * places:
 *
 *   - A client-supplied `client_uuid` names the edit. If a version already carries that
 *     key, that version is returned and nothing is written. This catches a retry that
 *     arrives *after* a later edit has moved the values on, which content comparison
 *     alone would read as a genuine change back.
 *   - Failing that, the aggregate compares values. A body identical to what is already
 *     current produces no version at all.
 *
 * Neither guard involves a lock. A duplicate that slips past both still meets the unique
 * index on (user_id, client_uuid).
 */
final class OverridePlanUseCase
{
    public function __construct(
        private readonly WellbeingPlanRepository $plans,
        private readonly RecalculatePlanUseCase $recalculate,
    ) {
    }

    /**
     * @param  array<string, int|float>  $overrides  keyed by WellbeingPlan::OVERRIDABLE_FIELDS
     * @param  string|null  $clientUuid  the client's own id for this edit, if it sent one
     */
    public function execute(
        string $userId,
        array $overrides,
        ?string $clientUuid = null,
        ?DateTimeImmutable $on = null,
    ): PlanView {
        $id = UserId::fromString($userId);

        if ($clientUuid !== null) {
            $alreadyApplied = $this->plans->findByClientUuid($id, $clientUuid);

            if ($alreadyApplied !== null) {
                return PlanView::fromDomain($alreadyApplied);
            }
        }

        // Editing before anything derived is a real path: a user can open the plan screen
        // on a fresh install and change the step goal. They are editing the defaults, so
        // the defaults have to exist and be recorded as version 1 -- otherwise version 1
        // is their edit and the history has nothing to show it was an edit *of*.
        $current = $this->recalculate->ensureExists($userId, $on);

        $updated = $current->overriddenWith($overrides, $clientUuid);

        if ($updated === $current) {
            return PlanView::fromDomain($current);
        }

        $this->plans->save($updated);

        return PlanView::fromDomain($this->plans->findCurrent($id) ?? $updated);
    }
}
