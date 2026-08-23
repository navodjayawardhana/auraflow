<?php

namespace App\Domain\Wellbeing\ValueObject;

/**
 * A user's own normal for deep and REM minutes, built from their preceding nights.
 *
 * RecoveryScoreCalculator::architectureScore has always been documented as scoring
 * "restorative sleep against the user's own baseline", and has always in fact been
 * handed the cold-start population figures of 60 and 90 minutes, because nothing
 * computed the personal ones. This is that computation.
 *
 * It matters more than it looks. Deep and REM minutes vary enormously between people:
 * against a 60-minute reference, someone whose own deep sleep runs at 35 minutes scores
 * below mid-scale every night of their life, and the component stops carrying
 * information about *their* recovery at all.
 *
 * Shaped after RestingHeartRateBaseline, including the exclusion of today -- a baseline
 * containing the night being scored damps its own anomaly.
 */
final class SleepArchitectureBaseline
{
    /**
     * Nights of staged sleep before the personal figures are trusted.
     *
     * Matched to RestingHeartRateBaseline::MIN_DAYS, so the two halves of the score
     * become personal at the same point in a user's history rather than one at a time.
     */
    public const MIN_NIGHTS = RestingHeartRateBaseline::MIN_DAYS;

    public const WINDOW_NIGHTS = RestingHeartRateBaseline::WINDOW_DAYS;

    private function __construct(
        private readonly float $deepMinutes,
        private readonly float $remMinutes,
        private readonly int $nightCount,
    ) {
    }

    /**
     * Null rather than an exception when there is not enough history.
     *
     * Unlike a resting-HR baseline, whose absence the score reports as `provisional`, a
     * missing architecture baseline is invisible to the user: the component still runs,
     * on population figures. There is nothing exceptional to raise.
     *
     * @param  array{float, float}[]  $priorNights  [deep minutes, REM minutes], one per night
     */
    public static function fromPriorNights(array $priorNights): ?self
    {
        $nights = array_slice(array_values($priorNights), -self::WINDOW_NIGHTS);

        if (count($nights) < self::MIN_NIGHTS) {
            return null;
        }

        $deep = array_sum(array_column($nights, 0)) / count($nights);
        $rem = array_sum(array_column($nights, 1)) / count($nights);

        return new self(round($deep, 1), round($rem, 1), count($nights));
    }

    public function deepMinutes(): float
    {
        return $this->deepMinutes;
    }

    public function remMinutes(): float
    {
        return $this->remMinutes;
    }

    public function nightCount(): int
    {
        return $this->nightCount;
    }
}
