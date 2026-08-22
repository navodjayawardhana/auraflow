<?php

namespace App\Infrastructure\Weather;

use App\Application\Wellbeing\DTO\CurrentWeather;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

/**
 * The providers in preference order, and the cache in front of all of them.
 *
 * Caching sits here rather than in each adapter for the reason the chain exists: a cached
 * answer is an answer, whichever provider produced it, and a per-adapter cache would let a
 * fallback re-ask upstream on every request while a perfectly good reading from the primary
 * sat unused ten seconds later.
 *
 * A provider that is not configured is skipped rather than tried and failed. That is what
 * lets the app work on a fresh checkout: OpenWeatherMap needs a key, Open-Meteo does not,
 * and the chip fills either way.
 */
final class ChainedWeatherProvider implements WeatherProvider
{
    /**
     * Weather changes slowly relative to how often a dashboard is opened, and free tiers
     * are rate limited. Ten minutes keeps a pull-to-refresh loop from burning quota without
     * the reading ever being meaningfully stale.
     */
    private const CACHE_TTL_SECONDS = 600;

    /**
     * Coordinates are rounded before they become a cache key. Two purposes: a coarser key
     * actually shares between nearby users, and a full-precision location is not written
     * into a cache store that outlives the request.
     */
    private const KEY_PRECISION = 2;

    /** @param  list<WeatherProvider>  $providers  Most preferred first. */
    public function __construct(private readonly array $providers)
    {
    }

    public function isConfigured(): bool
    {
        foreach ($this->providers as $provider) {
            if ($provider->isConfigured()) {
                return true;
            }
        }

        return false;
    }

    public function currentAt(float $latitude, float $longitude): CurrentWeather
    {
        $key = sprintf(
            'weather.%s.%s',
            number_format($latitude, self::KEY_PRECISION, '.', ''),
            number_format($longitude, self::KEY_PRECISION, '.', ''),
        );

        return Cache::remember(
            $key,
            self::CACHE_TTL_SECONDS,
            fn () => $this->firstAnswer($latitude, $longitude),
        );
    }

    private function firstAnswer(float $latitude, float $longitude): CurrentWeather
    {
        $failures = [];

        foreach ($this->providers as $provider) {
            if (! $provider->isConfigured()) {
                continue;
            }

            try {
                return $provider->currentAt($latitude, $longitude);
            } catch (Throwable $error) {
                // Logged rather than swallowed: a primary that has been quietly failing for
                // a week looks identical to one that is working, because the fallback keeps
                // the screen full.
                $failures[class_basename($provider)] = $error->getMessage();
                Log::warning('Weather provider failed, trying the next.', [
                    'provider' => class_basename($provider),
                    'reason' => $error->getMessage(),
                ]);
            }
        }

        throw new RuntimeException(
            $failures === []
                ? 'No weather provider is configured.'
                : 'Every weather provider failed: '.json_encode($failures),
        );
    }
}
