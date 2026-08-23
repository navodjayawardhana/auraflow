<?php

namespace App\Infrastructure\Planning\Persistence;

use App\Domain\Planning\Model\WellbeingPlan;
use App\Domain\Planning\ValueObject\HeartRateZones;
use App\Domain\Planning\ValueObject\PlanBasis;
use App\Domain\Planning\ValueObject\PlanSource;
use App\Domain\Wellbeing\ValueObject\UserId;
use App\Models\WellbeingPlan as EloquentWellbeingPlan;
use DateTimeImmutable;

final class WellbeingPlanMapper
{
    public static function toDomain(EloquentWellbeingPlan $model): WellbeingPlan
    {
        return WellbeingPlan::reconstitute(
            UserId::fromString((string) $model->user_id),
            $model->version,
            PlanSource::from($model->source),
            $model->step_goal,
            $model->water_ml,
            $model->active_kcal_goal,
            $model->sleep_need_hours,
            $model->hr_zones === null ? null : HeartRateZones::fromArray($model->hr_zones),
            PlanBasis::fromArray($model->basis ?? []),
            $model->edited_fields ?? [],
            $model->client_uuid,
            $model->created_at === null ? null : new DateTimeImmutable($model->created_at->toAtomString()),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public static function toEloquentAttributes(WellbeingPlan $plan): array
    {
        return [
            'user_id' => $plan->userId()->toString(),
            'version' => $plan->version(),
            'source' => $plan->source()->value,
            'step_goal' => $plan->stepGoal(),
            'water_ml' => $plan->waterMl(),
            'active_kcal_goal' => $plan->activeKcalGoal(),
            'sleep_need_hours' => $plan->sleepNeedHours(),
            // The zones carry the resting and maximum rates they were built from, which
            // the API response does not return. Stored anyway: without them a historic
            // zone is three pairs of numbers nobody can account for.
            'hr_zones' => $plan->heartRateZones()?->toStorage(),
            'basis' => $plan->basis()->toArray(),
            'edited_fields' => $plan->editedFields(),
            'client_uuid' => $plan->clientUuid(),
        ];
    }
}
