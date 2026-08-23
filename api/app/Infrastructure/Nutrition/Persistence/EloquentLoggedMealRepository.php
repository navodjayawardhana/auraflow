<?php

namespace App\Infrastructure\Nutrition\Persistence;

use App\Domain\Nutrition\Repository\LoggedMealRepository;
use App\Domain\Nutrition\ValueObject\DateRange;
use App\Models\MealEntry;

final class EloquentLoggedMealRepository implements LoggedMealRepository
{
    public function findForUserInRange(string $userId, DateRange $range): array
    {
        // The same scope the meals endpoint reads through, rather than a second where
        // clause that agrees with it today. Its docblock records why both bounds carry a
        // time -- a bare `<= '2026-08-23'` drops the last day of every range under SQLite
        // while passing under MySQL, which is the sort of bug that only shows in a demo.
        return MealEntry::query()
            ->forUserBetween((int) $userId, $range->fromIso(), $range->toIso())
            ->get()
            ->map(fn (MealEntry $meal) => $meal->toLoggedMeal())
            ->all();
    }
}
