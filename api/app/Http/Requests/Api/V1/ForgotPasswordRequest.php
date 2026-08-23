<?php

namespace App\Http\Requests\Api\V1;

use App\Domain\Auth\Model\PasswordResetChallenge;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * "Send me a code."
 *
 * Throttled on the same key shape as LoginRequest -- email *and* IP -- for the same two
 * reasons, restated because this endpoint is a different weapon. Keying on email alone
 * would let anyone who knows an address bury its owner's inbox from anywhere, and worse,
 * invalidate the code they are in the middle of typing on every send. Keying on IP alone
 * would let one host walk a list of addresses, sending mail we pay for to people who did
 * not ask.
 *
 * The bucket is prefixed. Sharing LoginRequest's bare `email|ip` key would mean five
 * failed sign-ins silently spend a person's ability to ask for a reset, which is the
 * exact moment they need it most.
 */
class ForgotPasswordRequest extends FormRequest
{
    /**
     * Five per window. A person who mistyped their address and tried again, plus a couple
     * of resends, and nothing beyond that.
     */
    private const MAX_ATTEMPTS = 5;

    /**
     * Matched to the code's own lifetime rather than picked. A window shorter than the
     * TTL would let someone send a fresh mail-bomb before the previous code had even
     * expired; a longer one would leave a person who genuinely lost the first mail unable
     * to try again after their code had died.
     */
    private const DECAY_SECONDS = PasswordResetChallenge::TTL_MINUTES * 60;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        // No `exists:users,email`. That single rule would answer, in a 422, the one
        // question this whole endpoint exists to refuse to answer.
        return [
            'email' => ['required', 'string', 'email'],
        ];
    }

    /**
     * Run automatically after validation, before the controller sees the request.
     *
     * A limiter the controller has to remember to call is a limiter that is one careless
     * refactor from being absent. Hooking it here means the throttle cannot be forgotten
     * and cannot be reordered after the work it is meant to bound.
     */
    protected function passedValidation(): void
    {
        $this->ensureIsNotRateLimited();

        RateLimiter::hit($this->throttleKey(), self::DECAY_SECONDS);
    }

    private function ensureIsNotRateLimited(): void
    {
        if (! RateLimiter::tooManyAttempts($this->throttleKey(), self::MAX_ATTEMPTS)) {
            return;
        }

        event(new Lockout($this));

        throw ValidationException::withMessages([
            'email' => __('auth.throttle', [
                'seconds' => $seconds = RateLimiter::availableIn($this->throttleKey()),
                'minutes' => ceil($seconds / 60),
            ]),
        ])->status(429);
    }

    private function throttleKey(): string
    {
        return 'password-forgot|'.Str::transliterate(
            Str::lower($this->string('email')).'|'.$this->ip()
        );
    }
}
