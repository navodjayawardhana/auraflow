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

    public function findRange(UserId $userId, DateTimeImmutable $from, DateTimeImmutable $to): array
    {
        $models = EloquentHealthSnapshot::query()
            ->where('user_id', $userId->toString())
            ->whereDate('recorded_on', '>=', $from->format('Y-m-d'))
            ->whereDate('recorded_on', '<=', $to->format('Y-m-d'))
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
        //
        // Matched with whereDate rather than updateOrCreate's equality: `recorded_on` is
        // cast to a date, so the stored value carries a time component that a plain
        // 'Y-m-d' comparison misses -- the lookup would never match, the insert would
        // run, and the unique index would reject it.
        $existing = EloquentHealthSnapshot::query()
            ->where('user_id', $attributes['user_id'])
            ->whereDate('recorded_on', $attributes['recorded_on'])
            ->first();

        if ($existing !== null) {
            // Merge, don't replace. The day's signals arrive from different places at
            // different times -- a night's sleep once in the morning, a water total a
            // dozen times through the day, a step count on its own -- and each write
            // carries only what it knows. Filling the row wholesale would let a water
            // tap null out the sleep that produced today's recovery score.
            //
            // "Absent" therefore means "leave alone" rather than "clear". Clearing a
            // value is not currently expressible, and until something needs to, adding a
            // way would only be a sharper edge to cut on.
            $fill = array_filter($attributes, static fn ($value) => $value !== null);

            // Steps and their completeness are one fact and are written as one, including
            // when the completeness is null. Left to the rule above, a count arriving
            // without a stated provenance would inherit whatever the previous write said:
            // an Android phone's partial afternoon total silently wearing yesterday's
            // "this is the whole day", which is the single reading that would put an
            // undercount into a step-goal median.
            if (array_key_exists('steps', $fill)) {
                $fill['steps_are_complete'] = $attributes['steps_are_complete'];
            }

            // A resting rate and how it was taken are one fact too, written together for the
            // same reason. Left to the merge rule, a morning check-in landing on a day that
            // already held a watch reading would overwrite the number and keep the word
            // `overnight` beside it -- a seated figure filed in the overnight baseline, which
            // is the exact defect this column was added to end.
            if (array_key_exists('resting_heart_rate', $fill)) {
                $fill['resting_hr_source'] = $attributes['resting_hr_source'];
            }

            $existing->fill($fill)->save();

            return;
        }

        EloquentHealthSnapshot::query()->create($attributes);
    }
}
