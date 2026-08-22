<?php

namespace Tests\Feature\Nutrition;

use App\Models\MealEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The photo-estimate endpoint's contract.
 *
 * Gemini is always faked. What is asserted is the boundary in both directions: that the
 * image leaves as inline data on a keyed request, and that what comes back is a labelled
 * estimate rather than anything the app could mistake for a measurement.
 */
class MealPhotoEndpointTest extends TestCase
{
    use RefreshDatabase;

    private const GEMINI = '*generativelanguage.googleapis.com*';

    private const ROUTE = '/api/v1/meals/estimate-from-photo';

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.gemini.key' => 'test-key', 'services.gemini.model' => 'gemini-3.6-flash']);
    }

    /** A real PNG header so `finfo` sees what a phone would send, padded past the floor. */
    private function photo(): string
    {
        $png = base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        );

        return base64_encode($png.str_repeat("\0", 2048));
    }

    private function fakeGemini(string $text, int $status = 200): void
    {
        Http::fake([
            self::GEMINI => Http::response([
                'candidates' => [['content' => ['parts' => [['text' => $text]]]]],
            ], $status),
        ]);
    }

    private function fakeRecognisedPlate(): void
    {
        $this->fakeGemini(json_encode([
            'items' => [
                ['name' => 'Rice', 'kcal' => 300, 'protein_g' => 6, 'carbs_g' => 66, 'fat_g' => 1],
                ['name' => 'Chicken curry', 'kcal' => 320, 'protein_g' => 28, 'carbs_g' => 8, 'fat_g' => 20],
            ],
            'confidence' => 'medium',
        ]));
    }

    // --- Access ---

    public function test_should_reject_an_unauthenticated_request(): void
    {
        $this->postJson(self::ROUTE, ['photo' => $this->photo()])->assertUnauthorized();
    }

    // --- The happy path ---

    public function test_should_return_the_items_and_a_total_summed_from_them(): void
    {
        $this->fakeRecognisedPlate();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => $this->photo()])
            ->assertOk()
            ->assertJsonCount(2, 'data.items')
            ->assertJsonPath('data.items.0.name', 'Rice')
            // Summed here rather than read from a total the model reported separately, so
            // the figure and the list it is made of can never disagree.
            ->assertJsonPath('data.kcal', 620)
            ->assertJsonPath('data.protein_g', 34)
            ->assertJsonPath('data.name', 'Rice, Chicken curry');
    }

    public function test_should_label_the_answer_as_a_photo_estimate(): void
    {
        $this->fakeRecognisedPlate();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => $this->photo()])
            ->assertOk()
            // The source the client must post back. Without it a guess from a photograph
            // could be saved as though the user had measured it.
            ->assertJsonPath('data.source', MealEntry::SOURCE_PHOTO)
            ->assertJsonPath('data.confidence', 'medium')
            ->assertJsonPath('data.model', 'gemini-3.6-flash');
    }

    public function test_should_report_the_lowest_confidence_when_the_model_states_none(): void
    {
        $this->fakeGemini('{"items":[{"name":"Stew","kcal":410}]}');

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => $this->photo()])
            ->assertOk()
            ->assertJsonPath('data.confidence', 'low');
    }

    public function test_should_write_nothing_while_estimating(): void
    {
        // The model is kept out of the write path entirely: a figure reaches the table only
        // after a person has looked at it and posted it to `store`.
        $this->fakeRecognisedPlate();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => $this->photo()])
            ->assertOk();

        $this->assertDatabaseCount('meal_entries', 0);
    }

    // --- What crosses the boundary ---

    public function test_should_send_the_image_inline_on_a_keyed_request(): void
    {
        $this->fakeRecognisedPlate();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => $this->photo()])
            ->assertOk();

        Http::assertSent(function ($request) {
            $parts = $request->data()['contents'][0]['parts'];

            return $request->hasHeader('x-goog-api-key', 'test-key')
                // In a header rather than the query string, which is logged by proxies.
                && ! str_contains($request->url(), 'test-key')
                && isset($parts[1]['inlineData']['data'])
                && $parts[1]['inlineData']['mimeType'] === 'image/png';
        });
    }

    public function test_should_never_return_the_provider_key(): void
    {
        $this->fakeRecognisedPlate();

        $response = $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => $this->photo()]);

        $this->assertStringNotContainsString('test-key', $response->getContent());
    }

    public function test_should_accept_a_photo_sent_as_a_data_uri(): void
    {
        $this->fakeRecognisedPlate();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => 'data:image/png;base64,'.$this->photo()])
            ->assertOk();
    }

    // --- Bad input ---

    public function test_should_require_a_photo(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, [])
            ->assertStatus(422)
            ->assertJsonValidationErrors('photo');
    }

    public function test_should_refuse_something_that_is_not_an_image(): void
    {
        // Read from the bytes, not from what the client called them: otherwise any file at
        // all could be forwarded to a third party on our key.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => base64_encode(str_repeat('not an image ', 200))])
            ->assertStatus(422)
            ->assertJsonValidationErrors('photo');

        Http::assertNothingSent();
    }

    public function test_should_refuse_a_photo_larger_than_the_ceiling(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => str_repeat('A', 5_600_004)])
            ->assertStatus(422)
            ->assertJsonValidationErrors('photo');
    }

    // --- When the answer is not usable ---

    public function test_should_report_a_photo_with_no_food_as_the_photos_problem(): void
    {
        // 422 and not 503: retrying the same picture of a car park fails the same way, and
        // "try again" would be a lie.
        $this->fakeGemini('{"items":[]}');

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => $this->photo()])
            ->assertStatus(422);
    }

    public function test_should_report_an_unreadable_reply_as_the_photos_problem(): void
    {
        $this->fakeGemini('I am sorry, I cannot help with that.');

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => $this->photo()])
            ->assertStatus(422);
    }

    public function test_should_report_a_provider_failure_as_a_degraded_dependency(): void
    {
        $this->fakeGemini('anything', status: 500);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => $this->photo()])
            ->assertStatus(503);
    }

    public function test_should_report_unavailable_when_no_key_is_configured(): void
    {
        // The state a fresh checkout is in. There is no keyless fallback for this one, so
        // it degrades to "unavailable" rather than to a worse guess.
        config(['services.gemini.key' => null]);
        Http::fake();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson(self::ROUTE, ['photo' => $this->photo()])
            ->assertStatus(503);

        Http::assertNothingSent();
    }

    // --- Saving what came back ---

    public function test_should_save_a_photo_estimate_as_its_own_kind_of_claim(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/meals', [
                'name' => 'Rice, Chicken curry',
                'kcal' => 620,
                'source' => MealEntry::SOURCE_PHOTO,
                'protein_g' => 34,
            ])
            ->assertCreated()
            ->assertJsonPath('data.source', 'photo');

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/meals?date='.now()->format('Y-m-d'))
            ->assertOk()
            // The row still knows a model guessed it from a photograph, which is what lets
            // the list label it honestly a week later.
            ->assertJsonPath('data.0.source', 'photo');
    }

    public function test_should_refuse_a_photo_estimate_that_carries_a_barcode(): void
    {
        // The mirror of the rule on lookups: a barcode here would let a guess inherit the
        // provenance of a scanned product.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/meals', [
                'name' => 'Rice',
                'kcal' => 300,
                'source' => MealEntry::SOURCE_PHOTO,
                'barcode' => '5000168001234',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('barcode');
    }
}
