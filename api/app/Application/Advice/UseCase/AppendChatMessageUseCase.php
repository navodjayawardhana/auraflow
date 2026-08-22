<?php

namespace App\Application\Advice\UseCase;

use App\Domain\Advice\ValueObject\ConversationTitle;
use App\Models\ChatConversation;
use App\Models\ChatMessage;

final class AppendChatMessageUseCase
{
    public function execute(ChatConversation $conversation, string $role, string $body): ChatMessage
    {
        $message = ChatMessage::query()->create([
            'user_id' => $conversation->user_id,
            'conversation_id' => $conversation->id,
            'role' => $role,
            'body' => $body,
        ]);

        $conversation->update([
            // Named once, by the question that opened it. Re-deriving the title on later
            // turns would rename a chat the user has already learned to recognise.
            'title' => $conversation->title
                ?? ($role === ChatMessage::ROLE_USER
                    ? (string) ConversationTitle::fromFirstMessage($body)
                    : null),
            'last_activity_at' => $message->created_at,
        ]);

        return $message;
    }
}
