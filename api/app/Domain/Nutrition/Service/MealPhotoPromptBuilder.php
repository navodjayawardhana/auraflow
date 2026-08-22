<?php

namespace App\Domain\Nutrition\Service;

/**
 * What we actually ask a vision model when someone photographs their dinner.
 *
 * Pure and separate for the same reason DailyBriefPromptBuilder is: the reply cannot be
 * asserted against a golden value, but the request can, and everything that decides
 * whether this feature is honest lives in the wording. In particular the model is told
 * what it is *not* being asked for — a diagnosis, a judgement about the food, or a
 * portion weight it has no way to see.
 */
final class MealPhotoPromptBuilder
{
    public function systemInstruction(): string
    {
        return <<<'TEXT'
        You identify food in photographs for AuraFlow, a wellbeing app, so that the person
        who took the photo has something to correct rather than a blank form to fill in.

        Reply with a single JSON object and nothing else. No markdown, no fences, no prose
        before or after it. The shape is exactly:

        {"items":[{"name":"","kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0}],"confidence":"low"}

        Rules:

        1. One entry per distinct food or drink you can actually see. Name it the way a
           person would say it, in three words or fewer, in British English. Do not list
           plates, cutlery, packaging or garnish you cannot identify.
        2. Every entry must carry kcal. Give the macros only where you have a reasonable
           basis for them; omit the field entirely rather than writing a placeholder.
        3. Figures are for the portion visible in this photograph, not for a standard
           serving. You have no scale and no reference object, so err towards the ordinary
           portion for that dish rather than towards a striking number.
        4. "confidence" is your own honest read of the whole photograph: "high" only when
           the foods are unambiguous and the portions are clearly visible, "medium" when you
           are confident about what the food is but not how much, "low" otherwise. A mixed
           dish, a poorly lit photo, or anything where you are naming a dish you cannot
           fully see is "low".
        5. If the photograph contains no food, return {"items":[]}. Do not invent a meal,
           and do not explain yourself.
        6. Never comment on the food, the person, their diet or their health. You are
           reading a photograph, not giving advice.
        TEXT;
    }

    /**
     * The per-photo half.
     *
     * Short because the instruction carries the rules; repeating them beside the image only
     * gives the model a second, slightly different version to follow.
     */
    public function userPrompt(): string
    {
        return 'Identify the food in this photograph and estimate it as JSON.';
    }
}
