<?php

namespace App\Domain\Wellbeing\ValueObject;

use InvalidArgumentException;

final class UserId
{
    private function __construct(private readonly string $value)
    {
    }

    public static function fromString(string $value): self
    {
        if (trim($value) === '') {
            throw new InvalidArgumentException('A user id cannot be empty.');
        }

        return new self($value);
    }

    public function toString(): string
    {
        return $this->value;
    }

    public function equals(UserId $other): bool
    {
        return $this->value === $other->value;
    }
}
