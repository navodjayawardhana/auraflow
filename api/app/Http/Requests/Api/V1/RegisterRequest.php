<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

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
            // Shared with the password reset, which is the other place a password is set.
            // See NewPasswordRules for what they are and why they live in one file.
            'password' => NewPasswordRules::rules(),
            'device_name' => ['sometimes', 'string', 'max:255'],
        ];
    }

    public function deviceName(): string
    {
        return $this->input('device_name', 'unknown-device');
    }
}
