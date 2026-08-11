<?php

namespace App\Domain\Wellbeing\Exception;

use DomainException;

final class InvalidRecoveryScoreException extends DomainException
{
    public static function outOfRange(float $value): self
    {
        return new self(sprintf('Recovery score must be between 0 and 100, got %s.', var_export($value, true)));
    }

    public static function incomparable(): self
    {
        return new self(
            'A provisional recovery score cannot be compared against an established one: '
            .'they are different measurements sharing a scale.'
        );
    }
}
