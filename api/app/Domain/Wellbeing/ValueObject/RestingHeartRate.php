<?php

namespace App\Domain\Wellbeing\ValueObject;

use App\Domain\Wellbeing\Exception\InvalidHeartRateException;

/**
 * A daily resting heart rate reading, in beats per minute, and how it was taken.
 *
 * The bounds reject readings no living adult produces at rest. Fitbit exports zero for
 * "no estimate available", and a zero treated as a heart rate would look like extreme
 * recovery rather than missing data.
 *
 * The source is not metadata hung off the side of the number: it is half of what the
 * number means. An overnight 58 and a seated 58 are different findings about the same
 * person, and the only reason they were ever interchangeable here is that nothing was
 * asking.
 */
final class RestingHeartRate
{
    private const MIN_BPM = 25.0;
    private const MAX_BPM = 140.0;

    private function __construct(
        private readonly float $bpm,
        private readonly RestingHeartRateSource $source,
    ) {
    }

    /**
     * The source has no default. Every caller knows which kind it is holding -- the log
     * form knows, the check-in knows, the mapper reads it off the row -- so asking costs
     * nothing, and a default would be a way for one of them to stop saying.
     */
    public static function fromBpm(float $bpm, RestingHeartRateSource $source): self
    {
        if (! is_finite($bpm) || $bpm < self::MIN_BPM || $bpm > self::MAX_BPM) {
            throw InvalidHeartRateException::outOfRange($bpm);
        }

        return new self(round($bpm, 1), $source);
    }

    public static function overnight(float $bpm): self
    {
        return self::fromBpm($bpm, RestingHeartRateSource::Overnight);
    }

    public static function seatedSpot(float $bpm): self
    {
        return self::fromBpm($bpm, RestingHeartRateSource::SeatedSpot);
    }

    public function bpm(): float
    {
        return $this->bpm;
    }

    public function source(): RestingHeartRateSource
    {
        return $this->source;
    }

    /**
     * How far this reading sits from the personal baseline, in that person's own
     * standard deviations.
     *
     * Expressed in standard deviations rather than absolute bpm so it means the same
     * thing for a resting-45 athlete and a resting-70 desk worker. An absolute
     * threshold would just encode fitness.
     *
     * Refuses a baseline built from the other kind of reading. Callers are expected to have
     * picked the matching baseline already, so this throw is a guard rather than a branch:
     * a seated 64 against an overnight mean would come out as a plausible +2 SD and read on
     * screen as illness, which is the failure this whole distinction exists to prevent.
     * RecoveryScore::isComparableTo draws the same line one layer up.
     */
    public function deviationFrom(RestingHeartRateBaseline $baseline): float
    {
        if ($this->source !== $baseline->source()) {
            throw InvalidHeartRateException::incomparableSources($this->source, $baseline->source());
        }

        return ($this->bpm - $baseline->mean()) / $baseline->standardDeviation();
    }

    public function isElevatedAgainst(RestingHeartRateBaseline $baseline, float $threshold): bool
    {
        return $this->deviationFrom($baseline) > $threshold;
    }

    public function equals(RestingHeartRate $other): bool
    {
        return $this->bpm === $other->bpm && $this->source === $other->source;
    }
}
