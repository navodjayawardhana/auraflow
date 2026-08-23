<?php

namespace Tests\Unit\Domain\Advice;

use App\Domain\Advice\ValueObject\ContextFingerprint;
use App\Domain\Advice\ValueObject\DailyContext;
use App\Domain\Advice\ValueObject\DayPart;
use App\Domain\Advice\ValueObject\GroundingPack;
use App\Domain\Advice\ValueObject\HistoryDay;
use App\Domain\Advice\ValueObject\PlanTargets;
use App\Domain\Movement\ValueObject\CompletedSession;
use App\Domain\Movement\ValueObject\SessionSource;
use App\Domain\Planning\ValueObject\PlanSource;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
use PHPUnit\Framework\TestCase;

/**
 * Whether settled advice may be rewritten, and how often, is decided entirely here.
 *
 * Both ways of being wrong are expensive and neither is visible from the outside. Too
 * sensitive and every tap on "+250 ml" is a paid model call and a brief that rewords
 * itself under the reader; too coarse and the 07:00 brief goes on claiming they have drunk
 * 250 ml at nine in the evening, which is the complaint the whole mechanism answers. So
 * each bucket has a case for the move that should fire it and a case for the move that
 * should not.
 */
class ContextFingerprintTest extends TestCase
{
    private const DATE = '2026-08-21';

    /**
     * @param  array<string, mixed>  $today  the day's fields, by name
     * @param  array<string, mixed>  $pack   the pack's other fields, by name
     */
    private function fingerprint(array $today = [], array $pack = []): ContextFingerprint
    {
        $context = new DailyContext(...(['date' => self::DATE] + $today));

        return ContextFingerprint::of(new GroundingPack(...(['today' => $context] + $pack)));
    }

    // --- Immaterial changes hold ---

    public function test_should_hold_when_one_glass_of_water_is_logged(): void
    {
        // The app logs 250 ml a tap. If a tap moved this, someone drinking normally would
        // pay for eight rewrites of the same three paragraphs.
        $this->assertTrue(
            $this->fingerprint(['waterMl' => 1000])->equals($this->fingerprint(['waterMl' => 1250])),
        );
    }

    public function test_should_hold_when_a_recovery_score_moves_by_a_point(): void
    {
        $this->assertTrue(
            $this->fingerprint(['recoveryScore' => 62])->equals($this->fingerprint(['recoveryScore' => 64])),
        );
    }

    public function test_should_hold_when_a_few_hundred_steps_are_walked(): void
    {
        $this->assertTrue(
            $this->fingerprint(['steps' => 4100])->equals($this->fingerprint(['steps' => 4600])),
        );
    }

    public function test_should_hold_when_a_past_days_score_is_rederived_by_a_point(): void
    {
        // Scores are derived on read, never stored, so a past day's number can shift by a
        // point for reasons nobody did anything about. The history is bucketed coarsely so
        // that arithmetic cannot become a rewrite.
        $this->assertTrue(
            $this->fingerprint([], ['history' => [new HistoryDay('2026-08-20', recoveryScore: 61)]])
                ->equals($this->fingerprint([], ['history' => [new HistoryDay('2026-08-20', recoveryScore: 62)]])),
        );
    }

    // --- Material changes move ---

    public function test_should_move_when_the_days_water_crosses_a_quarter_of_the_target(): void
    {
        // The case in the complaint: 250 ml at breakfast, two litres by the evening.
        $this->assertFalse(
            $this->fingerprint(['waterMl' => 250])->equals($this->fingerprint(['waterMl' => 2000])),
        );
    }

    public function test_should_move_when_a_night_is_logged_at_noon(): void
    {
        $this->assertFalse(
            $this->fingerprint(['steps' => 2000])
                ->equals($this->fingerprint(['steps' => 2000, 'sleepMinutes' => 430])),
        );
    }

    public function test_should_move_when_a_first_step_count_arrives(): void
    {
        // A missing figure must not collapse onto bucket zero. "No count" and "four hundred
        // steps" are the same integer after division and are not the same day.
        $this->assertFalse($this->fingerprint()->equals($this->fingerprint(['steps' => 400])));
    }

