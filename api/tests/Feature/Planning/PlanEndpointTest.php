<?php

namespace Tests\Feature\Planning;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Models\HealthSnapshot;
use App\Models\User;
use App\Models\WellbeingPlan;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * End to end: HTTP through the use cases, both Eloquent repositories and the database.
 *
 * The formula tests prove the arithmetic. What can only be proved here is that a
 * fortnight of real rows reaches Karvonen, that versions increment against a real unique
 * index, and that one account cannot see another's plan.
 */
class PlanEndpointTest extends TestCase
{
    use RefreshDatabase;

    private function givenRestingHeartRateHistory(User $user, float $bpm = 52.0): void
    {
        foreach (range(1, RestingHeartRateBaseline::MIN_DAYS + 2) as $index => $daysAgo) {
            HealthSnapshot::factory()
                ->for($user)
                ->on(date('Y-m-d', strtotime("-{$daysAgo} days")))
                ->restingHeartRate($bpm + ($index % 3) - 1)
                ->create();
        }
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

    // --- Slice A: authentication ---

    // Z
    public function test_should_reject_every_unauthenticated_plan_route(): void
    {
        $this->getJson('/api/v1/plan')->assertUnauthorized();
        $this->postJson('/api/v1/plan/recalculate')->assertUnauthorized();
        $this->putJson('/api/v1/plan', ['step_goal' => 9000])->assertUnauthorized();
        $this->getJson('/api/v1/plan/history')->assertUnauthorized();
    }

    // --- Slice B: nothing derived yet ---

    // Z
    public function test_should_return_null_before_a_plan_has_ever_been_derived(): void
    {
        // A read does not write. The client learns it needs to ask rather than being
        // handed a plan it never requested.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/plan')
            ->assertOk()
            ->assertJsonPath('data', null);
    }

    // Z
    public function test_should_return_an_empty_history_before_anything_exists(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/plan/history')
            ->assertOk()
            ->assertJsonPath('data', []);
    }

    // --- Slice C: a plan exists for an empty profile ---

    // Z
    public function test_should_derive_a_plan_from_no_profile_at_all(): void
    {
        // The cold-start path. Produce something, and say what it did not know.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/plan/recalculate')
            ->assertOk()
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.source', 'derived')
            ->assertJsonPath('data.step_goal', 10000)
            ->assertJsonPath('data.water_ml', 2000)
            ->assertJsonPath('data.sleep_need_hours', 8)
            ->assertJsonPath('data.active_kcal_goal', null)
            ->assertJsonPath('data.hr_zones', null)
            ->assertJsonPath('data.basis.missing', [
                'date_of_birth', 'sex', 'height_cm', 'weight_kg', 'activity_level',
            ]);
    }

    // Z
    public function test_should_name_a_population_default_for_every_undeliverable_source(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/plan/recalculate')
            ->assertOk()
            ->assertJsonPath('data.basis.step_goal_source', 'population_default')
            ->assertJsonPath('data.basis.water_source', 'population_default')
            ->assertJsonPath('data.basis.bmr_formula', null)
            ->assertJsonPath('data.basis.resting_hr_source', null);
    }

    // --- Slice D: Karvonen with and without a measured baseline ---

    // O
    public function test_should_build_zones_on_the_population_resting_rate_without_history(): void
    {
        $user = User::factory()->create();
        $this->givenAdultProfile($user);

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/plan/recalculate')
            ->assertOk()
            ->assertJsonPath('data.basis.resting_hr_source', 'population_default')
            ->assertJsonPath('data.basis.resting_hr_bpm', 72)
            ->assertJsonPath('data.basis.max_hr_formula', 'tanaka')
            ->assertJsonPath('data.basis.hr_zone_formula', 'karvonen');
    }

    // M
    public function test_should_prefer_the_measured_fourteen_day_baseline_when_it_exists(): void
    {
        // The strongest thing in this phase: the same age, but zones built on this
        // person's own fortnight rather than on a population table.
        $user = User::factory()->create();
        $this->givenAdultProfile($user);
        $this->givenRestingHeartRateHistory($user, 52.0);

        $response = $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/plan/recalculate')
            ->assertOk()
            ->assertJsonPath('data.basis.resting_hr_source', 'measured_14d')
            ->assertJsonPath('data.basis.max_hr_bpm', 180);

        $this->assertSame(52, $response->json('data.basis.resting_hr_bpm'));
        // 52 + 0.40 x (180 - 52) = 103.2 -> 103. On the population 72 it would be 115.
        $this->assertSame(103, $response->json('data.hr_zones.moderate.0'));
    }

    // I
    public function test_should_not_build_a_baseline_from_another_users_history(): void
    {
        $user = User::factory()->create();
        $this->givenAdultProfile($user);
        $this->givenRestingHeartRateHistory(User::factory()->create(), 45.0);

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/plan/recalculate')
            ->assertOk()
            ->assertJsonPath('data.basis.resting_hr_source', 'population_default');
    }

    // --- Slice E: versions ---

    // O
    public function test_should_not_mint_a_version_when_a_recalculation_changes_nothing(): void
    {
        // The history is a record of what the user's targets did, not of how often a
        // screen was opened.
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')->postJson('/api/v1/plan/recalculate');
        $this->actingAs($user, 'sanctum')->postJson('/api/v1/plan/recalculate')
            ->assertOk()
            ->assertJsonPath('data.version', 1);

        $this->assertSame(1, WellbeingPlan::query()->where('user_id', $user->id)->count());
    }

    // O
    public function test_should_not_mint_a_version_when_a_full_profile_recalculates_unchanged(): void
    {
        // The same guard as above, but after a database round-trip with every basis field
        // populated. JSON has no float type distinct from integer, so a restored basis has
        // to be coerced back before it can be compared -- otherwise the plan versions
        // itself on every call for a difference nobody made.
        $user = User::factory()->create();
        $this->givenAdultProfile($user);
        $this->givenRestingHeartRateHistory($user, 52.0);

        $this->actingAs($user, 'sanctum')->postJson('/api/v1/plan/recalculate');
        $this->actingAs($user, 'sanctum')->postJson('/api/v1/plan/recalculate')
            ->assertOk()
            ->assertJsonPath('data.version', 1);

        $this->assertSame(1, WellbeingPlan::query()->where('user_id', $user->id)->count());
    }

    // M
    public function test_should_increment_the_version_when_a_goal_is_set_by_hand(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user, 'sanctum')->postJson('/api/v1/plan/recalculate');

        $this->actingAs($user, 'sanctum')
            ->putJson('/api/v1/plan', ['step_goal' => 8000])
            ->assertOk()
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.source', 'edited')
            ->assertJsonPath('data.step_goal', 8000)
            // On Plan itself, not only on a history row: the live screen has to be able
            // to show which target the user set by hand.
            ->assertJsonPath('data.edited_fields', ['step_goal'])
            // The provenance of an overridden number is the user, not the paper.
            ->assertJsonPath('data.basis.step_goal_source', 'user_edited');
    }

