<?php

namespace Database\Factories;

use App\Models\HealthSnapshot;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<HealthSnapshot>
 */
class HealthSnapshotFactory extends Factory
{
    protected $model = HealthSnapshot::class;

    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'recorded_on' => fake()->dateTimeBetween('-30 days', 'now')->format('Y-m-d'),
            'sleep_minutes' => fake()->numberBetween(300, 540),
            'deep_sleep_minutes' => fake()->numberBetween(40, 90),
            'rem_sleep_minutes' => fake()->numberBetween(60, 120),
            'resting_heart_rate' => fake()->randomFloat(1, 52, 68),
        ];
    }

    public function on(string $date): static
    {
        return $this->state(fn () => ['recorded_on' => $date]);
    }

    public function restingHeartRate(float $bpm): static
    {
        return $this->state(fn () => ['resting_heart_rate' => $bpm]);
    }

    /** A night the device recorded no sleep for. */
    public function withoutSleep(): static
    {
        return $this->state(fn () => [
            'sleep_minutes' => null,
            'deep_sleep_minutes' => null,
            'rem_sleep_minutes' => null,
        ]);
    }

    public function withoutHeartRate(): static
    {
        return $this->state(fn () => ['resting_heart_rate' => null]);
    }
}
