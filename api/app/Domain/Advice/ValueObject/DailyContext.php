<?php

namespace App\Domain\Advice\ValueObject;

/**
 * Everything the briefing is allowed to know about a day.
 *
 * Deliberately a closed set. The prompt builder can only describe what appears here, so
 * widening what the model may talk about is a deliberate change to this class rather
 * than something that happens by accident when a controller passes more along.
 */
final class DailyContext
{
    public function __construct(
        public readonly string $date,
        public readonly ?int $recoveryScore = null,
        public readonly bool $recoveryIsProvisional = false,
        public readonly ?string $recoveryUnavailableReason = null,
        public readonly bool $illnessWarning = false,
        public readonly ?int $sleepMinutes = null,
        public readonly ?int $deepSleepMinutes = null,
        public readonly ?int $remSleepMinutes = null,
        public readonly ?float $restingHeartRate = null,
        public readonly ?int $steps = null,
        public readonly ?int $waterMl = null,
        public readonly int $waterTargetMl = 2000,
        public readonly ?string $weatherDescription = null,
        public readonly ?float $temperatureC = null,
        public readonly ?string $locationContext = null,
        public readonly ?string $bestFocusWindow = null,
    ) {
    }

    /**
     * Whether there is enough to say anything worth reading.
     *
     * A briefing generated from an empty day would be the model writing filler, which is
     * exactly the failure mode this feature has to avoid — so it is not generated at all.
     */
    public function isSufficient(): bool
    {
        return $this->recoveryScore !== null
            || $this->sleepMinutes !== null
            || $this->restingHeartRate !== null;
    }
}
