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
     * The prompt asks for under 120 words, which is roughly 160 tokens. Everything above
     * that is headroom for the model's own reasoning: from Gemini 3 onwards thinking tokens
     * are charged against maxOutputTokens, and they are not bounded by the answer's length.
     *
     * This has now been raised twice for the same reason. At 320 the reasoning consumed the
     * whole allowance; at 1024, which was set assuming reasoning of around 350 tokens, a
     * brief still came back with finishReason MAX_TOKENS. The lesson is that the reasoning
     * budget is not something to estimate tightly -- an unfinished answer is thrown away
     * entirely, so a generous ceiling costs a fraction of what a wasted call does.
     */
    private const MAX_OUTPUT_TOKENS = 2048;

    /**
     * Nothing in a brief about someone's own figures needs deep deliberation, and the
     * reasoning is billed and counted like any other output.
     */
    private const THINKING_LEVEL = 'low';

    private const TIMEOUT_SECONDS = 25;

    /** One retry. Provider blips are transient far more often than they are permanent. */
    private const ATTEMPTS = 2;

    /**
     * A photograph is megabytes rather than kilobytes, so both numbers above are wrong for
     * it in opposite directions: one attempt legitimately takes longer, and re-sending the
     * whole image after a timeout turns a slow request into a minute of silence on a phone
     * whose owner is standing there holding it. One attempt, with room to finish.
     */
    private const IMAGE_TIMEOUT_SECONDS = 45;

    private const IMAGE_ATTEMPTS = 1;

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
     * One image and one question about it.
     *
     * Here rather than in a second client because the provider, the key and the failure
     * vocabulary are the same; only the shape of the part differs. The bytes are passed
     * inline and never written to disk — the app has no reason to keep a photograph of
     * someone's dinner, and a stored image is a liability the feature does not need.
     *
     * @param  string  $imageBytes  Raw, not base64 — encoding is this method's business.
     */
    public function describeImage(
        string $systemInstruction,
        string $userPrompt,
        string $imageBytes,
        string $mimeType,
    ): string {
        return $this->call(
            $systemInstruction,
            [[
                'role' => 'user',
                'parts' => [
                    // Text first: the model follows an instruction that precedes the image
                    // more reliably than one that trails it.
                    ['text' => $userPrompt],
                    ['inlineData' => ['mimeType' => $mimeType, 'data' => base64_encode($imageBytes)]],
                ],
            ]],
            self::IMAGE_TIMEOUT_SECONDS,
            self::IMAGE_ATTEMPTS,
        );
    }

    /**
     * @param  list<array{role: string, parts: list<array<string, mixed>>}>  $contents
     */
    private function call(
        string $systemInstruction,
        array $contents,
        int $timeoutSeconds = self::TIMEOUT_SECONDS,
        int $attempts = self::ATTEMPTS,
    ): string {
        $apiKey = config('services.gemini.key');

        if (blank($apiKey)) {
            throw new RuntimeException('GEMINI_API_KEY is not configured.');
        }

        $url = sprintf(
            '%s/models/%s:generateContent',
            rtrim((string) config('services.gemini.base_url'), '/'),
            config('services.gemini.model'),
        );

        $response = Http::timeout($timeoutSeconds)
            ->retry($attempts, 500)
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
