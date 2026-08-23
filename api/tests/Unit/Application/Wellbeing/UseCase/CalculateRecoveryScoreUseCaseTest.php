<?php

namespace Tests\Unit\Application\Wellbeing\UseCase;

use App\Application\Wellbeing\DTO\CalculateRecoveryScoreRequest;
use App\Application\Wellbeing\Service\TrailingWindowReader;
use App\Application\Wellbeing\UseCase\CalculateRecoveryScoreUseCase;
use App\Domain\Planning\Model\WellbeingPlan;
use App\Domain\Planning\ValueObject\PlanBasis;
use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\Service\IllnessDetector;
use App\Domain\Wellbeing\Service\RecoveryScoreCalculator;
use App\Domain\Wellbeing\ValueObject\RestingHeartRate;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\SleepSummary;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;
use Tests\Unit\Application\Wellbeing\UseCase\Fake\FakeDailyHealthSnapshotRepository;
use Tests\Unit\Application\Wellbeing\UseCase\Fake\FakeWellbeingPlanRepository;

class CalculateRecoveryScoreUseCaseTest extends TestCase
{
    private const USER = 'user-1';
    private const TODAY = '2026-03-15';

    private FakeDailyHealthSnapshotRepository $snapshots;
    private FakeWellbeingPlanRepository $plans;
    private CalculateRecoveryScoreUseCase $useCase;

    protected function setUp(): void
    {
        $this->snapshots = new FakeDailyHealthSnapshotRepository();
        $this->plans = new FakeWellbeingPlanRepository();
        $this->useCase = new CalculateRecoveryScoreUseCase(
            $this->snapshots,
            new RecoveryScoreCalculator(),
            new IllnessDetector(),
            new TrailingWindowReader($this->snapshots),
            $this->plans,
        );
    }

    private function givenDay(string $date, ?float $sleepHours, ?float $restingBpm): void
    {
        $this->snapshots->add(DailyHealthSnapshot::record(
            UserId::fromString(self::USER),
            new DateTimeImmutable($date),
            $sleepHours === null ? null : SleepSummary::of($sleepHours, 60.0, 90.0),
            $restingBpm === null ? null : RestingHeartRate::fromBpm($restingBpm),
        ));
    }

    /** Enough prior days at a steady rate for a baseline to be established. */
    private function givenBaselineHistory(float $bpm = 60.0): void
    {
        $offsets = [7, 6, 5, 4, 3, 2, 1];
        foreach ($offsets as $index => $daysAgo) {
            $this->givenDay(
                (new DateTimeImmutable(self::TODAY))->modify("-{$daysAgo} days")->format('Y-m-d'),
                7.5,
                $bpm + ($index % 3) - 1,
            );
        }
    }

    private function calculateFor(string $date = self::TODAY): \App\Application\Wellbeing\DTO\RecoveryScoreResult
    {
        return $this->useCase->execute(new CalculateRecoveryScoreRequest(self::USER, $date));
    }

    // --- Slice A: availability ---

    // Z
    public function test_should_report_unavailable_when_no_snapshot_exists_for_the_date(): void
    {
        $result = $this->calculateFor();

        $this->assertFalse($result->isAvailable());
        $this->assertNull($result->score);
        $this->assertNotNull($result->unavailableReason);
    }

    // Z
    public function test_should_report_unavailable_when_the_night_has_no_sleep_recorded(): void
    {
        $this->givenDay(self::TODAY, null, 60.0);

        $this->assertFalse($this->calculateFor()->isAvailable());
    }

    // --- Slice B: cold start ---

    // O
    public function test_should_return_a_provisional_score_when_only_one_night_exists(): void
    {
        $this->givenDay(self::TODAY, 7.5, 60.0);

        $result = $this->calculateFor();

        $this->assertTrue($result->isAvailable());
        $this->assertTrue($result->provisional);
    }

    // B
    public function test_should_stay_provisional_when_history_is_one_day_short_of_the_minimum(): void
    {
        $short = RestingHeartRateBaseline::MIN_DAYS - 1;
        for ($daysAgo = $short; $daysAgo >= 1; $daysAgo--) {
            $this->givenDay(
                (new DateTimeImmutable(self::TODAY))->modify("-{$daysAgo} days")->format('Y-m-d'),
                7.5,
                60.0 + $daysAgo,
            );
        }
        $this->givenDay(self::TODAY, 7.5, 60.0);

        $this->assertTrue($this->calculateFor()->provisional);
    }

    // M
    public function test_should_become_established_once_enough_prior_days_exist(): void
    {
        $this->givenBaselineHistory();
        $this->givenDay(self::TODAY, 7.5, 60.0);

        $result = $this->calculateFor();

        $this->assertFalse($result->provisional);
        $this->assertSame(3, $result->componentsUsed);
    }

    // --- Slice C: the baseline must not include today ---

