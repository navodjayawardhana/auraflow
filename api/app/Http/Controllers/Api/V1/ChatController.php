<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Advice\UseCase\AppendChatMessageUseCase;
use App\Application\Advice\UseCase\BuildConversationHistoryUseCase;
use App\Application\Advice\UseCase\BuildGroundingPackUseCase;
use App\Application\Advice\UseCase\ResolveConversationUseCase;
use App\Application\Advice\UseCase\StartConversationUseCase;
use App\Domain\Advice\Service\ChatPromptBuilder;
use App\Domain\Advice\ValueObject\DayPart;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\SendChatMessageRequest;
use App\Infrastructure\Advice\GeminiClient;
use App\Models\ChatConversation;
use App\Models\ChatMessage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

/**
 * The assistant.
 *
 * Every read and write is scoped to `$request->user()` — there is no route by which one
 * account can reach another's conversation, and the grounding pack is built from that
 * user's own rows, before the model is called and never from anything it produced. The
 * model never sees an identifier, only figures.
 *
 * A request without a conversation id means "the one they were last in", so a client that
 * has never heard of conversations keeps working unchanged.
 */
final class ChatController extends Controller
{
    public function __construct(
        private readonly ChatPromptBuilder $prompts,
        private readonly BuildGroundingPackUseCase $buildPack,
        private readonly BuildConversationHistoryUseCase $buildHistory,
        private readonly ResolveConversationUseCase $resolveConversation,
        private readonly StartConversationUseCase $startConversation,
        private readonly AppendChatMessageUseCase $appendMessage,
        private readonly GeminiClient $gemini,
    ) {
    }

    /** The history list, most recently used first, so a past chat can be reopened. */
    public function conversations(Request $request): JsonResponse
    {
        $conversations = ChatConversation::query()
            ->where('user_id', $request->user()->id)
            ->withCount('messages')
            ->orderByDesc('last_activity_at')
            ->orderByDesc('id')
            ->limit(50)
            ->get();

        return response()->json([
            'data' => $conversations
                ->map(fn (ChatConversation $c) => $this->conversationToArray($c, (int) $c->messages_count))
                ->all(),
        ]);
    }

    /**
     * New chat.
     *
     * Creates nothing to be sorry about: the conversation they were in is left exactly
     * where it is and stays in the history list. This is the opposite of `destroy`.
     */
    public function newConversation(Request $request): JsonResponse
    {
        $conversation = $this->startConversation->execute($request->user()->id);

        return response()->json(['data' => $this->conversationToArray($conversation, 0)], 201);
    }

    public function index(Request $request): JsonResponse
    {
        $requestedId = $this->requestedConversationId($request);

        $conversation = $this->resolveConversation->execute($request->user()->id, $requestedId);

        if ($conversation === null) {
            // Asked for a specific chat and did not get it: not theirs, or gone. A user
            // who simply has no chats yet asked for none, and gets an empty thread.
            return $requestedId !== null
                ? response()->json(['message' => 'That conversation no longer exists.'], 404)
                : response()->json(['data' => [], 'meta' => ['conversation' => null]]);
        }

        $messages = ChatMessage::query()
            ->where('conversation_id', $conversation->id)
            ->orderBy('id')
            ->limit(200)
            ->get();

        return response()->json([
            'data' => $messages->map($this->toArray(...))->all(),
            'meta' => [
                'conversation' => $this->conversationToArray($conversation, $messages->count()),
            ],
        ]);
    }

    public function store(SendChatMessageRequest $request): JsonResponse
    {
        $user = $request->user();
        $body = $request->string('message')->trim()->toString();
        $requestedId = $request->has('conversation_id') ? $request->integer('conversation_id') : null;

        $conversation = $this->resolveConversation->execute($user->id, $requestedId);

        if ($conversation === null) {
            if ($requestedId !== null) {
                return response()->json(['message' => 'That conversation no longer exists.'], 404);
            }

            $conversation = $this->startConversation->execute($user->id);
        }

        $question = $this->appendMessage->execute($conversation, ChatMessage::ROLE_USER, $body);

        $pack = $this->buildPack->execute(
            (string) $user->id,
            now()->format('Y-m-d'),
            DayPart::fromHour((int) now()->format('G')),
        );

        // Their own figures lead, so the model answers from measurements rather than from
        // whatever it remembers being told earlier in the thread. Rebuilt on every message
        // rather than carried with the conversation: a thread opened this morning and
        // returned to this evening has to answer about this evening.
        $turns = [['role' => 'user', 'body' => $this->prompts->groundingFor($pack)]];

        foreach ($this->buildHistory->execute($conversation) as $turn) {
            $turns[] = $turn;
        }

        try {
            $reply = $this->gemini->converse($this->prompts->systemInstruction(), $turns);
        } catch (Throwable) {
            // The question stays in the thread — losing what they typed because the
            // provider was unreachable would be the worse failure.
            return response()->json([
                'message' => "The assistant isn't available right now.",
                'data' => [
                    'question' => $this->toArray($question),
                    'conversation' => $this->conversationToArray($conversation),
                ],
            ], 503);
        }

        $answer = $this->appendMessage->execute($conversation, ChatMessage::ROLE_ASSISTANT, $reply);

        return response()->json([
            'data' => [
                'question' => $this->toArray($question),
                'answer' => $this->toArray($answer),
                'conversation' => $this->conversationToArray($conversation->refresh()),
            ],
        ], 201);
    }

    /**
     * Clear. One conversation when named, otherwise the account's entire chat history.
     *
     * Deliberately not the same thing as starting a new chat: this is the only path that
     * destroys anything, and the client keeps it behind its own confirmation.
     */
    public function destroy(Request $request): JsonResponse
    {
        $userId = $request->user()->id;
        $requestedId = $this->requestedConversationId($request);

        if ($requestedId !== null) {
            $conversation = $this->resolveConversation->execute($userId, $requestedId);

            if ($conversation === null) {
                return response()->json(['message' => 'That conversation no longer exists.'], 404);
            }

            // Messages go explicitly rather than by cascade: SQLite only enforces the
            // foreign key when the connection has the pragma on, and a delete that
            // silently leaves the messages behind is the worst outcome of the three.
            ChatMessage::query()->where('conversation_id', $conversation->id)->delete();
            $conversation->delete();

            return response()->json(null, 204);
        }

        ChatMessage::query()->where('user_id', $userId)->delete();
        ChatConversation::query()->where('user_id', $userId)->delete();

        return response()->json(null, 204);
    }

    private function requestedConversationId(Request $request): ?int
    {
        return $request->has('conversation') ? $request->integer('conversation') : null;
    }

    /**
     * @return array<string, mixed>
     */
    private function conversationToArray(ChatConversation $conversation, ?int $messageCount = null): array
    {
        return [
            'id' => $conversation->id,
            'title' => $conversation->title,
            'message_count' => $messageCount ?? $conversation->messages()->count(),
            'last_activity_at' => $conversation->last_activity_at?->toAtomString(),
        ];
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
