<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Auth\Events\Lockout;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class LoginRequest extends FormRequest
{
    /** Attempts allowed before the pair is locked out. */
    private const MAX_ATTEMPTS = 5;

    private const DECAY_SECONDS = 60;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
            'device_name' => ['sometimes', 'string', 'max:255'],
        ];
    }

    public function deviceName(): string
    {
        return $this->input('device_name', 'unknown-device');
    }

    /**
     * Verify the credentials, with throttling.
     *
     * @throws ValidationException
     */
    public function authenticate(): void
    {
        $this->ensureIsNotRateLimited();

        if (! Auth::attempt($this->only('email', 'password'))) {
            RateLimiter::hit($this->throttleKey(), self::DECAY_SECONDS);

            // Deliberately the same message whether the address is unknown or the
            // password is wrong. Distinguishing them turns the login form into an
            // account-enumeration oracle.
            throw ValidationException::withMessages([
                'email' => __('auth.failed'),
            ]);
        }

        RateLimiter::clear($this->throttleKey());
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

    /**
     * Keyed on email *and* IP.
     *
     * Email alone would let an attacker lock a known user out of their own account from
     * anywhere; IP alone would let a single address spray many accounts freely.
     */
    private function throttleKey(): string
    {
        return Str::transliterate(Str::lower($this->string('email')).'|'.$this->ip());
    }
}
