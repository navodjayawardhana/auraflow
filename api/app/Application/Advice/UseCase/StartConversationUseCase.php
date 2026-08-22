<?php

namespace App\Application\Advice\UseCase;

use App\Models\ChatConversation;

final class StartConversationUseCase
{
    public function execute(int $userId): ChatConversation
    {
        // Tapping "New chat" from a chat that is already empty hands back the same empty
        // one. Otherwise every stray tap leaves an untitled blank in the history list,
        // and the list stops being worth opening.
        $unused = ChatConversation::query()
            ->where('user_id', $userId)
            ->whereDoesntHave('messages')
            ->orderByDesc('id')
            ->first();

        return $unused ?? ChatConversation::query()->create([
            'user_id' => $userId,
            'last_activity_at' => now(),
        ]);
    }
}
