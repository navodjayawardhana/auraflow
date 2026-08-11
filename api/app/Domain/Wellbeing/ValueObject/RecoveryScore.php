<?php

namespace App\Domain\Wellbeing\ValueObject;

use App\Domain\Wellbeing\Exception\InvalidRecoveryScoreException;

/**
 * How recovered the user is today, 0-100.
 *
 * The `provisional` flag is not cosmetic. A score computed without the autonomic
 * component is a different measurement on the same scale, not a slightly weaker one:
 * validation against 1,729 days of self-reported readiness showed that mixing the two
 * dropped the correlation from 0.123 to 0.063, because a participant's day-to-day
 * ranking became incoherent. Carrying the distinction in the type means a provisional
 * score cannot be silently compared against an established one.
 *
 * See docs/DATASET.md and EVIDENCE-LOG E-015.
 */
final class RecoveryScore
{
    private const MIN = 0.0;
    private const MAX = 100.0;

    private function __construct(
        private readonly float $value,
        private readonly bool $provisional,
        private readonly int $componentsUsed,
    ) {
    }

    public static function established(float $value, int $componentsUsed): self
    {
        return new self(self::guard($value), false, $componentsUsed);
    }

    /**
     * A score computed without the autonomic component, because the user has not yet
     * accumulated enough resting-heart-rate history for a personal baseline.
     */
    public static function provisional(float $value, int $componentsUsed): self
    {
        return new self(self::guard($value), true, $componentsUsed);
    }

    private static function guard(float $value): float
    {
        if (! is_finite($value) || $value < self::MIN || $value > self::MAX) {
            throw InvalidRecoveryScoreException::outOfRange($value);
        }

        return round($value, 1);
    }

    public function value(): float
    {
        return $this->value;
    }

    public function isProvisional(): bool
    {
        return $this->provisional;
    }

    public function isEstablished(): bool
    {
        return ! $this->provisional;
    }

    /**
     * How many of the three components contributed. Surfaced so the UI can show how
     * much of the picture the number is based on.
     */
    public function componentsUsed(): int
    {
        return $this->componentsUsed;
    }

    /**
     * Comparison is only meaningful between scores measured the same way.
     */
    public function isComparableTo(RecoveryScore $other): bool
    {
        return $this->provisional === $other->provisional;
    }

    public function isBetterThan(RecoveryScore $other): bool
    {
        if (! $this->isComparableTo($other)) {
            throw InvalidRecoveryScoreException::incomparable();
        }

        return $this->value > $other->value;
    }

    public function equals(RecoveryScore $other): bool
    {
        return $this->value === $other->value
            && $this->provisional === $other->provisional;
    }
}
