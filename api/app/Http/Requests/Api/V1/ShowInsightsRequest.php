<?php

namespace App\Http\Requests\Api\V1;

use App\Domain\Nutrition\ValueObject\DateRange;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A rolling window ending today, named by its length rather than its edges.
 *
 * `days` and not `from`/`to`, unlike the meals and snapshots reads beside it. Those two
 * page through history the user chose -- a particular week, a particular month -- and the
 * edges are the question. This one only ever answers "lately", the edges are always today
 * and today minus something, and a client that has to compute both is a client that can
 * get the timezone wrong and ask for a window that ends tomorrow.
 */
class ShowInsightsRequest extends FormRequest
{
    /** What the screen asks for unless it says otherwise; the resting-HR baseline window. */
    public const DEFAULT_DAYS = 14;

    /**
     * The widest window one request may ask for.
     *
     * Matches the snapshots read, and for the same reason: it keeps this a pair of indexed
     * range scans. Nothing on the screen is drawn over more than a fortnight today, so the
     * ceiling is slack rather than a target.
     */
    private const MAX_DAYS = 90;

    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'days' => ['nullable', 'integer', 'min:1', 'max:'.self::MAX_DAYS],
        ];
    }

    /**
     * The span asked for, inclusive of today.
     *
     * Today counts, and is a partial day. That is not hidden here -- the day is returned
     * with whatever it currently holds, and the client is the side that knows a target met
     * by three in the afternoon is a different claim from one met by bedtime.
     */
    public function window(): DateRange
    {
        // `filled` rather than a default argument: an explicit `days=` sends an empty
        // string, which the nullable rule allows through and `integer()` reads as zero.
        $days = $this->filled('days') ? $this->integer('days') : self::DEFAULT_DAYS;

        $to = now()->startOfDay();

        return DateRange::of(
            $to->copy()->subDays($days - 1)->format('Y-m-d'),
            $to->format('Y-m-d'),
        );
    }
}
