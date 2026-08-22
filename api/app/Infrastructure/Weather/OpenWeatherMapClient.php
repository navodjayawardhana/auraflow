<?php

namespace App\Infrastructure\Weather;

use App\Application\Wellbeing\DTO\CurrentWeather;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * The app's only route to weather data.
 *
 * Proxied rather than called from the phone for one reason that matters and one that
 * follows from it: the API key stays on the server (an EXPO_PUBLIC_ variable is inlined
 * into the bundle and readable from the APK), and one cache entry then serves every
 * client asking about the same place instead of each phone spending a request.
 */
final class OpenWeatherMapClient
{
    /**
     * Weather changes slowly relative to how often a dashboard is opened, and the free
     * tier is rate limited. Ten minutes keeps a pull-to-refresh loop from burning quota
     * without the reading ever being meaningfully stale.
     */
    private const CACHE_TTL_SECONDS = 600;

    /**
     * Coordinates are rounded before they become a cache key. Two purposes: a coarser key
     * actually shares between nearby users, and a full-precision location is not written
     * into a cache store that outlives the request.
     */
    private const KEY_PRECISION = 2;

    public function currentAt(float $latitude, float $longitude): CurrentWeather
    {
        $key = sprintf(
            'weather.%s.%s',
            number_format($latitude, self::KEY_PRECISION, '.', ''),
            number_format($longitude, self::KEY_PRECISION, '.', ''),
        );

        $payload = Cache::remember(
            $key,
            self::CACHE_TTL_SECONDS,
            fn () => $this->fetch($latitude, $longitude),
        );

        return $this->toDto($payload);
    }

    /**
     * @return array<string, mixed>
     */
    private function fetch(float $latitude, float $longitude): array
    {
        $apiKey = config('services.openweather.key');

        if (blank($apiKey)) {
            throw new RuntimeException('OPENWEATHER_API_KEY is not configured.');
        }

        $response = Http::timeout(6)
            ->retry(2, 200)
            ->get(config('services.openweather.base_url').'/weather', [
                'lat' => $latitude,
                'lon' => $longitude,
                'units' => 'metric',
                'appid' => $apiKey,
            ]);

        if (! $response->successful()) {
            throw new RuntimeException('Weather provider returned '.$response->status());
        }

        return $response->json();
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function toDto(array $payload): CurrentWeather
    {
        $weather = $payload['weather'][0] ?? [];
        $main = $payload['main'] ?? [];

        return new CurrentWeather(
            condition: (string) ($weather['main'] ?? 'Unknown'),
            description: (string) ($weather['description'] ?? ''),
            temperatureC: (float) ($main['temp'] ?? 0),
            feelsLikeC: (float) ($main['feels_like'] ?? 0),
            humidityPercent: (int) ($main['humidity'] ?? 0),
            locationName: isset($payload['name']) && $payload['name'] !== '' ? (string) $payload['name'] : null,
            observedAt: date(DATE_ATOM, (int) ($payload['dt'] ?? time())),
        );
    }
}
