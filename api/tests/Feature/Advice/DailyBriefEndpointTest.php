<?php

namespace Tests\Feature\Advice;

use App\Jobs\GenerateDailyBrief;
use App\Models\DailyBrief;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * The briefing endpoints, exercised where the date cast actually bites.
 *
 * `brief_for` is a `date` column carrying an `immutable_date` cast, which writes
 * `Y-m-d 00:00:00`. A lookup built with plain equality against `Y-m-d` therefore matches
 * nothing, and the insert that follows is rejected by the unique index on
 * (user_id, brief_for). Every test below that asks for the same day twice is guarding that
 * boundary -- and nothing short of a real database would notice it.
 */
class DailyBriefEndpointTest extends TestCase
{
    use RefreshDatabase;

    private const DATE = '2026-03-15';

    protected function setUp(): void
    {
        parent::setUp();

        // The generator itself is not under test here; what is, is the row it is queued
        // against.
        Queue::fake();
    }

    public function test_should_reject_an_unauthenticated_refresh(): void
    {
        $this->postJson('/api/v1/briefs/'.self::DATE.'/refresh')->assertUnauthorized();
    }

    public function test_should_create_a_pending_brief_on_first_request(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/briefs/'.self::DATE)
            ->assertOk()
            ->assertJsonPath('data.status', DailyBrief::STATUS_PENDING)
            ->assertJsonPath('data.date', self::DATE);

        $this->assertDatabaseCount('daily_briefs', 1);
        Queue::assertPushed(GenerateDailyBrief::class);
    }

    public function test_should_refresh_a_brief_that_already_exists(): void
    {
        $user = User::factory()->create();

        // Created through the endpoint rather than the model, so the row is stored exactly
        // as production stores it -- writing it any other way would sidestep the cast that
        // caused the bug.
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/briefs/'.self::DATE)->assertOk();

        DailyBrief::query()->first()->update([
            'status' => DailyBrief::STATUS_FAILED,
            'failure_reason' => 'The model was unreachable.',
        ]);

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/briefs/'.self::DATE.'/refresh')
            ->assertStatus(202)
            ->assertJsonPath('data.status', DailyBrief::STATUS_PENDING);

        // One row, reset. A second row would mean the lookup missed and the unique index
        // was the only thing standing between this and duplicate briefings.
        $this->assertDatabaseCount('daily_briefs', 1);

        $brief = DailyBrief::query()->first();
        $this->assertSame(DailyBrief::STATUS_PENDING, $brief->status);
        $this->assertNull($brief->failure_reason);
    }

    public function test_should_create_the_brief_when_refreshing_a_day_that_has_none(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/briefs/'.self::DATE.'/refresh')
            ->assertStatus(202);

        $this->assertDatabaseCount('daily_briefs', 1);
        Queue::assertPushed(GenerateDailyBrief::class);
    }

    public function test_should_survive_being_refreshed_twice(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/briefs/'.self::DATE.'/refresh')
            ->assertStatus(202);

        // The second call is the one that used to return 500: the row now exists, and the
        // match clause could not see it.
        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/briefs/'.self::DATE.'/refresh')
            ->assertStatus(202);

        $this->assertDatabaseCount('daily_briefs', 1);
    }

    public function test_should_retry_a_brief_left_pending_by_a_job_that_never_ran(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')->getJson('/api/v1/briefs/'.self::DATE)->assertOk();
        Queue::assertPushed(GenerateDailyBrief::class, 1);

        // The worker was not running. Age the row past the point where "still working" is a
        // credible explanation.
        DailyBrief::query()->first()->forceFill([
            'updated_at' => now()->subMinutes(10),
        ])->saveQuietly();

        $this->actingAs($user, 'sanctum')->getJson('/api/v1/briefs/'.self::DATE)->assertOk();

        Queue::assertPushed(GenerateDailyBrief::class, 2);
        $this->assertDatabaseCount('daily_briefs', 1);
    }

    public function test_should_not_queue_a_second_job_while_the_first_is_still_plausible(): void
    {
        // The client polls every few seconds. Without the row's clock moving first, each
        // poll past the threshold would queue another job for the same day.
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')->getJson('/api/v1/briefs/'.self::DATE)->assertOk();
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/briefs/'.self::DATE)->assertOk();
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/briefs/'.self::DATE)->assertOk();

        Queue::assertPushed(GenerateDailyBrief::class, 1);
    }

    public function test_should_retry_a_day_that_had_nothing_to_say_earlier(): void
    {
        // The case that sent someone looking for a bug: a briefing that failed at breakfast
        // for want of data stayed failed all day, long after they had logged a night. It is
        // `waiting`, not `failed`, and waiting is retried.
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')->getJson('/api/v1/briefs/'.self::DATE)->assertOk();

        DailyBrief::query()->first()->forceFill([
            'status' => DailyBrief::STATUS_WAITING,
            'updated_at' => now()->subMinutes(10),
        ])->saveQuietly();

        $this->actingAs($user, 'sanctum')->getJson('/api/v1/briefs/'.self::DATE)->assertOk();

        Queue::assertPushed(GenerateDailyBrief::class, 2);
    }

    public function test_should_leave_a_genuine_failure_alone(): void
    {
        // A failure is over. Retrying it every couple of minutes for the rest of the day
        // would be the app arguing with itself, and the card offers a button for the case
        // where the user disagrees.
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')->getJson('/api/v1/briefs/'.self::DATE)->assertOk();

        DailyBrief::query()->first()->forceFill([
            'status' => DailyBrief::STATUS_FAILED,
            'updated_at' => now()->subMinutes(10),
        ])->saveQuietly();

        $this->actingAs($user, 'sanctum')->getJson('/api/v1/briefs/'.self::DATE)->assertOk();

        Queue::assertPushed(GenerateDailyBrief::class, 1);
    }

    public function test_should_keep_one_users_brief_out_of_anothers(): void
    {
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        $this->actingAs($mine, 'sanctum')->postJson('/api/v1/briefs/'.self::DATE.'/refresh');
        $this->actingAs($theirs, 'sanctum')->postJson('/api/v1/briefs/'.self::DATE.'/refresh');

        $this->assertDatabaseCount('daily_briefs', 2);
    }
}
