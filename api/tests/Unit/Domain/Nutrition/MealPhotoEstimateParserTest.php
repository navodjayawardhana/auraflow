<?php

namespace Tests\Unit\Domain\Nutrition;

use App\Domain\Nutrition\Exception\UnreadableMealPhotoException;
use App\Domain\Nutrition\Service\MealPhotoEstimateParser;
use PHPUnit\Framework\TestCase;

/**
 * The half of this feature that actually breaks.
 *
 * A model asked for JSON returns almost-JSON routinely, so every case below is a reply
 * that has been seen or should be expected — not a contrived one. The through-line is that
 * a partial answer survives and an untrustworthy one does not.
 */
class MealPhotoEstimateParserTest extends TestCase
{
    private MealPhotoEstimateParser $parser;

    protected function setUp(): void
    {
        parent::setUp();
        $this->parser = new MealPhotoEstimateParser;
    }

    // --- Getting to the JSON at all ---

    public function test_should_read_a_clean_reply(): void
    {
        $estimate = $this->parser->parse(
            '{"items":[{"name":"Rice","kcal":320,"protein_g":6,"carbs_g":70,"fat_g":1}],"confidence":"medium"}',
        );

        $this->assertSame(320, $estimate->totalKcal());
        $this->assertSame('medium', $estimate->confidence);
        $this->assertSame('Rice', $estimate->items[0]->name);
    }

    public function test_should_read_a_reply_wrapped_in_a_markdown_fence(): void
    {
        $estimate = $this->parser->parse(
            "```json\n{\"items\":[{\"name\":\"Toast\",\"kcal\":180}]}\n```",
        );

        $this->assertSame(180, $estimate->totalKcal());
    }

    public function test_should_read_a_reply_buried_in_prose(): void
    {
        $estimate = $this->parser->parse(
            'Here is the breakdown you asked for: {"items":[{"name":"Apple","kcal":95}]} Hope that helps!',
        );

        $this->assertSame('Apple', $estimate->items[0]->name);
    }

    public function test_should_accept_a_bare_list_of_items(): void
    {
        // A shortcut the model takes often enough that rejecting it would throw away good
        // answers. A brace-first scan returns only the first element here.
        $estimate = $this->parser->parse('[{"name":"Egg","kcal":78},{"name":"Beans","kcal":150}]');

        $this->assertCount(2, $estimate->items);
        $this->assertSame(228, $estimate->totalKcal());
    }

    public function test_should_refuse_a_reply_that_is_not_json_at_all(): void
    {
        $this->expectException(UnreadableMealPhotoException::class);

        $this->parser->parse('I am sorry, I cannot help with that.');
    }

    public function test_should_refuse_a_truncated_reply(): void
    {
        // What a run into the output-token ceiling looks like from here.
        $this->expectException(UnreadableMealPhotoException::class);

        $this->parser->parse('{"items":[{"name":"Rice","kcal":32');
    }

    public function test_should_refuse_a_reply_with_no_items_key(): void
    {
        $this->expectException(UnreadableMealPhotoException::class);

        $this->parser->parse('{"confidence":"high"}');
    }

    // --- Partial answers, which are the normal case ---

    public function test_should_keep_an_item_that_is_missing_its_macros(): void
    {
        $estimate = $this->parser->parse('{"items":[{"name":"Soup","kcal":210}]}');

        $this->assertSame(210, $estimate->totalKcal());
        $this->assertNull($estimate->totalProteinG());
    }

    public function test_should_sum_a_macro_only_over_the_items_that_reported_it(): void
    {
        // Silence is not zero. Treating it as zero reads as "this meal has 6 g of protein"
        // when what happened is that half the plate was never costed.
        $estimate = $this->parser->parse(
            '{"items":[{"name":"Rice","kcal":300,"protein_g":6},{"name":"Curry","kcal":400}]}',
        );

        $this->assertSame(6, $estimate->totalProteinG());
        $this->assertNull($estimate->totalFatG());
    }

    public function test_should_accept_figures_sent_as_strings(): void
    {
        $estimate = $this->parser->parse('{"items":[{"name":"Banana","kcal":"105","protein_g":"1.3"}]}');

        $this->assertSame(105, $estimate->totalKcal());
        $this->assertSame(1, $estimate->totalProteinG());
    }

    public function test_should_accept_the_alternative_field_names_the_model_reaches_for(): void
    {
        $estimate = $this->parser->parse('{"items":[{"food":"Chips","calories":365,"carbs":48}]}');

        $this->assertSame('Chips', $estimate->items[0]->name);
        $this->assertSame(48, $estimate->totalCarbsG());
    }

