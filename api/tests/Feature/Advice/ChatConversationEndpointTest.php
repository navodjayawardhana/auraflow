<?php

namespace Tests\Feature\Advice;

use App\Models\ChatConversation;
use App\Models\ChatMessage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Conversations: starting one, reopening one, and destroying one.
 *
 * The thread used to be a single endless list per account, so the two properties worth
 * the most here are that a conversation id from one account resolves to nothing in
 * another's hands, and that the history replayed to the model is cut to the conversation
 * being had rather than everything the user has ever asked.
 */
class ChatConversationEndpointTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.gemini.key' => 'test-key', 'services.gemini.model' => 'gemini-test']);
    }

    private function fakeModel(string $reply = 'Rest today.'): void
    {
        Http::fake([
            '*generativelanguage.googleapis.com*' => Http::response([
                'candidates' => [['content' => ['parts' => [['text' => $reply]]]]],
            ]),
        ]);
    }

    private function conversationFor(User $user, ?string $title = null): ChatConversation
    {
        return ChatConversation::query()->create([
            'user_id' => $user->id,
            'title' => $title,
            'last_activity_at' => now(),
        ]);
    }

    private function messageIn(ChatConversation $conversation, string $body): ChatMessage
    {
        return ChatMessage::query()->create([
            'user_id' => $conversation->user_id,
            'conversation_id' => $conversation->id,
            'role' => ChatMessage::ROLE_USER,
            'body' => $body,
        ]);
    }

    // --- Access ---

    public function test_should_reject_unauthenticated_conversation_routes(): void
    {
        $this->getJson('/api/v1/chat/conversations')->assertUnauthorized();
        $this->postJson('/api/v1/chat/conversations')->assertUnauthorized();
    }

    public function test_should_never_list_another_users_conversations(): void
    {
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        $this->conversationFor($theirs, 'Their private worry');

        $this->actingAs($mine, 'sanctum')
            ->getJson('/api/v1/chat/conversations')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_should_not_open_another_users_conversation(): void
    {
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        $conversation = $this->conversationFor($theirs);
        $this->messageIn($conversation, 'something private');

        // 404 rather than 403: a forbidden would confirm the id exists.
        $this->actingAs($mine, 'sanctum')
            ->getJson('/api/v1/chat?conversation='.$conversation->id)
            ->assertNotFound();
    }

    public function test_should_not_write_into_another_users_conversation(): void
    {
        $this->fakeModel();

        $mine = User::factory()->create();
        $theirs = User::factory()->create();
        $conversation = $this->conversationFor($theirs);

        $this->actingAs($mine, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'hello', 'conversation_id' => $conversation->id])
            ->assertNotFound();

        $this->assertSame(0, ChatMessage::query()->count());
    }

    public function test_should_not_delete_another_users_conversation(): void
    {
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        $conversation = $this->conversationFor($theirs);
        $this->messageIn($conversation, 'something private');

        $this->actingAs($mine, 'sanctum')
            ->deleteJson('/api/v1/chat?conversation='.$conversation->id)
            ->assertNotFound();

        $this->assertDatabaseCount('chat_conversations', 1);
        $this->assertDatabaseCount('chat_messages', 1);
    }

    // --- Starting and reopening ---

    public function test_should_start_an_empty_conversation_without_touching_the_last_one(): void
    {
        $this->fakeModel();
        $user = User::factory()->create();

        $first = $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'How did I sleep?'])
            ->assertCreated()
            ->json('data.conversation.id');

        $second = $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat/conversations')
            ->assertCreated()
            ->json('data.id');

        $this->assertNotSame($first, $second);

        // The point of "new chat" over "clear chat": the previous exchange is still there.
        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/chat?conversation='.$first)
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.body', 'How did I sleep?');

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/chat?conversation='.$second)
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_should_not_stack_blank_conversations(): void
    {
        $user = User::factory()->create();

        $first = $this->actingAs($user, 'sanctum')->postJson('/api/v1/chat/conversations')->json('data.id');
        $second = $this->actingAs($user, 'sanctum')->postJson('/api/v1/chat/conversations')->json('data.id');

        $this->assertSame($first, $second);
        $this->assertDatabaseCount('chat_conversations', 1);
    }

    public function test_should_default_to_the_most_recently_used_conversation(): void
    {
        $this->fakeModel();
        $user = User::factory()->create();

        $older = $this->conversationFor($user, 'Older');
        $older->update(['last_activity_at' => now()->subDays(3)]);
        $this->messageIn($older, 'yesterday');

        $newer = $this->conversationFor($user, 'Newer');
        $this->messageIn($newer, 'today');

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/chat')
            ->assertOk()
            ->assertJsonPath('meta.conversation.id', $newer->id)
            ->assertJsonPath('data.0.body', 'today');
    }

    public function test_should_list_conversations_most_recent_first_with_their_size(): void
    {
        $user = User::factory()->create();

        $older = $this->conversationFor($user, 'Older');
        $older->update(['last_activity_at' => now()->subDays(2)]);
        $this->messageIn($older, 'one');

        $newer = $this->conversationFor($user, 'Newer');
        $this->messageIn($newer, 'one');
        $this->messageIn($newer, 'two');

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/chat/conversations')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.title', 'Newer')
            ->assertJsonPath('data.0.message_count', 2)
            ->assertJsonPath('data.1.title', 'Older');
    }

    // --- Titles ---

    public function test_should_title_a_conversation_from_its_opening_question(): void
    {
        $this->fakeModel();
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'Why is my recovery low?'])
            ->assertCreated()
            ->assertJsonPath('data.conversation.title', 'Why is my recovery low?');
    }

    public function test_should_shorten_a_long_opening_question_at_a_word_boundary(): void
    {
        $this->fakeModel();
        $user = User::factory()->create();

        $title = $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', [
                'message' => 'Should I go for a long run this evening or leave it until tomorrow morning?',
            ])
            ->assertCreated()
            ->json('data.conversation.title');

        $this->assertStringEndsWith('…', $title);
        $this->assertStringStartsWith('Should I go for a long run', $title);
        $this->assertLessThanOrEqual(45, mb_strlen($title));
    }

    public function test_should_keep_the_first_title_when_the_conversation_continues(): void
    {
        $this->fakeModel();
        $user = User::factory()->create();

        $id = $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'First question'])
            ->json('data.conversation.id');

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'Second question', 'conversation_id' => $id])
            ->assertCreated()
            ->assertJsonPath('data.conversation.title', 'First question');
    }

    // --- What the model sees ---

    public function test_should_scope_the_model_history_to_the_current_conversation(): void
    {
        $this->fakeModel();
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'Ask me about apples'])
            ->assertCreated();

        $second = $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat/conversations')
            ->json('data.id');

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'Ask me about bananas', 'conversation_id' => $second])
            ->assertCreated();

        // Neither request can satisfy this predicate unless the second one carried the
        // new conversation alone: an unscoped history would carry both words together.
        Http::assertSent(function ($request) {
            $body = json_encode($request->data());

            return str_contains($body, 'bananas') && ! str_contains($body, 'apples');
        });
    }

    public function test_should_replay_earlier_turns_of_the_same_conversation(): void
    {
        $this->fakeModel();
        $user = User::factory()->create();

        $id = $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'Ask me about apples'])
            ->json('data.conversation.id');

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'And what else?', 'conversation_id' => $id])
            ->assertCreated();

        Http::assertSent(function ($request) {
            $body = json_encode($request->data());

            return str_contains($body, 'apples') && str_contains($body, 'And what else?');
        });
    }

    // --- Clearing ---

    public function test_should_clear_only_the_named_conversation(): void
    {
        $user = User::factory()->create();

        $kept = $this->conversationFor($user, 'Kept');
        $this->messageIn($kept, 'still here');

        $doomed = $this->conversationFor($user, 'Doomed');
        $this->messageIn($doomed, 'gone');

        $this->actingAs($user, 'sanctum')
            ->deleteJson('/api/v1/chat?conversation='.$doomed->id)
            ->assertNoContent();

        $this->assertDatabaseMissing('chat_conversations', ['id' => $doomed->id]);
        $this->assertDatabaseHas('chat_conversations', ['id' => $kept->id]);

        // The messages go with it rather than lingering unattached.
        $this->assertSame(0, ChatMessage::query()->where('conversation_id', $doomed->id)->count());
        $this->assertSame(1, ChatMessage::query()->where('conversation_id', $kept->id)->count());
    }

    public function test_should_clear_the_whole_history_when_no_conversation_is_named(): void
    {
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        foreach ([$mine, $mine, $theirs] as $owner) {
            $this->messageIn($this->conversationFor($owner), 'hello');
        }

        $this->actingAs($mine, 'sanctum')->deleteJson('/api/v1/chat')->assertNoContent();

        $this->assertSame(0, ChatConversation::query()->where('user_id', $mine->id)->count());
        $this->assertSame(0, ChatMessage::query()->where('user_id', $mine->id)->count());
        $this->assertSame(1, ChatConversation::query()->where('user_id', $theirs->id)->count());
        $this->assertSame(1, ChatMessage::query()->where('user_id', $theirs->id)->count());
    }
}
