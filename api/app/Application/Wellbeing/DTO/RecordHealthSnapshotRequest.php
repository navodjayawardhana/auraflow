<?php

namespace App\Application\Wellbeing\DTO;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;

final class RecordHealthSnapshotRequest
{
    public function __construct(
        public readonly string $userId,
        public readonly string $date,
        public readonly ?int $sleepMinutes = null,
        public readonly ?int $deepSleepMinutes = null,
        public readonly ?int $remSleepMinutes = null,
        public readonly ?float $restingHeartRate = null,
        /**
         * How `restingHeartRate` was taken. Present whenever the rate is, because the two
         * are one fact -- a bpm figure on its own cannot be pooled with anything.
         */
        public readonly ?RestingHeartRateSource $restingHrSource = null,
        public readonly ?int $steps = null,
        /** Whether `steps` covers the day, or only the part a phone was watching. */
        public readonly ?bool $stepsAreComplete = null,
        public readonly ?int $waterMl = null,
    ) {
    }
}
