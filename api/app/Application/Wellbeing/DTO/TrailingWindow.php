<?php

namespace App\Application\Wellbeing\DTO;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
use App\Domain\Wellbeing\ValueObject\SleepArchitectureBaseline;

/**
 * Everything the preceding fortnight says about a user, read once.
 *
 * The three figures come from the same rows and were being fetched by two callers with
 * two copies of the same query. One reader, one window, one DTO -- the daily-brief
 * controller has a docblock about what happens when a lookup exists in two places.
 */
final class TrailingWindow
{
    /**
     * @param  array<string, RestingHeartRateBaseline>  $restingHeartRateBySource
     *                                     One baseline per kind of reading, keyed by the
     *                                     source's value, and only for the kinds that
     *                                     cleared the minimum on their own. A fortnight
     *                                     holding nine overnight nights and five seated
     *                                     mornings yields two baselines here, not one of
     *                                     fourteen -- see the reader.
     * @param  int[]  $completeDailySteps  step counts from the window, oldest first.
     *                                     Only days whose count covers the whole day:
     *                                     see the reader for why a partial one is a gap
     *                                     rather than a small number.
     */
    public function __construct(
        private readonly array $restingHeartRateBySource,
        public readonly ?SleepArchitectureBaseline $sleepArchitecture,
        public readonly array $completeDailySteps,
    ) {
    }

    public static function empty(): self
    {
        return new self([], null, []);
    }

    /**
     * The baseline a reading of this kind is entitled to be scored against, or null.
     *
     * Null rather than the other kind. A user who has switched from a watch to the morning
     * check-in has a fortnight of overnight nights sitting right there, and handing it over
     * would move the mixture from inside the baseline to the comparison -- the same error,
     * now invisible, because the resulting score would look established. They get
     * provisional scores until five seated mornings exist, which is the cold-start path the
     * app already has and already explains.
     *
     * Takes a nullable source so callers can pass `$snapshot->restingHeartRate()?->source()`
     * without branching on a day that recorded no rate at all.
     */
    public function restingHeartRateFor(?RestingHeartRateSource $source): ?RestingHeartRateBaseline
    {
        return $source === null ? null : ($this->restingHeartRateBySource[$source->value] ?? null);
    }

    /**
     * A resting-rate normal for consumers that want the figure rather than a comparison.
     *
     * Heart-rate zones need *a* resting rate to sit under the Karvonen reserve; they are not
     * z-scoring anything, so a baseline of either kind serves. Overnight is preferred where
     * both exist because the zone formulae were derived against a true resting rate and a
     * seated one sits above it, which would narrow the reserve and put every zone boundary
     * slightly high. Where only seated exists it is still far closer to this person than the
     * population constant it replaces.
     */
    public function preferredRestingHeartRate(): ?RestingHeartRateBaseline
    {
        return $this->restingHeartRateFor(RestingHeartRateSource::Overnight)
            ?? $this->restingHeartRateFor(RestingHeartRateSource::SeatedSpot);
    }
}
