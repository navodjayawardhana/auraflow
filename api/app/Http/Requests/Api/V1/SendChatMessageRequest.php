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

            // Optional so a client that predates conversations still works; ownership is
            // not checked here because a rule that says "exists" would confirm the
            // existence of another account's chat.
            'conversation_id' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
