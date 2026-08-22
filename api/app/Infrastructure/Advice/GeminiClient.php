<?php

namespace App\Infrastructure\Advice;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * The one place a language model is called.
 *
 * Behind an interface-shaped seam on purpose: the prompt (Domain\Advice) is the part with
 * the rules in it, and swapping provider — or dropping to a rule-based writer if the key
 * runs out — should be a change here and nowhere else.
 */
final class GeminiClient
{
    /**
     * Low temperature because this is a briefing about someone's measurements, not
     * creative writing. Variability here reads as unreliability.
     */
    private const TEMPERATURE = 0.4;

    /**
     * The prompt asks for under 120 words, which is roughly 160 tokens. The rest of this
     * budget is headroom for the model's own reasoning: from Gemini 3 onwards thinking
     * tokens are charged against maxOutputTokens, and they routinely run to ~350 here.
     * At the old 320 the reasoning consumed the entire allowance and every brief came
     * back truncated mid-sentence with finishReason MAX_TOKENS.
     */
    private const MAX_OUTPUT_TOKENS = 1024;

    /**
     * Nothing in a brief about someone's own figures needs deep deliberation, and the
     * reasoning is billed and counted like any other output.
     */
    private const THINKING_LEVEL = 'low';

    /**
     * A multi-turn exchange.
     *
     * @param  list<array{role: string, body: string}>  $turns  Oldest first; role is 'user' or 'assistant'.
     */
    public function converse(string $systemInstruction, array $turns): string
    {
        $contents = array_map(
            static fn (array $turn): array => [
                // Gemini's own vocabulary is user/model rather than user/assistant.
                'role' => $turn['role'] === 'assistant' ? 'model' : 'user',
                'parts' => [['text' => $turn['body']]],
            ],
            $turns,
        );

        return $this->call($systemInstruction, $contents);
    }

    public function generate(string $systemInstruction, string $userPrompt): string
    {
        return $this->call($systemInstruction, [
            ['role' => 'user', 'parts' => [['text' => $userPrompt]]],
        ]);
    }

    /**
     * @param  list<array{role: string, parts: list<array{text: string}>}>  $contents
     */
    private function call(string $systemInstruction, array $contents): string
    {
        $apiKey = config('services.gemini.key');

        if (blank($apiKey)) {
            throw new RuntimeException('GEMINI_API_KEY is not configured.');
        }

        $url = sprintf(
            '%s/models/%s:generateContent',
            rtrim((string) config('services.gemini.base_url'), '/'),
            config('services.gemini.model'),
        );

        $response = Http::timeout(25)
            ->retry(2, 500)
            ->withHeaders(['x-goog-api-key' => $apiKey])
            ->post($url, [
                'systemInstruction' => [
                    'parts' => [['text' => $systemInstruction]],
                ],
                'contents' => $contents,
                'generationConfig' => [
                    'temperature' => self::TEMPERATURE,
                    'maxOutputTokens' => self::MAX_OUTPUT_TOKENS,
                    'thinkingConfig' => ['thinkingLevel' => self::THINKING_LEVEL],
                ],
            ]);

        if (! $response->successful()) {
            throw new RuntimeException('Gemini returned '.$response->status());
        }

        $text = $response->json('candidates.0.content.parts.0.text');

        if (! is_string($text) || trim($text) === '') {
            // A blocked or empty candidate is a real outcome — safety filters can fire on
            // health wording — and it must not surface as an empty reply.
            throw new RuntimeException('Gemini returned no usable text.');
        }

        // A truncated answer is worse than none: the brief would stop mid-sentence and
        // read as a broken app rather than a missing one, and the caller already knows
        // how to show "couldn't generate today".
        if ($response->json('candidates.0.finishReason') === 'MAX_TOKENS') {
            throw new RuntimeException('Gemini ran out of output budget before finishing.');
        }

        return trim($text);
    }
}
