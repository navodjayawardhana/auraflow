<?php

namespace App\Infrastructure\Wellbeing\Persistence;

use App\Domain\Wellbeing\Exception\InvalidHeartRateException;
use App\Domain\Wellbeing\Exception\InvalidSleepSummaryException;
use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\ValueObject\RestingHeartRate;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
use App\Domain\Wellbeing\ValueObject\SleepSummary;
use App\Domain\Wellbeing\ValueObject\UserId;
use App\Models\HealthSnapshot as EloquentHealthSnapshot;
use DateTimeImmutable;

final class DailyHealthSnapshotMapper
{
    public static function toDomain(EloquentHealthSnapshot $model): DailyHealthSnapshot
    {
        return DailyHealthSnapshot::reconstitute(
            UserId::fromString((string) $model->user_id),
            new DateTimeImmutable($model->recorded_on->format('Y-m-d')),
            self::toSleep($model),
            self::toRestingHeartRate($model),
            $model->steps,
            $model->steps_are_complete,
            $model->water_ml,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public static function toEloquentAttributes(DailyHealthSnapshot $snapshot): array
    {
        $sleep = $snapshot->sleep();

        return [
            'user_id'            => $snapshot->userId()->toString(),
            'recorded_on'        => $snapshot->date()->format('Y-m-d'),
            'sleep_minutes'      => $sleep === null ? null : (int) round($sleep->hours() * 60),
            'deep_sleep_minutes' => $sleep?->deepMinutes() === null ? null : (int) round($sleep->deepMinutes()),
            'rem_sleep_minutes'  => $sleep?->remMinutes() === null ? null : (int) round($sleep->remMinutes()),
            'resting_heart_rate' => $snapshot->restingHeartRate()?->bpm(),
            'resting_hr_source'  => $snapshot->restingHeartRate()?->source()->value,
            'steps'              => $snapshot->steps(),
            'steps_are_complete' => $snapshot->stepsAreComplete(),
            'water_ml'           => $snapshot->waterMl(),
        ];
    }

    /**
     * Stored rows can predate a validation rule, or arrive from a vendor export that
     * disagrees with it. Rather than let a historic row crash the read path, an
     * unusable value is treated as absent -- the score's components already degrade
     * independently, so a missing one is a case the domain handles.
     */
    private static function toSleep(EloquentHealthSnapshot $model): ?SleepSummary
    {
        if ($model->sleep_minutes === null) {
            return null;
        }

        try {
            return SleepSummary::of(
                $model->sleep_minutes / 60,
                $model->deep_sleep_minutes === null ? null : (float) $model->deep_sleep_minutes,
                $model->rem_sleep_minutes === null ? null : (float) $model->rem_sleep_minutes,
            );
        } catch (InvalidSleepSummaryException) {
            return null;
        }
    }

    /**
     * A rate whose provenance the row does not state is treated as absent, the same way an
     * out-of-range one is.
     *
     * The migration backfilled every row that existed, and the endpoint refuses a rate
     * without a source, so this is reachable only by something writing to the table
     * directly. Reading such a row as overnight would be the whole defect back again in one
     * line -- a seated figure landing in the overnight baseline because a column was empty.
     * Dropping it costs one day of history; guessing costs the baseline.
     */
    private static function toRestingHeartRate(EloquentHealthSnapshot $model): ?RestingHeartRate
    {
        if ($model->resting_heart_rate === null || $model->resting_hr_source === null) {
            return null;
        }

        $source = RestingHeartRateSource::tryFrom((string) $model->resting_hr_source);

        if ($source === null) {
            return null;
        }

        try {
            return RestingHeartRate::fromBpm((float) $model->resting_heart_rate, $source);
        } catch (InvalidHeartRateException) {
            return null;
        }
    }
}
