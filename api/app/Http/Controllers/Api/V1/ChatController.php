<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Advice\UseCase\BuildDailyContextUseCase;
use App\Domain\Advice\Service\ChatPromptBuilder;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\SendChatMessageRequest;
use App\Infrastructure\Advice\GeminiClient;
use App\Models\ChatMessage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

/**
 * The assistant.
 *
 * Every read and write is scoped to `$request->user()` — there is no route by which one
 * account can reach another's thread, and the grounding block is built from that user's
 * own day. The model never sees an identifier, only figures.
 */
final class ChatController extends Controller
{
    /**
     * How much of the thread is replayed to the model. Enough for the conversation to
     * follow itself, bounded so a long thread cannot grow the cost of every message.
     */
    private const HISTORY_TURNS = 12;

    public function __construct(
        private readonly ChatPromptBuilder $prompts,
        private readonly BuildDailyContextUseCase $buildContext,
        private readonly GeminiClient $gemini,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $messages = ChatMessage::query()
            ->where('user_id', $request->user()->id)
            ->orderBy('id')
            ->limit(200)
            ->get();

        return response()->json([
            'data' => $messages->map($this->toArray(...))->all(),
        ]);
    }

    public function store(SendChatMessageRequest $request): JsonResponse
    {
        $user = $request->user();
        $body = $request->string('message')->trim()->toString();

        $question = ChatMessage::query()->create([
            'user_id' => $user->id,
            'role' => ChatMessage::ROLE_USER,
            'body' => $body,
        ]);

        $history = ChatMessage::query()
            ->where('user_id', $user->id)
            ->orderByDesc('id')
            ->limit(self::HISTORY_TURNS)
            ->get()
            ->reverse()
            ->values();

        $context = $this->buildContext->execute((string) $user->id, now()->format('Y-m-d'));

        // Today's figures lead, so the model answers from measurements rather than from
        // whatever it remembers being told earlier in the thread.
        $turns = [['role' => 'user', 'body' => $this->prompts->groundingFor($context)]];

        foreach ($history as $message) {
            $turns[] = ['role' => $message->role, 'body' => $message->body];
        }

        try {
            $reply = $this->gemini->converse($this->prompts->systemInstruction(), $turns);
        } catch (Throwable) {
            // The question stays in the thread — losing what they typed because the
            // provider was unreachable would be the worse failure.
            return response()->json([
                'message' => "The assistant isn't available right now.",
                'data' => ['question' => $this->toArray($question)],
            ], 503);
        }

        $answer = ChatMessage::query()->create([
            'user_id' => $user->id,
            'role' => ChatMessage::ROLE_ASSISTANT,
            'body' => $reply,
        ]);

        return response()->json([
            'data' => [
                'question' => $this->toArray($question),
                'answer' => $this->toArray($answer),
            ],
        ], 201);
    }

    public function destroy(Request $request): JsonResponse
    {
        ChatMessage::query()->where('user_id', $request->user()->id)->delete();

        return response()->json(null, 204);
    }

    /**
     * @return array<string, mixed>
     */
    private function toArray(ChatMessage $message): array
    {
        return [
            'id' => $message->id,
            'role' => $message->role,
            'body' => $message->body,
            'created_at' => $message->created_at?->toAtomString(),
        ];
    }
}
