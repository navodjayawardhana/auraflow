<?php

namespace Tests\Feature\Advice;

use App\Models\ExerciseSession;
use App\Models\HealthSnapshot;
use App\Models\MealEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * What actually reaches the model, asserted on the wire.
 *
 * The unit tests pin the prompt builders, which is where the wording lives. This pins the
 * two things a pure builder cannot: that the rows going into the pack are the caller's own
 * and nobody else's, and that the provenance survives every layer between a database
 * column and the request body. A qualifier lost in the assembly is invisible in a prompt
 * test, because the prompt test hands the builder a value that already carries it.
 */
class GroundingPackTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.gemini.key' => 'test-key', 'services.gemini.model' => 'gemini-test']);

        Http::fake([
            '*generativelanguage.googleapis.com*' => Http::response([
                'candidates' => [['content' => ['parts' => [['text' => 'Noted.']]]]],
            ]),
        ]);
    }

    /** Everything the model was sent, as one string to search. */
    private function sentPrompt(): string
    {
        $sent = '';

        Http::assertSent(function ($request) use (&$sent): bool {
            $sent = json_encode($request->data());

            return true;
        });

        return $sent;
    }

    private function ask(User $user): void
    {
        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/chat', ['message' => 'How has my week been?'])
            ->assertCreated();
    }

    public function test_should_never_put_another_users_rows_in_the_pack(): void
    {
        // The property that matters most in a grounded assistant. Every read the pack makes
        // is scoped by user id, and this is the test that would fail if one of them stopped
        // being -- a single unscoped query and the assistant discusses a stranger's week.
        $mine = User::factory()->create();
        $theirs = User::factory()->create();

        $yesterday = now()->subDay()->format('Y-m-d');

        // Mine too, and asserted for. Without it the pack could come back empty for some
        // unrelated reason and this would still pass, proving only that nothing works.
        HealthSnapshot::factory()->for($mine)->on($yesterday)->withSteps(5150)->create();

        HealthSnapshot::factory()->for($theirs)->on($yesterday)->withSteps(31337)->create([
            'sleep_minutes' => 511,
            'water_ml' => 4321,
        ]);

        MealEntry::query()->create([
            'user_id' => $theirs->id,
            'eaten_on' => $yesterday,
            'eaten_at' => now()->subDay(),
            'name' => 'Somebody Elses Dinner',
            'kcal' => 1234,
            'source' => MealEntry::SOURCE_LOOKUP,
        ]);

        ExerciseSession::query()->create([
            'user_id' => $theirs->id,
            'performed_on' => $yesterday,
            'performed_at' => now()->subDay(),
            'exercise' => ExerciseSession::EXERCISE_SQUAT,
            'source' => ExerciseSession::SOURCE_POSE,
            'total_reps' => 99,
            'good_form_reps' => 98,
            'duration_seconds' => 600,
            'prescribed_intensity' => ExerciseSession::INTENSITY_FULL,
        ]);

        $this->ask($mine);

        $prompt = $this->sentPrompt();

        $this->assertStringContainsString('steps 5150', $prompt);
        $this->assertStringNotContainsString('31337', $prompt);
        $this->assertStringNotContainsString('4321', $prompt);
        $this->assertStringNotContainsString('Somebody Elses Dinner', $prompt);
        $this->assertStringNotContainsString('1234', $prompt);
        $this->assertStringNotContainsString('99 reps', $prompt);
    }

    public function test_should_label_an_estimated_meal_as_estimated_all_the_way_to_the_model(): void
    {
        // A photograph's guess and a barcode's label are the same integer. If the source is
        // dropped anywhere between the column and the request body, the model says "you ate
        // 1,800 calories" and a guess has acquired the authority of a measurement.
        $user = User::factory()->create();
        $today = now()->format('Y-m-d');

        HealthSnapshot::factory()->for($user)->on($today)->create();

        MealEntry::query()->create([
            'user_id' => $user->id,
            'eaten_on' => $today,
            'eaten_at' => now(),
            'name' => 'Rice and curry',
            'kcal' => 780,
            'source' => MealEntry::SOURCE_PHOTO,
        ]);

        $this->ask($user);

        $prompt = $this->sentPrompt();

        $this->assertStringContainsString('Rice and curry', $prompt);
        $this->assertStringContainsString("a vision model's guess from a photograph, not measured", $prompt);
        $this->assertStringContainsString('est 780 kcal', $prompt);
    }

    public function test_should_carry_a_seated_resting_rate_into_the_history_as_seated(): void
    {
        $user = User::factory()->create();

        HealthSnapshot::factory()->for($user)
            ->on(now()->subDays(2)->format('Y-m-d'))
            ->seatedRestingHeartRate(64.0)
            ->create();

        HealthSnapshot::factory()->for($user)->on(now()->format('Y-m-d'))->create();

        $this->ask($user);

        $prompt = $this->sentPrompt();

        $this->assertStringContainsString('resting HR 64.0 seated', $prompt);
        $this->assertStringContainsString('must never be averaged together', $prompt);
    }

    public function test_should_mark_a_partial_step_count_as_a_floor_in_the_history(): void
    {
        $user = User::factory()->create();

        HealthSnapshot::factory()->for($user)
            ->on(now()->subDay()->format('Y-m-d'))
            ->withSteps(3200, complete: false)
            ->create();

        HealthSnapshot::factory()->for($user)->on(now()->format('Y-m-d'))->create();

        $this->ask($user);

        $prompt = $this->sentPrompt();

        $this->assertStringContainsString('steps 3200 partial', $prompt);
        $this->assertStringContainsString('it is a floor and not a day', $prompt);
    }

    public function test_should_say_a_guided_sessions_reps_were_never_observed(): void
    {
        $user = User::factory()->create();

        HealthSnapshot::factory()->for($user)->on(now()->format('Y-m-d'))->create();

        ExerciseSession::query()->create([
            'user_id' => $user->id,
            'performed_on' => now()->format('Y-m-d'),
            'performed_at' => now(),
            'exercise' => ExerciseSession::EXERCISE_MARCH,
            'source' => ExerciseSession::SOURCE_GUIDED,
            'total_reps' => 40,
            'duration_seconds' => 300,
            'prescribed_intensity' => ExerciseSession::INTENSITY_MOBILITY,
        ]);

        $this->ask($user);

        $this->assertStringContainsString('the reps are assumed, nothing observed them', $this->sentPrompt());
    }

    public function test_should_still_send_a_pack_for_a_user_with_no_data_at_all(): void
    {
        // An empty pack is not an empty prompt. Every section says what is absent, because
        // a section that simply vanishes leaves the model to guess whether it was never
        // asked for or came back empty -- and it guesses generously.
        $this->ask(User::factory()->create());

        $prompt = $this->sentPrompt();

        $this->assertStringContainsString('Daily history: nothing has been recorded', $prompt);
        $this->assertStringContainsString('Movement sessions: none recorded', $prompt);
        $this->assertStringContainsString('no derived plan yet', $prompt);
    }

    public function test_should_never_send_an_identifier_even_with_a_full_pack(): void
    {
        $user = User::factory()->create(['email' => 'someone@example.com', 'name' => 'Someone Real']);

        HealthSnapshot::factory()->for($user)->on(now()->format('Y-m-d'))->create();

        MealEntry::query()->create([
            'user_id' => $user->id,
            'eaten_on' => now()->format('Y-m-d'),
            'eaten_at' => now(),
            'name' => 'Porridge',
            'kcal' => 300,
            'source' => MealEntry::SOURCE_ESTIMATE,
        ]);

        $this->ask($user);

        $prompt = $this->sentPrompt();

        $this->assertStringNotContainsString('someone@example.com', $prompt);
        $this->assertStringNotContainsString('Someone Real', $prompt);
    }
}
