<?php

namespace App\Infrastructure\Wellbeing\Persistence;

use App\Domain\Wellbeing\Exception\InvalidHeartRateException;
use App\Domain\Wellbeing\Exception\InvalidSleepSummaryException;
use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\ValueObject\RestingHeartRate;
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

    private static function toRestingHeartRate(EloquentHealthSnapshot $model): ?RestingHeartRate
    {
        if ($model->resting_heart_rate === null) {
            return null;
        }

        try {
            return RestingHeartRate::fromBpm((float) $model->resting_heart_rate);
        } catch (InvalidHeartRateException) {
            return null;
        }
    }
}
