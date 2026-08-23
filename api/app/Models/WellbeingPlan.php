<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Persistence only.
 *
 * Every formula behind these numbers lives in App\Domain\Planning\Service. See
 * Infrastructure\Planning\Persistence\WellbeingPlanMapper for the translation.
 */
class WellbeingPlan extends Model
{
    protected $fillable = [
        'user_id',
        'version',
        'source',
        'step_goal',
        'water_ml',
        'active_kcal_goal',
        'sleep_need_hours',
        'hr_zones',
        'basis',
        'edited_fields',
        'client_uuid',
    ];

    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'step_goal' => 'integer',
            'water_ml' => 'integer',
            'active_kcal_goal' => 'integer',
            'sleep_need_hours' => 'float',
            'hr_zones' => 'array',
            'basis' => 'array',
            'edited_fields' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
