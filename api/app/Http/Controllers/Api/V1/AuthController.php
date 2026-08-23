<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Auth\UseCase\RequestPasswordResetUseCase;
use App\Application\Auth\UseCase\ResetPasswordUseCase;
use App\Domain\Auth\Exception\PasswordResetFailedException;
use App\Domain\Auth\Repository\AccountRepository;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\ForgotPasswordRequest;
use App\Http\Requests\Api\V1\LoginRequest;
use App\Http\Requests\Api\V1\RegisterRequest;
use App\Http\Requests\Api\V1\ResetPasswordRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Token issuance for the mobile client.
 *
 * Registering and signing in carry no business rule that AuraFlow itself owns -- password
 * hashing, uniqueness and token lifetime are all framework concerns, and wrapping them in
 * a domain context would add ceremony without moving a single decision out of the
 * framework. That is why those two paths have no Domain layer behind them.
 *
 * Password reset is the exception, and it is worth naming why rather than letting the
 * difference look like inconsistency. Fifteen minutes, five guesses, one live code per
 * address and destroy-on-exhaustion are not things Laravel decided for us; they are
 * choices with a threat model behind them, and they live in Domain\Auth where they can be
 * tested without a request. The two methods at the foot of this class only delegate.
 *
 * The reset ends in a token, which is why it is here rather than in a controller of its
 * own: the shape of an authenticated response, the per-device token convention and the
 * user presenter are all already in this file, and a second copy of any of them is a
 * second thing to keep in step.
 */
final class AuthController extends Controller
{
    public function __construct(
        private readonly AccountRepository $accounts,
        private readonly RequestPasswordResetUseCase $requestPasswordReset,
        private readonly ResetPasswordUseCase $resetPassword,
    ) {
    }

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
        // Delegated rather than inlined as `$request->user()->tokens()->delete()`, because
        // a successful password reset has to revoke sessions in exactly the same way. Two
        // copies of that line would look harmless until one of them learned about a second
        // credential type and the other did not.
        $this->accounts->revokeAllSessions($request->user()->id);

        return response()->json(['data' => ['message' => 'Signed out on all devices.']]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->present($request->user())]);
    }

    /**
     * Ask for a reset code.
     *
     * One response, always. Same status, same body, same wording whether the address
     * belongs to an account, belongs to nobody, or was invented on the spot. There is no
     * branch here to get wrong: the use case returns void precisely so that this method
     * has nothing it could accidentally reveal.
     *
     * 202 rather than 200, and the wording is hedged ("if that address is registered"),
     * so the client can show an honest message without the server having confirmed
     * anything.
     */
    public function forgotPassword(ForgotPasswordRequest $request): JsonResponse
    {
        $this->requestPasswordReset->execute($request->string('email')->toString());

        return response()->json([
            'data' => [
                'message' => 'If that address is registered, a six-digit code is on its way.',
            ],
        ], 202);
    }

    /**
     * Spend the code, set the password, and hand back a session.
     *
     * The user ends up signed in on this device and signed out everywhere else -- the
     * revocation happens inside the use case, before the token below is minted, so the
     * new token is the only one alive. Someone resetting because their account was taken
     * gets the attacker off it in the same request.
     *
     * Every domain failure becomes one 422 shaped like any other validation error, which
     * is what lets the mobile client render it with the code it already has for a bad
     * login rather than a special case.
     */
    public function resetPassword(ResetPasswordRequest $request): JsonResponse
    {
        try {
            $userId = $this->resetPassword->execute(
                $request->string('email')->toString(),
                $request->string('code')->toString(),
                $request->string('password')->toString(),
            );
        } catch (PasswordResetFailedException $failure) {
            throw ValidationException::withMessages(['code' => $failure->getMessage()]);
        }

        $request->clearRateLimit();

        $user = User::findOrFail($userId);

        return response()->json([
            'data' => [
                'user' => $this->present($user),
                'token' => $user->createToken($request->deviceName())->plainTextToken,
            ],
        ]);
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
