<?php

namespace Tests\Feature\Advice;

use App\Models\DailyBrief;
use App\Models\HealthSnapshot;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * When settled advice is allowed to change, and how often.
 *
 * Two failures sit either side of this and both are real. Never rewriting means a brief
 * written at 07:00 telling someone at 21:00 they have drunk 250 ml when they have since
 * drunk two litres. Rewriting on a timer means paying for the same three paragraphs on a
 * day nothing happened, and advice that rewords itself under the reader for no reason they
 * could point at. The rule is decided on facts -- a fingerprint of the context -- and
 * bounded by a floor, and both halves are asserted here against a real database and a real
 * queue, because the interesting part is the interaction between the two.
 */
class DailyBriefRewriteTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    /**
     * What the next generation will produce.
     *
     * A field read by one long-lived stub rather than a second `Http::fake` call: stubs
     * are matched in registration order, so re-faking the same URL leaves the first
     * response answering forever and every assertion below would pass for the wrong reason.
     */
    private string $reply = 'First writing.';

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.gemini.key' => 'test-key', 'services.gemini.model' => 'gemini-test']);

        Http::fake([
            '*generativelanguage.googleapis.com*' => fn () => Http::response([
                'candidates' => [['content' => ['parts' => [['text' => $this->reply]]]]],
            ]),
        ]);

        $this->user = User::factory()->create();

        // Enough to brief on: the gate requires a score, a night or a heart rate.
        HealthSnapshot::factory()->for($this->user)->on($this->today())->create([
            'water_ml' => 500,
        ]);
    }

    private function today(): string
    {
        return now()->format('Y-m-d');
    }

    /** What the model will say the next time it is actually called. */
    private function modelWillSay(string $reply): void
    {
        $this->reply = $reply;
    }

    private function poll(): void
    {
        $this->actingAs($this->user, 'sanctum')->getJson('/api/v1/briefs/'.$this->today())->assertOk();
    }

    /** Move the row's clock back so the next poll is past the floor. */
    private function ageBriefBy(int $minutes): void
    {
        DailyBrief::query()->first()->forceFill(['updated_at' => now()->subMinutes($minutes)])->saveQuietly();
    }

    private function brief(): DailyBrief
    {
        return DailyBrief::query()->first()->refresh();
    }

    /** Water is logged the way the app logs it, through the ingest endpoint. */
    private function logWater(int $ml): void
    {
        $this->actingAs($this->user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', ['recorded_on' => $this->today(), 'water_ml' => $ml])
            ->assertSuccessful();
    }

    public function test_should_record_the_context_a_brief_was_written_from(): void
    {
        $this->modelWillSay('First writing.');
        $this->poll();

        $brief = $this->brief();

        $this->assertSame(DailyBrief::STATUS_READY, $brief->status);
        $this->assertNotNull($brief->context_fingerprint);
    }

    public function test_should_tell_the_client_a_rewrite_is_in_flight(): void
    {
        // Otherwise the client, which stops polling the moment a brief is ready, would
        // never ask again -- and the rewrite it triggered would be met tomorrow.
        $this->modelWillSay('First writing.');
        $this->poll();

        $this->actingAs($this->user, 'sanctum')
            ->getJson('/api/v1/briefs/'.$this->today())
            ->assertJsonPath('data.rewriting', false);

        $this->logWater(2000);
        $this->ageBriefBy(31);

        $this->actingAs($this->user, 'sanctum')
            ->getJson('/api/v1/briefs/'.$this->today())
            ->assertJsonPath('data.rewriting', true)
            // The advice they can already see is still there. A skeleton over text someone
            // is halfway through would be the cure being worse than the complaint.
            ->assertJsonPath('data.status', DailyBrief::STATUS_READY);
    }

    public function test_should_rewrite_when_the_day_has_materially_moved(): void
    {
        $this->modelWillSay('You have barely drunk anything.');
        $this->poll();

        $this->logWater(2000);
        $this->ageBriefBy(31);

        $this->modelWillSay('You are well ahead on water.');
        $this->poll();

        $this->assertSame('You are well ahead on water.', $this->brief()->body);
    }

    public function test_should_leave_settled_advice_alone_when_nothing_material_has_changed(): void
    {
        $this->modelWillSay('First writing.');
        $this->poll();

        // One glass, landing inside the bucket the day was already in. Not worth a new
        // sentence -- and the model must not be called to produce one.
        $this->logWater(750);
        $this->ageBriefBy(31);

        $this->modelWillSay('Second writing.');
        $this->poll();

        $this->assertSame('First writing.', $this->brief()->body);
        Http::assertSentCount(1);
    }

    public function test_should_not_call_the_model_again_inside_the_rewrite_floor(): void
    {
        $this->modelWillSay('First writing.');
        $this->poll();

        // A genuinely material change, immediately followed by the polling the client does
        // every few seconds. The floor is what stops a burst of logging becoming a burst of
        // paid calls.
        $this->logWater(2000);

        $this->modelWillSay('Second writing.');

        $this->poll();
        $this->poll();
        $this->poll();

        $this->assertSame('First writing.', $this->brief()->body);
        Http::assertSentCount(1);
    }

    public function test_should_rewrite_once_the_floor_has_passed(): void
    {
        $this->modelWillSay('First writing.');
        $this->poll();

        $this->logWater(2000);

        $this->modelWillSay('Second writing.');
        $this->poll();

        $this->assertSame('First writing.', $this->brief()->body);

        $this->ageBriefBy(31);
        $this->poll();

        $this->assertSame('Second writing.', $this->brief()->body);
    }

    public function test_should_honour_a_refresh_the_user_asked_for_regardless_of_the_floor(): void
    {
        // The floor governs the app's own polling. A person pressing a button is entitled
        // to new advice whether or not their figures moved.
        $this->modelWillSay('First writing.');
        $this->poll();

        $this->modelWillSay('Rewritten on request.');

        $this->actingAs($this->user, 'sanctum')
            ->postJson('/api/v1/briefs/'.$this->today().'/refresh')
            ->assertStatus(202);

        $this->assertSame('Rewritten on request.', $this->brief()->body);
    }

    public function test_should_rewrite_a_brief_that_predates_the_fingerprint_column_once(): void
    {
        $this->modelWillSay('First writing.');
        $this->poll();

        // A row written before the column existed. "We do not know what this was written
        // from" earns one rewrite, and then the new fingerprint settles it.
        DailyBrief::query()->first()->forceFill([
            'context_fingerprint' => null,
            'updated_at' => now()->subMinutes(31),
        ])->saveQuietly();

        $this->modelWillSay('Second writing.');
        $this->poll();

        $this->assertSame('Second writing.', $this->brief()->body);

        $this->ageBriefBy(31);
        $this->modelWillSay('Third writing.');
        $this->poll();

        // Two calls in the whole test: the first writing, and the one the missing
        // fingerprint earned. The third poll finds a fingerprint it recognises.
        $this->assertSame('Second writing.', $this->brief()->body);
        Http::assertSentCount(2);
    }
}