    public function test_should_drop_an_item_with_no_calorie_figure_and_keep_the_rest(): void
    {
        // Calories are the only thing this screen exists to produce, so an item without
        // them is not an item. The plate around it still is.
        $estimate = $this->parser->parse(
            '{"items":[{"name":"Salad","kcal":null},{"name":"Bread","kcal":140}]}',
        );

        $this->assertCount(1, $estimate->items);
        $this->assertSame('Bread', $estimate->items[0]->name);
    }

    public function test_should_drop_an_unnamed_item(): void
    {
        $estimate = $this->parser->parse('{"items":[{"name":"  ","kcal":90},{"name":"Milk","kcal":60}]}');

        $this->assertCount(1, $estimate->items);
    }

    public function test_should_refuse_when_every_item_was_unusable(): void
    {
        $this->expectException(UnreadableMealPhotoException::class);

        $this->parser->parse('{"items":[{"name":"Mystery"},{"kcal":200}]}');
    }

    public function test_should_refuse_an_empty_plate(): void
    {
        // The reply the prompt asks for when the photo holds no food.
        $this->expectException(UnreadableMealPhotoException::class);

        $this->parser->parse('{"items":[]}');
    }

    // --- Figures that would be a lie if shown ---

    public function test_should_drop_an_implausible_item_rather_than_clamp_it(): void
    {
        // Clamping turns a misread into a confident-looking number, which is exactly the
        // failure this feature must not have.
        $estimate = $this->parser->parse(
            '{"items":[{"name":"Rice","kcal":90000},{"name":"Fish","kcal":220}]}',
        );

        $this->assertCount(1, $estimate->items);
        $this->assertSame(220, $estimate->totalKcal());
    }

    public function test_should_refuse_a_total_the_save_endpoint_would_reject(): void
    {
        // Matching StoreMealRequest's ceiling here means the user never edits a plausible
        // screen only to hit a validation error they cannot explain.
        $this->expectException(UnreadableMealPhotoException::class);

        $this->parser->parse('{"items":[{"name":"A","kcal":4500},{"name":"B","kcal":4500}]}');
    }

    public function test_should_ignore_a_negative_macro(): void
    {
        $estimate = $this->parser->parse('{"items":[{"name":"Rice","kcal":300,"fat_g":-4}]}');

        $this->assertNull($estimate->totalFatG());
    }

    public function test_should_cap_how_many_items_one_plate_may_have(): void
    {
        $rows = array_map(
            static fn (int $i): array => ['name' => 'Item '.$i, 'kcal' => 10],
            range(1, 40),
        );

        $estimate = $this->parser->parse(json_encode(['items' => $rows]));

        $this->assertCount(12, $estimate->items);
    }

    public function test_should_flatten_a_multiline_item_name(): void
    {
        $estimate = $this->parser->parse('{"items":[{"name":"Rice\\nand\\n  curry","kcal":600}]}');

        $this->assertSame('Rice and curry', $estimate->items[0]->name);
    }

    // --- Confidence, which is the model's claim about itself ---

    public function test_should_treat_an_unstated_confidence_as_the_lowest(): void
    {
        $estimate = $this->parser->parse('{"items":[{"name":"Rice","kcal":300}]}');

        $this->assertSame('low', $estimate->confidence);
    }

    public function test_should_treat_a_word_we_did_not_ask_for_as_the_lowest(): void
    {
        // "very high" is not evidence of anything, and must not be shown as if it were.
        $estimate = $this->parser->parse('{"items":[{"name":"Rice","kcal":300}],"confidence":"very high"}');

        $this->assertSame('low', $estimate->confidence);
    }

    public function test_should_accept_a_stated_confidence_regardless_of_case(): void
    {
        $estimate = $this->parser->parse('{"items":[{"name":"Rice","kcal":300}],"confidence":"HIGH"}');

        $this->assertSame('high', $estimate->confidence);
    }

    // --- The name the editor is seeded with ---

    public function test_should_join_the_item_names_into_a_meal_name(): void
    {
        $estimate = $this->parser->parse(
            '{"items":[{"name":"Rice","kcal":300},{"name":"Dhal","kcal":180},{"name":"Papadum","kcal":40}]}',
        );

        $this->assertSame('Rice, Dhal, Papadum', $estimate->suggestedName());
    }

    public function test_should_cut_a_long_meal_name_to_what_the_column_accepts(): void
    {
        $rows = array_map(
            static fn (int $i): array => ['name' => 'Something rather long '.$i, 'kcal' => 20],
            range(1, 10),
        );

        $name = $this->parser->parse(json_encode(['items' => $rows]))->suggestedName();

        $this->assertLessThanOrEqual(120, mb_strlen($name));
        $this->assertStringEndsWith('…', $name);
    }
}
