<?php

namespace App\Providers;

use App\Infrastructure\Weather\ChainedWeatherProvider;
use App\Infrastructure\Weather\OpenMeteoClient;
use App\Infrastructure\Weather\OpenWeatherMapClient;
use App\Infrastructure\Weather\WeatherProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Order is preference. OpenWeatherMap first because it names the place and
        // describes the sky in words; Open-Meteo behind it because it needs no key and so
        // can never be the reason the chip is empty.
        $this->app->singleton(WeatherProvider::class, fn ($app) => new ChainedWeatherProvider([
            $app->make(OpenWeatherMapClient::class),
            $app->make(OpenMeteoClient::class),
        ]));
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        /*
         * Meal photo recognition, throttled harder than anything else here: every call is a
         * paid model call carrying a megabyte of image, behind a single tap.
         *
         * Named rather than inline so the number lives in configuration. A deployment
         * protecting a billed dependency and a demo shooting a dozen photos in a row want
         * different limits, and neither should mean editing a route.
         *
         * Keyed by user, falling back to IP: keying by IP alone would have one household
         * on one router share a budget, and an authenticated route already knows better.
         */
        RateLimiter::for('meal-photo', fn (Request $request) => Limit::perMinute(
            (int) config('services.gemini.photo_rate_limit')
        )->by($request->user()?->id ?: $request->ip()));
    }
}
