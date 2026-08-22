<?php

namespace Tests\Feature\Weather;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class WeatherEndpointTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.openweather.key' => 'test-key']);
        Cache::flush();
    }

    private function fakeProvider(array $payload = [], int $status = 200): void
    {
        Http::fake([
            '*api.openweathermap.org*' => Http::response(array_merge([
                'weather' => [['main' => 'Clouds', 'description' => 'broken clouds']],
                'main' => ['temp' => 28.4, 'feels_like' => 31.2, 'humidity' => 74],
                'name' => 'Colombo',
                'dt' => 1755777600,
            ], $payload), $status),
        ]);
    }

    public function test_should_reject_an_unauthenticated_request(): void
    {
        $this->getJson('/api/v1/weather?lat=6.92&lon=79.86')->assertUnauthorized();
    }

    public function test_should_return_the_narrowed_shape_rather_than_the_providers(): void
    {
        $this->fakeProvider();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=6.92&lon=79.86')
            ->assertOk()
            ->assertJsonPath('data.condition', 'Clouds')
            ->assertJsonPath('data.temperature_c', 28.4)
            ->assertJsonPath('data.humidity_percent', 74)
            ->assertJsonPath('data.location_name', 'Colombo')
            // The client is coupled to our shape, not the provider's, so swapping
            // provider stays a change to one adapter.
            ->assertJsonMissingPath('data.coord')
            ->assertJsonMissingPath('data.sys');
    }

    public function test_should_never_expose_the_provider_key(): void
    {
        $this->fakeProvider();

        $response = $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=6.92&lon=79.86');

        $this->assertStringNotContainsString('test-key', $response->getContent());
    }

    public function test_should_serve_a_second_nearby_request_from_cache(): void
    {
        $this->fakeProvider();

        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')->getJson('/api/v1/weather?lat=6.9271&lon=79.8612')->assertOk();
        // Rounded to two decimals, so a few metres away shares the entry rather than
        // spending another call against the free tier.
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/weather?lat=6.9272&lon=79.8613')->assertOk();

        Http::assertSentCount(1);
    }

    public function test_should_report_a_provider_failure_as_unavailable_not_a_fault(): void
    {
        $this->fakeProvider([], 500);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=6.92&lon=79.86')
            ->assertStatus(503);
    }

    public function test_should_report_a_missing_key_as_unavailable(): void
    {
        config(['services.openweather.key' => null]);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=6.92&lon=79.86')
            ->assertStatus(503);
    }

    public function test_should_reject_coordinates_outside_the_globe(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=200&lon=79.86')
            ->assertStatus(422)
            ->assertJsonValidationErrors('lat');
    }
}
