<?php

namespace App\Domain\Nutrition\ValueObject;

/**
 * Where a calorie figure came from, and therefore how much weight it can carry.
 *
 * The cases carry the strings stored in `meal_entries.source`, and `MealEntry`'s constants
 * are defined from them — one spelling of each, so the two cannot drift apart.
 *
 * Only a lookup is measured, and even then it is measured by someone else: a
 * manufacturer's declaration read out of a food database. Everything else is a guess,
 * whether a person typed it or a vision model produced it from a photograph. Totals carry
 * that split rather than one confident sum, which is the whole reason this is an enum with
 * a question on it instead of a bare string.
 */
enum MealSource: string
{
    case Lookup = 'lookup';

    case Estimate = 'estimate';

    case Photo = 'photo';

    /**
     * Reads a stored value, falling back to the weakest claim.
     *
     * A row whose `source` no build recognises — written by a client ahead of this one, or
     * by a migration since renamed — must not be counted as measured. Falling back to
     * Estimate can only ever understate confidence, which is the safe direction to be
     * wrong in.
     */
    public static function fromStored(?string $value): self
    {
        return self::tryFrom((string) $value) ?? self::Estimate;
    }

    /** True only for a figure someone other than the user put a number on. */
    public function isMeasured(): bool
    {
        return $this === self::Lookup;
    }
}
