<?php

namespace Tests\Unit\Domain\Planning\Service;

use App\Domain\Planning\Service\HeartRateZoneCalculator;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
use PHPUnit\Framework\TestCase;

/**
 * Tanaka, Karvonen, and the ACSM bands between them.
 *
 * The heart of the phase. These zones are the one output the app can personalise with
 * something a lookup table has no access to -- a fortnight of the user's own resting
 * heart rate, already being computed for the recovery score -- so the tests that matter
 * most are the two that prove a measured baseline is preferred and that its absence is
 * declared rather than hidden.
 */
class HeartRateZoneCalculatorTest extends TestCase
{
    private HeartRateZoneCalculator $calculator;

    protected function setUp(): void
    {
        $this->calculator = new HeartRateZoneCalculator();
    }

    private function baselineAt(float $mean): RestingHeartRateBaseline
    {
        return RestingHeartRateBaseline::fromPriorReadings([
            $mean - 3, $mean, $mean + 3, $mean - 1, $mean + 1, $mean,
        ], RestingHeartRateSource::Overnight);
    }

    // --- Slice A: no maximum without an age ---

    // Z
    public function test_should_not_predict_a_maximum_heart_rate_without_an_age(): void
    {
        $this->assertNull($this->calculator->maximumHeartRate(null));
    }

    // Z
    public function test_should_offer_no_zones_at_all_without_an_age(): void
    {
        // Zones are exercise advice. A population age would produce three plausible bands
        // for a person who is not the user, which is worse than none.
        $this->assertNull($this->calculator->zonesFor(null, $this->baselineAt(55.0)));
    }

    // --- Slice B: Tanaka ---

    // O
    public function test_should_predict_the_maximum_by_the_tanaka_regression(): void
    {
        // Tanaka H, Monahan KD, Seals DR. "Age-predicted maximal heart rate revisited."
        // J Am Coll Cardiol. 2001;37(1):153-156.  HRmax = 208 - 0.7 x age.
        // At 40: 208 - 28 = 180.
        $this->assertEqualsWithDelta(180.0, $this->calculator->maximumHeartRate(40), 0.001);
    }

    // I
    public function test_should_agree_with_the_folklore_equation_only_at_forty(): void
    {
        // 208 - 0.7a and 220 - a intersect at exactly 40, and diverge either side. That
        // divergence is the paper's whole point: 220 - age understates the maximum in
        // older adults, and understating a maximum prescribes too easy an intensity to
        // the people the guidance is most consequential for.
        $folklore = static fn (int $age): float => 220.0 - $age;

        $this->assertEqualsWithDelta($folklore(40), $this->calculator->maximumHeartRate(40), 0.001);
        $this->assertGreaterThan($folklore(65), $this->calculator->maximumHeartRate(65));
        $this->assertLessThan($folklore(20), $this->calculator->maximumHeartRate(20));
    }

    // --- Slice C: Karvonen ---

    // O
    public function test_should_match_the_published_karvonen_worked_example(): void
    {
        // Karvonen MJ, Kentala E, Mustala O. Ann Med Exp Biol Fenn. 1957;35(3):307-315.
        //   target = (HRmax - HRrest) x intensity + HRrest
        // Standard worked example, HRmax 185 and HRrest 65:
        //   at 70% -> (185-65) x 0.70 + 65 = 149
        //   at 60% -> (185-65) x 0.60 + 65 = 137
        // as reproduced at https://www.topendsports.com/fitness/karvonen-formula.htm
        $this->assertEqualsWithDelta(149.0, $this->calculator->karvonenTarget(185.0, 65.0, 0.70), 0.001);
        $this->assertEqualsWithDelta(137.0, $this->calculator->karvonenTarget(185.0, 65.0, 0.60), 0.001);
    }

    // B
    public function test_should_return_the_resting_rate_at_zero_intensity_and_the_maximum_at_full(): void
    {
        $this->assertEqualsWithDelta(65.0, $this->calculator->karvonenTarget(185.0, 65.0, 0.0), 0.001);
        $this->assertEqualsWithDelta(185.0, $this->calculator->karvonenTarget(185.0, 65.0, 1.0), 0.001);
    }

    // --- Slice D: the ACSM bands ---

    // M
    public function test_should_lay_the_three_bands_out_in_ascending_contiguous_order(): void
    {
        // ACSM's Guidelines for Exercise Testing and Prescription, 10th ed., Table 5.2:
        // light 30-39% HRR, moderate 40-59%, vigorous 60-89%.
        $zones = $this->calculator->zonesFor(40, $this->baselineAt(60.0));

        $this->assertLessThan($zones->easy[1], $zones->easy[0]);
        $this->assertLessThanOrEqual($zones->moderate[0], $zones->easy[1]);
        $this->assertLessThanOrEqual($zones->hard[0], $zones->moderate[1]);
        $this->assertLessThan($zones->maximumBpm, $zones->hard[1]);
    }

    // I
    public function test_should_build_every_band_from_the_same_reserve(): void
    {
        // 40 years old, resting 60: HRmax 180, reserve 120.
        // easy    30% -> 96,  39% -> 107 (rounded)
        // moderate 40% -> 108, 59% -> 131
        // hard    60% -> 132, 89% -> 167
        $zones = $this->calculator->zonesFor(40, $this->baselineAt(60.0));

        $this->assertSame([96, 107], $zones->easy);
        $this->assertSame([108, 131], $zones->moderate);
        $this->assertSame([132, 167], $zones->hard);
    }

    // --- Slice E: measured before population ---

    // I
    public function test_should_prefer_the_users_measured_resting_rate_over_the_population_value(): void
    {
        // The whole argument for this phase. Two 40-year-olds, one a resting-45 runner
        // and one on the population mean, must not be handed the same bands.
        $measured = $this->calculator->zonesFor(40, $this->baselineAt(45.0));
        $population = $this->calculator->zonesFor(40, null);

        $this->assertSame(45, $measured->restingBpm);
        $this->assertSame(HeartRateZoneCalculator::POPULATION_RESTING_BPM, $population->restingBpm);
        $this->assertNotSame($measured->moderate, $population->moderate);
    }

    // E
    public function test_should_fall_back_to_the_population_resting_rate_rather_than_refusing(): void
    {
        // Ostchega Y, Porter KS, Hughes J, Dillon CF, Nwankwo T. National Health
        // Statistics Reports no. 41, NCHS 2011: mean resting pulse plateaus at 72 bpm in
        // adulthood. A cold-start user gets zones, and the plan says which rate they came
        // from -- produce something, and say what it did not know.
        $zones = $this->calculator->zonesFor(40, null);

        $this->assertSame(72, $zones->restingBpm);
        $this->assertSame([104, 114], $zones->easy);
    }

    // S
    public function test_should_widen_the_reserve_for_a_lower_resting_rate(): void
    {
        // Same age, so the same maximum; a lower floor means a wider reserve and a harder
        // top of the vigorous band. That difference is what makes the zones the user's.
        $runner = $this->calculator->zonesFor(35, $this->baselineAt(45.0));
        $beginner = $this->calculator->zonesFor(35, $this->baselineAt(78.0));

        $this->assertSame($runner->maximumBpm, $beginner->maximumBpm);
        $this->assertGreaterThan($beginner->hard[1] - $beginner->easy[0], $runner->hard[1] - $runner->easy[0]);
    }
}
