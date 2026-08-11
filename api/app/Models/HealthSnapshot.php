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
    ];

    protected function casts(): array
    {
        return [
            'recorded_on' => 'immutable_date',
            'sleep_minutes' => 'integer',
            'deep_sleep_minutes' => 'integer',
            'rem_sleep_minutes' => 'integer',
            'resting_heart_rate' => 'float',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
