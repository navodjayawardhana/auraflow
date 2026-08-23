<?php

namespace Database\Factories;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
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
            'resting_hr_source' => RestingHeartRateSource::Overnight->value,
        ];
    }

    public function on(string $date): static
    {
        return $this->state(fn () => ['recorded_on' => $date]);
    }

    /**
     * A resting rate, and how it was taken.
     *
     * Both together, never the figure alone: a row whose provenance is unstated is the one
     * the mapper refuses to read, and a fixture built on it would be asserting against a
     * case the app treats as absent. Overnight is the default because it is what a watch
     * reports and what the score was validated on, not because it is the safe answer.
     */
    public function restingHeartRate(
        float $bpm,
        RestingHeartRateSource $source = RestingHeartRateSource::Overnight,
    ): static {
        return $this->state(fn () => [
            'resting_heart_rate' => $bpm,
            'resting_hr_source' => $source->value,
        ]);
    }

    /** A morning check-in: awake, seated, finger on the node's pad. */
    public function seatedRestingHeartRate(float $bpm): static
    {
        return $this->restingHeartRate($bpm, RestingHeartRateSource::SeatedSpot);
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

    /**
     * A day's steps, and whether the count covers the day.
     *
     * Both together, never the count alone: a step count in a fixture whose provenance is
     * unstated is the exact row the production code refuses to read, and a test built on
     * one would be asserting against a case the app treats as absent.
     */
    public function withSteps(int $steps, bool $complete = true): static
    {
        return $this->state(fn () => [
            'steps' => $steps,
            'steps_are_complete' => $complete,
        ]);
    }

    public function withoutHeartRate(): static
    {
        return $this->state(fn () => [
            'resting_heart_rate' => null,
            'resting_hr_source' => null,
        ]);
    }
}
