<?php

namespace Tests\Feature\Weather;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The endpoint, and the chain behind it.
 *
 * Both providers are always faked, never one. An unmatched URL is answered with an empty
 * 200 by the HTTP fake, so a test that stubs only OpenWeatherMap would let a fallback
 * "succeed" on nothing and prove the opposite of what it claims.
 */
class WeatherEndpointTest extends TestCase
{
    use RefreshDatabase;

    private const OPEN_WEATHER = '*api.openweathermap.org*';

    private const OPEN_METEO = '*api.open-meteo.com*';

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.openweather.key' => 'test-key']);
        Cache::flush();
    }

    private function fakeProviders(
        int $openWeatherStatus = 200,
        int $openMeteoStatus = 200,
        array $openWeatherPayload = [],
    ): void {
        Http::fake([
            self::OPEN_WEATHER => Http::response(array_merge([
                'weather' => [['main' => 'Clouds', 'description' => 'broken clouds']],
                'main' => ['temp' => 28.4, 'feels_like' => 31.2, 'humidity' => 74],
                'name' => 'Colombo',
                'dt' => 1755777600,
            ], $openWeatherPayload), $openWeatherStatus),

            self::OPEN_METEO => Http::response([
                'current' => [
                    'time' => 1755777600,
                    'temperature_2m' => 26.1,
                    'relative_humidity_2m' => 81,
                    'apparent_temperature' => 29.0,
                    'weather_code' => 61,
                ],
            ], $openMeteoStatus),
        ]);
    }

    // --- The endpoint's contract ---

    public function test_should_reject_an_unauthenticated_request(): void
    {
        $this->getJson('/api/v1/weather?lat=6.92&lon=79.86')->assertUnauthorized();
    }

    public function test_should_return_the_narrowed_shape_rather_than_the_providers(): void
    {
        $this->fakeProviders();

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
        $this->fakeProviders();

        $response = $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=6.92&lon=79.86');

        $this->assertStringNotContainsString('test-key', $response->getContent());
    }

    public function test_should_reject_coordinates_outside_the_globe(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=200&lon=79.86')
            ->assertStatus(422)
            ->assertJsonValidationErrors('lat');
    }

    // --- The chain ---

    public function test_should_not_call_the_fallback_while_the_preferred_provider_answers(): void
    {
        $this->fakeProviders();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=6.92&lon=79.86')
            ->assertOk();

        Http::assertNotSent(fn ($request) => str_contains($request->url(), 'open-meteo'));
    }

    public function test_should_fall_through_to_the_keyless_provider_when_the_key_is_missing(): void
    {
        // The case a fresh checkout is in. It used to be a 503; a provider that needs no
        // account is the reason it no longer is.
        config(['services.openweather.key' => null]);
        $this->fakeProviders();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=6.92&lon=79.86')
            ->assertOk()
            ->assertJsonPath('data.condition', 'Rain')
            ->assertJsonPath('data.temperature_c', 26.1);

        // Skipped, not tried and failed: an unset key is a provider that was never in play.
        Http::assertNotSent(fn ($request) => str_contains($request->url(), 'openweathermap'));
    }

    public function test_should_fall_through_when_the_preferred_provider_fails(): void
    {
        $this->fakeProviders(openWeatherStatus: 500);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=6.92&lon=79.86')
            ->assertOk()
            ->assertJsonPath('data.condition', 'Rain')
            // Open-Meteo answers about a coordinate, not a place, so the name is absent
            // rather than echoed back from the request.
            ->assertJsonPath('data.location_name', null);
    }

    public function test_should_report_unavailable_only_when_every_provider_fails(): void
    {
        $this->fakeProviders(openWeatherStatus: 500, openMeteoStatus: 500);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=6.92&lon=79.86')
            // 503, not 500: every dependency being down is degraded service, not a fault in
            // this request.
            ->assertStatus(503);
    }

    public function test_should_not_cache_a_total_failure(): void
    {
        $this->fakeProviders(openWeatherStatus: 500, openMeteoStatus: 500);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/weather?lat=6.92&lon=79.86')
            ->assertStatus(503);

        // Asserted against the store rather than by re-faking and asking again: repeated
        // `Http::fake` calls merge, and the first matching stub wins, so the second set
        // would never be reached.
        //
        // A ten-minute cache over an outage would keep the chip empty for ten minutes after
        // the outage ended. `Cache::remember` does not store when its callback throws, and
        // this is what keeps that true if the chain ever starts returning a null object
        // instead of raising.
        $this->assertNull(Cache::get('weather.6.92.79.86'));
    }

    // --- The cache, which now sits in front of the whole chain ---

    public function test_should_serve_a_second_nearby_request_from_cache(): void
    {
        $this->fakeProviders();

        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')->getJson('/api/v1/weather?lat=6.9271&lon=79.8612')->assertOk();
        // Rounded to two decimals, so a few metres away shares the entry rather than
        // spending another call against the free tier.
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/weather?lat=6.9272&lon=79.8613')->assertOk();

        Http::assertSentCount(1);
    }

    public function test_should_cache_the_fallback_answer_too(): void
    {
        // In front of the chain rather than inside each adapter: otherwise a request served
        // by the fallback would re-ask upstream every time, which is the situation the
        // cache exists to avoid.
        $this->fakeProviders(openWeatherStatus: 500);

        $user = User::factory()->create();
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/weather?lat=6.92&lon=79.86')->assertOk();

        $before = count(Http::recorded());
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/weather?lat=6.92&lon=79.86')->assertOk();

        $this->assertCount($before, Http::recorded());
    }
}
