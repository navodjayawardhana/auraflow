<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Persistence only.
 *
 * Every rule about what a profile means -- what a valid height is, how BMI is banded,
 * which population's cut-offs apply -- lives in App\Domain\Profile. See
 * Infrastructure\Profile\Persistence\UserProfileMapper for the translation.
 */
class UserProfile extends Model
{
    protected $fillable = [
        'user_id',
        'date_of_birth',
        'sex',
        'height_cm',
        'weight_kg',
        'activity_level',
        'bmi_scale',
    ];

    protected function casts(): array
    {
        return [
            'date_of_birth' => 'immutable_date',
            'height_cm' => 'integer',
            // Cast to float rather than left as the decimal string Eloquent returns, so
            // the mapper hands the domain a number and not "72.3".
            'weight_kg' => 'float',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
