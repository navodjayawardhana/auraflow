<?php

namespace Tests\Feature\Insights;

use App\Models\HealthSnapshot;
use App\Models\MealEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The one read behind the insights screen.
 *
 * The arithmetic on top of this -- coverage, adherence, the rank correlations -- is the
 * client's, and is tested there against hand-worked answers. What can only be proved here
 * is the property everything on that screen stands on: a day nobody recorded comes back
 * present and null, never absent and never zero. A client that could not tell "did not
 * move" from "nobody counted" would average a fortnight over four days and say nothing
 * about it.
 */
class InsightsEndpointTest extends TestCase
{
    use RefreshDatabase;

    private function daysAgo(int $days): string
    {
        return now()->startOfDay()->subDays($days)->format('Y-m-d');
    }

    public function test_should_reject_an_unauthenticated_read(): void
    {
        $this->getJson('/api/v1/insights')->assertUnauthorized();
    }

    public function test_should_return_a_fortnight_by_default_ending_today(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/insights')
            ->assertOk()
            ->assertJsonPath('data.window_days', 14)
            ->assertJsonPath('data.from', $this->daysAgo(13))
            ->assertJsonPath('data.to', $this->daysAgo(0))
            ->assertJsonCount(14, 'data.days');
    }

    public function test_should_reject_a_window_wider_than_the_ceiling(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/insights?days=91')
            ->assertStatus(422)
            ->assertJsonValidationErrors('days');
    }

    /** A gap has to survive the trip, or every average downstream is over a longer window. */
    public function test_should_return_unrecorded_days_as_nulls_rather_than_omitting_them(): void
    {
        $user = User::factory()->create();

        HealthSnapshot::factory()->for($user)->on($this->daysAgo(1))->create([
            'sleep_minutes' => 420,
            'steps' => 7200,
            'water_ml' => 1500,
        ]);

        $response = $this->actingAs($user, 'sanctum')->getJson('/api/v1/insights?days=3')->assertOk();

        $days = collect($response->json('data.days'))->keyBy('date');

        $this->assertSame(420, $days[$this->daysAgo(1)]['sleep_minutes']);
        $this->assertSame(7200, $days[$this->daysAgo(1)]['steps']);

        $this->assertArrayHasKey($this->daysAgo(2), $days->all());
        $this->assertNull($days[$this->daysAgo(2)]['sleep_minutes']);
        $this->assertNull($days[$this->daysAgo(2)]['steps']);
        $this->assertNull($days[$this->daysAgo(2)]['water_ml']);
    }

    /** Zero steps is a day someone did not move, and must not read as a missing day. */
    public function test_should_keep_a_recorded_zero_distinct_from_a_missing_value(): void
    {
        $user = User::factory()->create();

        HealthSnapshot::factory()->for($user)->on($this->daysAgo(1))->create(['steps' => 0]);

        $response = $this->actingAs($user, 'sanctum')->getJson('/api/v1/insights?days=2')->assertOk();

        $days = collect($response->json('data.days'))->keyBy('date');

        $this->assertSame(0, $days[$this->daysAgo(1)]['steps']);
        $this->assertNull($days[$this->daysAgo(0)]['steps']);
    }

    public function test_should_score_recovery_across_the_window_from_one_read(): void
    {
        $user = User::factory()->create();

        // Five earlier nights is what a resting-HR baseline needs, so the last two days
        // score against an established one and the ones before them do not.
        foreach (range(6, 0) as $offset) {
            HealthSnapshot::factory()->for($user)->on($this->daysAgo($offset))->create([
                'sleep_minutes' => 430,
                'resting_heart_rate' => 58.0,
            ]);
        }

        $response = $this->actingAs($user, 'sanctum')->getJson('/api/v1/insights?days=7')->assertOk();

        $days = collect($response->json('data.days'))->keyBy('date');

        $this->assertNotNull($days[$this->daysAgo(0)]['recovery_score']);
        $this->assertFalse($days[$this->daysAgo(0)]['recovery_provisional']);

        // The oldest day in the window has no history in front of it in this fixture.
        $this->assertTrue($days[$this->daysAgo(6)]['recovery_provisional']);
    }

    /** Meals are counted for coverage, and a guess is never counted as a measurement. */
    public function test_should_count_meals_and_keep_the_estimated_ones_apart(): void
    {
        $user = User::factory()->create();
        $day = $this->daysAgo(1);

        foreach ([MealEntry::SOURCE_LOOKUP, MealEntry::SOURCE_ESTIMATE, MealEntry::SOURCE_PHOTO] as $source) {
            MealEntry::query()->create([
                'user_id' => $user->id,
                'eaten_on' => $day,
                'eaten_at' => $day.' 12:00:00',
                'name' => 'Something',
                'kcal' => 400,
                'source' => $source,
            ]);
        }

        $response = $this->actingAs($user, 'sanctum')->getJson('/api/v1/insights?days=3')->assertOk();

        $days = collect($response->json('data.days'))->keyBy('date');

        $this->assertSame(3, $days[$day]['meal_count']);
        $this->assertSame(2, $days[$day]['estimated_meal_count']);
        $this->assertSame(0, $days[$this->daysAgo(2)]['meal_count']);
    }

    public function test_should_not_leak_another_users_days(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();

        HealthSnapshot::factory()->for($other)->on($this->daysAgo(1))->create(['steps' => 9999]);

        $response = $this->actingAs($user, 'sanctum')->getJson('/api/v1/insights?days=3')->assertOk();

        foreach ($response->json('data.days') as $day) {
            $this->assertNull($day['steps']);
        }
    }
}
