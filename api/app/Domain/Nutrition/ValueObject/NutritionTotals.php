<?php

namespace App\Domain\Nutrition\ValueObject;

/**
 * A sum of meals that still knows what it is made of.
 *
 * The point of this object is the split. Three barcode lookups and three typed guesses can
 * add up to the same 1,800 kcal, and reporting only that number launders the guesses into
 * a figure with the authority of a measurement. So the energy is carried three ways — the
 * total, the measured part, the estimated part — and the client is left with no way to
 * render a confident number over an uncertain sum.
 *
 * Macros are not split the same way, and that is a judgement rather than an oversight:
 * almost every row that carries a macro breakdown at all is a barcode lookup, so a split
 * would be one column repeating the other. `mealsWithMacros` against `mealCount` is the
 * honest caveat there, and it is the one the client already shows.
 */
final class NutritionTotals
{
    private function __construct(
        public readonly int $kcal,
        public readonly int $measuredKcal,
        public readonly int $estimatedKcal,
        public readonly int $mealCount,
        public readonly int $measuredCount,
        public readonly int $estimatedCount,
        public readonly int $proteinG,
        public readonly int $carbsG,
        public readonly int $fatG,
        public readonly int $mealsWithMacros,
    ) {
    }

    /** A day nobody logged. Zeroes, not nulls — the client renders "0 kcal", not "—". */
    public static function empty(): self
    {
        return new self(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }

    /** @param  iterable<LoggedMeal>  $meals */
    public static function of(iterable $meals): self
    {
        $kcal = $measuredKcal = $mealCount = $measuredCount = 0;
        $protein = $carbs = $fat = $withMacros = 0;

        foreach ($meals as $meal) {
            $mealCount++;
            $kcal += $meal->kcal;

            if ($meal->source->isMeasured()) {
                $measuredCount++;
                $measuredKcal += $meal->kcal;
            }

            // Summed over the rows that have them, which understates a day where some rows
            // do not. Treating a missing macro as zero would be the same understatement
            // wearing a confident face; `mealsWithMacros` is what says how much of the day
            // the figure actually covers.
            $protein += $meal->proteinG ?? 0;
            $carbs += $meal->carbsG ?? 0;
            $fat += $meal->fatG ?? 0;

            if ($meal->hasMacros()) {
                $withMacros++;
            }
        }

        return new self(
            kcal: $kcal,
            measuredKcal: $measuredKcal,
            estimatedKcal: $kcal - $measuredKcal,
            mealCount: $mealCount,
            measuredCount: $measuredCount,
            estimatedCount: $mealCount - $measuredCount,
            proteinG: $protein,
            carbsG: $carbs,
            fatG: $fat,
            mealsWithMacros: $withMacros,
        );
    }

    /** True when every calorie in the total came from a lookup, so no `≈` is warranted. */
    public function isWhollyMeasured(): bool
    {
        return $this->mealCount > 0 && $this->estimatedCount === 0;
    }

    public function isEmpty(): bool
    {
        return $this->mealCount === 0;
    }

    /**
     * @return array<string, int>
     */
    public function toArray(): array
    {
        return [
            'kcal' => $this->kcal,
            'measured_kcal' => $this->measuredKcal,
            'estimated_kcal' => $this->estimatedKcal,
            'meal_count' => $this->mealCount,
            'measured_count' => $this->measuredCount,
            'estimated_count' => $this->estimatedCount,
            'protein_g' => $this->proteinG,
            'carbs_g' => $this->carbsG,
            'fat_g' => $this->fatG,
            'meals_with_macros' => $this->mealsWithMacros,
        ];
    }
}
