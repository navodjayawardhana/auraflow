<?php

namespace App\Http\Requests\Api\V1;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
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

            // Required alongside a rate, for the reason `steps_are_complete` is required
            // alongside a count: the same integer means two different things depending on
            // how it was taken, and a baseline built across both describes neither. Every
            // writer knows which it holds -- the night form takes an overnight figure, the
            // morning check-in takes a seated one -- so asking costs a field and guessing
            // costs the autonomic component its meaning.
            'resting_hr_source' => [
                'nullable',
                Rule::enum(RestingHeartRateSource::class),
                'required_with:resting_heart_rate',
            ],

            // Ranges rather than value objects: these carry no physiological invariant
            // the domain has to defend, only an upper bound that catches a broken
            // pedometer or a fat-fingered entry. 100k steps is roughly 75 km on foot.
            'steps' => ['nullable', 'integer', 'min:0', 'max:100000'],

            // Required alongside a count rather than optional, because a step count
            // whose provenance is unstated cannot be read: the same integer is a whole
            // day on iOS and only the foregrounded part of one on Android. Every writer
            // knows which it is holding, so asking is cheap; guessing downstream is not.
            'steps_are_complete' => ['nullable', 'boolean', 'required_with:steps'],

            'water_ml' => ['nullable', 'integer', 'min:0', 'max:20000'],
        ];
    }

    /**
     * The generated message for this one reads "the resting hr source field", which tells a
     * developer nothing about why it is being asked for -- and this is a rule people will
     * hit while wiring up a client.
     */
    public function messages(): array
    {
        return [
            'resting_hr_source.required_with' => 'Say how the resting heart rate was taken: '
                .'`overnight` for a night\'s reading from a wearable, `seated_spot` for a '
                .'check-in taken awake and sitting. The two are kept in separate baselines.',
        ];
    }

    /**
     * Cross-field rules the per-field ones cannot express.
     */
    public function after(): array
    {
        return [
            function (Validator $validator) {
                // A completeness flag with nothing to qualify describes nothing, the same
                // way stage minutes with no total do below.
                if ($this->input('steps') === null && $this->input('steps_are_complete') !== null) {
                    $validator->errors()->add(
                        'steps_are_complete',
                        'Completeness describes a step count and needs one to sit beside.',
                    );
                }
            },
            function (Validator $validator) {
                // A provenance with nothing to qualify, same as above. It also catches the
                // sequence that would otherwise be silent: a client that sends the source
                // on its own and the rate in a later merge write, leaving the row with a
                // label that no longer describes the number sitting next to it.
                if ($this->input('resting_heart_rate') === null && $this->input('resting_hr_source') !== null) {
                    $validator->errors()->add(
                        'resting_hr_source',
                        'A resting-rate source describes a reading and needs one to sit beside.',
                    );
                }
            },
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
