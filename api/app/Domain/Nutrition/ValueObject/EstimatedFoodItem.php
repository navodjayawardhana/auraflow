<?php

namespace App\Domain\Nutrition\ValueObject;

/**
 * One thing the model claims to see on the plate.
 *
 * Macros are nullable rather than zero-filled. "No fat" and "the model did not say" are
 * different statements, and a zero would let the second be added up as if it were the
 * first.
 */
final class EstimatedFoodItem
{
    public function __construct(
        public readonly string $name,
        public readonly int $kcal,
        public readonly ?int $proteinG,
        public readonly ?int $carbsG,
        public readonly ?int $fatG,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'name' => $this->name,
            'kcal' => $this->kcal,
            'protein_g' => $this->proteinG,
            'carbs_g' => $this->carbsG,
            'fat_g' => $this->fatG,
        ];
    }
}
