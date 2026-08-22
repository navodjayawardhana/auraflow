<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class ShowDailyBriefRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [];
    }

    /** The date is a route segment rather than a field, so it is validated here. */
    public function after(): array
    {
        return [
            function (Validator $validator) {
                $date = $this->route('date');

                if (! is_string($date) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                    $validator->errors()->add('date', 'The date must be in YYYY-MM-DD format.');

                    return;
                }

                [$year, $month, $day] = array_map('intval', explode('-', $date));

                if (! checkdate($month, $day, $year)) {
                    $validator->errors()->add('date', 'The date is not a real calendar date.');

                    return;
                }

                // Briefing a day that has not happened would mean asking a model to write
                // about nothing at all.
                if ($date > now()->format('Y-m-d')) {
                    $validator->errors()->add('date', 'Cannot brief on a future date.');
                }
            },
        ];
    }
}
