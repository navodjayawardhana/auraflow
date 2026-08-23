<?php

namespace Tests\Unit\Domain\Wellbeing\ValueObject;

use App\Domain\Wellbeing\Exception\InvalidHeartRateException;
use App\Domain\Wellbeing\ValueObject\RestingHeartRate;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
use PHPUnit\Framework\TestCase;

/**
 * The guard that makes a mixed comparison impossible rather than merely unlikely.
 *
 * Everything else in this feature is a filtering rule the readers apply, and a filtering
 * rule can be forgotten by the next caller. What cannot be forgotten is the type refusing
 * the arithmetic -- a seated reading against an overnight mean would otherwise divide
 * cleanly, return something like +2 SD, and reach the screen as an illness warning about a
 * person whose heart did nothing unusual.
 */
class RestingHeartRateProvenanceTest extends TestCase
{
    // O
    public function test_should_score_a_reading_against_a_baseline_of_its_own_kind(): void
    {
        $baseline = RestingHeartRateBaseline::fromPriorReadings(
            [66, 68, 70, 68, 68],
            RestingHeartRateSource::SeatedSpot,
        );

        $this->assertSame(
            0.0,
            RestingHeartRate::seatedSpot(68.0)->deviationFrom($baseline),
        );
    }

    // E
    public function test_should_refuse_to_score_a_seated_reading_against_an_overnight_baseline(): void
    {
        // The two series are a plausible distance apart for one person: 55 asleep, 68
        // sitting at a desk. Divided anyway this returns roughly +16 SD, which the illness
        // detector would report as an emergency.
        $overnight = RestingHeartRateBaseline::fromPriorReadings(
            [54, 55, 56, 54, 55, 56],
            RestingHeartRateSource::Overnight,
        );

        $this->expectException(InvalidHeartRateException::class);

        RestingHeartRate::seatedSpot(68.0)->deviationFrom($overnight);
    }

    // E
    public function test_should_refuse_the_mismatch_in_the_other_direction_too(): void
    {
        $seated = RestingHeartRateBaseline::fromPriorReadings(
            [66, 68, 70, 68, 68],
            RestingHeartRateSource::SeatedSpot,
        );

        $this->expectException(InvalidHeartRateException::class);

        RestingHeartRate::overnight(55.0)->deviationFrom($seated);
    }

    // O
    public function test_should_keep_the_source_a_baseline_was_built_from(): void
    {
        // Read by everything that has to disclose which kind of history a score rests on.
        $this->assertSame(
            RestingHeartRateSource::SeatedSpot,
            RestingHeartRateBaseline::fromPriorReadings(
                [66, 68, 70, 68, 68],
                RestingHeartRateSource::SeatedSpot,
            )->source(),
        );
    }

    // B
    public function test_should_treat_only_the_overnight_kind_as_covered_by_the_published_validation(): void
    {
        // E-015 scored the recovery model against PMData's self-reported readiness using
        // overnight resting rates. Nothing in that table describes a seated series, and the
        // app's copy depends on this staying true.
        $this->assertTrue(RestingHeartRateSource::Overnight->isCoveredByPublishedValidation());
        $this->assertFalse(RestingHeartRateSource::SeatedSpot->isCoveredByPublishedValidation());
    }
}
