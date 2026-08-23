<?php

namespace App\Http\Requests\Api\V1;

use App\Models\ExerciseSession;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreExerciseSessionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'exercise' => ['required', Rule::in([
                ExerciseSession::EXERCISE_SQUAT,
                ExerciseSession::EXERCISE_MARCH,
            ])],
            // Optional so a write replayed from an outbox filled before guided sessions
            // existed still lands; the controller reads a missing value as 'pose', which
            // is what every such queued write was.
            'source' => ['nullable', Rule::in([
                ExerciseSession::SOURCE_POSE,
                ExerciseSession::SOURCE_GUIDED,
            ])],
            // 500 is far past any bodyweight set; it exists to catch a counter that has
            // run away on jitter rather than to police how much anyone trains.
            'total_reps' => ['required', 'integer', 'min:0', 'max:500'],
            // Nullable at this level and pinned to the source below: a counted session
            // must carry it, a guided one must not.
            'good_form_reps' => ['nullable', 'integer', 'min:0', 'max:500'],
            // Four hours. A session longer than that is a screen left on, not exercise.
            'duration_seconds' => ['required', 'integer', 'min:0', 'max:14400'],
            'mean_heart_rate' => ['nullable', 'integer', 'min:30', 'max:230'],
            'prescribed_intensity' => ['required', Rule::in([
                ExerciseSession::INTENSITY_FULL,
                ExerciseSession::INTENSITY_REDUCED,
                ExerciseSession::INTENSITY_MOBILITY,
                ExerciseSession::INTENSITY_UNKNOWN,
            ])],
            'recovery_score' => ['nullable', 'integer', 'min:0', 'max:100'],
            'performed_at' => ['nullable', 'date', 'before_or_equal:now'],
            // Supplied by the offline outbox so a replayed write lands once. Opaque to
            // the server -- it only ever compares it to what this user sent before.
            'client_uuid' => ['nullable', 'string', 'max:64'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                if ($validator->errors()->isNotEmpty()) {
                    return;
                }

                $isGuided = $this->input('source') === ExerciseSession::SOURCE_GUIDED;

                // Nothing watched a guided session, so there is no form count to report.
                // Accepting one would let the app pass off `total_reps` as a measurement
                // of depth that no camera ever made.
                if ($isGuided && $this->filled('good_form_reps')) {
                    $validator->errors()->add(
                        'good_form_reps',
                        'A guided session cannot report reps at depth -- nothing observed them.',
                    );
                }

                // The mirror image: a counted session that omits it is a client bug, not a
                // session in which nobody reached depth.
                if (! $isGuided && ! $this->filled('good_form_reps')) {
                    $validator->errors()->add(
                        'good_form_reps',
                        'A counted session must report how many reps reached depth.',
                    );
                }

                // Only the guided figure demonstrates a march; the pose counter reads a
                // knee angle and would grade one as a very shallow squat.
                if (! $isGuided && $this->input('exercise') === ExerciseSession::EXERCISE_MARCH) {
                    $validator->errors()->add(
                        'exercise',
                        'A march can only be logged from a guided session.',
                    );
                }

                // Good-form reps are a subset of the reps that happened. A row claiming
                // otherwise would put the history's quality ratio above 100%.
                if ($this->integer('good_form_reps') > $this->integer('total_reps')) {
                    $validator->errors()->add(
                        'good_form_reps',
                        'Good-form reps cannot exceed the reps counted.',
                    );
                }

                // A gated session must say what it was gated on; an ungated one must not
                // invent a score it never saw.
                $intensity = $this->input('prescribed_intensity');
                $hasScore = $this->filled('recovery_score');

                if ($intensity === ExerciseSession::INTENSITY_UNKNOWN && $hasScore) {
                    $validator->errors()->add(
                        'recovery_score',
                        'An ungated session cannot carry a recovery score.',
                    );
                }

                if ($intensity !== ExerciseSession::INTENSITY_UNKNOWN && ! $hasScore) {
                    $validator->errors()->add(
                        'recovery_score',
                        'A gated session must carry the score it was gated on.',
                    );
                }
            },
        ];
    }
}
