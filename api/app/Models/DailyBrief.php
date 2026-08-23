<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Persistence only — see App\Domain\Advice for the rules that decide what a briefing may
 * say, and App\Infrastructure\Advice for how it is produced.
 */
class DailyBrief extends Model
{
    use HasFactory;

    public const STATUS_PENDING = 'pending';
    public const STATUS_READY = 'ready';
    public const STATUS_FAILED = 'failed';

    /**
     * Nothing to write about yet — not a failure.
     *
     * A day with no sleep, no heart rate and no score is a day the briefing has nothing
     * true to say about, and saying so is correct behaviour. It is kept apart from `failed`
     * because the two want opposite handling: a failure is over, while this resolves itself
     * the moment anything is logged, and so it is retried where a failure is not.
     */
    public const STATUS_WAITING = 'waiting';

    protected $fillable = [
        'user_id',
        'brief_for',
        'status',
        'body',
        'model',
        'failure_reason',
        'generated_at',
    ];

    protected function casts(): array
    {
        return [
            'brief_for' => 'immutable_date',
            'generated_at' => 'immutable_datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
