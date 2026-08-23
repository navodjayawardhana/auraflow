<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Insights\UseCase\BuildInsightsSeriesUseCase;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\ShowInsightsRequest;
use Illuminate\Http\JsonResponse;

/**
 * Thin by design: validate at the boundary, delegate, shape the response. No decision
 * about what any of these numbers mean is taken here.
 */
final class InsightsController extends Controller
{
    public function __construct(private readonly BuildInsightsSeriesUseCase $buildSeries)
    {
    }

    public function show(ShowInsightsRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->buildSeries
                ->execute((string) $request->user()->id, $request->window())
                ->toArray(),
        ]);
    }
}
