<?php

namespace App\Infrastructure\Planning\Persistence;

use App\Domain\Planning\Model\WellbeingPlan;
use App\Domain\Planning\Repository\WellbeingPlanRepository;
use App\Domain\Wellbeing\ValueObject\UserId;
use App\Models\WellbeingPlan as EloquentWellbeingPlan;

final class EloquentWellbeingPlanRepository implements WellbeingPlanRepository
{
    public function findCurrent(UserId $userId): ?WellbeingPlan
    {
        $model = EloquentWellbeingPlan::query()
            ->where('user_id', $userId->toString())
            // By version, not by created_at. Two versions written inside the same second
            // -- a recalculation immediately overridden -- order arbitrarily by timestamp
            // on a column with second resolution, and "current" would flip between reads.
            ->orderByDesc('version')
            ->first();

        return $model === null ? null : WellbeingPlanMapper::toDomain($model);
    }

    public function history(UserId $userId, int $limit): array
    {
        $models = EloquentWellbeingPlan::query()
            ->where('user_id', $userId->toString())
            ->orderByDesc('version')
            ->limit($limit)
            ->get();

        return $models->map(WellbeingPlanMapper::toDomain(...))->all();
    }

    public function findByClientUuid(UserId $userId, string $clientUuid): ?WellbeingPlan
    {
        $model = EloquentWellbeingPlan::query()
            ->where('user_id', $userId->toString())
            ->where('client_uuid', $clientUuid)
            ->first();

        return $model === null ? null : WellbeingPlanMapper::toDomain($model);
    }

    public function save(WellbeingPlan $plan): void
    {
        // A plain insert. Versions are immutable by design, so there is no update path to
        // fall back on -- and the unique index on (user_id, version) is what turns two
        // concurrent recalculations into a rejected write rather than two rows both
        // calling themselves version 4.
        EloquentWellbeingPlan::query()->create(WellbeingPlanMapper::toEloquentAttributes($plan));
    }
}
