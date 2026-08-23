<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Profile\UseCase\GetProfileUseCase;
use App\Application\Profile\UseCase\UpdateProfileUseCase;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\UpdateProfileRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Thin by design: validate at the boundary, delegate, shape the response. No rule about
 * what a valid body is, or which BMI cut-offs apply to whom, is decided here.
 */
final class ProfileController extends Controller
{
    public function __construct(
        private readonly GetProfileUseCase $getProfile,
        private readonly UpdateProfileUseCase $updateProfile,
    ) {
    }

    public function show(Request $request): JsonResponse
    {
        $profile = $this->getProfile->execute((string) $request->user()->id);

        // Null, not 404: the user exists and has simply not filled anything in. The
        // client tells the two apart to decide between rendering the screen and
        // prompting -- the same reasoning as the recovery score's available=false.
        return response()->json(['data' => $profile?->toArray()]);
    }

    /**
     * A merge, not a replacement.
     *
     * A key present in the body is written. A key absent is left exactly as it was. A key
     * present with a null value is cleared. Clearing `sex` returns it to `unspecified`,
     * which is the domain's cleared state rather than a null.
     *
     * Stated here because it is the half of the contract that never gets written down and
     * then diverges: the mobile form happens to submit all five fields every time, so
     * both semantics behave identically today and would stop doing so the first time a
     * screen submits one.
     *
     * Saving a profile does not move the plan. That would change targets the user is
     * being measured against without asking; the client compares `profile.updated_at`
     * with `plan.created_at` and offers POST /plan/recalculate.
     */
    public function update(UpdateProfileRequest $request): JsonResponse
    {
        $profile = $this->updateProfile->execute(
            (string) $request->user()->id,
            $request->profileChanges(),
        );

        return response()->json(['data' => $profile->toArray()]);
    }
}
