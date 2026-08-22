<?php

namespace App\Domain\Nutrition\Service;

use App\Domain\Nutrition\Exception\UnreadableMealPhotoException;
use App\Domain\Nutrition\ValueObject\EstimatedFoodItem;
use App\Domain\Nutrition\ValueObject\MealPhotoEstimate;

/**
 * Turns whatever the model actually said into something the app may show.
 *
 * The reason this is a class of its own, and pure: a model asked for JSON returns almost
 * JSON most of the time. Fenced in markdown, prefaced with "Here is the breakdown:",
 * missing the macros on one item, a calorie count as a string, a stray trailing item with
 * no name. None of those are exceptional — they are the normal spread of replies, and a
 * feature that only works on the tidy ones works about half the time.
 *
 * The rule throughout is that a *partial* answer survives and an *untrustworthy* one does
 * not. An item missing its protein figure is still a real item; an item missing its
 * calories is not, because calories are the only thing this screen exists to produce.
 */
final class MealPhotoEstimateParser
{
    /** More than a dozen named things is a menu, not a plate — and it floods the editor. */
    private const MAX_ITEMS = 12;

    /** No single component of one meal is five thousand calories. */
    private const MAX_ITEM_KCAL = 5000;

    private const MAX_MACRO_G = 1000;

    private const MAX_ITEM_NAME_LENGTH = 60;

    /** @throws UnreadableMealPhotoException */
    public function parse(string $raw): MealPhotoEstimate
    {
        $decoded = json_decode($this->isolateJson($raw), true);

        if (! is_array($decoded)) {
            throw new UnreadableMealPhotoException('The recogniser did not return readable JSON.');
        }

        // A bare list of items rather than the requested envelope is a common shortcut the
        // model takes, and it costs one line to accept.
        $envelope = array_is_list($decoded) ? [] : $decoded;
        $rows = array_is_list($decoded) ? $decoded : ($envelope['items'] ?? null);

        if (! is_array($rows)) {
            throw new UnreadableMealPhotoException('The recogniser returned no items.');
        }

        $items = [];

        foreach ($rows as $row) {
            $item = is_array($row) ? $this->toItem($row) : null;

            if ($item !== null) {
                $items[] = $item;
            }

            if (count($items) === self::MAX_ITEMS) {
                break;
            }
        }

        return new MealPhotoEstimate($items, $this->toConfidence($envelope['confidence'] ?? null));
    }

    /**
     * Pulls the JSON out of a reply that may be wrapped in prose or a markdown fence.
     *
     * Outermost delimiters rather than a real scan, because what we want is the whole reply
     * minus its decoration. Whichever of `{` or `[` opens first decides which pair is the
     * envelope — looking for braces unconditionally would reach inside a returned array and
     * hand back its first element as if it were the whole answer.
     */
    private function isolateJson(string $raw): string
    {
        $text = trim($raw);

        $object = strpos($text, '{');
        $list = strpos($text, '[');

        $opensFirst = match (true) {
            $object === false => $list,
            $list === false => $object,
            default => min($object, $list),
        };

        if ($opensFirst === false) {
            return $text;
        }

        $end = strrpos($text, $opensFirst === $object ? '}' : ']');

        return $end === false || $end < $opensFirst
            ? $text
            : substr($text, $opensFirst, $end - $opensFirst + 1);
    }

    /**
     * @param  array<mixed>  $row
     */
    private function toItem(array $row): ?EstimatedFoodItem
    {
        $name = $this->toName($row['name'] ?? $row['item'] ?? $row['food'] ?? null);
        $kcal = $this->toKcal($row['kcal'] ?? $row['calories'] ?? $row['energy_kcal'] ?? null);

        if ($name === null || $kcal === null) {
            return null;
        }

        return new EstimatedFoodItem(
            $name,
            $kcal,
            $this->toMacro($row['protein_g'] ?? $row['protein'] ?? null),
            $this->toMacro($row['carbs_g'] ?? $row['carbohydrates'] ?? $row['carbs'] ?? null),
            $this->toMacro($row['fat_g'] ?? $row['fat'] ?? null),
        );
    }

    private function toName(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        // Newlines and runs of spaces would otherwise reach a single-line row in the app.
        $name = trim((string) preg_replace('/\s+/u', ' ', $value));

        if ($name === '') {
            return null;
        }

        return mb_substr($name, 0, self::MAX_ITEM_NAME_LENGTH);
    }

    private function toKcal(mixed $value): ?int
    {
        if (! is_numeric($value)) {
            return null;
        }

        $kcal = (int) round((float) $value);

        // Dropped rather than clamped. Clamping would quietly turn a misread into a
        // confident-looking figure, which is the one thing this feature must not do.
        return $kcal < 0 || $kcal > self::MAX_ITEM_KCAL ? null : $kcal;
    }

    private function toMacro(mixed $value): ?int
    {
        if (! is_numeric($value)) {
            return null;
        }

        $grams = (int) round((float) $value);

        return $grams < 0 || $grams > self::MAX_MACRO_G ? null : $grams;
    }

    private function toConfidence(mixed $value): string
    {
        $stated = is_string($value) ? strtolower(trim($value)) : '';

        return in_array($stated, [
            MealPhotoEstimate::CONFIDENCE_MEDIUM,
            MealPhotoEstimate::CONFIDENCE_HIGH,
        ], true)
            ? $stated
            // Silence, or a word we did not ask for, is not evidence of certainty.
            : MealPhotoEstimate::CONFIDENCE_LOW;
    }
}
