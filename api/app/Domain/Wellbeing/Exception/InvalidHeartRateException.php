<?php

namespace App\Domain\Wellbeing\Exception;

use DomainException;

final class InvalidHeartRateException extends DomainException
{
    public static function outOfRange(float $bpm): self
    {
        return new self(sprintf(
            'Resting heart rate %s is outside the plausible range. Note that exports use 0 for '
            .'"no estimate available", which must be treated as missing rather than as a reading.',
            var_export($bpm, true),
        ));
    }
}
