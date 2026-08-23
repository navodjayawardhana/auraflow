<?php

namespace App\Domain\Planning\Service;

use App\Domain\Planning\Model\WellbeingPlan;
use App\Domain\Planning\ValueObject\HeartRateZones;
use App\Domain\Planning\ValueObject\MeasuredHistory;
use App\Domain\Planning\ValueObject\PlanBasis;
use App\Domain\Planning\ValueObject\PlanSource;
use App\Domain\Profile\Model\UserProfile;
use App\Domain\Profile\ValueObject\Sex;
use DateTimeImmutable;
use InvalidArgumentException;

/**
 * The profile and the measurements in; a plan and the reasons for it out.
 *
 * This is the only place the five formulas meet, and the only place that decides what to
 * do when one of them cannot run. Every such decision follows the same rule the recovery
 * score's `provisional` flag already set: produce something, and say what it did not
 * know. Nothing here invents a term to keep a formula alive.
 *
 * Pure. No clock, no repository, no framework -- the reference date arrives as an
 * argument because a plan derived "today" must age the person as at today, and a test
 * has to be able to fix that day.
 */
final class PlanDeriver
{
    public function __construct(
        private readonly EnergyExpenditureCalculator $energy,
        private readonly HeartRateZoneCalculator $heartRate,
        private readonly HydrationGoalCalculator $hydration,
        private readonly StepGoalCalculator $steps,
        private readonly SleepNeedCalculator $sleep,
    ) {
    }

    public function derive(
        UserProfile $profile,
        MeasuredHistory $history,
        DateTimeImmutable $on,
        int $version = 1,
    ): WellbeingPlan {
        if ($version < 1) {
            throw new InvalidArgumentException('Plan versions are 1-based.');
        }

        $age = $profile->ageOn($on);
        $activityLevel = $profile->activityLevel();

        $bmr = $this->energy->basalMetabolicRate($age, $profile->sex(), $profile->heightCm(), $profile->weightKg());
        $tdee = $this->energy->totalDailyEnergyExpenditure($bmr, $activityLevel);

        $zones = $this->heartRate->zonesFor($age, $history->restingHeartRate);

        return WellbeingPlan::derived(
            $profile->userId(),
            $version,
            $this->steps->dailyGoal($history->medianDailySteps),
            $this->hydration->dailyGoalMl($profile->weightKg(), $profile->sex()),
            $this->energy->activeEnergyGoal($bmr, $tdee),
            $this->sleep->needHours($age),
            $zones,
            new PlanBasis(
                $bmr,
                $tdee,
                // Reported even when there is no BMR to multiply. The factor is a fact
                // about what the user said they do, and showing it is how they discover
                // that answering the activity question would change their calorie goal.
                $activityLevel->physicalActivityLevel(),
                $zones?->maximumBpm,
                $this->restingHeartRateBpm($history, $zones),
                $this->restingHeartRateSource($history, $zones !== null),
                $history->medianDailySteps === null ? PlanSource::POPULATION_DEFAULT : PlanSource::MEASURED_7D,
                $this->waterSource($profile),
                $age === null ? PlanSource::POPULATION_DEFAULT : PlanSource::PROFILE_AGE,
                $this->sleep->recommendedRange($age),
                $this->missingFields($profile, $age),
            ),
        );
    }

    /**
     * The resting rate the basis reports.
     *
     * A measured baseline is worth showing whether or not zones could be built from it --
     * "your resting heart rate over the last fortnight is 54" is a finding in its own
     * right, and an age-less profile should still see it. The population value only
     * appears when it was actually used, which is to say when there are zones.
     */
    private function restingHeartRateBpm(MeasuredHistory $history, ?HeartRateZones $zones): ?int
    {
        if ($history->restingHeartRate !== null) {
            return (int) round($history->restingHeartRate->mean());
        }

        return $zones?->restingBpm;
    }

    /**
     * Which resting heart rate answered -- the single most load-bearing line in the
     * basis, because it is the difference between zones that are the user's own and
     * zones that are a table's.
     */
    private function restingHeartRateSource(MeasuredHistory $history, bool $hasZones): ?string
    {
        if ($history->restingHeartRate !== null) {
            return PlanSource::MEASURED_14D;
        }

        return $hasZones ? PlanSource::POPULATION_DEFAULT : null;
    }

    private function waterSource(UserProfile $profile): string
    {
        if ($profile->weightKg() !== null) {
            return PlanSource::PROFILE_MASS;
        }

        return $profile->sex()->efsaTotalWaterAdequateIntakeMl() === null
            ? PlanSource::POPULATION_DEFAULT
            : PlanSource::PROFILE_SEX;
    }

    /**
     * The profile fields whose absence changed an answer.
     *
     * Only fields that actually cost the user something appear. Listing everything blank
     * would turn the prompt into noise; listing exactly what a formula reached for and
     * did not find is a reason to go and fill it in.
     *
     * `date_of_birth` is reported when there is no usable age, which covers a missing
     * date and a date the clock made nonsense of alike -- from the plan's side those are
     * the same gap.
     *
     * @return string[]
     */
    private function missingFields(UserProfile $profile, ?int $age): array
    {
        $missing = [];

        if ($age === null) {
            $missing[] = 'date_of_birth';
        }

        if ($profile->sex() === Sex::Unspecified) {
            $missing[] = 'sex';
        }

        if ($profile->heightCm() === null) {
            $missing[] = 'height_cm';
        }

        if ($profile->weightKg() === null) {
            $missing[] = 'weight_kg';
        }

        if ($profile->statedActivityLevel() === null) {
            $missing[] = 'activity_level';
        }

        return $missing;
    }
}
