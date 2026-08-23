<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Persistence only.
 *
 * This class exists to talk to the database and nothing else. Every rule about what a
 * health snapshot means lives in App\Domain\Wellbeing -- see
 * Infrastructure\Wellbeing\Persistence\DailyHealthSnapshotMapper for the translation.
 *
 * Adding behaviour here would put business logic behind a framework base class, which
 * is exactly the coupling the Domain layer is arranged to avoid.
 */
class HealthSnapshot extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'recorded_on',
        'sleep_minutes',
        'deep_sleep_minutes',
        'rem_sleep_minutes',
        'resting_heart_rate',
        'resting_hr_source',
        'steps',
        'steps_are_complete',
        'water_ml',
    ];

    protected function casts(): array
    {
        return [
            'recorded_on' => 'immutable_date',
            'sleep_minutes' => 'integer',
            'deep_sleep_minutes' => 'integer',
            'rem_sleep_minutes' => 'integer',
            'resting_heart_rate' => 'float',
            // Left as a plain string rather than cast to the domain enum. Casting here
            // would put a Domain type behind a framework base class, which is the coupling
            // this file exists to avoid -- the mapper does the translation, once.
            'steps' => 'integer',
            'steps_are_complete' => 'boolean',
            'water_ml' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
