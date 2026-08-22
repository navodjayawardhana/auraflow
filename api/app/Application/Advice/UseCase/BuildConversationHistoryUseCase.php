<?php

namespace App\Application\Advice\UseCase;

use App\Models\ChatConversation;
use App\Models\ChatMessage;

/**
 * The turns replayed to the model for one conversation.
 *
 * Scoped to the conversation and nothing wider. Replaying the account's whole history
 * would let a question asked three chats ago steer today's answer, and would make every
 * message more expensive than the last for as long as the user keeps the app.
 */
final class BuildConversationHistoryUseCase
{
    /**
     * How far back the model can see. Enough for the conversation to follow itself,
     * bounded so a long one cannot grow the cost of every message in it.
     */
    private const HISTORY_TURNS = 12;

    /**
     * @return list<array{role: string, body: string}>
     */
    public function execute(ChatConversation $conversation): array
    {
        return ChatMessage::query()
            ->where('conversation_id', $conversation->id)
            ->orderByDesc('id')
            ->limit(self::HISTORY_TURNS)
            ->get()
            ->reverse()
            ->map(fn (ChatMessage $message) => ['role' => $message->role, 'body' => $message->body])
            ->values()
            ->all();
    }
}
