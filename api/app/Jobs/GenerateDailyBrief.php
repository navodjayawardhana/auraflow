<?php

namespace App\Jobs;

use App\Application\Advice\UseCase\BuildDailyContextUseCase;
use App\Domain\Advice\Service\DailyBriefPromptBuilder;
use App\Infrastructure\Advice\GeminiClient;
use App\Models\DailyBrief;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Writes one day's briefing, off the request.
 *
 * Queued because a language model call takes seconds and a phone opening a dashboard
 * should not wait on one. The client polls the brief endpoint instead and shows a
 * placeholder until the status flips — the same cache-then-network shape the rest of the
 * app already uses.
 */
class GenerateDailyBrief implements ShouldQueue
{
    use Queueable;

    /** Two retries with backoff: transient provider failures are common, permanent ones are not. */
    public int $tries = 3;

    public array $backoff = [10, 30];

    public function __construct(
        public readonly int $userId,
        public readonly string $date,
    ) {
    }

    public function handle(
        BuildDailyContextUseCase $buildContext,
        DailyBriefPromptBuilder $prompts,
        GeminiClient $gemini,
    ): void {
        $brief = DailyBrief::query()
            ->where('user_id', $this->userId)
            ->whereDate('brief_for', $this->date)
            ->first();

        if ($brief === null || $brief->status === DailyBrief::STATUS_READY) {
            // Already written, or the row went away. Rewriting settled advice would mean
            // the user sees it change under them on a reopen.
            return;
        }

        $context = $buildContext->execute((string) $this->userId, $this->date);

        if (! $context->isSufficient()) {
            $brief->update([
                'status' => DailyBrief::STATUS_WAITING,
                'failure_reason' => 'Nothing recorded today to brief on yet.',
            ]);

            return;
        }

        try {
            $body = $gemini->generate($prompts->systemInstruction(), $prompts->userPrompt($context));
        } catch (Throwable $error) {
            /*
             * Recorded here rather than left to `failed()`, which only the queue calls.
             *
             * On a synchronous queue the rethrow lands in the HTTP response that asked for
             * the brief, and the client turns a 500 into no card at all -- so the reader
             * loses the explanation along with the briefing. Catching it keeps the request
             * successful and the row truthful, which is the whole point of having a status
             * on it.
             *
             * The provider's own words stay in the log. They name the vendor and describe
             * token budgets, neither of which is any use to someone holding a phone.
             */
            Log::warning('The daily brief could not be generated.', [
                'user_id' => $this->userId,
                'date' => $this->date,
                'reason' => $error->getMessage(),
            ]);

            $brief->update([
                'status' => DailyBrief::STATUS_FAILED,
                'failure_reason' => 'The brief could not be written just now.',
            ]);

            return;
        }

        $brief->update([
            'status' => DailyBrief::STATUS_READY,
            'body' => $body,
            'model' => config('services.gemini.model'),
            'failure_reason' => null,
            'generated_at' => now(),
        ]);
    }

    /**
     * A failed briefing is a missing card, not a broken app. Recording why lets the UI say
     * something truthful instead of spinning.
     */
    public function failed(Throwable $exception): void
    {
        DailyBrief::query()
            ->where('user_id', $this->userId)
            ->whereDate('brief_for', $this->date)
            ->update([
                'status' => DailyBrief::STATUS_FAILED,
                'failure_reason' => 'Could not reach the advice service.',
            ]);
    }
}
