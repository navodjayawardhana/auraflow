<?php

namespace Tests\Unit\Domain\Planning\Service;

use App\Domain\Planning\Service\EnergyExpenditureCalculator;
use App\Domain\Planning\Service\HeartRateZoneCalculator;
use App\Domain\Planning\Service\HydrationGoalCalculator;
use App\Domain\Planning\Service\PlanDeriver;
use App\Domain\Planning\Service\SleepNeedCalculator;
use App\Domain\Planning\Service\StepGoalCalculator;
use App\Domain\Planning\ValueObject\MeasuredHistory;
use App\Domain\Planning\ValueObject\PlanSource;
use App\Domain\Profile\Model\UserProfile;
use App\Domain\Profile\ValueObject\ActivityLevel;
use App\Domain\Profile\ValueObject\Sex;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

/**
 * The five formulas composed, and -- more importantly -- what happens when one of them
 * cannot run.
 *
 * Every gap has to produce two things: a usable plan, and an honest account of what was
 * missing. That is the same discipline as the recovery score's `provisional` flag, and
 * the tests below are mostly about the second half of it.
 */
class PlanDeriverTest extends TestCase
{
    private const TODAY = '2026-08-22';

    private PlanDeriver $deriver;

    protected function setUp(): void
    {
        $this->deriver = new PlanDeriver(
            new EnergyExpenditureCalculator(),
            new HeartRateZoneCalculator(),
            new HydrationGoalCalculator(),
            new StepGoalCalculator(),
            new SleepNeedCalculator(),
        );
    }

    private function userId(): UserId
    {
        return UserId::fromString('user-1');
    }

    private function on(): DateTimeImmutable
    {
        return new DateTimeImmutable(self::TODAY);
    }

    private function fullProfile(): UserProfile
    {
        return UserProfile::of(
            $this->userId(),
            new DateTimeImmutable('1986-08-22'),   // 40 on the reference date
            Sex::Male,
            178,
            76.0,
            ActivityLevel::Moderate,
        );
    }

    private function baselineAt(float $mean): RestingHeartRateBaseline
    {
        return RestingHeartRateBaseline::fromPriorReadings([
            $mean - 3, $mean, $mean + 3, $mean - 1, $mean + 1, $mean,
        ], RestingHeartRateSource::Overnight);
    }

    // --- Slice A: the cold start ---

    // Z
    public function test_should_produce_a_plan_for_a_profile_that_says_nothing(): void
    {
        $plan = $this->deriver->derive(
            UserProfile::empty($this->userId()),
            MeasuredHistory::none(),
            $this->on(),
        );

        // The app's existing constants, unchanged, so nobody's day gets worse for having
        // an empty profile.
        $this->assertSame(10000, $plan->stepGoal());
        $this->assertSame(2000, $plan->waterMl());
        $this->assertSame(8.0, $plan->sleepNeedHours());
        $this->assertSame(1, $plan->version());
    }

    // Z
    public function test_should_withhold_the_two_numbers_that_are_health_advice(): void
    {
        // A calorie burn target and a heart-rate range both need terms an empty profile
        // does not carry. There is no population substitute that would not amount to
        // prescribing exercise to a person who is not the user.
        $plan = $this->deriver->derive(
            UserProfile::empty($this->userId()),
            MeasuredHistory::none(),
            $this->on(),
        );

        $this->assertNull($plan->activeKcalGoal());
        $this->assertNull($plan->heartRateZones());
    }

    // Z
    public function test_should_list_every_field_an_empty_profile_failed_to_supply(): void
    {
        $basis = $this->deriver->derive(
            UserProfile::empty($this->userId()),
            MeasuredHistory::none(),
            $this->on(),
        )->basis();

        $this->assertSame(
            ['date_of_birth', 'sex', 'height_cm', 'weight_kg', 'activity_level'],
            $basis->missing,
        );
        $this->assertSame(PlanSource::POPULATION_DEFAULT, $basis->stepGoalSource);
        $this->assertSame(PlanSource::POPULATION_DEFAULT, $basis->waterSource);
    }

    // Z
    public function test_should_report_no_resting_rate_source_when_no_zones_were_built(): void
    {
        // A resting-HR source beside an absent zone set would imply a Karvonen
        // calculation that did not happen.
        $basis = $this->deriver->derive(
            UserProfile::empty($this->userId()),
            MeasuredHistory::none(),
            $this->on(),
        )->basis();

        $this->assertNull($basis->restingHrSource);
        $this->assertNull($basis->restingHrBpm);
    }

    // --- Slice B: filling the profile in, one field at a time ---

    // O
    public function test_should_stop_asking_for_a_field_once_it_has_been_supplied(): void
    {
        $profile = UserProfile::of($this->userId(), null, Sex::Unspecified, null, 82.0);

        $basis = $this->deriver->derive($profile, MeasuredHistory::none(), $this->on())->basis();

        $this->assertNotContains('weight_kg', $basis->missing);
        $this->assertContains('height_cm', $basis->missing);
        $this->assertSame(PlanSource::PROFILE_MASS, $basis->waterSource);
    }

