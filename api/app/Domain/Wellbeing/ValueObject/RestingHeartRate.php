<?php

namespace App\Domain\Wellbeing\ValueObject;

use App\Domain\Wellbeing\Exception\InvalidHeartRateException;

/**
 * A daily resting heart rate reading, in beats per minute.
 *
 * The bounds reject readings no living adult produces at rest. Fitbit exports zero for
 * "no estimate available", and a zero treated as a heart rate would look like extreme
 * recovery rather than missing data.
 */
final class RestingHeartRate
{
    private const MIN_BPM = 25.0;
    private const MAX_BPM = 140.0;

    private function __construct(private readonly float $bpm)
    {
    }

    public static function fromBpm(float $bpm): self
    {
        if (! is_finite($bpm) || $bpm < self::MIN_BPM || $bpm > self::MAX_BPM) {
            throw InvalidHeartRateException::outOfRange($bpm);
        }

        return new self(round($bpm, 1));
    }

    public function bpm(): float
    {
        return $this->bpm;
    }

    /**
     * How far this reading sits from the personal baseline, in that person's own
     * standard deviations.
     *
     * Expressed in standard deviations rather than absolute bpm so it means the same
     * thing for a resting-45 athlete and a resting-70 desk worker. An absolute
     * threshold would just encode fitness.
     */
    public function deviationFrom(RestingHeartRateBaseline $baseline): float
    {
        return ($this->bpm - $baseline->mean()) / $baseline->standardDeviation();
    }

    public function isElevatedAgainst(RestingHeartRateBaseline $baseline, float $threshold): bool
    {
        return $this->deviationFrom($baseline) > $threshold;
    }

    public function equals(RestingHeartRate $other): bool
    {
        return $this->bpm === $other->bpm;
    }
}
