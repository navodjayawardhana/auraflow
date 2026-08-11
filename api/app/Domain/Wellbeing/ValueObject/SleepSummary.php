<?php

namespace App\Domain\Wellbeing\ValueObject;

use App\Domain\Wellbeing\Exception\InvalidSleepSummaryException;

/**
 * One night's sleep: how long, and how much of it was restorative.
 *
 * Nights outside 3-12 hours are rejected rather than clamped. The source data runs to
 * 20.7 hours, which is a recording artefact, and clamping would invent a plausible
 * measurement where none was taken.
 */
final class SleepSummary
{
    public const MIN_HOURS = 3.0;
    public const MAX_HOURS = 12.0;

    private function __construct(
        private readonly float $hours,
        private readonly ?float $deepMinutes,
        private readonly ?float $remMinutes,
    ) {
    }

    public static function of(float $hours, ?float $deepMinutes = null, ?float $remMinutes = null): self
    {
        if (! is_finite($hours) || $hours < self::MIN_HOURS || $hours > self::MAX_HOURS) {
            throw InvalidSleepSummaryException::implausibleDuration($hours);
        }

        foreach (['deep' => $deepMinutes, 'REM' => $remMinutes] as $stage => $minutes) {
            if ($minutes !== null && ($minutes < 0 || $minutes > $hours * 60)) {
                throw InvalidSleepSummaryException::stageExceedsTotal($stage, $minutes, $hours);
            }
        }

        return new self(round($hours, 2), $deepMinutes, $remMinutes);
    }

    /**
     * Fitbit and Health Connect both report duration in milliseconds. Reading that as
     * minutes gives nights of twenty-seven million hours, so the conversion lives here
     * rather than at each call site.
     */
    public static function fromMilliseconds(int $milliseconds, ?float $deepMinutes = null, ?float $remMinutes = null): self
    {
        return self::of($milliseconds / 3_600_000, $deepMinutes, $remMinutes);
    }

    public function hours(): float
    {
        return $this->hours;
    }

    public function deepMinutes(): ?float
    {
        return $this->deepMinutes;
    }

    public function remMinutes(): ?float
    {
        return $this->remMinutes;
    }

    public function hasStageBreakdown(): bool
    {
        return $this->deepMinutes !== null && $this->remMinutes !== null;
    }

    public function equals(SleepSummary $other): bool
    {
        return $this->hours === $other->hours
            && $this->deepMinutes === $other->deepMinutes
            && $this->remMinutes === $other->remMinutes;
    }
}
