<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\LoginRequest;
use App\Http\Requests\Api\V1\RegisterRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;

/**
 * Token issuance for the mobile client.
 *
 * No Domain layer here, deliberately. Registering and signing in carry no business rule
 * that AuraFlow itself owns -- password hashing, uniqueness and token lifetime are all
 * framework concerns. Wrapping them in a domain context would add ceremony without
 * moving a single decision out of the framework, which is the opposite of the point.
 * The rules that *are* AuraFlow's live in Domain\Wellbeing.
 */
final class AuthController extends Controller
{
    public function register(RegisterRequest $request): JsonResponse
    {
        $user = User::create([
            'name' => $request->string('name')->toString(),
            'email' => $request->string('email')->toString(),
            // Hashed by the model cast, not here -- one place, so a future write path
            // cannot forget.
            'password' => $request->string('password')->toString(),
        ]);

        return response()->json([
            'data' => [
                'user' => $this->present($user),
                'token' => $user->createToken($request->deviceName())->plainTextToken,
            ],
        ], 201);
    }

    public function login(LoginRequest $request): JsonResponse
    {
        $request->authenticate();

        $user = $request->user() ?? User::where('email', $request->string('email'))->firstOrFail();

        // One token per device, replaced on each sign-in. Without this, every re-install
        // leaves a live credential behind that the user has no way to see or revoke.
        $user->tokens()->where('name', $request->deviceName())->delete();

        return response()->json([
            'data' => [
                'user' => $this->present($user),
                'token' => $user->createToken($request->deviceName())->plainTextToken,
            ],
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        // This device only. Signing out on a phone must not sign the user out of a
        // tablet they still have in their hand.
        $request->user()->currentAccessToken()->delete();

        return response()->json(['data' => ['message' => 'Signed out.']]);
    }

    public function logoutEverywhere(Request $request): JsonResponse
    {
        $request->user()->tokens()->delete();

        return response()->json(['data' => ['message' => 'Signed out on all devices.']]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->present($request->user())]);
    }

    /**
     * @return array<string, mixed>
     */
    private function present(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
        ];
    }
}
