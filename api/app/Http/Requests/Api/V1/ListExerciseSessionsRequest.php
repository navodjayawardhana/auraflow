<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

class ListExerciseSessionsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            // Optional: the history screen wants the recent list, a day view wants one
            // date. Absent means "the most recent sessions", not "every session ever".
            'date' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'],
        ];
    }
}
