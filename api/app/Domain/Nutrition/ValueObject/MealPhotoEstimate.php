<?php

namespace App\Domain\Nutrition\ValueObject;

use App\Domain\Nutrition\Exception\UnreadableMealPhotoException;

/**
 * What a vision model thinks is on a plate, and how much of a guess that is.
 *
 * Totals are summed here rather than read from the model's own total field. Asking for
 * both invites the two to disagree, and once they do there is no way to tell which one the
 * user is editing when they change a number. One source, derived.
 */
final class MealPhotoEstimate
{
    /** The model's own words for how sure it is. Anything else is read as the lowest. */
    public const CONFIDENCE_LOW = 'low';

    public const CONFIDENCE_MEDIUM = 'medium';

    public const CONFIDENCE_HIGH = 'high';

    /**
     * Matches the ceiling StoreMealRequest enforces. An estimate the save endpoint would
     * reject is worse than no estimate: the user edits a plausible-looking screen and then
     * hits a validation error they cannot explain.
     */
    public const MAX_TOTAL_KCAL = 8000;

    /** @param  list<EstimatedFoodItem>  $items */
    public function __construct(
        public readonly array $items,
        public readonly string $confidence,
    ) {
        if ($items === []) {
            throw new UnreadableMealPhotoException('No food was recognised in the photo.');
        }

        if ($this->totalKcal() > self::MAX_TOTAL_KCAL) {
            throw new UnreadableMealPhotoException('The recognised total is not a plausible meal.');
        }
    }

    public function totalKcal(): int
    {
        return array_sum(array_map(static fn (EstimatedFoodItem $item): int => $item->kcal, $this->items));
    }

    /**
     * Null when no item carried the macro.
     *
     * A partial answer is summed over the items that had one, which slightly understates
     * the total — but the alternative is treating silence as zero, and the client already
     * shows every one of these figures as an estimate.
     */
    public function totalProteinG(): ?int
    {
        return $this->sumOf('proteinG');
    }

    public function totalCarbsG(): ?int
    {
        return $this->sumOf('carbsG');
    }

    public function totalFatG(): ?int
    {
        return $this->sumOf('fatG');
    }

    /** Cut to the length the meal name column accepts, on a word boundary where possible. */
    public function suggestedName(int $maxLength = 120): string
    {
        $joined = implode(', ', array_map(
            static fn (EstimatedFoodItem $item): string => $item->name,
            $this->items,
        ));

        if (mb_strlen($joined) <= $maxLength) {
            return $joined;
        }

        $cut = mb_substr($joined, 0, $maxLength - 1);
        $lastSpace = mb_strrpos($cut, ' ');

        return rtrim($lastSpace === false ? $cut : mb_substr($cut, 0, $lastSpace), ' ,').'…';
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'items' => array_map(static fn (EstimatedFoodItem $item): array => $item->toArray(), $this->items),
            'name' => $this->suggestedName(),
            'kcal' => $this->totalKcal(),
            'protein_g' => $this->totalProteinG(),
            'carbs_g' => $this->totalCarbsG(),
            'fat_g' => $this->totalFatG(),
            // The model's own claim about itself, passed through as that and never turned
            // into a number. A percentage here would read as measured accuracy.
            'confidence' => $this->confidence,
        ];
    }

    private function sumOf(string $property): ?int
    {
        $values = array_filter(
            array_map(static fn (EstimatedFoodItem $item) => $item->{$property}, $this->items),
            static fn (?int $value): bool => $value !== null,
        );

        return $values === [] ? null : (int) array_sum($values);
    }
}
