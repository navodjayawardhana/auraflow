<?php

namespace Tests\Feature\Wellbeing;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Models\HealthSnapshot;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * End to end: HTTP through the use case, the Eloquent repository and the database.
 *
 * The domain tests already prove the rules. What can only be proved here is that the
 * wiring is right -- that the container resolves the repository interface, that the
 * mapper round-trips, and that the query really does exclude the day being scored.
 */
class RecoveryScoreEndpointTest extends TestCase
{
    use RefreshDatabase;

    private const TODAY = '2026-03-15';

    private function givenBaselineHistory(User $user, float $bpm = 60.0): void
    {
        foreach (range(1, RestingHeartRateBaseline::MIN_DAYS + 2) as $index => $daysAgo) {
            HealthSnapshot::factory()
                ->for($user)
                ->on(date('Y-m-d', strtotime(self::TODAY." -{$daysAgo} days")))
                ->restingHeartRate($bpm + ($index % 3) - 1)
                ->create();
        }
    }

    // --- Slice A: authentication ---

    // Z
    public function test_should_reject_an_unauthenticated_request(): void
    {
        $this->getJson('/api/v1/recovery/'.self::TODAY)->assertUnauthorized();
    }

    // --- Slice B: input validation at the boundary ---

    // B
    public function test_should_not_route_a_malformed_date(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/recovery/not-a-date')
            ->assertNotFound();
    }

    // E
    public function test_should_reject_a_date_that_is_not_a_real_calendar_day(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/recovery/2026-02-30')
            ->assertStatus(422);
    }

    // --- Slice C: nothing to score ---

    // Z
    public function test_should_report_unavailable_rather_than_missing_when_there_is_no_data(): void
    {
        // 200 with available=false, not 404: the user and the date both exist, there is
        // simply nothing to score. A 404 would tell the client the endpoint was wrong.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.score', null);
    }

    // Z
    public function test_should_report_unavailable_when_the_night_recorded_no_sleep(): void
    {
        $user = User::factory()->create();
        HealthSnapshot::factory()->for($user)->on(self::TODAY)->withoutSleep()->create();

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->assertJsonPath('data.available', false);
    }

    // --- Slice D: cold start ---

    // O
    public function test_should_return_a_provisional_score_when_the_user_has_no_history(): void
    {
        $user = User::factory()->create();
        HealthSnapshot::factory()->for($user)->on(self::TODAY)->create();

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.provisional', true);
    }

    // --- Slice E: isolation between users ---

    // I
    public function test_should_not_build_a_baseline_from_another_users_history(): void
    {
        $user = User::factory()->create();
        $this->givenBaselineHistory(User::factory()->create());

        HealthSnapshot::factory()->for($user)->on(self::TODAY)->create();

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->assertJsonPath('data.provisional', true);
    }

    // --- Slice F: illness warning ---

    // M
    public function test_should_raise_a_warning_when_resting_rate_is_elevated_against_the_users_own_baseline(): void
    {
        $user = User::factory()->create();
        $this->givenBaselineHistory($user, 60.0);
        HealthSnapshot::factory()->for($user)->on(self::TODAY)->restingHeartRate(78.0)->create();

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->assertJsonPath('data.illness_warning', true);
    }

    // --- Slice G: happy path ---

    // S
    public function test_should_return_an_established_score_once_enough_history_exists(): void
    {
        $user = User::factory()->create();
        $this->givenBaselineHistory($user, 60.0);
        HealthSnapshot::factory()->for($user)->on(self::TODAY)->restingHeartRate(55.0)->create();

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->assertJsonPath('data.date', self::TODAY)
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.provisional', false)
            ->assertJsonPath('data.components_used', 3)
            ->assertJsonPath('data.illness_warning', false)
            ->assertJsonStructure(['data' => ['date', 'score', 'available', 'provisional', 'components_used', 'illness_warning']]);
    }
}
