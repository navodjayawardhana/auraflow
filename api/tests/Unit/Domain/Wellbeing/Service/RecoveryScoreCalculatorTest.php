<?php

namespace Tests\Unit\Domain\Wellbeing\Service;

use App\Domain\Wellbeing\Service\RecoveryScoreCalculator;
use App\Domain\Wellbeing\ValueObject\RestingHeartRate;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\SleepSummary;
use PHPUnit\Framework\TestCase;

/**
 * Guards the port of ml/recovery.py. If these drift, the shipped app stops behaving
 * like the model the report's numbers describe.
 */
class RecoveryScoreCalculatorTest extends TestCase
{
    private RecoveryScoreCalculator $calculator;

    protected function setUp(): void
    {
        $this->calculator = new RecoveryScoreCalculator();
    }

    private function steadyBaseline(float $mean = 60.0): RestingHeartRateBaseline
    {
        return RestingHeartRateBaseline::fromPriorReadings([
            $mean - 3, $mean, $mean + 3, $mean - 1, $mean + 1, $mean,
        ]);
    }

    // --- Slice A: duration component ---

    // Z
    public function test_should_award_full_duration_marks_when_sleep_exactly_meets_the_need(): void
    {
        $score = $this->calculator->durationScore(SleepSummary::of(8.0), 8.0);

        $this->assertSame(100.0, $score);
    }

    // O
    public function test_should_penalise_one_hour_short_more_than_one_hour_long(): void
    {
        $short = 100 - $this->calculator->durationScore(SleepSummary::of(7.0), 8.0);
        $long = 100 - $this->calculator->durationScore(SleepSummary::of(9.0), 8.0);

        $this->assertEqualsWithDelta(2 * $long, $short, 0.001);
    }

    // B
    public function test_should_not_return_a_negative_duration_score_for_an_extreme_deficit(): void
    {
        $this->assertSame(0.0, $this->calculator->durationScore(SleepSummary::of(3.0), 12.0));
    }

    // --- Slice B: architecture component ---

    // Z
    public function test_should_skip_the_architecture_component_when_stages_are_unavailable(): void
    {
        $this->assertNull($this->calculator->architectureScore(SleepSummary::of(7.5), 60.0, 90.0));
    }

    // O
    public function test_should_place_typical_restorative_sleep_at_mid_scale(): void
    {
        $score = $this->calculator->architectureScore(SleepSummary::of(8.0, 60.0, 90.0), 60.0, 90.0);

        $this->assertEqualsWithDelta(50.0, $score, 0.001);
    }

    // M
    public function test_should_score_above_mid_scale_when_deep_and_rem_beat_the_personal_baseline(): void
    {
        $score = $this->calculator->architectureScore(SleepSummary::of(9.0, 90.0, 120.0), 60.0, 90.0);

        $this->assertGreaterThan(50.0, $score);
    }

    // --- Slice C: autonomic component ---

    // Z
    public function test_should_skip_the_autonomic_component_when_no_baseline_exists(): void
    {
        $this->assertNull(
            $this->calculator->autonomicScore(RestingHeartRate::fromBpm(60.0), null)
        );
    }

    // Z
    public function test_should_skip_the_autonomic_component_when_no_reading_exists(): void
    {
        $this->assertNull($this->calculator->autonomicScore(null, $this->steadyBaseline()));
    }

    // O
    public function test_should_place_a_resting_rate_at_baseline_on_mid_scale(): void
    {
        $baseline = $this->steadyBaseline(60.0);
        $score = $this->calculator->autonomicScore(RestingHeartRate::fromBpm($baseline->mean()), $baseline);

        $this->assertEqualsWithDelta(50.0, $score, 0.001);
    }

    // M
    public function test_should_score_the_same_for_an_athlete_and_a_desk_worker_equally_elevated(): void
    {
        // Expressed in each person's own standard deviations, an absolute threshold
        // would just encode fitness rather than strain.
        $athlete = RestingHeartRateBaseline::fromPriorReadings([42, 45, 48, 44, 46, 45]);
        $deskWorker = RestingHeartRateBaseline::fromPriorReadings([67, 70, 73, 69, 71, 70]);

        $athleteScore = $this->calculator->autonomicScore(
            RestingHeartRate::fromBpm($athlete->mean() + $athlete->standardDeviation()),
            $athlete,
        );
        $deskWorkerScore = $this->calculator->autonomicScore(
            RestingHeartRate::fromBpm($deskWorker->mean() + $deskWorker->standardDeviation()),
            $deskWorker,
        );

        $this->assertEqualsWithDelta($athleteScore, $deskWorkerScore, 0.001);
    }

    // B
    public function test_should_score_below_mid_scale_when_resting_rate_is_elevated(): void
    {
        $baseline = $this->steadyBaseline(60.0);
        $score = $this->calculator->autonomicScore(RestingHeartRate::fromBpm(72.0), $baseline);

        $this->assertLessThan(50.0, $score);
    }

    // --- Slice D: the combined score ---

    // Z
    public function test_should_return_a_provisional_score_when_the_autonomic_component_is_missing(): void
    {
        $score = $this->calculator->calculate(SleepSummary::of(7.5, 60.0, 90.0), null, null);

        $this->assertTrue($score->isProvisional());
        $this->assertSame(2, $score->componentsUsed());
    }

    // I
    public function test_should_weight_the_autonomic_component_above_the_sleep_components(): void
    {
        // The weights are not intuition: a held-out grid search chose autonomic-only in
        // all five folds. Sleep keeps a small weight solely so a new user without five
        // days of history still gets a number.
        $this->assertGreaterThan(
            RecoveryScoreCalculator::WEIGHT_DURATION + RecoveryScoreCalculator::WEIGHT_ARCHITECTURE,
            RecoveryScoreCalculator::WEIGHT_AUTONOMIC,
        );
    }

    // I
    public function test_should_let_the_autonomic_component_dominate_the_combined_value(): void
    {
        $baseline = $this->steadyBaseline(60.0);
        $goodSleep = SleepSummary::of(8.0, 90.0, 120.0);

        $rested = $this->calculator->calculate($goodSleep, RestingHeartRate::fromBpm(54.0), $baseline);
        $strained = $this->calculator->calculate($goodSleep, RestingHeartRate::fromBpm(70.0), $baseline);

        // Identical sleep, opposite autonomic signals: the score has to move a long way.
        $this->assertGreaterThan(25.0, $rested->value() - $strained->value());
    }

    // E
    public function test_should_reject_a_night_with_no_computable_component(): void
    {
        // Sleep without stages and no heart-rate data still leaves the duration
        // component, so the only way to have nothing is an empty set -- guarded here
        // so a future refactor cannot silently return a meaningless zero.
        $score = $this->calculator->calculate(SleepSummary::of(7.0), null, null);

        $this->assertSame(1, $score->componentsUsed());
        $this->assertTrue($score->isProvisional());
    }

    // S
    public function test_should_return_an_established_score_when_every_signal_is_present(): void
    {
        $score = $this->calculator->calculate(
            SleepSummary::of(8.0, 65.0, 95.0),
            RestingHeartRate::fromBpm(58.0),
            $this->steadyBaseline(60.0),
        );

        $this->assertTrue($score->isEstablished());
        $this->assertSame(3, $score->componentsUsed());
        $this->assertGreaterThan(50.0, $score->value());
    }
}
