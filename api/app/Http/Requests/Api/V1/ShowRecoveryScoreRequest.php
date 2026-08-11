<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * Input validation at the boundary, so the domain never has to defend against a
 * malformed date string.
 */
class ShowRecoveryScoreRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [];
    }

    /**
     * The date arrives as a route segment rather than a field, so it is validated here.
     */
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
                }
            },
        ];
    }
}
