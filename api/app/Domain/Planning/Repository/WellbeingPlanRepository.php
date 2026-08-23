<?php

namespace App\Domain\Planning\Repository;

use App\Domain\Planning\Model\WellbeingPlan;
use App\Domain\Wellbeing\ValueObject\UserId;

interface WellbeingPlanRepository
{
    /** The newest version, or null when the user has never had a plan derived. */
    public function findCurrent(UserId $userId): ?WellbeingPlan;

    /**
     * Every version, newest first.
     *
     * Capped by the caller rather than unbounded: a plan that recalculates on each
     * profile edit accumulates versions, and the history screen shows a list, not an
     * archive.
     *
     * @return WellbeingPlan[]
     */
    public function history(UserId $userId, int $limit): array;

    /**
     * The version a given client-supplied edit produced, if it has already been applied.
     *
     * This is the offline outbox's safety net. Content comparison alone catches the
     * common replay -- the same body arriving twice in a row -- but not one that arrives
     * after a later edit has moved the values on, where the retry would otherwise read as
     * a genuine change back. The key makes the two distinguishable.
     */
    public function findByClientUuid(UserId $userId, string $clientUuid): ?WellbeingPlan;

    public function save(WellbeingPlan $plan): void;
}
