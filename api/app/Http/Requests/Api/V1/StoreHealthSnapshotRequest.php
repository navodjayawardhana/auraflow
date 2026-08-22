<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * Boundary validation for an ingested night, so the domain never has to defend against
 * a malformed payload from a device, a bridge, or a hand-typed form.
 */
class StoreHealthSnapshotRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            // Future dates are rejected outright rather than clamped: a client with a
            // wrong clock would otherwise write a night that has not happened, and every
            // trailing baseline computed from these rows would inherit the error.
            'recorded_on' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],

            'sleep_minutes' => ['nullable', 'integer', 'min:0', 'max:1440'],
            'deep_sleep_minutes' => ['nullable', 'integer', 'min:0', 'max:1440'],
            'rem_sleep_minutes' => ['nullable', 'integer', 'min:0', 'max:1440'],
            'resting_heart_rate' => ['nullable', 'numeric', 'min:25', 'max:220'],

            // Ranges rather than value objects: these carry no physiological invariant
            // the domain has to defend, only an upper bound that catches a broken
            // pedometer or a fat-fingered entry. 100k steps is roughly 75 km on foot.
            'steps' => ['nullable', 'integer', 'min:0', 'max:100000'],
            'water_ml' => ['nullable', 'integer', 'min:0', 'max:20000'],
        ];
    }

    /**
     * Cross-field rules the per-field ones cannot express.
     */
    public function after(): array
    {
        return [
            function (Validator $validator) {
                $sleep = $this->integer('sleep_minutes');
                $deep = $this->input('deep_sleep_minutes');
                $rem = $this->input('rem_sleep_minutes');

                if ($this->input('sleep_minutes') === null) {
                    // Stage minutes describe a night's structure; without a total they
                    // describe nothing.
                    foreach (['deep_sleep_minutes', 'rem_sleep_minutes'] as $field) {
                        if ($this->input($field) !== null) {
                            $validator->errors()->add(
                                $field,
                                'Stage minutes need a total sleep_minutes to sit inside.',
                            );
                        }
                    }

                    return;
                }

                if ((int) $deep + (int) $rem > $sleep) {
                    $validator->errors()->add(
                        'deep_sleep_minutes',
                        'Deep and REM minutes cannot exceed the total slept.',
                    );
                }
            },
        ];
    }
}
