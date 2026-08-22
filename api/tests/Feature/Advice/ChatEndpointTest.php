<?php

namespace Tests\Feature\Advice;

use App\Models\ChatMessage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ChatEndpointTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.gemini.key' => 'test-key', 'services.gemini.model' => 'gemini-test']);
    }

    private function fakeModel(string $reply = 'You slept well. Take the harder work this morning.'): void
    {
        Http::fake([
            '*generativelanguage.googleapis.com*' => Http::response([
                'candidates' => [['content' => ['parts' => [['text' => $reply]]]]],
            ]),
        ]);
    }

    // --- Access ---

    public function test_should_reject_an_unauthenticated_read(): void
    {
        $this->getJson('/api/v1/chat')->assertUnauthorized();
    }

    public function test_should_reject_an_unauthenticated_message(): void
    {
        $this->postJson('/api/v1/chat', ['message' => 'hello'])->assertUnauthorized();
    }

    public function test_should_never_show_another_users_thread(): void
    {
        // The property that matters most in a health assistant: there is no route by which
        // one account reaches another's conversation.
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        ChatMessage::query()->create([
            'user_id' => $theirs->id,
            'role' => ChatMessage::ROLE_USER,
            'body' => 'something private',
        ]);

        $this->actingAs($mine, 'sanctum')
            ->getJson('/api/v1/chat')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_should_only_clear_the_callers_own_thread(): void
    {
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        foreach ([$mine, $theirs] as $user) {
            ChatMessage::query()->create([
                'user_id' => $user->id,
                'role' => ChatMessage::ROLE_USER,
                'body' => 'hello',
            ]);
        }

        $this->actingAs($mine, 'sanctum')->deleteJson('/api/v1/chat')->assertNoContent();

        $this->assertSame(0, ChatMessage::query()->where('user_id', $mine->id)->count());
        $this->assertSame(1, ChatMessage::query()->where('user_id', $theirs->id)->count());
    }

    // --- Conversation ---

    public function test_should_store_both_sides_of_the_exchange(): void
    {
        $this->fakeModel();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'How did I sleep?'])
            ->assertCreated()
            ->assertJsonPath('data.question.role', 'user')
            ->assertJsonPath('data.answer.role', 'assistant');

        $this->assertSame(2, ChatMessage::query()->count());
    }

    public function test_should_ground_the_model_in_todays_figures(): void
    {
        $this->fakeModel();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'How am I doing?'])
            ->assertCreated();

        Http::assertSent(function ($request) {
            $body = json_encode($request->data());

            // The grounding block leads the conversation, and the safety rules travel with
            // it — a request without them would be an ungoverned health chatbot.
            return str_contains($body, "Today's data")
                && str_contains($body, 'Never diagnose')
                && str_contains($body, 'not a clinician');
        });
    }

    public function test_should_never_send_an_identifier_to_the_model(): void
    {
        $this->fakeModel();

        $user = User::factory()->create(['email' => 'someone@example.com', 'name' => 'Someone Real']);

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'Hello'])
            ->assertCreated();

        Http::assertSent(function ($request) {
            $body = json_encode($request->data());

            return ! str_contains($body, 'someone@example.com')
                && ! str_contains($body, 'Someone Real');
        });
    }

    public function test_should_keep_the_question_when_the_provider_fails(): void
    {
        Http::fake(['*generativelanguage.googleapis.com*' => Http::response([], 500)]);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'Why am I tired?'])
            ->assertStatus(503);

        // Losing what they typed because the provider was unreachable is the worse
        // failure, so the question survives and only the answer is missing.
        $this->assertSame(1, ChatMessage::query()->where('role', 'user')->count());
        $this->assertSame(0, ChatMessage::query()->where('role', 'assistant')->count());
    }

    public function test_should_reject_an_empty_or_oversized_message(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => '  '])
            ->assertStatus(422);

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => str_repeat('a', 2001)])
            ->assertStatus(422);
    }

    public function test_should_return_the_thread_oldest_first(): void
    {
        $user = User::factory()->create();

        foreach (['first', 'second', 'third'] as $body) {
            ChatMessage::query()->create([
                'user_id' => $user->id,
                'role' => ChatMessage::ROLE_USER,
                'body' => $body,
            ]);
        }

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/chat')
            ->assertOk()
            ->assertJsonPath('data.0.body', 'first')
            ->assertJsonPath('data.2.body', 'third');
    }
}
