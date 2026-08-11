<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            // Length carries far more entropy than composition rules, which mostly push
            // people towards predictable substitutions. `uncompromised()` checks the
            // haveibeenpwned k-anonymity range API -- only a hash prefix leaves the
            // server, never the password.
            'password' => ['required', 'confirmed', Password::min(10)->uncompromised()],
            'device_name' => ['sometimes', 'string', 'max:255'],
        ];
    }

    public function deviceName(): string
    {
        return $this->input('device_name', 'unknown-device');
    }
}
