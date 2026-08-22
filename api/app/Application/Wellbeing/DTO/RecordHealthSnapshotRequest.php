<?php

namespace App\Application\Wellbeing\DTO;

final class RecordHealthSnapshotRequest
{
    public function __construct(
        public readonly string $userId,
        public readonly string $date,
        public readonly ?int $sleepMinutes = null,
        public readonly ?int $deepSleepMinutes = null,
        public readonly ?int $remSleepMinutes = null,
        public readonly ?float $restingHeartRate = null,
        public readonly ?int $steps = null,
        public readonly ?int $waterMl = null,
    ) {
    }
}
