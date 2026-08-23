<?php

namespace App\Domain\Advice\ValueObject;

use App\Domain\Movement\ValueObject\CompletedSession;

/**
 * Everything the assistant and the briefing are allowed to know, assembled server-side.
 *
 * `DailyContext` was the whole of this and is now one field of it. That class is still a
 * closed set and widening it is still a deliberate edit; what changed is that a closed set
 * of *today* could not answer the questions people actually ask. "How did I sleep last
 * week", "what did I eat yesterday", "is my recovery trending down", "how many sessions
 * did I do" are all questions whose answers were sitting in the user's own rows and never
 * reached the prompt.
 *
 * This is not database access for the model and it never becomes it. The pack is built
 * from one authenticated user's rows before the model is called, no part of it is shaped
 * by anything the model produced, and there is no path by which a reply can ask for more.
 * Widening what may be known is still an edit to this file.
 *
 * ## The windows, and why they are these
 *
 * The pack competes with the reply for the same budget, so each window is the shortest one
 * that answers its question:
 *
 *   History, {@see HISTORY_DAYS} days.  The fortnight the rest of the app already reasons
 *     in — `RestingHeartRateBaseline::WINDOW_DAYS` is a fortnight, the insights screen
 *     draws a fortnight, and `CalculateRecoveryScoreUseCase` calls anything older than one
 *     "archaeology" rather than context. Fourteen daily lines answer "last week" with a
 *     week of margin and let a trend be described from days the user can see on their own
 *     chart. Thirty would double the cost of the pack to support a claim the app itself
 *     declines to make.
 *
 *   Named meals, {@see NAMED_MEAL_DAYS} days.  Today and yesterday. These are the widest
 *     rows in the pack because a name is unbounded where everything else is an integer,
 *     and nobody asks what they ate a week last Tuesday. The older days keep their
 *     calorie totals in the history line, so a longer question still has a truthful, if
 *     coarser, answer.
 *
 *   Sessions, the history window, capped at {@see SESSION_LIMIT}.  "How many sessions this
 *     week" needs the same span as the rest; the cap is there so a user who trains four
 *     times a day cannot push the history out of the prompt.
 */
final class GroundingPack
{
    /** @see the class docblock — this is the fortnight the whole app reasons in. */
    public const HISTORY_DAYS = 14;

    /** Today and yesterday. Long enough for "what did I eat yesterday", and no longer. */
    public const NAMED_MEAL_DAYS = 2;

    public const SESSION_LIMIT = 10;

    /**
     * Two days of meals for someone who logs every biscuit is still a list without an end,
     * and the pack has to have one. Sixteen covers an ordinarily thorough two days.
     */
    public const NAMED_MEAL_LIMIT = 16;

    /**
     * @param  list<HistoryDay>  $history  oldest first, one entry per calendar day in the
     *                                     window including the days nothing was recorded —
     *                                     a gap the model can see is a gap it will not fill
     * @param  list<RecentMeal>  $recentMeals  oldest first
     * @param  list<CompletedSession>  $sessions  newest first
     */
    public function __construct(
        public readonly DailyContext $today,
        public readonly array $history = [],
        public readonly array $recentMeals = [],
        public readonly array $sessions = [],
        public readonly ?PlanTargets $targets = null,
        /**
         * Null for a day that is not today.
         *
         * A briefing being written for a past date has no "now" to be in, and stamping one
         * on would make the same backfilled day read differently depending on when someone
         * happened to ask for it.
         */
        public readonly ?DayPart $dayPart = null,
    ) {
    }

    /**
     * Whether there is enough to say anything worth reading.
     *
     * Delegated to the day rather than widened to the pack, and deliberately so: a
     * fortnight of history does not make today worth briefing on. A briefing written from
     * old days would be the model producing filler about a day that has not happened yet,
     * which is the failure this gate exists to prevent.
     */
    public function isSufficient(): bool
    {
        return $this->today->isSufficient();
    }
}
