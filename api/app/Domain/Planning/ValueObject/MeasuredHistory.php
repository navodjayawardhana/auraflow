<?php

namespace App\Domain\Planning\ValueObject;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;

/**
 * What the device knows, as opposed to what the person typed.
 *
 * The two halves of the plan's input are kept apart on purpose. A profile is a claim; a
 * baseline is a measurement, and the phase brief is explicit that the plan has to say
 * which of the two a number came from. Bundling them into one "user context" object
 * would make that distinction a matter of remembering rather than of type.
 *
 * Both fields are null on a fresh install and stay null until enough days exist -- the
 * thresholds are the domain's (RestingHeartRateBaseline::MIN_DAYS, and seven days for a
 * step median), and it is the assembler's job upstream to honour them.
 */
final class MeasuredHistory
{
    public function __construct(
        public readonly ?RestingHeartRateBaseline $restingHeartRate = null,
        public readonly ?int $medianDailySteps = null,
    ) {
    }

    public static function none(): self
    {
        return new self();
    }
}
