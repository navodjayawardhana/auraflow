<?php

namespace App\Domain\Wellbeing\Exception;

use DomainException;

final class InvalidSleepSummaryException extends DomainException
{
    public static function implausibleDuration(float $hours): self
    {
        return new self(sprintf(
            'Sleep duration %.2f h is implausible (expected %.1f-%.1f). Such nights are recording '
            .'artefacts and are rejected rather than clamped, because clamping invents a '
            .'measurement that was never taken.',
            $hours,
            \App\Domain\Wellbeing\ValueObject\SleepSummary::MIN_HOURS,
            \App\Domain\Wellbeing\ValueObject\SleepSummary::MAX_HOURS,
        ));
    }

    public static function stageExceedsTotal(string $stage, float $minutes, float $totalHours): self
    {
        return new self(sprintf(
            '%s sleep of %.0f min exceeds the %.2f h total for the night.',
            $stage,
            $minutes,
            $totalHours,
        ));
    }
}
