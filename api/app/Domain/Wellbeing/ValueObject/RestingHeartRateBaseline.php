<?php

namespace App\Domain\Wellbeing\ValueObject;

use App\Domain\Wellbeing\Exception\InsufficientBaselineHistoryException;

/**
 * A user's own resting-heart-rate normal, built from their preceding days.
 *
 * The baseline deliberately excludes today. Including the reading being tested lets it
 * pull its own reference: a single elevated day is damped, and across a multi-day
 * illness the baseline climbs with the symptom until the anomaly disappears into it.
 * This was a real defect in the Python pipeline, caught by a test expecting a clean
 * +10 bpm deviation and getting 8.57.
 *
 * One source per baseline, always. A mean and standard deviation taken across overnight
 * and seated readings together describes neither population: the mean lands between two
 * distributions, and the deviation is inflated by the gap between them rather than by
 * anything the person's heart did. A z-score against that is a number without a referent,
 * and it would be *most* wrong on the days a user changed how they measured -- exactly the
 * days it is being read hardest. So the source is a constructor argument rather than a
 * label, and the type carries it forward for RestingHeartRate::deviationFrom to check.
 */
final class RestingHeartRateBaseline
{
    /**
     * Days of history before a baseline is trusted. Below this the user is on the
     * cold-start path and gets a provisional score instead.
     */
    public const MIN_DAYS = 5;

    /** How far back the trailing window reaches. */
    public const WINDOW_DAYS = 14;

    /**
     * Floor for the standard deviation. A person with an unusually steady resting heart
     * rate would otherwise produce a near-zero divisor, sending every small fluctuation
     * to an extreme z-score.
     */
    private const MIN_STANDARD_DEVIATION = 0.5;
    private const FALLBACK_STANDARD_DEVIATION = 2.5;

    private function __construct(
        private readonly float $mean,
        private readonly float $standardDeviation,
        private readonly int $dayCount,
        private readonly RestingHeartRateSource $source,
    ) {
    }

    /**
     * @param  float[]  $priorReadings  resting heart rates from days strictly before today,
     *                                  every one of them taken the way `$source` says. The
     *                                  caller owns that filtering because only the caller
     *                                  can see the rows; passing a mixture here produces a
     *                                  baseline that lies about itself.
     */
    public static function fromPriorReadings(array $priorReadings, RestingHeartRateSource $source): self
    {
        $readings = array_values(array_filter($priorReadings, is_finite(...)));
        $count = count($readings);

        if ($count < self::MIN_DAYS) {
            throw InsufficientBaselineHistoryException::needsMoreDays($count, self::MIN_DAYS);
        }

        $window = array_slice($readings, -self::WINDOW_DAYS);
        $mean = array_sum($window) / count($window);

        $variance = array_sum(array_map(fn (float $r) => ($r - $mean) ** 2, $window)) / count($window);
        $deviation = sqrt($variance);

        if ($deviation < self::MIN_STANDARD_DEVIATION) {
            $deviation = self::FALLBACK_STANDARD_DEVIATION;
        }

        return new self(round($mean, 2), round($deviation, 3), count($window), $source);
    }

    public static function canBeBuiltFrom(array $priorReadings): bool
    {
        return count(array_filter($priorReadings, is_finite(...))) >= self::MIN_DAYS;
    }

    public function mean(): float
    {
        return $this->mean;
    }

    public function standardDeviation(): float
    {
        return $this->standardDeviation;
    }

    public function dayCount(): int
    {
        return $this->dayCount;
    }

    /**
     * Which kind of reading this normal is a normal for.
     *
     * Read by the deviation check, and surfaced all the way to the client, because a score
     * built on a seated baseline is outside what E-015 evaluated and the user has to be
     * told which one they are looking at.
     */
    public function source(): RestingHeartRateSource
    {
        return $this->source;
    }
}