    // O
    public function test_should_record_the_defaults_as_version_one_when_the_first_action_is_an_edit(): void
    {
        // Editing before anything derived is a real path. The defaults have to exist as
        // version 1, or the history has nothing to show the edit was an edit *of*.
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->putJson('/api/v1/plan', ['water_ml' => 2500])
            ->assertOk()
            ->assertJsonPath('data.version', 2);

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/plan/history')
            ->assertOk()
            ->assertJsonPath('data.0.version', 2)
            ->assertJsonPath('data.1.version', 1)
            ->assertJsonPath('data.1.source', 'derived');
    }

    // --- Slice F: replay safety, so a plan edit can be queued offline ---

    // B
    public function test_should_collapse_an_identical_consecutive_edit_into_the_same_version(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user, 'sanctum')->postJson('/api/v1/plan/recalculate');

        $this->actingAs($user, 'sanctum')->putJson('/api/v1/plan', ['step_goal' => 8000]);

        $this->actingAs($user, 'sanctum')
            ->putJson('/api/v1/plan', ['step_goal' => 8000])
            ->assertOk()
            ->assertJsonPath('data.version', 2);

        $this->assertSame(2, WellbeingPlan::query()->where('user_id', $user->id)->count());
    }

    // B
    public function test_should_recognise_a_replayed_edit_by_its_client_uuid(): void
    {
        // The case content comparison alone cannot catch: a retry arriving after a later
        // edit has moved the values on, which would otherwise read as a change back.
        $user = User::factory()->create();
        $this->actingAs($user, 'sanctum')->postJson('/api/v1/plan/recalculate');

        $this->actingAs($user, 'sanctum')->putJson('/api/v1/plan', [
            'step_goal' => 8000,
            'client_uuid' => 'outbox-1',
        ])->assertJsonPath('data.version', 2);

        $this->actingAs($user, 'sanctum')->putJson('/api/v1/plan', ['step_goal' => 9500]);

        $this->actingAs($user, 'sanctum')
            ->putJson('/api/v1/plan', ['step_goal' => 8000, 'client_uuid' => 'outbox-1'])
            ->assertOk()
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.step_goal', 8000);

        $this->assertSame(3, WellbeingPlan::query()->where('user_id', $user->id)->count());
    }

    // --- Slice G: validation and isolation ---

    // E
    public function test_should_reject_a_goal_that_cannot_be_a_goal(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->putJson('/api/v1/plan', ['step_goal' => 2000000])
            ->assertStatus(422);
    }

    // I
    public function test_should_not_let_one_user_read_anothers_plan_or_history(): void
    {
        $other = User::factory()->create();
        $this->actingAs($other, 'sanctum')->postJson('/api/v1/plan/recalculate');
        $this->actingAs($other, 'sanctum')->putJson('/api/v1/plan', ['step_goal' => 14000]);

        $intruder = User::factory()->create();

        $this->actingAs($intruder, 'sanctum')->getJson('/api/v1/plan')
            ->assertOk()->assertJsonPath('data', null);

        $this->actingAs($intruder, 'sanctum')->getJson('/api/v1/plan/history')
            ->assertOk()->assertJsonPath('data', []);
    }

    // --- Slice H: happy path ---

    // S
    public function test_should_derive_a_fully_personal_plan_and_read_it_back(): void
    {
        $user = User::factory()->create();
        $this->givenAdultProfile($user);
        $this->givenRestingHeartRateHistory($user, 52.0);

        $this->actingAs($user, 'sanctum')->postJson('/api/v1/plan/recalculate')->assertOk();

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/plan')
            ->assertOk()
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.source', 'derived')
            ->assertJsonPath('data.water_ml', 2100)
            ->assertJsonPath('data.sleep_need_hours', 8)
            ->assertJsonPath('data.basis.missing', [])
            ->assertJsonPath('data.basis.bmr_formula', 'mifflin_st_jeor')
            ->assertJsonPath('data.basis.sleep_need_range', [7, 9])
            ->assertJsonStructure(['data' => [
                'version', 'source', 'step_goal', 'water_ml', 'active_kcal_goal',
                'sleep_need_hours', 'edited_fields', 'created_at',
                'hr_zones' => ['easy', 'moderate', 'hard'],
                'basis' => [
                    'bmr_kcal', 'tdee_kcal', 'bmr_formula', 'max_hr_formula',
                    'hr_zone_formula', 'resting_hr_bpm', 'resting_hr_source',
                    'step_goal_source', 'water_source', 'missing',
                ],
            ]]);
    }
}
