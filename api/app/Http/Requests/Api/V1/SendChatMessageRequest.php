<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

class SendChatMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            // Bounded because every character is billed and replayed on later turns; 2000
            // is far more than a question about last night's sleep ever needs.
            'message' => ['required', 'string', 'min:1', 'max:2000'],
        ];
    }
}
