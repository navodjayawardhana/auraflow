<?php

namespace App\Application\Advice\UseCase;

use App\Models\ChatConversation;

/**
 * Which conversation a chat request is about.
 *
 * The single ownership gate for the whole slice. Every read, write and delete goes
 * through here, so "can this account touch this conversation?" is answered once rather
 * than re-derived in three controller methods that would eventually disagree.
 */
final class ResolveConversationUseCase
{
    /**
     * Null means the caller asked for a conversation that is not theirs, or has none at
     * all yet. Both answer with the same nothing on purpose: a probe must not be able to
     * tell "someone else's chat" apart from "no such chat".
     */
    public function execute(int $userId, ?int $conversationId): ?ChatConversation
    {
        $conversations = ChatConversation::query()->where('user_id', $userId);

        if ($conversationId !== null) {
            return $conversations->whereKey($conversationId)->first();
        }

        return $conversations->orderByDesc('last_activity_at')->orderByDesc('id')->first();
    }
}
