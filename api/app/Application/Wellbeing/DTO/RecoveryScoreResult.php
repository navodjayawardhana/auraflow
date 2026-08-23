<?php

namespace App\Application\Wellbeing\DTO;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;

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
        /** Only ever set alongside an unavailable result -- see LastKnownScore. */
        public readonly ?LastKnownScore $lastKnown = null,
        /**
         * Which kind of resting-rate baseline the autonomic component was measured against,
         * or null where it did not run.
         *
         * Carried out of the application layer rather than left inside it because the client
         * cannot honestly present the number without it: the score's published validation
         * (E-015) used overnight rates, and a score resting on seated mornings is outside
         * what that evaluated. A screen that does not know cannot say.
         */
        public readonly ?RestingHeartRateSource $restingHrSource = null,
    ) {
    }

    public static function unavailable(string $date, string $reason, ?LastKnownScore $lastKnown = null): self
    {
        return new self($date, null, true, 0, false, $reason, $lastKnown);
    }

    public function isAvailable(): bool
    {
        return $this->score !== null;
    }
}
