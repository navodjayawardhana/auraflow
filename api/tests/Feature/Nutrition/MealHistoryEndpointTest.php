<?php

namespace Tests\Feature\Nutrition;

use App\Models\MealEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The range read, and the backfill that makes it worth having.
 *
 * The aggregation itself is proved in `Tests\Unit\Domain\Nutrition\NutritionAggregatorTest`
 * against fixtures with hand-worked answers. What is checked here is the wiring: that the
 * window reaches the query, that the buckets reach the response, and that a meal filed for
 * an earlier evening lands on that evening's day rather than on the day it was typed.
 */
class MealHistoryEndpointTest extends TestCase
{
    use RefreshDatabase;

    private function meal(User $user, string $date, int $kcal, string $source = MealEntry::SOURCE_ESTIMATE): MealEntry
    {
        return MealEntry::query()->create([
            'user_id' => $user->id,
            'eaten_on' => $date,
            'eaten_at' => $date.' 12:30:00',
            'name' => 'Meal',
            'kcal' => $kcal,
            'source' => $source,
            'barcode' => $source === MealEntry::SOURCE_LOOKUP ? '5000168001234' : null,
        ]);
    }

    // --- The window ---

    public function test_should_return_the_meals_of_a_whole_week(): void
    {
        $user = User::factory()->create();

        $this->meal($user, '2026-08-16', 500);   // the Sunday before — outside
        $this->meal($user, '2026-08-17', 400);
        $this->meal($user, '2026-08-17', 650);
        $this->meal($user, '2026-08-23', 210);
        $this->meal($user, '2026-08-24', 900);   // the Monday after — outside

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/meals?from=2026-08-17&to=2026-08-23')
            ->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonPath('meta.total_kcal', 1260)
            ->assertJsonCount(7, 'meta.days')
            ->assertJsonCount(1, 'meta.weeks')
            ->assertJsonPath('meta.weeks.0.start', '2026-08-17')
            ->assertJsonPath('meta.weeks.0.end', '2026-08-23')
            ->assertJsonPath('meta.weeks.0.partial', false)
            ->assertJsonPath('meta.days.0.kcal', 1050)
            ->assertJsonPath('meta.days.1.kcal', 0);
    }

    public function test_should_split_a_range_spanning_a_month_end_into_two_months(): void
    {
        $user = User::factory()->create();

        $this->meal($user, '2026-08-30', 550);
        $this->meal($user, '2026-09-01', 300);

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/meals?from=2026-08-28&to=2026-09-03')
            ->assertOk()
            ->assertJsonCount(2, 'meta.months')
            ->assertJsonPath('meta.months.0.start', '2026-08-01')
            ->assertJsonPath('meta.months.0.kcal', 550)
            // Four days of August, so the figure is a fragment and the response says so.
            ->assertJsonPath('meta.months.0.partial', true)
            ->assertJsonPath('meta.months.1.start', '2026-09-01')
            ->assertJsonPath('meta.months.1.kcal', 300);
    }

    public function test_should_still_answer_a_single_date_the_way_it_always_has(): void
    {
        $user = User::factory()->create();
        $this->meal($user, now()->format('Y-m-d'), 620);

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/meals?date='.now()->format('Y-m-d'))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.total_kcal', 620)
            ->assertJsonCount(1, 'meta.days');
    }

    public function test_should_refuse_a_window_wider_than_a_quarter(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/meals?from=2026-01-01&to=2026-12-31')
            ->assertStatus(422)
            ->assertJsonValidationErrors('to');
    }

    public function test_should_refuse_a_range_with_no_end(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/meals?from=2026-08-17')
            ->assertStatus(422)
            ->assertJsonValidationErrors('to');
    }

    public function test_should_refuse_a_request_that_names_no_window_at_all(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/meals')
            ->assertStatus(422);
    }

    // --- Provenance through the total ---

    public function test_should_report_measured_and_estimated_energy_separately(): void
    {
        $user = User::factory()->create();

        $this->meal($user, '2026-08-19', 200, MealEntry::SOURCE_LOOKUP);
        $this->meal($user, '2026-08-19', 500);
        $this->meal($user, '2026-08-19', 300, MealEntry::SOURCE_PHOTO);

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/meals?from=2026-08-19&to=2026-08-19')
            ->assertOk()
            ->assertJsonPath('meta.totals.kcal', 1000)
            ->assertJsonPath('meta.totals.measured_kcal', 200)
            // The photo estimate counts with the guesses, not with the measurements.
            ->assertJsonPath('meta.totals.estimated_kcal', 800)
            ->assertJsonPath('meta.totals.measured_count', 1)
            ->assertJsonPath('meta.totals.estimated_count', 2);
    }

    public function test_should_not_leak_another_users_meals_into_a_range_total(): void
    {
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        $this->meal($mine, '2026-08-19', 400);
        $this->meal($theirs, '2026-08-19', 900);

        $this->actingAs($mine, 'sanctum')
            ->getJson('/api/v1/meals?from=2026-08-17&to=2026-08-23')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.total_kcal', 400);
    }

    // --- Backfill ---

    public function test_should_file_a_backfilled_meal_under_the_day_it_was_eaten(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/meals', [
                'name' => 'Rice and curry',
                'kcal' => 620,
                'source' => MealEntry::SOURCE_ESTIMATE,
                'eaten_at' => now()->subDay()->setTime(19, 30)->toAtomString(),
            ])
            ->assertCreated()
            ->assertJsonPath('data.eaten_on', now()->subDay()->format('Y-m-d'));
    }

    public function test_should_take_the_day_from_the_offset_the_client_sent(): void
    {
        // Half past midnight in Colombo is 19:00 the previous day in UTC. The meal belongs
        // to the day the eater was living in, not to the day the server files it under.
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/meals', [
                'name' => 'Late supper',
                'kcal' => 300,
                'source' => MealEntry::SOURCE_ESTIMATE,
                'eaten_at' => '2026-08-19T00:30:00+05:30',
            ])
            ->assertCreated()
            ->assertJsonPath('data.eaten_on', '2026-08-19');
    }

    public function test_should_accept_several_meals_on_one_day(): void
    {
        $user = User::factory()->create();

        foreach ([['08:00', 320], ['13:00', 610], ['16:30', 180], ['20:00', 740]] as [$time, $kcal]) {
            $this->actingAs($user, 'sanctum')
                ->postJson('/api/v1/meals', [
                    'name' => 'Meal at '.$time,
                    'kcal' => $kcal,
                    'source' => MealEntry::SOURCE_ESTIMATE,
                    'eaten_at' => '2026-08-19T'.$time.':00+00:00',
                ])
                ->assertCreated();
        }

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/meals?from=2026-08-19&to=2026-08-19')
            ->assertOk()
            ->assertJsonCount(4, 'data')
            // In the order they were eaten, which is the only order a diary reads in.
            ->assertJsonPath('data.0.kcal', 320)
            ->assertJsonPath('data.3.kcal', 740)
            ->assertJsonPath('meta.total_kcal', 1850);
    }
}
