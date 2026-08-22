<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\ShowWeatherRequest;
use App\Infrastructure\Weather\WeatherProvider;
use Illuminate\Http\JsonResponse;
use Throwable;

/**
 * Weather, proxied so the provider key never ships in the app bundle.
 *
 * Which provider answers is the container's business, not this controller's -- see
 * AppServiceProvider for the chain and ChainedWeatherProvider for how it falls through.
 */
final class WeatherController extends Controller
{
    public function __construct(private readonly WeatherProvider $weather)
    {
    }

    public function show(ShowWeatherRequest $request): JsonResponse
    {
        try {
            $weather = $this->weather->currentAt(
                $request->float('lat'),
                $request->float('lon'),
            );
        } catch (Throwable) {
            // 503, not 500: the provider being unreachable or unconfigured is a degraded
            // dependency rather than a fault in this request, and the client already
            // knows how to hide a card it cannot fill.
            return response()->json([
                'message' => 'Weather is unavailable right now.',
            ], 503);
        }

        return response()->json(['data' => $weather->toArray()]);
    }
}
