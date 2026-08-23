<?php

namespace Tests\Feature\Wellbeing;

use App\Models\HealthSnapshot;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The ingest path, end to end.
 *
 * The use-case tests prove the rules; what can only be proved here is that the boundary
 * really rejects what it claims to, and that re-sending a night updates rather than
 * duplicates -- the property every retrying client depends on.
 */
class HealthSnapshotEndpointTest extends TestCase
{
    use RefreshDatabase;

    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'recorded_on' => now()->subDay()->format('Y-m-d'),
            'sleep_minutes' => 450,
            'deep_sleep_minutes' => 90,
            'rem_sleep_minutes' => 100,
            'resting_heart_rate' => 58.4,
            // Paired with the rate, because the endpoint refuses one without the other --
            // a bpm figure that does not say how it was taken cannot be pooled with
            // anything, so it is not a valid payload to build fixtures on.
            'resting_hr_source' => 'overnight',
        ], $overrides);
    }

    // --- Authentication ---

    public function test_should_reject_an_unauthenticated_write(): void
    {
        $this->postJson('/api/v1/health-snapshots', $this->validPayload())->assertUnauthorized();
    }

    public function test_should_reject_an_unauthenticated_read(): void
    {
        $this->getJson('/api/v1/health-snapshots?from=2026-01-01&to=2026-01-07')->assertUnauthorized();
    }

    // --- Writing ---

    public function test_should_store_a_night_and_return_it(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', $this->validPayload())
            ->assertCreated()
            ->assertJsonPath('data.sleep_minutes', 450)
            ->assertJsonPath('data.resting_heart_rate', 58.4);

        $this->assertDatabaseCount('health_snapshots', 1);
    }

    public function test_should_update_rather_than_duplicate_the_same_night(): void
    {
        $user = User::factory()->create();
        $date = now()->subDay()->format('Y-m-d');

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', $this->validPayload(['recorded_on' => $date]))
            ->assertCreated();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', $this->validPayload([
                'recorded_on' => $date,
                'sleep_minutes' => 400,
            ]))
            ->assertCreated();

        // Idempotent per (user, day): a duplicate row would silently corrupt every
        // trailing baseline computed from these snapshots.
        $this->assertDatabaseCount('health_snapshots', 1);
        $this->assertSame(400, HealthSnapshot::first()->sleep_minutes);
    }

    public function test_should_merge_a_partial_write_rather_than_clearing_the_rest(): void
    {
        $user = User::factory()->create();
        $date = now()->subDay()->format('Y-m-d');

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', $this->validPayload(['recorded_on' => $date]))
            ->assertCreated();

        // A water tap knows nothing about last night's sleep. Writing it must not wipe
        // the sleep that produced today's recovery score.
        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => $date,
                'water_ml' => 750,
            ])
            ->assertCreated();

        $stored = HealthSnapshot::first();

        $this->assertSame(750, $stored->water_ml);
        $this->assertSame(450, $stored->sleep_minutes);
        $this->assertSame(58.4, $stored->resting_heart_rate);
    }

    public function test_should_store_activity_metrics(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => now()->format('Y-m-d'),
                'steps' => 6420,
                // Required alongside the count: the same integer is a whole day from a
                // platform with a pedometer history and a fraction of one from a phone
                // that only counts while it is open. StepProvenanceTest covers what
                // depends on the distinction.
                'steps_are_complete' => true,
                'water_ml' => 1500,
            ])
            ->assertCreated()
            ->assertJsonPath('data.steps', 6420)
            ->assertJsonPath('data.steps_are_complete', true)
            ->assertJsonPath('data.water_ml', 1500);
    }

    public function test_should_reject_an_implausible_step_count(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => now()->format('Y-m-d'),
                'steps' => 500000,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('steps');
    }

    public function test_should_accept_a_heart_rate_only_night(): void
    {
        // A watch worn by day but not overnight reports exactly this shape.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => now()->subDay()->format('Y-m-d'),
                'resting_heart_rate' => 61.0,
                'resting_hr_source' => 'overnight',
            ])
            ->assertCreated()
            ->assertJsonPath('data.sleep_minutes', null);
    }

    // --- Boundary validation ---

    public function test_should_reject_a_future_night(): void
    {
        // A client with a wrong clock would otherwise poison every trailing baseline.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/health-snapshots', $this->validPayload([
                'recorded_on' => now()->addDay()->format('Y-m-d'),
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('recorded_on');
    }

    public function test_should_reject_stages_longer_than_the_night(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/health-snapshots', $this->validPayload([
                'sleep_minutes' => 300,
                'deep_sleep_minutes' => 200,
                'rem_sleep_minutes' => 200,
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('deep_sleep_minutes');
    }

    public function test_should_reject_an_implausible_heart_rate(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/health-snapshots', $this->validPayload(['resting_heart_rate' => 500]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('resting_heart_rate');
    }

    public function test_should_surface_a_domain_rule_as_a_validation_error(): void
    {
        // 40 minutes passes the form request's 0..1440 range but is not a night any
        // physiology would call sleep, so the value object rejects it. The client should
        // see one error shape either way rather than a 500.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/health-snapshots', $this->validPayload([
                'sleep_minutes' => 40,
                'deep_sleep_minutes' => 10,
                'rem_sleep_minutes' => 10,
            ]))
            ->assertStatus(422);
    }

    // --- Reading ---

    public function test_should_list_only_the_requested_window(): void
    {
        $user = User::factory()->create();

        foreach ([5, 3, 1] as $daysAgo) {
            HealthSnapshot::factory()
                ->for($user)
                ->on(now()->subDays($daysAgo)->format('Y-m-d'))
                ->create();
        }

        $this->actingAs($user, 'sanctum')
            ->getJson(sprintf(
                '/api/v1/health-snapshots?from=%s&to=%s',
                now()->subDays(3)->format('Y-m-d'),
                now()->subDay()->format('Y-m-d'),
            ))
            ->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_should_not_leak_another_users_nights(): void
    {
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        HealthSnapshot::factory()->for($theirs)->on(now()->subDay()->format('Y-m-d'))->create();

        $this->actingAs($mine, 'sanctum')
            ->getJson(sprintf(
                '/api/v1/health-snapshots?from=%s&to=%s',
                now()->subDays(7)->format('Y-m-d'),
                now()->format('Y-m-d'),
            ))
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_should_reject_an_inverted_window(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/health-snapshots?from=2026-03-10&to=2026-03-01')
            ->assertStatus(422)
            ->assertJsonValidationErrors('to');
    }

    public function test_should_reject_a_window_wider_than_the_cap(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/health-snapshots?from=2025-01-01&to=2025-12-31')
            ->assertStatus(422)
            ->assertJsonValidationErrors('to');
    }
}
