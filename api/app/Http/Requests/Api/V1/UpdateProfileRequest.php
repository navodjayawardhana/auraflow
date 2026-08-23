<?php

namespace App\Http\Requests\Api\V1;

use App\Domain\Profile\Model\UserProfile;
use App\Domain\Profile\ValueObject\ActivityLevel;
use App\Domain\Profile\ValueObject\BmiScale;
use App\Domain\Profile\ValueObject\Sex;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Boundary validation for a profile edit.
 *
 * Every field is optional and every field is nullable, which are two different things
 * here: absent means "I am not editing this", null means "clear it". A user who typed
 * the wrong year of birth has to be able to take it back out. The merge itself is
 * UserProfile::apply's rule; this only decides what a well-formed value looks like.
 *
 * The numeric bounds mirror the domain's rather than replacing them -- the domain throws
 * on a 400 cm height whoever calls it, and this turns that into a 422 instead of a 500.
 */
class UpdateProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            // A birth date in the future is a wrong device clock. Left through, Tanaka
            // and the NSF bands would both evaluate at a negative age and return numbers
            // that look entirely reasonable.
            'date_of_birth' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'before:today'],

            'sex' => ['sometimes', 'nullable', Rule::enum(Sex::class)],

            'height_cm' => [
                'sometimes', 'nullable', 'integer',
                'min:'.UserProfile::MIN_HEIGHT_CM,
                'max:'.UserProfile::MAX_HEIGHT_CM,
            ],

            'weight_kg' => [
                'sometimes', 'nullable', 'numeric',
                'min:'.UserProfile::MIN_WEIGHT_KG,
                'max:'.UserProfile::MAX_WEIGHT_KG,
            ],

            'activity_level' => ['sometimes', 'nullable', Rule::enum(ActivityLevel::class)],

            // Writable, because the contract's prose says the profile decides which
            // population applies and a read-only field cannot decide anything. Stored on
            // the profile rather than passed per request: the same body must not read as
            // "healthy" on one device and "overweight" on another.
            'bmi_scale' => ['sometimes', 'nullable', Rule::enum(BmiScale::class)],
        ];
    }

    /**
     * Only the profile fields the request actually carried.
     *
     * `array_intersect_key` on the validated set rather than `only()` on the request, so
     * a client cannot slip an unvalidated key through, and `sometimes` keeps an absent
     * field absent instead of folding it in as a null that would clear it.
     *
     * @return array<string, mixed>
     */
    public function profileChanges(): array
    {
        return array_intersect_key(
            $this->validated(),
            array_flip(['date_of_birth', 'sex', 'height_cm', 'weight_kg', 'activity_level', 'bmi_scale']),
        );
    }
}
