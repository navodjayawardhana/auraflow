<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Planning\UseCase\GetCurrentPlanUseCase;
use App\Application\Planning\UseCase\ListPlanHistoryUseCase;
use App\Application\Planning\UseCase\OverridePlanUseCase;
use App\Application\Planning\UseCase\RecalculatePlanUseCase;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\UpdatePlanRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The plan, its recalculation, its overrides and its history.
 *
 * Every formula behind these numbers lives in App\Domain\Planning\Service, and every
 * decision about when a change earns a new version lives in the aggregate. This class
 * hands a user id to a use case and shapes what comes back.
 *
 * All four routes read the user id from the authenticated token and nothing else. There
 * is no path parameter by which one account could name another's plan, which is why
 * there is no ownership check to forget.
 */
final class PlanController extends Controller
{
    public function __construct(
        private readonly GetCurrentPlanUseCase $getPlan,
        private readonly RecalculatePlanUseCase $recalculatePlan,
        private readonly OverridePlanUseCase $overridePlan,
        private readonly ListPlanHistoryUseCase $listHistory,
    ) {
    }

    public function show(Request $request): JsonResponse
    {
        // Null until something derives one. A GET does not write, so the cold-start
        // client learns it needs to ask rather than being handed a plan it never
        // requested and cannot distinguish from one it did.
        return response()->json([
            'data' => $this->getPlan->execute((string) $request->user()->id)?->toArray(),
        ]);
    }

    public function recalculate(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->recalculatePlan->execute((string) $request->user()->id)->toArray(),
        ]);
    }

    /**
     * Replay-safe, so the mobile outbox can queue an edit offline.
     *
     * A retry either carries a `client_uuid` already recorded against a version, or a body
     * identical to what is current; both return the existing version rather than minting a
     * second one. A duplicated goal change would otherwise show in the user's own history
     * as an edit they never made.
     */
    public function update(UpdatePlanRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->overridePlan->execute(
                (string) $request->user()->id,
                $request->overrides(),
                $request->clientUuid(),
            )->toArray(),
        ]);
    }

    public function history(Request $request): JsonResponse
    {
        $versions = $this->listHistory->execute((string) $request->user()->id);

        return response()->json([
            'data' => array_map(static fn ($version) => $version->toArray(), $versions),
        ]);
    }
}
