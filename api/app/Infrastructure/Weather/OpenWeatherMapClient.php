<?php

namespace App\Infrastructure\Weather;

use App\Application\Wellbeing\DTO\CurrentWeather;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * The preferred source: it names the place and describes the sky in words.
 *
 * Proxied rather than called from the phone, which is the reason this class is server-side
 * at all: the API key would otherwise be an EXPO_PUBLIC_ variable, inlined into the bundle
 * and readable from the APK. Caching lives in ChainedWeatherProvider, in front of every
 * provider rather than inside each one.
 */
final class OpenWeatherMapClient implements WeatherProvider
{
    public function isConfigured(): bool
    {
        return filled(config('services.openweather.key'));
    }

    public function currentAt(float $latitude, float $longitude): CurrentWeather
    {
        return $this->toDto($this->fetch($latitude, $longitude));
    }

    /**
     * @return array<string, mixed>
     */
    private function fetch(float $latitude, float $longitude): array
    {
        $apiKey = config('services.openweather.key');

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
