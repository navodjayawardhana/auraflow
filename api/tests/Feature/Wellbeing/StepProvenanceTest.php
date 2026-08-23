<?php

namespace Tests\Feature\Wellbeing;

use App\Domain\Planning\Service\StepGoalCalculator;
use App\Models\HealthSnapshot;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A step count and the thing that makes it readable, from the phone to the plan.
 *
 * The parts worth a test here are the ones that fail silently. A step goal derived from a
 * week of undercounts is a plausible number that is wrong in the one direction that
 * matters -- below what the person already walks, so they meet it daily and the app
 * congratulates them. Nothing on any screen would look broken.
 *
 * The other three are properties the sync depends on rather than arithmetic: a day
 * re-sent updates instead of duplicating, a steps-only write leaves the night alone, and
 * a count arriving without stated provenance cannot quietly inherit yesterday's.
 */
class StepProvenanceTest extends TestCase
{
    use RefreshDatabase;

    private function daysAgo(int $days): string
    {
        return now()->startOfDay()->subDays($days)->format('Y-m-d');
    }

    private function givenAdultProfile(User $user): void
    {
        $this->actingAs($user, 'sanctum')->putJson('/api/v1/profile', [
            'date_of_birth' => '1986-08-22',
            'sex' => 'male',
            'height_cm' => 178,
            'weight_kg' => 76.0,
            'activity_level' => 'moderate',
        ]);
    }

    /**
     * @param  int[]  $steps  one figure per day, most recent first
     */
    private function givenStepHistory(User $user, array $steps, bool $complete): void
    {
        foreach ($steps as $index => $count) {
            HealthSnapshot::factory()
                ->for($user)
                ->on($this->daysAgo($index + 1))
                ->withSteps($count, $complete)
                ->create();
        }
    }

    // --- Ingest ---

    // Z
    public function test_should_refuse_a_step_count_that_does_not_say_what_it_covers(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => $this->daysAgo(1),
                'steps' => 8200,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('steps_are_complete');
    }

    // Z
    public function test_should_refuse_completeness_with_no_count_to_describe(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => $this->daysAgo(1),
                'steps_are_complete' => true,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('steps_are_complete');
    }

