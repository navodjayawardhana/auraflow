<?php

namespace App\Models;

use App\Domain\Nutrition\ValueObject\LoggedMeal;
use App\Domain\Nutrition\ValueObject\MealSource;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Persistence only. */
class MealEntry extends Model
{
    use HasFactory;

    /**
     * Looked up from a food database — a figure someone else measured.
     *
     * The three values are taken from the domain enum rather than spelled again here.
     * Two lists of the same strings drift, and the way they drift is that a row is written
     * with a `source` the aggregator does not recognise and is quietly counted as an
     * estimate for the rest of its life.
     */
    public const SOURCE_LOOKUP = MealSource::Lookup->value;

    /** The user's own guess. Shown differently, because it is a different claim. */
    public const SOURCE_ESTIMATE = MealSource::Estimate->value;

    /**
     * A vision model's guess from a photograph, which the user then checked.
     *
     * Its own value rather than folded into SOURCE_ESTIMATE: the user owns an estimate they
     * typed, and does not own one a model produced from a picture with no scale in it. A
     * row that cannot say which of the two it is cannot be honestly labelled later, and no
     * schema change was needed to keep them apart — `source` was already a string.
     */
    public const SOURCE_PHOTO = MealSource::Photo->value;

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

    /**
     * One user's meals over an inclusive span of days, in the order they were eaten.
     *
     * `eaten_on` rather than `eaten_at`, because the index is on `eaten_on` and because a
     * timestamp comparison would slice a day at whatever hour the range happens to start.
     * The ordering is by `eaten_at` so several meals on one day come back as the day
     * happened, which is the only order a food diary reads correctly in.
     */
    public function scopeForUserBetween(Builder $query, int $userId, string $from, string $to): Builder
    {
        return $query
            ->where('user_id', $userId)
            // Both bounds carry a time, and they have to. MySQL stores this column as a
            // real DATE, but SQLite keeps whatever Eloquent's date cast wrote — midnight —
            // so a bare `<= '2026-08-23'` is a string comparison that drops the last day of
            // every range under test while passing in production. Padding to the end of
            // the closing day is correct under both and still uses (user_id, eaten_on).
            ->whereBetween('eaten_on', [$from.' 00:00:00', $to.' 23:59:59'])
            ->orderBy('eaten_at')
            ->orderBy('id');
    }

    /**
     * The row as the domain sees it: a day, an energy figure and where that figure is from.
     *
     * A translation rather than a rule, which is why it can live on the model. It exists
     * so the aggregator never has to know what Eloquent is, and so its tests can be
     * written as lists of `LoggedMeal` with the answers worked out by hand.
     */
    public function toLoggedMeal(): LoggedMeal
    {
        return LoggedMeal::on(
            $this->eaten_on->format('Y-m-d'),
            $this->kcal,
            MealSource::fromStored($this->source),
            $this->protein_g,
            $this->carbs_g,
            $this->fat_g,
        );
    }
}
