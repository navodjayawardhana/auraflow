<?php

namespace App\Domain\Nutrition\Repository;

use App\Domain\Nutrition\ValueObject\DateRange;
use App\Domain\Nutrition\ValueObject\LoggedMeal;

/**
 * Meals as the aggregator wants them: plain values over a span of days.
 *
 * The meals endpoint reaches for Eloquent directly, which is defensible in a controller
 * that also has to render rows the domain has no opinion about -- names, barcodes,
 * timestamps. A use case cannot, so the read it needs is declared here and satisfied in
 * Infrastructure like every other repository in the app.
 */
interface LoggedMealRepository
{
    /**
     * One user's meals over an inclusive span of days, oldest first.
     *
     * @return list<LoggedMeal>
     */
    public function findForUserInRange(string $userId, DateRange $range): array;
}
