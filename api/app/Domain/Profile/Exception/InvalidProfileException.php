<?php

namespace App\Domain\Profile\Exception;

use DomainException;

final class InvalidProfileException extends DomainException
{
    public static function heightOutOfRange(int $heightCm): self
    {
        return new self(sprintf('A height of %d cm is not a height a person has.', $heightCm));
    }

    public static function weightOutOfRange(float $weightKg): self
    {
        return new self(sprintf('A mass of %.1f kg is not a mass a person has.', $weightKg));
    }
}