    // I
    public function test_should_exclude_today_from_the_baseline_it_is_measured_against(): void
    {
        // Seven steady days near 60, then a sharply elevated today. If today were part
        // of its own baseline the deviation would be damped and the warning suppressed.
        $this->givenBaselineHistory(60.0);
        $this->givenDay(self::TODAY, 7.5, 78.0);

        $this->assertTrue($this->calculateFor()->illnessWarning);
    }

    // I
    public function test_should_not_let_one_users_history_build_another_users_baseline(): void
    {
        $this->snapshots->add(DailyHealthSnapshot::record(
            UserId::fromString('someone-else'),
            new DateTimeImmutable('2026-03-10'),
            SleepSummary::of(8.0, 60.0, 90.0),
            RestingHeartRate::fromBpm(45.0),
        ));
        $this->givenDay(self::TODAY, 7.5, 60.0);

        // Only this user's own single night exists, so no baseline is possible.
        $this->assertTrue($this->calculateFor()->provisional);
    }

    // --- Slice D: illness warning ---

    // E
    public function test_should_not_warn_when_no_baseline_has_been_established(): void
    {
        $this->givenDay(self::TODAY, 7.5, 95.0);

        $this->assertFalse($this->calculateFor()->illnessWarning);
    }

    // E
    public function test_should_not_warn_when_the_resting_rate_is_normal_for_this_user(): void
    {
        $this->givenBaselineHistory(60.0);
        $this->givenDay(self::TODAY, 7.5, 60.0);

        $this->assertFalse($this->calculateFor()->illnessWarning);
    }

    // --- Slice E: the three parameters that were never passed ---
    //
    // RecoveryScoreCalculator has accepted a personal sleep need and personal deep and
    // REM baselines since it was written, and nothing ever supplied them. These prove
    // they arrive.

    /** A night with neither stages nor a heart rate, so only the duration component runs. */
    private function givenDurationOnlyNight(string $date, float $hours): void
    {
        $this->snapshots->add(DailyHealthSnapshot::record(
            UserId::fromString(self::USER),
            new DateTimeImmutable($date),
            SleepSummary::of($hours),
            null,
        ));
    }

    private function givenPlanWithSleepNeed(float $hours): void
    {
        $this->plans->add(WellbeingPlan::derived(
            UserId::fromString(self::USER),
            1,
            10000,
            2000,
            null,
            $hours,
            null,
            new PlanBasis(null, null, 1.4, null, null, null, 'population_default', 'population_default', 'age_band', [7.0, 9.0], []),
        ));
    }

    // Z
    public function test_should_fall_back_to_the_calculators_default_sleep_need_when_no_plan_exists(): void
    {
        // Seven hours against the built-in 8.0: an hour short at 18 points per hour.
        $this->givenDurationOnlyNight(self::TODAY, 7.0);

        $this->assertEqualsWithDelta(82.0, $this->calculateFor()->score, 0.001);
    }

    // O
    public function test_should_score_the_same_night_against_the_sleep_need_the_plan_derived(): void
    {
        // The identical night, for someone whose NSF age band puts their need at seven
        // hours. No deficit, so no penalty -- the number the app showed until now was
        // wrong for every user the adult midpoint did not describe.
        $this->givenDurationOnlyNight(self::TODAY, 7.0);
        $this->givenPlanWithSleepNeed(7.0);

        $this->assertEqualsWithDelta(100.0, $this->calculateFor()->score, 0.001);
    }

    // M
    public function test_should_measure_sleep_architecture_against_the_users_own_preceding_nights(): void
    {
        // Someone who consistently gets 30 minutes of deep and 45 of REM. Against the
        // population figures of 60 and 90 they score 25 every night of their life; against
        // their own fortnight, a typical night is mid-scale, which is what the component
        // was documented to mean.
        foreach (range(6, 1) as $daysAgo) {
            $this->snapshots->add(DailyHealthSnapshot::record(
                UserId::fromString(self::USER),
                (new DateTimeImmutable(self::TODAY))->modify("-{$daysAgo} days"),
                SleepSummary::of(7.0, 30.0, 45.0),
                null,
            ));
        }

        $this->snapshots->add(DailyHealthSnapshot::record(
            UserId::fromString(self::USER),
            new DateTimeImmutable(self::TODAY),
            SleepSummary::of(8.0, 30.0, 45.0),
            null,
        ));

        // Duration 100 and architecture 50, equally weighted. On population figures the
        // architecture half would be 25 and the score 62.5.
        $this->assertEqualsWithDelta(75.0, $this->calculateFor()->score, 0.001);
    }

    // --- Slice F: happy path ---

    // S
    public function test_should_return_an_established_score_for_a_well_recovered_day(): void
    {
        $this->givenBaselineHistory(60.0);
        $this->givenDay(self::TODAY, 8.0, 55.0);

        $result = $this->calculateFor();

        $this->assertTrue($result->isAvailable());
        $this->assertFalse($result->provisional);
        $this->assertFalse($result->illnessWarning);
        $this->assertGreaterThan(50.0, $result->score);
        $this->assertSame(self::TODAY, $result->date);
    }
}

