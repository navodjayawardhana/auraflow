<?php

namespace App\Domain\Advice\ValueObject;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;

/**
 * Everything the briefing is allowed to know about *today*.
 *
 * Deliberately a closed set. The prompt builder can only describe what appears here, so
 * widening what the model may talk about is a deliberate change to this class rather
 * than something that happens by accident when a controller passes more along.
 *
 * This used to be the whole of what the model saw, and is now one field of
 * {@see GroundingPack} — history, meals, sessions and targets live there. The split is
 * along the line the two consumers actually care about: this is the day, and a day is
 * what the briefing is about and what the fingerprint is mostly taken over.
 */
final class DailyContext
{
    /**
     * The cold-start hydration figure, named so a caller with no plan can pass it
     * deliberately rather than reproduce the literal.
     */
    public const DEFAULT_WATER_TARGET_ML = 2000;

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
        /**
         * How that rate was taken, because it is half of what the rate means.
         *
         * An overnight 58 and a seated 58 are different findings about the same person —
         * `RestingHeartRate::deviationFrom` throws rather than compare them — and a model
         * given a fortnight of both without being told which is which will average them
         * into a trend that describes the measuring rather than the person.
         */
        public readonly ?RestingHeartRateSource $restingHeartRateSource = null,
        public readonly ?int $steps = null,
        /**
         * Whether that count is the day or only the witnessed part of it.
         *
         * Default null, and null is read as partial: a brief that calls an undercount a
         * day's walking is the one thing a briefing must not do, and the platform that
         * can answer for a whole day is the one that has to say so.
         */
        public readonly ?bool $stepsAreComplete = null,
        public readonly ?int $waterMl = null,
        /**
         * The user's own hydration goal where they have a plan, and this literal where
         * they do not.
         *
         * The default is a cold-start value rather than the app's opinion: `PlanTargets`
         * carries the derived goal along with the provenance that says whether it is
         * theirs, and the caller passes it in. Left unset it is a round number nobody
         * derived, which is why the prompt never calls it a target of theirs.
         */
        public readonly int $waterTargetMl = self::DEFAULT_WATER_TARGET_ML,
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
