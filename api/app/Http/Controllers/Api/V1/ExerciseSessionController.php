<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\ListExerciseSessionsRequest;
use App\Http\Requests\Api\V1\StoreExerciseSessionRequest;
use App\Models\ExerciseSession;
use Illuminate\Http\JsonResponse;

final class ExerciseSessionController extends Controller
{
    /** Enough for a history screen without paginating; the app shows recent work, not an archive. */
    private const RECENT_LIMIT = 30;

    public function index(ListExerciseSessionsRequest $request): JsonResponse
    {
        $query = ExerciseSession::query()
            ->where('user_id', $request->user()->id)
            ->orderByDesc('performed_at');

        if ($request->filled('date')) {
            $query->whereDate('performed_on', $request->string('date')->toString());
        } else {
            $query->limit(self::RECENT_LIMIT);
        }

        $sessions = $query->get();

        return response()->json([
            'data' => $sessions->map($this->toArray(...))->all(),
            'meta' => [
                'total_reps' => (int) $sessions->sum('total_reps'),
                'good_form_reps' => (int) $sessions->sum('good_form_reps'),
                // Deliberately no average heart rate across sessions. Most rows have none
                // -- the node is rarely worn -- so a mean over the few that do would be a
                // figure about the wearing, not about the training.
            ],
        ]);
    }

    public function store(StoreExerciseSessionRequest $request): JsonResponse
    {
        $performedAt = $request->filled('performed_at') ? $request->date('performed_at') : now();

        // A replay from the offline queue must not become a second session. Checked
        // rather than relying on the unique index so the caller gets its row back with a
        // 201 instead of a constraint violation it cannot act on.
        if ($request->filled('client_uuid')) {
            $existing = ExerciseSession::query()
                ->where('user_id', $request->user()->id)
                ->where('client_uuid', $request->string('client_uuid')->toString())
                ->first();

            if ($existing !== null) {
                return response()->json(['data' => $this->toArray($existing)], 201);
            }
        }

        $session = ExerciseSession::query()->create([
            'user_id' => $request->user()->id,
            'performed_on' => $performedAt->format('Y-m-d'),
            'performed_at' => $performedAt,
            'exercise' => $request->string('exercise')->toString(),
            'total_reps' => $request->integer('total_reps'),
            'good_form_reps' => $request->integer('good_form_reps'),
            'duration_seconds' => $request->integer('duration_seconds'),
            'mean_heart_rate' => $request->input('mean_heart_rate'),
            'prescribed_intensity' => $request->string('prescribed_intensity')->toString(),
            'recovery_score' => $request->input('recovery_score'),
            'client_uuid' => $request->input('client_uuid'),
        ]);

        return response()->json(['data' => $this->toArray($session)], 201);
    }

    /**
     * @return array<string, mixed>
     */
    private function toArray(ExerciseSession $session): array
    {
        return [
            'id' => $session->id,
            'exercise' => $session->exercise,
            'performed_on' => $session->performed_on->format('Y-m-d'),
            'performed_at' => $session->performed_at->toAtomString(),
            'total_reps' => $session->total_reps,
            // The client shows these as "12 of 15 reached depth" rather than a
            // percentage, so both counts travel rather than a ratio.
            'good_form_reps' => $session->good_form_reps,
            'duration_seconds' => $session->duration_seconds,
            'mean_heart_rate' => $session->mean_heart_rate,
            'prescribed_intensity' => $session->prescribed_intensity,
            'recovery_score' => $session->recovery_score,
        ];
    }
}
