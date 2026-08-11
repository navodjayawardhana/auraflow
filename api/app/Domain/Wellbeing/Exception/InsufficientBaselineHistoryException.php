<?php

namespace App\Domain\Wellbeing\Exception;

use DomainException;

/**
 * Not an error condition so much as the cold-start path: a new user simply has not worn
 * the device long enough yet. Callers are expected to catch this and fall back to a
 * provisional score rather than surfacing a failure.
 */
final class InsufficientBaselineHistoryException extends DomainException
{
    public static function needsMoreDays(int $available, int $required): self
    {
        return new self(sprintf(
            'A personal resting-heart-rate baseline needs %d prior days, %d available.',
            $required,
            $available,
        ));
    }
}
