<?php

namespace App\Http\Requests\Api\V1;

use App\Domain\Planning\Model\WellbeingPlan;
use App\Domain\Wellbeing\ValueObject\SleepSummary;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Boundary validation for a hand-set goal.
 *
 * The bounds are wide on purpose. These are the user's own targets and the app is not
 * entitled to an opinion about ambition -- what it is entitled to reject is a number that
 * cannot be a goal at all, because a step target of two million turns every progress ring
 * in the app into a flat line.
 *
 * Heart-rate zones are not overridable. A zone the user typed would carry the same
 * `karvonen` label in the basis as one the formula produced, and there is no honest way
 * to show a hand-picked training intensity as a derived one.
 */
class UpdatePlanRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'step_goal' => ['sometimes', 'nullable', 'integer', 'min:100', 'max:100000'],
            'water_ml' => ['sometimes', 'nullable', 'integer', 'min:250', 'max:10000'],
            'active_kcal_goal' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:5000'],

            // The same window SleepSummary accepts, so a sleep need cannot be set to a
            // figure no recorded night could ever meet.
            'sleep_need_hours' => [
                'sometimes', 'nullable', 'numeric',
                'min:'.SleepSummary::MIN_HOURS,
                'max:'.SleepSummary::MAX_HOURS,
            ],

            // The client's own id for this edit, so the offline outbox can replay a write
            // whose response was lost. Optional: an online edit has nothing to replay, and
            // an identical consecutive body is already collapsed without it.
            'client_uuid' => ['sometimes', 'nullable', 'string', 'max:64'],
        ];
    }

    /**
     * @return array<string, int|float>
     */
    public function overrides(): array
    {
        return array_intersect_key(
            $this->validated(),
            array_flip(WellbeingPlan::OVERRIDABLE_FIELDS),
        );
    }

    public function clientUuid(): ?string
    {
        $value = $this->validated()['client_uuid'] ?? null;

        return $value === null || $value === '' ? null : (string) $value;
    }
}
