<?php

namespace App\Domain\Advice\ValueObject;

use App\Domain\Nutrition\ValueObject\MealSource;

/**
 * One meal, named, so "what did I eat yesterday" has an answer that is not a total.
 *
 * Named meals are the widest rows in the pack — a name is a string of unbounded length
 * where everything else is an integer — so they are carried for the shortest window that
 * answers the question and the older days keep their totals only.
 */
final class RecentMeal
{
    public function __construct(
        public readonly string $date,
        public readonly string $name,
        public readonly int $kcal,
        /**
         * Travels with the figure rather than beside it.
         *
         * A barcode's 420 kcal and a photograph's 420 kcal are the same integer and
         * different claims, and the rendered line is the only place the model can learn
         * which it is holding.
         */
        public readonly MealSource $source,
    ) {
    }
}
