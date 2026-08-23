<?php

namespace App\Domain\Movement\Repository;

use App\Domain\Movement\ValueObject\CompletedSession;
use App\Domain\Nutrition\ValueObject\DateRange;

/**
 * Sessions as anything outside the movement screen wants them: plain values over a span.
 *
 * The sessions endpoint reaches for Eloquent directly, which is defensible in a controller
 * that also renders fields the domain has no opinion about. A use case cannot, so the read
 * it needs is declared here and satisfied in Infrastructure, the same way `LoggedMeal` is.
 */
interface CompletedSessionRepository
{
    /**
     * One user's sessions over an inclusive span of days, newest first.
     *
     * Newest first and capped, unlike the meal read beside it, because the only caller is
     * building a bounded summary rather than a total: a user who trains four times a day
     * must not be able to push the rest of the grounding pack out of the prompt.
     *
     * @return list<CompletedSession>
     */
    public function findForUserInRange(string $userId, DateRange $range, int $limit): array;
}
