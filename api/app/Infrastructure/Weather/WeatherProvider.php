<?php

namespace App\Infrastructure\Weather;

use App\Application\Wellbeing\DTO\CurrentWeather;
use RuntimeException;

/**
 * One source of current conditions.
 *
 * Narrow on purpose: the app shows a temperature and a word. Anything richer would be an
 * interface shaped by whichever provider happened to be written first.
 */
interface WeatherProvider
{
    /**
     * Whether this provider has what it needs to be tried at all.
     *
     * Separate from failing, because the two deserve different handling: an unset key is a
     * provider that was never in play, while a timeout is one that was and lost. Only the
     * second is worth reporting as a fault.
     */
    public function isConfigured(): bool;

    /** @throws RuntimeException when the provider cannot answer. */
    public function currentAt(float $latitude, float $longitude): CurrentWeather;
}
