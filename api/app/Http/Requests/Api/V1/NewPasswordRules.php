<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Validation\Rules\Password;

/**
 * The rules a password must satisfy, wherever one is set.
 *
 * One copy, referenced by RegisterRequest and ResetPasswordRequest, because two copies of
 * a password policy is how one of them ends up weaker -- and the weaker one is invariably
 * the reset path, which is precisely where an attacker is standing.
 *
 * Not in Domain, unlike the reset TTL and attempt bound beside it. `Password::min()` is a
 * framework validation rule and `uncompromised()` is a call to a third-party API; wrapping
 * them in a domain object would move the code without moving the decision, which is the
 * ceremony AuthController's docblock already refuses.
 */
final class NewPasswordRules
{
    /**
     * Length carries far more entropy than composition rules, which mostly push people
     * towards predictable substitutions. `uncompromised()` checks the haveibeenpwned
     * k-anonymity range API -- only a hash prefix leaves the server, never the password.
     *
     * @return array<int, mixed>
     */
    public static function rules(): array
    {
        return ['required', 'confirmed', Password::min(10)->uncompromised()];
    }
}