    // O
    public function test_should_carry_completeness_back_out_the_way_it_came_in(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => $this->daysAgo(1),
                'steps' => 4100,
                'steps_are_complete' => false,
            ])
            ->assertCreated()
            ->assertJsonPath('data.steps', 4100)
            ->assertJsonPath('data.steps_are_complete', false);
    }

    // S
    public function test_should_update_rather_than_duplicate_a_day_that_is_synced_again(): void
    {
        $user = User::factory()->create();
        $date = now()->format('Y-m-d');

        // The shape of a day on an Android phone: the same date written repeatedly as the
        // figure grows, then once more when the app is closed.
        foreach ([1200, 3400, 5900] as $count) {
            $this->actingAs($user, 'sanctum')
                ->postJson('/api/v1/health-snapshots', [
                    'recorded_on' => $date,
                    'steps' => $count,
                    'steps_are_complete' => false,
                ])
                ->assertCreated();
        }

        $this->assertDatabaseCount('health_snapshots', 1);
        $this->assertSame(5900, HealthSnapshot::query()->sole()->steps);
    }

    // I
    public function test_should_leave_a_recorded_night_alone_when_only_steps_arrive(): void
    {
        $user = User::factory()->create();
        $date = $this->daysAgo(1);

        HealthSnapshot::factory()
            ->for($user)
            ->on($date)
            ->restingHeartRate(54.0)
            ->create(['sleep_minutes' => 452, 'deep_sleep_minutes' => 88, 'rem_sleep_minutes' => 95]);

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => $date,
                'steps' => 9300,
                'steps_are_complete' => true,
            ])
            ->assertCreated();

        $row = HealthSnapshot::query()->sole();

        // The whole reason the sync may write a bare step count: the endpoint merges, so
        // a walk cannot null out the night that produced today's recovery score.
        $this->assertSame(452, $row->sleep_minutes);
        $this->assertSame(54.0, $row->resting_heart_rate);
        $this->assertSame(9300, $row->steps);
        $this->assertTrue($row->steps_are_complete);
    }

    // B
    public function test_should_not_let_a_later_count_inherit_an_earlier_days_completeness(): void
    {
        $user = User::factory()->create();
        $date = $this->daysAgo(1);

        HealthSnapshot::factory()->for($user)->on($date)->withSteps(11_400, true)->create();

        // A bridge or an import that states a count and nothing about it. Silently keeping
        // the `true` already on the row is how an undercount would reach a median.
        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => $date,
                'steps' => 2800,
                'steps_are_complete' => false,
            ])
            ->assertCreated();

        $row = HealthSnapshot::query()->sole();

        $this->assertSame(2800, $row->steps);
        $this->assertFalse($row->steps_are_complete);
    }

    // --- What the plan does with it ---

    // S
    public function test_should_derive_the_step_goal_from_a_week_of_complete_days(): void
    {
        $user = User::factory()->create();
        $this->givenAdultProfile($user);

        // Median 6,100: low active by Tudor-Locke, so the goal is the next boundary up.
        $this->givenStepHistory($user, [5200, 5800, 6000, 6100, 6400, 7100, 7400], complete: true);

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/plan/recalculate')
            ->assertOk()
            ->assertJsonPath('data.step_goal', 7500)
            ->assertJsonPath('data.basis.step_goal_source', 'measured_7d');
    }

    // E
    public function test_should_keep_the_population_default_when_the_week_is_only_witnessed(): void
    {
        $user = User::factory()->create();
        $this->givenAdultProfile($user);

        // The same seven days, but each a phone reporting what it saw while open. A median
        // of 6,100 undercounts would set a target below what this person already walks --
        // worse than the anchor it replaced, because it would look derived.
        $this->givenStepHistory($user, [5200, 5800, 6000, 6100, 6400, 7100, 7400], complete: false);

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/plan/recalculate')
            ->assertOk()
            ->assertJsonPath('data.step_goal', StepGoalCalculator::POPULATION_DEFAULT)
            ->assertJsonPath('data.basis.step_goal_source', 'population_default');
    }

    // B
    public function test_should_hold_the_default_until_a_full_week_of_complete_days_exists(): void
    {
        $user = User::factory()->create();
        $this->givenAdultProfile($user);

        $this->givenStepHistory($user, [5200, 5800, 6000, 6100, 6400, 7100], complete: true);

        // Six days is not a week. Someone who walks to work Monday to Friday and nowhere
        // at the weekend has a six-day median describing a different person.
        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/plan/recalculate')
            ->assertOk()
            ->assertJsonPath('data.basis.step_goal_source', 'population_default');
    }

    // M
    public function test_should_ignore_the_witnessed_days_and_read_only_the_whole_ones(): void
    {
        $user = User::factory()->create();
        $this->givenAdultProfile($user);

        // Seven whole days around 11,000, and six partial days that saw a fraction of the
        // same walking. Counting all thirteen would drag the median into a lower band and
        // hand this person a goal they clear before lunch.
        foreach ([11_200, 10_800, 11_500, 11_100, 10_900, 11_300, 11_000] as $index => $count) {
            HealthSnapshot::factory()
                ->for($user)
                ->on($this->daysAgo($index + 1))
                ->withSteps($count, true)
                ->create();
        }

        foreach ([1400, 900, 2100, 700, 1800, 1100] as $index => $count) {
            HealthSnapshot::factory()
                ->for($user)
                ->on($this->daysAgo($index + 8))
                ->withSteps($count, false)
                ->create();
        }

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/plan/recalculate')
            ->assertOk()
            // Median 11,100 is somewhat active; the boundary above it is 12,500.
            ->assertJsonPath('data.step_goal', 12_500)
            ->assertJsonPath('data.basis.step_goal_source', 'measured_7d');
    }
}
