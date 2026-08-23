<?php

namespace App\Http\Requests\Api\V1;

use App\Domain\Auth\Model\PasswordResetChallenge;
use App\Domain\Auth\ValueObject\ResetCode;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * "Here is the code, and here is my new password."
 *
 * Two independent bounds sit over this endpoint and they guard different things. The
 * per-code counter in PasswordResetChallenge caps guesses against one issued secret and
 * survives a restart because it is a database column. The limiter here caps requests from
 * one address-and-IP pair over time, and so also covers the attacker who burns a code,
 * requests another, and keeps going.
 *
 * Deliberately looser than the per-code bound, so that in normal use it is the code's own
 * counter that bites and the person is told something useful ("ask for a new one") rather
 * than "try again in fifteen minutes". This one is the backstop.
 *
 * Keyed and prefixed exactly as ForgotPasswordRequest, and for the reasons written there.
 */
class ResetPasswordRequest extends FormRequest
{
    /** One exhausted code (five) plus a full second code's worth, and no more. */
    private const MAX_ATTEMPTS = 10;

    private const DECAY_SECONDS = PasswordResetChallenge::TTL_MINUTES * 60;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email'],
            // `digits` and not `size`: it rejects "12345a" and "  1234" before either can
            // reach the domain, which keeps malformed input from spending an attempt.
            'code' => ['required', 'string', 'digits:'.ResetCode::LENGTH],
            'password' => NewPasswordRules::rules(),
            'device_name' => ['sometimes', 'string', 'max:255'],
        ];
    }

    public function deviceName(): string
    {
        return $this->input('device_name', 'unknown-device');
    }

    protected function passedValidation(): void
    {
        $this->ensureIsNotRateLimited();

        // Hit before the attempt is judged, not after a failure, because the controller
        // cannot be trusted to remember and a limiter that only counts failures it is told
        // about counts nothing when a code path forgets to tell it.
        RateLimiter::hit($this->throttleKey(), self::DECAY_SECONDS);
    }

    /**
     * Called by the controller once the reset has actually succeeded.
     *
     * Without it, a person who fumbled the code twice and then got it right would find
     * their own next reset -- a month later, from the same network -- already two attempts
     * down. A completed reset means the pair was legitimate, so the suspicion is spent.
     */
    public function clearRateLimit(): void
    {
        RateLimiter::clear($this->throttleKey());
    }

    private function ensureIsNotRateLimited(): void
    {
        if (! RateLimiter::tooManyAttempts($this->throttleKey(), self::MAX_ATTEMPTS)) {
            return;
        }

        event(new Lockout($this));

        throw ValidationException::withMessages([
            'code' => __('auth.throttle', [
                'seconds' => $seconds = RateLimiter::availableIn($this->throttleKey()),
                'minutes' => ceil($seconds / 60),
            ]),
        ])->status(429);
    }

    private function throttleKey(): string
    {
        return 'password-reset|'.Str::transliterate(
            Str::lower($this->string('email')).'|'.$this->ip()
        );
    }
}
