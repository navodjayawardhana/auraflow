<?php

namespace App\Domain\Auth\Exception;

use App\Domain\Auth\ValueObject\ResetCode;
use DomainException;

final class InvalidResetCodeException extends DomainException
{
    public static function malformed(): self
    {
        return new self(sprintf(
            'A reset code is exactly %d digits.',
            ResetCode::LENGTH,
        ));
    }
}
