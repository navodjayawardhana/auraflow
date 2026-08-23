<?php

namespace App\Http\Requests\Api\V1;

use App\Domain\Nutrition\ValueObject\DateRange;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * One day, or a span of them.
 *
 * `date` stays because a single day is still the common read and the shortest URL for it,
 * and because clients already in someone's hand send it. `from`/`to` is the history view:
 * a week, a calendar month, or whatever window a chart needs.
 */
class ListMealsRequest extends FormRequest
{
    /**
     * The widest window one request may ask for.
     *
     * A calendar month is at most 31 days and the month view asks for exactly that, so
     * this is roughly a quarter of slack. It keeps the read a single indexed range scan
     * and keeps the aggregated reply small enough to cache on a phone; a year of history
     * is several requests, which is also how it would have to be paged on screen.
     */
    private const MAX_WINDOW_DAYS = 92;

    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'date' => ['nullable', 'required_without:from', 'date_format:Y-m-d', 'before_or_equal:today'],
            'from' => ['nullable', 'required_without:date', 'date_format:Y-m-d'],
            // No ceiling on `to`. The current week and the current month both run past
            // today, and refusing them would mean the history view could never show the
            // period the user is living in.
            'to' => ['nullable', 'required_with:from', 'date_format:Y-m-d', 'after_or_equal:from'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                if ($validator->errors()->isNotEmpty() || ! $this->filled('from')) {
                    return;
                }

                if ($this->range()->lengthInDays() > self::MAX_WINDOW_DAYS) {
                    $validator->errors()->add(
                        'to',
                        'The window cannot be longer than '.self::MAX_WINDOW_DAYS.' days.',
                    );
                }
            },
        ];
    }

    /** The span asked for, whichever way it was asked for. */
    public function range(): DateRange
    {
        if ($this->filled('from')) {
            return DateRange::of($this->string('from')->toString(), $this->string('to')->toString());
        }

        return DateRange::ofDay($this->string('date')->toString());
    }
}
