<?php

namespace App\Jobs;

use App\Application\Advice\UseCase\BuildGroundingPackUseCase;
use App\Domain\Advice\Service\DailyBriefPromptBuilder;
use App\Domain\Advice\ValueObject\ContextFingerprint;
use App\Domain\Advice\ValueObject\DayPart;
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
 *
 * ## When settled advice may be rewritten
 *
 * It used to be never, and the justification held right up until the day it did not: a
 * brief written at 07:00 tells someone at 21:00 they have drunk 250 ml when they have
 * since drunk two litres. The rule is now decided on facts rather than a clock. The
 * context is fingerprinted at the coarseness at which it would change a sentence (see
 * `ContextFingerprint` for the bucket widths), and a `ready` brief is rewritten only when
 * that fingerprint has actually moved. Advice the user has read does not reword itself
 * because time passed; it rewords itself because their day did.
 *
 * The check is cheap and is meant to be repeated. Building the pack is a handful of
 * queries and the model is not called until after the comparison, so a job dispatched
 * against an unchanged day costs those queries and nothing else — the same bargain the
 * `waiting` retry already makes.
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
        BuildGroundingPackUseCase $buildPack,
        DailyBriefPromptBuilder $prompts,
        GeminiClient $gemini,
    ): void {
        $brief = DailyBrief::query()
            ->where('user_id', $this->userId)
            ->whereDate('brief_for', $this->date)
            ->first();

        if ($brief === null) {
            return;
        }

        $pack = $buildPack->execute((string) $this->userId, $this->date, $this->dayPart());

        $fingerprint = ContextFingerprint::of($pack);

        if ($brief->status === DailyBrief::STATUS_READY
            && $fingerprint->equals(ContextFingerprint::fromStored($brief->context_fingerprint))) {
            // Nothing worth a new sentence has happened. Rewriting here would mean the user
            // sees settled advice change under them on a reopen for no reason they could
            // point at, and it would be a paid call to say the same thing again.
            return;
        }

        if (! $pack->isSufficient()) {
            $brief->update([
                'status' => DailyBrief::STATUS_WAITING,
                'failure_reason' => 'Nothing recorded today to brief on yet.',
            ]);

            return;
        }

        try {
            $body = $gemini->generate($prompts->systemInstruction(), $prompts->userPrompt($pack));
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
            // Written with the body, in the same statement. A fingerprint saved separately
            // could be lost while the advice it describes survives, and the row would then
            // claim advice was written from a context nobody can reproduce.
            'context_fingerprint' => $fingerprint->value,
            'failure_reason' => null,
            'generated_at' => now(),
        ]);
    }

    /**
     * Which third of the day it is — for today, and only for today.
     *
     * A briefing being regenerated for a past date has no "now" to be written in, and
     * stamping the current hour on one would make the same backfilled day read differently
     * depending on when somebody happened to ask for it.
     */
    private function dayPart(): ?DayPart
    {
        return $this->date === now()->format('Y-m-d')
            ? DayPart::fromHour((int) now()->format('G'))
            : null;
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
