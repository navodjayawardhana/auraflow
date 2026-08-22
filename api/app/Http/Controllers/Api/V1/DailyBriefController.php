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
 */
final class DailyBriefController extends Controller
{
    public function show(ShowDailyBriefRequest $request, string $date): JsonResponse
    {
        $userId = $request->user()->id;

        $brief = DailyBrief::query()
            ->where('user_id', $userId)
            ->whereDate('brief_for', $date)
            ->first();

        if ($brief === null) {
            $brief = DailyBrief::query()->create([
                'user_id' => $userId,
                'brief_for' => $date,
                'status' => DailyBrief::STATUS_PENDING,
            ]);

            GenerateDailyBrief::dispatch($userId, $date);
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
            ],
        ]);
    }

    /** Regenerate — the day's figures change as it goes on. */
    public function refresh(ShowDailyBriefRequest $request, string $date): JsonResponse
    {
        $userId = $request->user()->id;

        DailyBrief::query()->updateOrCreate(
            ['user_id' => $userId, 'brief_for' => $date],
            ['status' => DailyBrief::STATUS_PENDING, 'failure_reason' => null],
        );

        GenerateDailyBrief::dispatch($userId, $date);

        return response()->json(['data' => ['date' => $date, 'status' => DailyBrief::STATUS_PENDING]], 202);
    }
}
