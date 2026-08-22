<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Persistence only. */
class MealEntry extends Model
{
    use HasFactory;

    /** Looked up from a food database — a figure someone else measured. */
    public const SOURCE_LOOKUP = 'lookup';

    /** The user's own guess. Shown differently, because it is a different claim. */
    public const SOURCE_ESTIMATE = 'estimate';

    protected $fillable = [
        'user_id',
        'eaten_on',
        'eaten_at',
        'name',
        'kcal',
        'source',
        'barcode',
        'protein_g',
        'carbs_g',
        'fat_g',
        'portion_g',
    ];

    protected function casts(): array
    {
        return [
            'eaten_on' => 'immutable_date',
            'eaten_at' => 'immutable_datetime',
            'kcal' => 'integer',
            'protein_g' => 'integer',
            'carbs_g' => 'integer',
            'fat_g' => 'integer',
            'portion_g' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
