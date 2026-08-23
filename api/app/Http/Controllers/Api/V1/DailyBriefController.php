<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\ShowDailyBriefRequest;
use App\Jobs\GenerateDailyBrief;
use App\Models\DailyBrief;
use Illuminate\Http\JsonResponse;

/**
 * The day's briefing: ask for it, then come back for it.
 *
 * The request never waits on the language model. Asking creates a pending row and queues
 * the work; the client polls this same endpoint and renders a placeholder until the
 * status flips — which is the shape the app already uses everywhere else.
 *
 * A settled briefing is not frozen for the rest of the day. Past the rewrite floor a poll
 * queues a job that re-examines the day and rewrites only if the context has materially
 * moved; the job owns that judgement, this endpoint owns how often it may be asked for.
 */
final class DailyBriefController extends Controller
{
    /** How long a pending briefing may sit before it is treated as a dropped job. */
    private const STRANDED_AFTER_SECONDS = 120;

    /**
     * The floor between two rewrites of settled advice.
     *
     * The job decides *whether* a brief is out of date, by comparing a fingerprint of the
     * context it was written from. This decides how often it is allowed to ask, and it
     * exists because the client polls this endpoint every few seconds: without a floor, a
     * burst of logging could turn into a burst of paid model calls, each one rewriting
     * advice the reader is halfway through.
     *
     * Half an hour, chosen against the fingerprint's own bucket widths rather than picked
     * for roundness. The narrowest bucket is 500 ml of water — four of the app's own
     * glasses — and nobody drinks four glasses in under half an hour, so the floor never
     * suppresses a change the user would notice. What it does suppress is the same change
     * being noticed twice.
     *
     * Deliberately not applied to `refresh`. That is a button the user pressed, and a
     * person asking for new advice is entitled to it whether or not their figures moved.
     */
    private const REWRITE_FLOOR_SECONDS = 1800;

    public function show(ShowDailyBriefRequest $request, string $date): JsonResponse
    {
        $userId = $request->user()->id;

        $brief = $this->findFor($userId, $date);

        // Whether this request queued a re-examination of advice the reader can already
        // see. It is reported because otherwise the rewrite lands after the client has
        // stopped asking, and the user meets their new brief tomorrow.
        $rewriting = $brief !== null && $this->mayBeOutOfDate($brief);

        if ($brief === null) {
            $brief = DailyBrief::query()->create([
                'user_id' => $userId,
                'brief_for' => $date,
                'status' => DailyBrief::STATUS_PENDING,
            ]);

            GenerateDailyBrief::dispatch($userId, $date);
        } elseif ($this->isStranded($brief) || $rewriting) {
            // Touched before dispatching, not after: the client polls this endpoint every
            // few seconds, and without moving the clock first every one of those polls
            // would queue another job for the same day.
            //
            // The touch is what enforces the rewrite floor as well. A job that finds the
            // fingerprint unchanged writes nothing at all, so `generated_at` cannot be the
            // clock this is measured against -- it would stay old and every poll would
            // queue another check. `updated_at` moves here whether or not the job goes on
            // to write, which is exactly the "we already asked" the floor is about.
            $brief->touch();
            GenerateDailyBrief::dispatch($userId, $date);
            $brief->refresh();
        }

        return response()->json([
            'data' => [
                'date' => $brief->brief_for->format('Y-m-d'),
                'status' => $brief->status,
                'body' => $brief->body,
                // Named so a briefing written by a model since replaced is identifiable
                // rather than anonymous.
                'model' => $brief->model,
                'reason' => $brief->failure_reason,
                'generated_at' => $brief->generated_at?->toAtomString(),
                // Not a status. The advice below is still the current advice and still
                // worth reading; this only says a check is in flight, so the client keeps
                // asking for a little longer instead of showing a skeleton over text the
                // user is halfway through.
                'rewriting' => $rewriting,
            ],
        ]);
    }

    /** Regenerate — the day's figures change as it goes on. */
    public function refresh(ShowDailyBriefRequest $request, string $date): JsonResponse
    {
        $userId = $request->user()->id;

        $brief = $this->findFor($userId, $date);

        if ($brief === null) {
            DailyBrief::query()->create([
                'user_id' => $userId,
                'brief_for' => $date,
                'status' => DailyBrief::STATUS_PENDING,
            ]);
        } else {
            $brief->update([
                'status' => DailyBrief::STATUS_PENDING,
                'failure_reason' => null,
            ]);
        }

        GenerateDailyBrief::dispatch($userId, $date);

        return response()->json(['data' => ['date' => $date, 'status' => DailyBrief::STATUS_PENDING]], 202);
    }

    /**
     * A briefing left pending by a job that never ran.
     *
     * Dispatching only on creation meant exactly one attempt, ever. A worker that was not
     * running -- restarting, crashed, or simply never started in a development environment
     * -- left the row at `pending` with nothing to retry it, and the client polling this
     * endpoint would wait for an answer no longer coming. Which is what happened.
     *
     * Generation takes seconds, so a couple of minutes is comfortably past "still working"
     * and safely short of a user staring at a placeholder.
     */
    private function isStranded(DailyBrief $brief): bool
    {
        if ($brief->updated_at === null) {
            return false;
        }

        if (! $brief->updated_at->lt(now()->subSeconds(self::STRANDED_AFTER_SECONDS))) {
            return false;
        }

        // `waiting` joins `pending` here for the opposite reason. Pending is retried because
        // the answer never came; waiting is retried because the question has changed --
        // a night logged at noon makes a day that had nothing to say at breakfast worth
        // writing about, and the user should not have to find a button to discover that.
        //
        // Cheap to repeat: the job checks the day's data and returns before the model call,
        // so a genuinely empty day costs a query every couple of minutes and nothing else.
        return in_array($brief->status, [DailyBrief::STATUS_PENDING, DailyBrief::STATUS_WAITING], true);
    }

    /**
     * A settled briefing old enough to be worth re-examining.
     *
     * "Worth re-examining", not "out of date" -- this endpoint cannot tell the difference
     * and should not try. Deciding whether the day has actually moved means building the
     * grounding pack, which is several queries, and doing that on a poll that arrives every
     * few seconds would be the cost this method exists to bound. So the cheap timestamp
     * check happens here and the expensive, truthful one happens in the job, which returns
     * before the model call when the fingerprint has not moved.
     *
     * Only `ready` briefs. `pending` and `waiting` are the stranded path's business and
     * have their own, much shorter, clock; `failed` is over.
     */
    private function mayBeOutOfDate(DailyBrief $brief): bool
    {
        return $brief->status === DailyBrief::STATUS_READY
            && $brief->updated_at !== null
            && $brief->updated_at->lt(now()->subSeconds(self::REWRITE_FLOOR_SECONDS));
    }

    /**
     * The one way to find a day's briefing, shared rather than written out twice.
     *
     * `whereDate` and not plain equality. The `brief_for` cast writes a date as
     * `Y-m-d 00:00:00`, so `where('brief_for', '2026-08-22')` matches the stored row on no
     * day at all -- it then inserts, and the unique index on (user_id, brief_for) rejects
     * it. `refresh()` did exactly that through `updateOrCreate`, whose match clause does
     * not pass through the cast, and every regenerate returned a 500.
     *
     * The same mistake broke `health_snapshots` idempotency once already. Two copies of a
     * lookup is how one of them drifts, so there is now one.
     */
    private function findFor(int $userId, string $date): ?DailyBrief
    {
        return DailyBrief::query()
            ->where('user_id', $userId)
            ->whereDate('brief_for', $date)
            ->first();
    }
}