    public function test_should_move_when_a_partial_step_count_becomes_a_whole_day(): void
    {
        // Not a magnitude. The same number stops being a floor, and that changes what may
        // be said about it rather than by how much.
        $this->assertFalse(
            $this->fingerprint(['steps' => 6000, 'stepsAreComplete' => false])
                ->equals($this->fingerprint(['steps' => 6000, 'stepsAreComplete' => true])),
        );
    }

    public function test_should_move_when_a_score_stops_being_provisional(): void
    {
        $this->assertFalse(
            $this->fingerprint(['recoveryScore' => 70, 'recoveryIsProvisional' => true])
                ->equals($this->fingerprint(['recoveryScore' => 70])),
        );
    }

    public function test_should_move_when_the_illness_flag_is_raised(): void
    {
        $this->assertFalse(
            $this->fingerprint(['recoveryScore' => 41])
                ->equals($this->fingerprint(['recoveryScore' => 41, 'illnessWarning' => true])),
        );
    }

    public function test_should_move_when_the_resting_rate_changes_kind(): void
    {
        $this->assertFalse(
            $this->fingerprint(['restingHeartRate' => 60.0, 'restingHeartRateSource' => RestingHeartRateSource::Overnight])
                ->equals($this->fingerprint(['restingHeartRate' => 60.0, 'restingHeartRateSource' => RestingHeartRateSource::SeatedSpot])),
        );
    }

    public function test_should_move_when_a_session_is_logged(): void
    {
        $session = CompletedSession::on(self::DATE, 'squat', SessionSource::Pose, 30, 22);

        $this->assertFalse(
            $this->fingerprint()->equals($this->fingerprint([], ['sessions' => [$session]])),
        );
    }

    public function test_should_move_when_the_plan_changes(): void
    {
        $targets = static fn (int $stepGoal): PlanTargets => new PlanTargets(
            stepGoal: $stepGoal,
            waterMl: 2400,
            sleepNeedHours: 8.0,
            activeKcalGoal: null,
            heartRateZoneSummary: null,
            stepGoalSource: PlanSource::MEASURED_7D,
            waterSource: PlanSource::PROFILE_MASS,
            sleepNeedSource: PlanSource::PROFILE_AGE,
        );

        $this->assertFalse(
            $this->fingerprint([], ['targets' => $targets(7500)])
                ->equals($this->fingerprint([], ['targets' => $targets(9000)])),
        );
    }

    public function test_should_move_when_the_day_reaches_the_evening(): void
    {
        // The same figures at breakfast and at nine at night are not the same context, and
        // this is the whole of why a brief may change on a day nothing was logged.
        $this->assertFalse(
            $this->fingerprint([], ['dayPart' => DayPart::Morning])
                ->equals($this->fingerprint([], ['dayPart' => DayPart::Evening])),
        );
    }

    public function test_should_bucket_the_clock_into_three(): void
    {
        // Bounded on purpose: a passing clock is worth at most two rewrites in a day.
        $this->assertSame(DayPart::Morning, DayPart::fromHour(7));
        $this->assertSame(DayPart::Morning, DayPart::fromHour(11));
        $this->assertSame(DayPart::Afternoon, DayPart::fromHour(12));
        $this->assertSame(DayPart::Afternoon, DayPart::fromHour(16));
        $this->assertSame(DayPart::Evening, DayPart::fromHour(17));
        $this->assertSame(DayPart::Evening, DayPart::fromHour(23));
    }

    // --- Reading one back off a row ---

    public function test_should_treat_a_brief_with_no_stored_fingerprint_as_unknown(): void
    {
        // Written before the column existed. "We do not know what this was written from" is
        // a reason to rewrite once, not a reason to call it current forever.
        $this->assertFalse($this->fingerprint()->equals(ContextFingerprint::fromStored(null)));
        $this->assertNull(ContextFingerprint::fromStored(''));
    }

    public function test_should_match_a_fingerprint_that_has_been_round_tripped_through_storage(): void
    {
        $fingerprint = $this->fingerprint(['recoveryScore' => 70, 'waterMl' => 1200]);

        $this->assertTrue($fingerprint->equals(ContextFingerprint::fromStored($fingerprint->value)));
    }
}
