<?php

namespace App\Application\Nutrition\UseCase;

use App\Domain\Nutrition\Exception\UnreadableMealPhotoException;
use App\Domain\Nutrition\Service\MealPhotoEstimateParser;
use App\Domain\Nutrition\Service\MealPhotoPromptBuilder;
use App\Domain\Nutrition\ValueObject\MealPhotoEstimate;
use App\Infrastructure\Advice\GeminiClient;
use RuntimeException;

/**
 * Photograph in, editable draft out.
 *
 * Orchestration only, and deliberately synchronous — unlike the daily brief, which is
 * queued. The difference is who is waiting: a brief is read when the dashboard is opened
 * and nobody is standing over it, whereas this runs because someone just pressed a shutter
 * and is holding the phone waiting to see what it says. Queueing it would mean storing the
 * photograph somewhere, polling for the answer, and keeping an image of someone's dinner on
 * a server for as long as that took. The image is held for one request and then gone.
 */
final class EstimateMealFromPhotoUseCase
{
    public function __construct(
        private readonly MealPhotoPromptBuilder $prompts,
        private readonly MealPhotoEstimateParser $parser,
        private readonly GeminiClient $gemini,
    ) {
    }

    /**
     * @param  string  $imageBytes  Raw image data, already validated as a supported type.
     *
     * @throws UnreadableMealPhotoException when the reply holds no usable food
     * @throws RuntimeException when the provider cannot be reached or is unconfigured
     */
    public function execute(string $imageBytes, string $mimeType): MealPhotoEstimate
    {
        return $this->parser->parse($this->gemini->describeImage(
            $this->prompts->systemInstruction(),
            $this->prompts->userPrompt(),
            $imageBytes,
            $mimeType,
        ));
    }
}
