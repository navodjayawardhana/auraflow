<?php

namespace App\Infrastructure\Weather;

use App\Application\Wellbeing\DTO\CurrentWeather;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Open-Meteo: no account, no key, no quota to sign up for.
 *
 * It exists here as the floor under the weather chip. A provider that cannot be
 * misconfigured is worth having behind one that can, and the day the OpenWeatherMap key
 * expires or a demo runs on a fresh checkout, the chip still fills.
 *
 * It gives less than OpenWeatherMap -- no place name, and a numeric code rather than a
 * phrase -- which is why it sits second rather than first.
 */
final class OpenMeteoClient implements WeatherProvider
{
    /**
     * WMO 4677, as far as a one-word label needs it.
     *
     * The pairs collapse deliberately: "light rain" and "moderate rain" are both `Rain` on
     * a chip 60 pixels wide, and the description carries the difference for anyone who
     * opens something that shows it.
     *
     * @var array<int, array{0: string, 1: string}>
     */
    private const CONDITIONS = [
        0 => ['Clear', 'clear sky'],
        1 => ['Clear', 'mainly clear'],
        2 => ['Clouds', 'partly cloudy'],
        3 => ['Clouds', 'overcast'],
        45 => ['Fog', 'fog'],
        48 => ['Fog', 'depositing rime fog'],
        51 => ['Drizzle', 'light drizzle'],
        53 => ['Drizzle', 'moderate drizzle'],
        55 => ['Drizzle', 'dense drizzle'],
        56 => ['Drizzle', 'light freezing drizzle'],
        57 => ['Drizzle', 'dense freezing drizzle'],
        61 => ['Rain', 'slight rain'],
        63 => ['Rain', 'moderate rain'],
        65 => ['Rain', 'heavy rain'],
        66 => ['Rain', 'light freezing rain'],
        67 => ['Rain', 'heavy freezing rain'],
        71 => ['Snow', 'slight snowfall'],
        73 => ['Snow', 'moderate snowfall'],
        75 => ['Snow', 'heavy snowfall'],
        77 => ['Snow', 'snow grains'],
        80 => ['Rain', 'slight rain showers'],
        81 => ['Rain', 'moderate rain showers'],
        82 => ['Rain', 'violent rain showers'],
        85 => ['Snow', 'slight snow showers'],
        86 => ['Snow', 'heavy snow showers'],
        95 => ['Thunderstorm', 'thunderstorm'],
        96 => ['Thunderstorm', 'thunderstorm with slight hail'],
        99 => ['Thunderstorm', 'thunderstorm with heavy hail'],
    ];

    /** Nothing to configure is the entire point of this one. */
    public function isConfigured(): bool
    {
        return true;
    }

    public function currentAt(float $latitude, float $longitude): CurrentWeather
    {
        $response = Http::timeout(6)
            ->retry(2, 200)
            ->get(config('services.openmeteo.base_url').'/forecast', [
                'latitude' => $latitude,
                'longitude' => $longitude,
                'current' => 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
                // Unix rather than the default local string, so the timestamp needs no
                // guess about which zone it was written in.
                'timeformat' => 'unixtime',
            ]);

        if (! $response->successful()) {
            throw new RuntimeException('Open-Meteo returned '.$response->status());
        }

        $current = $response->json('current');

        if (! is_array($current) || ! isset($current['temperature_2m'])) {
            throw new RuntimeException('Open-Meteo returned no current conditions.');
        }

        [$condition, $description] = self::CONDITIONS[(int) ($current['weather_code'] ?? -1)]
            ?? ['Unknown', ''];

        return new CurrentWeather(
            condition: $condition,
            description: $description,
            temperatureC: (float) $current['temperature_2m'],
            feelsLikeC: (float) ($current['apparent_temperature'] ?? $current['temperature_2m']),
            humidityPercent: (int) ($current['relative_humidity_2m'] ?? 0),
            // This endpoint answers about a coordinate, not a place. Inventing a name from
            // the one the phone asked about would be the client's own input read back to it
            // as though it were data.
            locationName: null,
            observedAt: date(DATE_ATOM, (int) ($current['time'] ?? time())),
        );
    }
}
