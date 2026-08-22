<?php

namespace App\Jobs;

use App\Application\Advice\UseCase\BuildDailyContextUseCase;
use App\Domain\Advice\Service\DailyBriefPromptBuilder;
use App\Infrastructure\Advice\GeminiClient;
use App\Models\DailyBrief;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
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
                'status' => DailyBrief::STATUS_FAILED,
                'failure_reason' => 'Not enough recorded today to brief on.',
            ]);

            return;
        }

        $body = $gemini->generate($prompts->systemInstruction(), $prompts->userPrompt($context));

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
