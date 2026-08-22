<?php

namespace Tests\Feature\Movement;

use App\Models\ExerciseSession;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ExerciseSessionEndpointTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'exercise' => ExerciseSession::EXERCISE_SQUAT,
            'total_reps' => 15,
            'good_form_reps' => 12,
            'duration_seconds' => 180,
            'mean_heart_rate' => 128,
            'prescribed_intensity' => ExerciseSession::INTENSITY_FULL,
            'recovery_score' => 75,
        ], $overrides);
    }

    /**
     * @return array<string, mixed>
     */
    private function row(int $userId, string $at, int $reps): array
    {
        return [
            'user_id' => $userId,
            'performed_on' => substr($at, 0, 10),
            'performed_at' => $at,
            'exercise' => ExerciseSession::EXERCISE_SQUAT,
            'total_reps' => $reps,
            'good_form_reps' => $reps,
            'duration_seconds' => 120,
            'mean_heart_rate' => null,
            'prescribed_intensity' => ExerciseSession::INTENSITY_FULL,
            'recovery_score' => 70,
        ];
    }

    // --- Authentication ---

    public function test_should_reject_an_unauthenticated_write(): void
    {
        $this->postJson('/api/v1/exercise-sessions', $this->validPayload())->assertUnauthorized();
    }

    public function test_should_reject_an_unauthenticated_read(): void
    {
        $this->getJson('/api/v1/exercise-sessions')->assertUnauthorized();
    }

    // --- Writing ---

    public function test_should_store_a_session(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $this->validPayload())
            ->assertCreated()
            ->assertJsonPath('data.total_reps', 15)
            ->assertJsonPath('data.good_form_reps', 12)
            ->assertJsonPath('data.recovery_score', 75);

        $this->assertDatabaseCount('exercise_sessions', 1);
    }

    public function test_should_keep_two_sessions_on_the_same_day_as_two_rows(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $this->validPayload())
            ->assertCreated();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $this->validPayload([
                'total_reps' => 8,
                'good_form_reps' => 8,
            ]))
            ->assertCreated();

        // Unlike a night of sleep, a second set is a second event -- merging the two
        // would lose one of them.
        $this->assertDatabaseCount('exercise_sessions', 2);
    }

    public function test_should_accept_a_session_with_no_heart_rate(): void
    {
        // The node is rarely worn. A session without it is the normal case, not an error.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $this->validPayload(['mean_heart_rate' => null]))
            ->assertCreated()
            ->assertJsonPath('data.mean_heart_rate', null);
    }

    public function test_should_accept_an_ungated_session_with_no_score(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $this->validPayload([
                'prescribed_intensity' => ExerciseSession::INTENSITY_UNKNOWN,
                'recovery_score' => null,
            ]))
            ->assertCreated()
            ->assertJsonPath('data.prescribed_intensity', ExerciseSession::INTENSITY_UNKNOWN);
    }

    public function test_should_not_duplicate_a_session_replayed_from_the_offline_queue(): void
    {
        $user = User::factory()->create();
        $payload = $this->validPayload(['client_uuid' => 'sess-2026-08-22-abc123']);

        $first = $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $payload)
            ->assertCreated();

        // The outbox re-sends when it cannot tell whether the first write landed.
        $second = $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $payload)
            ->assertCreated();

        $this->assertDatabaseCount('exercise_sessions', 1);
        $this->assertSame($first->json('data.id'), $second->json('data.id'));
    }

    public function test_should_let_two_users_reuse_the_same_client_uuid(): void
    {
        // The id is only ever unique within one account, so two devices generating the
        // same string must not collide with each other.
        $payload = $this->validPayload(['client_uuid' => 'sess-collision']);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $payload)
            ->assertCreated();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $payload)
            ->assertCreated();

        $this->assertDatabaseCount('exercise_sessions', 2);
    }

    // --- Boundary validation ---

    public function test_should_reject_more_good_form_reps_than_reps(): void
    {
        // Otherwise the history quality ratio goes above 100%.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $this->validPayload([
                'total_reps' => 10,
                'good_form_reps' => 11,
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('good_form_reps');
    }

    public function test_should_reject_a_runaway_rep_count(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $this->validPayload([
                'total_reps' => 5000,
                'good_form_reps' => 0,
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('total_reps');
    }

    public function test_should_reject_a_gated_session_with_no_score(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $this->validPayload(['recovery_score' => null]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('recovery_score');
    }

    public function test_should_reject_an_ungated_session_that_carries_a_score(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $this->validPayload([
                'prescribed_intensity' => ExerciseSession::INTENSITY_UNKNOWN,
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('recovery_score');
    }

    public function test_should_reject_an_unknown_exercise(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $this->validPayload(['exercise' => 'deadlift']))
            ->assertStatus(422)
            ->assertJsonValidationErrors('exercise');
    }

    public function test_should_reject_a_session_from_the_future(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->postJson('/api/v1/exercise-sessions', $this->validPayload([
                'performed_at' => now()->addDay()->toAtomString(),
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('performed_at');
    }

    // --- Reading ---

    public function test_should_list_the_callers_sessions_newest_first(): void
    {
        $user = User::factory()->create();

        ExerciseSession::query()->create($this->row($user->id, '2026-08-20 07:00:00', 10));
        ExerciseSession::query()->create($this->row($user->id, '2026-08-22 07:00:00', 20));

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/exercise-sessions')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.total_reps', 20)
            ->assertJsonPath('meta.total_reps', 30);
    }

    public function test_should_filter_to_one_day_when_a_date_is_given(): void
    {
        $user = User::factory()->create();

        ExerciseSession::query()->create($this->row($user->id, '2026-08-20 07:00:00', 10));
        ExerciseSession::query()->create($this->row($user->id, '2026-08-22 07:00:00', 20));

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/exercise-sessions?date=2026-08-22')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.total_reps', 20);
    }

    public function test_should_not_list_another_users_sessions(): void
    {
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        ExerciseSession::query()->create($this->row($theirs->id, '2026-08-22 07:00:00', 20));

        $this->actingAs($mine, 'sanctum')
            ->getJson('/api/v1/exercise-sessions')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }
}
