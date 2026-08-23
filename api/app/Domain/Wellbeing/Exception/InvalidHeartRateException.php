<?php

namespace App\Domain\Wellbeing\Exception;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
use DomainException;

final class InvalidHeartRateException extends DomainException
{
    /**
     * A reading measured against a baseline built from the other kind of reading.
     *
     * Not a validation failure a user can fix -- it means a caller reached for the wrong
     * baseline, and the arithmetic would have succeeded and produced a number that looks
     * exactly like a real one.
     */
    public static function incomparableSources(
        RestingHeartRateSource $reading,
        RestingHeartRateSource $baseline,
    ): self {
        return new self(sprintf(
            'A %s resting heart rate cannot be scored against a %s baseline: the two measure '
            .'different things, so the deviation between them is not a deviation in anything.',
            $reading->value,
            $baseline->value,
        ));
    }

    public static function outOfRange(float $bpm): self
    {
        return new self(sprintf(
            'Resting heart rate %s is outside the plausible range. Note that exports use 0 for '
            .'"no estimate available", which must be treated as missing rather than as a reading.',
            var_export($bpm, true),
        ));
    }
}
