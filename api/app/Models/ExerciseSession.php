<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Persistence only. */
class ExerciseSession extends Model
{
    /** The only movement the pose counter can read today. */
    public const EXERCISE_SQUAT = 'squat';

    /** Mirrors SessionIntensity in the app's session-prescription module. */
    public const INTENSITY_FULL = 'full';

    public const INTENSITY_REDUCED = 'reduced';

    public const INTENSITY_MOBILITY = 'mobility';

    /** The score had not loaded, so nothing was gated. Not the same as a low score. */
    public const INTENSITY_UNKNOWN = 'unknown';

    protected $fillable = [
        'user_id',
        'performed_on',
        'performed_at',
        'exercise',
        'total_reps',
        'good_form_reps',
        'duration_seconds',
        'mean_heart_rate',
        'prescribed_intensity',
        'recovery_score',
        'client_uuid',
    ];

    protected function casts(): array
    {
        return [
            'performed_on' => 'immutable_date',
            'performed_at' => 'immutable_datetime',
            'total_reps' => 'integer',
            'good_form_reps' => 'integer',
            'duration_seconds' => 'integer',
            'mean_heart_rate' => 'integer',
            'recovery_score' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
