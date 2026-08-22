<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

class ListHealthSnapshotsRequest extends FormRequest
{
    /** A window wide enough for any client chart, narrow enough to stay one cheap query. */
    private const MAX_WINDOW_DAYS = 90;

    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => [
                'required',
                'date_format:Y-m-d',
                'after_or_equal:from',
                'before_or_equal:'.now()->addDay()->format('Y-m-d'),
            ],
        ];
    }

    public function after(): array
    {
        return [
            function ($validator) {
                if ($validator->errors()->isNotEmpty()) {
                    return;
                }

                $from = new \DateTimeImmutable($this->string('from')->toString());
                $to = new \DateTimeImmutable($this->string('to')->toString());

                if ((int) $from->diff($to)->format('%a') > self::MAX_WINDOW_DAYS) {
                    $validator->errors()->add(
                        'to',
                        'The window cannot be longer than '.self::MAX_WINDOW_DAYS.' days.',
                    );
                }
            },
        ];
    }
}
