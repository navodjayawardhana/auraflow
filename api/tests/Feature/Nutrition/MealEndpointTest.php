<?php

namespace Tests\Feature\Nutrition;

use App\Models\MealEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class MealEndpointTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    private function estimate(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Rice and curry',
            'kcal' => 620,
            'source' => MealEntry::SOURCE_ESTIMATE,
        ], $overrides);
    }

    // --- Access ---

    public function test_should_reject_unauthenticated_requests(): void
    {
        $this->getJson('/api/v1/meals?date='.now()->format('Y-m-d'))->assertUnauthorized();
        $this->postJson('/api/v1/meals', $this->estimate())->assertUnauthorized();
    }

    public function test_should_not_list_another_users_meals(): void
    {
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        MealEntry::query()->create([
            'user_id' => $theirs->id,
            'eaten_on' => now()->format('Y-m-d'),
            'eaten_at' => now(),
            'name' => 'Their lunch',
            'kcal' => 500,
            'source' => MealEntry::SOURCE_ESTIMATE,
        ]);

        $this->actingAs($mine, 'sanctum')
            ->getJson('/api/v1/meals?date='.now()->format('Y-m-d'))
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_should_not_delete_another_users_meal(): void
    {
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        $meal = MealEntry::query()->create([
            'user_id' => $theirs->id,
            'eaten_on' => now()->format('Y-m-d'),
            'eaten_at' => now(),
            'name' => 'Their lunch',
            'kcal' => 500,
            'source' => MealEntry::SOURCE_ESTIMATE,
        ]);

        $this->actingAs($mine, 'sanctum')
            ->deleteJson('/api/v1/meals/'.$meal->id)
            ->assertNotFound();

        $this->assertDatabaseCount('meal_entries', 1);
    }

    // --- Logging ---

    public function test_should_log_a_user_estimate(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/meals', $this->estimate())
            ->assertCreated()
            ->assertJsonPath('data.kcal', 620)
            ->assertJsonPath('data.source', 'estimate');
    }

    public function test_should_refuse_a_lookup_that_carries_no_barcode(): void
    {
        // A row claiming to come from a food database with no product behind it would let
        // a guess be displayed with the authority of a measurement.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/meals', $this->estimate(['source' => MealEntry::SOURCE_LOOKUP]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('barcode');
    }

    public function test_should_accept_a_lookup_with_its_barcode(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/meals', $this->estimate([
                'name' => 'Oat biscuits',
                'kcal' => 210,
                'source' => MealEntry::SOURCE_LOOKUP,
                'barcode' => '5000168001234',
                'protein_g' => 4,
                'carbs_g' => 30,
                'fat_g' => 8,
                'portion_g' => 50,
            ]))
            ->assertCreated()
            ->assertJsonPath('data.source', 'lookup')
            ->assertJsonPath('data.barcode', '5000168001234');
    }

    public function test_should_reject_an_implausible_calorie_figure(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/meals', $this->estimate(['kcal' => 90000]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('kcal');
    }

    public function test_should_reject_a_meal_eaten_in_the_future(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/meals', $this->estimate([
                'eaten_at' => now()->addHour()->toAtomString(),
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('eaten_at');
    }

    // --- The day's totals ---

    public function test_should_total_the_day_without_offering_a_net_figure(): void
    {
        $user = User::factory()->create();

        foreach ([[400, 20], [620, 31]] as [$kcal, $protein]) {
            MealEntry::query()->create([
                'user_id' => $user->id,
                'eaten_on' => now()->format('Y-m-d'),
                'eaten_at' => now(),
                'name' => 'Meal',
                'kcal' => $kcal,
                'protein_g' => $protein,
                'source' => MealEntry::SOURCE_ESTIMATE,
            ]);
        }

        $response = $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/meals?date='.now()->format('Y-m-d'))
            ->assertOk()
            ->assertJsonPath('meta.total_kcal', 1020)
            ->assertJsonPath('meta.protein_g', 51);

        // Energy out is estimated from steps that are only counted while the app is open.
        // A net figure would be a small number derived from two large uncertain ones.
        $this->assertArrayNotHasKey('net_kcal', $response->json('meta'));
    }

    // --- Barcode lookup ---

    public function test_should_return_a_product_from_open_food_facts(): void
    {
        Http::fake([
            '*openfoodfacts.org*' => Http::response([
                'status' => 1,
                'product' => [
                    'code' => '5000168001234',
                    'product_name' => 'Oat Biscuits',
                    'brands' => 'Nairns, Other',
                    'nutriments' => [
                        'energy-kcal_100g' => 420.4,
                        'proteins_100g' => 9.1,
                        'carbohydrates_100g' => 60.2,
                        'fat_100g' => 16.0,
                    ],
                    'serving_quantity' => 25,
                ],
            ]),
        ]);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/foods/5000168001234')
            ->assertOk()
            ->assertJsonPath('data.name', 'Oat Biscuits')
            // Only the first brand — their field is a comma-separated list.
            ->assertJsonPath('data.brand', 'Nairns')
            ->assertJsonPath('data.kcal_per_100g', 420)
            ->assertJsonPath('data.source', 'Open Food Facts');
    }

    public function test_should_report_an_unknown_barcode_as_not_found(): void
    {
        Http::fake(['*openfoodfacts.org*' => Http::response(['status' => 0])]);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/foods/9999999999999')
            ->assertNotFound();
    }

    public function test_should_refuse_a_product_with_no_energy_value(): void
    {
        // Guessing an energy figure for a product that has none is exactly the false
        // precision this feature exists to avoid.
        Http::fake([
            '*openfoodfacts.org*' => Http::response([
                'status' => 1,
                'product' => ['code' => '123456', 'product_name' => 'Mystery', 'nutriments' => []],
            ]),
        ]);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/foods/123456')
            ->assertNotFound();
    }

    public function test_should_cache_a_repeated_lookup(): void
    {
        Http::fake([
            '*openfoodfacts.org*' => Http::response([
                'status' => 1,
                'product' => [
                    'code' => '5000168001234',
                    'product_name' => 'Oat Biscuits',
                    'nutriments' => ['energy-kcal_100g' => 420],
                ],
            ]),
        ]);

        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')->getJson('/api/v1/foods/5000168001234')->assertOk();
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/foods/5000168001234')->assertOk();

        // Their terms ask clients not to hammer the service, and a product does not change.
        Http::assertSentCount(1);
    }
}
