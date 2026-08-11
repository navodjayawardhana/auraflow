<?php

namespace App\Infrastructure\Wellbeing\Persistence;

use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\ValueObject\UserId;
use App\Models\HealthSnapshot as EloquentHealthSnapshot;
use DateTimeImmutable;

final class EloquentDailyHealthSnapshotRepository implements DailyHealthSnapshotRepository
{
    public function findForDate(UserId $userId, DateTimeImmutable $date): ?DailyHealthSnapshot
    {
        $model = EloquentHealthSnapshot::query()
            ->where('user_id', $userId->toString())
            ->whereDate('recorded_on', $date->format('Y-m-d'))
            ->first();

        return $model === null ? null : DailyHealthSnapshotMapper::toDomain($model);
    }

    public function findPrecedingDays(UserId $userId, DateTimeImmutable $before, int $days): array
    {
        $earliest = $before->modify(sprintf('-%d days', $days));

        $models = EloquentHealthSnapshot::query()
            ->where('user_id', $userId->toString())
            // Strictly before the day being scored: a baseline that includes today lets
            // the reading pull its own reference.
            ->whereDate('recorded_on', '<', $before->format('Y-m-d'))
            ->whereDate('recorded_on', '>=', $earliest->format('Y-m-d'))
            ->orderBy('recorded_on')
            ->get();

        return $models->map(DailyHealthSnapshotMapper::toDomain(...))->all();
    }

    public function save(DailyHealthSnapshot $snapshot): void
    {
        $attributes = DailyHealthSnapshotMapper::toEloquentAttributes($snapshot);

        // Idempotent by (user, day): a device re-syncing the same night must update the
        // row rather than add a second one. Duplicates would silently corrupt every
        // trailing baseline computed from these rows.
        EloquentHealthSnapshot::query()->updateOrCreate(
            [
                'user_id' => $attributes['user_id'],
                'recorded_on' => $attributes['recorded_on'],
            ],
            $attributes,
        );
    }
}
