<?php

namespace App\Models;

use App\Domain\Movement\ValueObject\SessionSource;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Persistence only. */
class ExerciseSession extends Model
{
    /** The only movement the pose counter can read today. */
    public const EXERCISE_SQUAT = 'squat';

    /** Demonstrated by the guided figure only -- nothing counts a knee raise from a camera. */
    public const EXERCISE_MARCH = 'march';

    /**
     * Every rep observed and graded by the on-device pose model.
     *
     * Taken from the domain enum rather than spelled again here, on the same reasoning
     * `MealEntry` records: two lists of the same strings drift, and the way they drift is
     * that a row is written with a `source` the domain does not recognise and is quietly
     * described as the weaker claim for the rest of its life.
     */
    public const SOURCE_POSE = SessionSource::Pose->value;

    /** Followed along to the animated figure. The reps are assumed, not seen. */
    public const SOURCE_GUIDED = SessionSource::Guided->value;

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
        'source',
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
