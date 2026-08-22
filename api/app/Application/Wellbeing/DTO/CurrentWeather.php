<?php

namespace App\Application\Wellbeing\DTO;

/**
 * Only what the app actually shows or reasons about.
 *
 * The upstream response carries far more; narrowing it here means the mobile client is
 * coupled to our shape rather than to a third party's, and swapping provider later is a
 * change to one adapter.
 */
final class CurrentWeather
{
    public function __construct(
        public readonly string $condition,
        public readonly string $description,
        public readonly float $temperatureC,
        public readonly float $feelsLikeC,
        public readonly int $humidityPercent,
        public readonly ?string $locationName,
        public readonly string $observedAt,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'condition' => $this->condition,
            'description' => $this->description,
            'temperature_c' => round($this->temperatureC, 1),
            'feels_like_c' => round($this->feelsLikeC, 1),
            'humidity_percent' => $this->humidityPercent,
            'location_name' => $this->locationName,
            'observed_at' => $this->observedAt,
        ];
    }
}
