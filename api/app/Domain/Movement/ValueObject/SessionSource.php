<?php

namespace App\Domain\Movement\ValueObject;

/**
 * Whether a session's reps were watched or assumed.
 *
 * The same distinction `MealSource` draws over calories, for the same reason: twelve reps
 * the pose model graded and twelve reps a user followed along to are not one number with
 * a footnote, they are two different claims. Anything that totals, reports or describes a
 * session has to be able to tell them apart, and `ExerciseSession`'s constants are defined
 * from these cases so the two spellings cannot drift.
 */
enum SessionSource: string
{
    /** Every rep observed and graded by the on-device pose model. */
    case Pose = 'pose';

    /** Followed along to the animated figure. The count is the prescription, not an observation. */
    case Guided = 'guided';

    /**
     * Reads a stored value, falling back to the weaker claim.
     *
     * A row whose `source` no build recognises must not be described as observed. Falling
     * back to Guided can only understate what was measured, which is the safe direction.
     */
    public static function fromStored(?string $value): self
    {
        return self::tryFrom((string) $value) ?? self::Guided;
    }

    /** True only where a model actually watched the movement happen. */
    public function wasObserved(): bool
    {
        return $this === self::Pose;
    }
}
