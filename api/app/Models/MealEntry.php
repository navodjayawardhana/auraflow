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

    /**
     * A vision model's guess from a photograph, which the user then checked.
     *
     * Its own value rather than folded into SOURCE_ESTIMATE: the user owns an estimate they
     * typed, and does not own one a model produced from a picture with no scale in it. A
     * row that cannot say which of the two it is cannot be honestly labelled later, and no
     * schema change was needed to keep them apart — `source` was already a string.
     */
    public const SOURCE_PHOTO = 'photo';

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