    // O
    public function test_should_derive_zones_from_a_date_of_birth_alone(): void
    {
        // Age is the only term Tanaka needs, and Karvonen's other input has a stated
        // population fallback. So a user who supplies nothing but a birthday still gets
        // zones -- with the fallback declared.
        $profile = UserProfile::of($this->userId(), new DateTimeImmutable('1986-08-22'));

        $plan = $this->deriver->derive($profile, MeasuredHistory::none(), $this->on());

        $this->assertNotNull($plan->heartRateZones());
        $this->assertSame(180, $plan->heartRateZones()->maximumBpm);
        $this->assertSame(PlanSource::POPULATION_DEFAULT, $plan->basis()->restingHrSource);
    }

    // M
    public function test_should_assume_the_lowest_activity_band_until_told_otherwise(): void
    {
        // Sedentary rather than moderate: the factor only ever inflates an energy figure,
        // so the unfilled profile must not hand out a larger calorie target than the
        // user's life justifies.
        $unstated = UserProfile::of($this->userId(), new DateTimeImmutable('1986-08-22'), Sex::Male, 178, 76.0);

        $basis = $this->deriver->derive($unstated, MeasuredHistory::none(), $this->on())->basis();

        $this->assertSame(ActivityLevel::Sedentary->physicalActivityLevel(), $basis->activityFactor);
        $this->assertContains('activity_level', $basis->missing);
    }

    // --- Slice C: measured beats stated ---

    // I
    public function test_should_name_the_measured_baseline_when_one_exists(): void
    {
        $plan = $this->deriver->derive(
            $this->fullProfile(),
            new MeasuredHistory($this->baselineAt(52.0)),
            $this->on(),
        );

        $this->assertSame(PlanSource::MEASURED_14D, $plan->basis()->restingHrSource);
        $this->assertSame(52, $plan->basis()->restingHrBpm);
        $this->assertSame(52, $plan->heartRateZones()->restingBpm);
    }

    // I
    public function test_should_report_a_measured_resting_rate_even_when_it_cannot_build_zones(): void
    {
        // No date of birth, so no maximum and no zones -- but a fortnight of the user's
        // own resting heart rate is a finding worth showing on its own.
        $plan = $this->deriver->derive(
            UserProfile::empty($this->userId()),
            new MeasuredHistory($this->baselineAt(58.0)),
            $this->on(),
        );

        $this->assertNull($plan->heartRateZones());
        $this->assertSame(58, $plan->basis()->restingHrBpm);
        $this->assertSame(PlanSource::MEASURED_14D, $plan->basis()->restingHrSource);
    }

    // I
    public function test_should_name_the_measured_median_when_a_full_week_exists(): void
    {
        $plan = $this->deriver->derive(
            $this->fullProfile(),
            new MeasuredHistory(null, 6400),
            $this->on(),
        );

        $this->assertSame(7500, $plan->stepGoal());
        $this->assertSame(PlanSource::MEASURED_7D, $plan->basis()->stepGoalSource);
    }

    // --- Slice D: the versions and the names ---

    // E
    public function test_should_refuse_a_version_below_one(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        $this->deriver->derive(UserProfile::empty($this->userId()), MeasuredHistory::none(), $this->on(), 0);
    }

    // I
    public function test_should_name_a_formula_for_every_number_it_derived(): void
    {
        $basis = $this->deriver->derive(
            $this->fullProfile(),
            new MeasuredHistory($this->baselineAt(52.0), 9100),
            $this->on(),
        )->basis()->toArray();

        $this->assertSame('mifflin_st_jeor', $basis['bmr_formula']);
        $this->assertSame('tanaka', $basis['max_hr_formula']);
        $this->assertSame('karvonen', $basis['hr_zone_formula']);
        $this->assertSame([7.0, 9.0], $basis['sleep_need_range']);
    }

    // S
    public function test_should_derive_every_goal_for_a_complete_profile(): void
    {
        $plan = $this->deriver->derive(
            $this->fullProfile(),
            new MeasuredHistory($this->baselineAt(52.0), 9100),
            $this->on(),
        );

        // BMR = 10(76) + 6.25(178) - 5(40) + 5 = 1,677.
        $this->assertEqualsWithDelta(1677.0, $plan->basis()->bmrKcal, 0.5);
        // Moderate = the 1.70-1.99 band midpoint.
        $this->assertEqualsWithDelta(1677.0 * 1.85, $plan->basis()->tdeeKcal, 1.0);

        $this->assertSame(10000, $plan->stepGoal());          // median 9,100 -> next band
        // 76 kg: 1000 + 500 + (56 x 20) = 2,620 mL of total water, 80% of it drunk.
        $this->assertSame(2100, $plan->waterMl());
        $this->assertSame(8.0, $plan->sleepNeedHours());      // NSF adult band midpoint
        $this->assertNotNull($plan->activeKcalGoal());
        $this->assertSame([], $plan->basis()->missing);
        $this->assertSame(PlanSource::Derived, $plan->source());
    }
}
