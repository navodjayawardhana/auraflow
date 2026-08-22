<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Separate conversations, so the assistant is not one thread that only ever grows.
 *
 * The thread stays server-side for the reasons the chat_messages migration gives, and
 * that is exactly why the grouping has to live here too: if the client decided which
 * messages belonged together, the history we replay to the model would again be whatever
 * a client chose to send. A conversation is the unit the model's context is cut to.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('chat_conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            // Null until the first question is asked -- an untitled row is an unused one,
            // which is how "New chat" avoids stacking blanks in the list.
            $table->string('title')->nullable();

            // Bumped on every turn and set at creation, never null, so the list orders on
            // one column. A nullable "last message" would sort a brand-new empty chat to
            // the bottom of the very list it was just created from.
            $table->timestamp('last_activity_at');

            $table->timestamps();

            // Every read is "this user's chats, most recently used first".
            $table->index(['user_id', 'last_activity_at']);
        });

        Schema::table('chat_messages', function (Blueprint $table) {
            $table->foreignId('conversation_id')
                ->nullable()
                ->after('user_id')
                ->constrained('chat_conversations')
                ->cascadeOnDelete();

            // Replaces (user_id, id) as the hot path: history is now read per conversation.
            $table->index(['conversation_id', 'id']);
        });

        $this->adoptExistingThreads();
    }

    public function down(): void
    {
        Schema::table('chat_messages', function (Blueprint $table) {
            // The key goes before the column. SQLite has no DROP CONSTRAINT and rebuilds
            // the table for this, but a bare DROP COLUMN leaves the constraint pointing at
            // a column that no longer exists and the whole table becomes unreadable.
            $table->dropForeign(['conversation_id']);
            $table->dropIndex(['conversation_id', 'id']);
            $table->dropColumn('conversation_id');
        });

        Schema::dropIfExists('chat_conversations');
    }

    /**
     * Every user's existing thread becomes their first conversation.
     *
     * Messages already written have no conversation, and leaving them unattached would
     * make a real user's history vanish from a screen that still lists every row in the
     * table -- so they are adopted rather than orphaned, in one conversation per user
     * because that is precisely what they were.
     *
     * The title rule is spelled out here instead of calling the domain value object: a
     * migration has to keep producing the same result years after that rule has moved on.
     */
    private function adoptExistingThreads(): void
    {
        $userIds = DB::table('chat_messages')
            ->whereNull('conversation_id')
            ->distinct()
            ->pluck('user_id');

        foreach ($userIds as $userId) {
            $bounds = DB::table('chat_messages')
                ->where('user_id', $userId)
                ->whereNull('conversation_id')
                ->selectRaw('MIN(created_at) AS started_at, MAX(created_at) AS ended_at')
                ->first();

            $opener = DB::table('chat_messages')
                ->where('user_id', $userId)
                ->whereNull('conversation_id')
                ->where('role', 'user')
                ->orderBy('id')
                ->value('body');

            $conversationId = DB::table('chat_conversations')->insertGetId([
                'user_id' => $userId,
                'title' => $opener === null ? null : $this->titleFrom($opener),
                'last_activity_at' => $bounds->ended_at ?? now(),
                'created_at' => $bounds->started_at ?? now(),
                'updated_at' => now(),
            ]);

            DB::table('chat_messages')
                ->where('user_id', $userId)
                ->whereNull('conversation_id')
                ->update(['conversation_id' => $conversationId]);
        }
    }

    private function titleFrom(string $body): string
    {
        $flat = trim((string) preg_replace('/\s+/u', ' ', $body));

        if ($flat === '') {
            return 'Earlier chat';
        }

        if (mb_strlen($flat) <= 44) {
            return $flat;
        }

        $cut = mb_substr($flat, 0, 44);
        $boundary = mb_strrpos($cut, ' ');

        return rtrim($boundary !== false && $boundary >= 20 ? mb_substr($cut, 0, $boundary) : $cut, ' ,.;:!?-').'…';
    }
};
