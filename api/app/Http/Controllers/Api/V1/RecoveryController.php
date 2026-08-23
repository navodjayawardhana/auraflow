<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Wellbeing\DTO\CalculateRecoveryScoreRequest;
use App\Application\Wellbeing\UseCase\CalculateRecoveryScoreUseCase;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\ShowRecoveryScoreRequest;
use Illuminate\Http\JsonResponse;

/**
 * Thin by design: validate at the boundary, delegate, shape the response. No decision
 * about what a recovery score means is taken here.
 */
final class RecoveryController extends Controller
{
    public function __construct(private readonly CalculateRecoveryScoreUseCase $calculateRecoveryScore)
    {
    }

    public function show(ShowRecoveryScoreRequest $request, string $date): JsonResponse
    {
        $result = $this->calculateRecoveryScore->execute(
            new CalculateRecoveryScoreRequest((string) $request->user()->id, $date),
        );

        if (! $result->isAvailable()) {
            // 200, not 404: the user and the date both exist, there is simply nothing to
            // score yet. A 404 would tell the client the endpoint was wrong.
            return response()->json([
                'data' => [
                    'date' => $result->date,
                    'score' => null,
                    'available' => false,
                    'reason' => $result->unavailableReason,
                    // The last day that could be scored, so the dashboard can show something
                    // dated rather than a bare dash. Null when nothing in the last fortnight
                    // scores either.
                    'last_known' => $result->lastKnown?->toArray(),
                ],
            ]);
        }

        return response()->json([
            'data' => [
                'date' => $result->date,
                'score' => $result->score,
                'available' => true,
                // Surfaced rather than hidden: a provisional score is a different
                // measurement from an established one and the client must not chart
                // them on the same line.
                'provisional' => $result->provisional,
                'components_used' => $result->componentsUsed,
                'illness_warning' => $result->illnessWarning,
            ],
        ]);
    }
}
