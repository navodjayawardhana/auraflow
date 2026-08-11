<?php

namespace App\Application\Wellbeing\DTO;

/**
 * What leaves the application layer. A DTO rather than the domain object, so the shape
 * of the API response is not tied to the shape of the domain model.
 */
final class RecoveryScoreResult
{
    public function __construct(
        public readonly string $date,
        public readonly ?float $score,
        public readonly bool $provisional,
        public readonly int $componentsUsed,
        public readonly bool $illnessWarning,
        public readonly ?string $unavailableReason = null,
    ) {
    }

    public static function unavailable(string $date, string $reason): self
    {
        return new self($date, null, true, 0, false, $reason);
    }

    public function isAvailable(): bool
    {
        return $this->score !== null;
    }
}
