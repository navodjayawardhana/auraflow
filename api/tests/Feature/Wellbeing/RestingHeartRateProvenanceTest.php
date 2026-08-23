<?php

namespace Tests\Feature\Wellbeing;

use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
use App\Models\HealthSnapshot;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A resting heart rate and the thing that makes it readable, from the form to the score.
 *
 * The cases here are the ones that fail silently. A baseline built across both kinds of
 * reading still produces a mean, a standard deviation and a score in range -- nothing looks
 * broken, and the number is furthest from the truth on exactly the days a user changed how
 * they measure. E-015's second correction was this same mistake one layer up, and it cost
 * roughly half the model's correlation before anyone noticed.
 *
 * The rest are properties the ingest depends on: a rate cannot arrive without saying how it
 * was taken, a morning check-in cannot land on a night's row and keep the night's label, and
 * a day of seated mornings appearing in the table cannot move an overnight score by a tenth.
 */
class RestingHeartRateProvenanceTest extends TestCase
{
    use RefreshDatabase;

    private const TODAY = '2026-03-15';

    /** Nine nights from a watch, mean exactly 55.0. */
    private function givenOvernightNights(User $user, int $fromDaysAgo = 1): void
    {
        foreach ([54, 55, 56, 54, 55, 56, 54, 55, 56] as $index => $bpm) {
            HealthSnapshot::factory()
                ->for($user)
                ->on($this->daysBeforeToday($index + $fromDaysAgo))
                ->restingHeartRate((float) $bpm)
                ->create();
        }
    }

    /**
     * Morning check-ins, mean exactly 68.0 -- a plausible seated figure for the same person
     * whose nights sit at 55.
     *
     * @param  float[]  $rates
     */
    private function givenSeatedMornings(User $user, array $rates = [66, 68, 70, 68, 68]): void
    {
        foreach ($rates as $index => $bpm) {
            HealthSnapshot::factory()
                ->for($user)
                // Placed after the nights so the two series occupy different days without
                // either being pushed outside the fourteen-day window.
                ->on($this->daysBeforeToday($index + 1))
                ->seatedRestingHeartRate((float) $bpm)
                ->create();
        }
    }

    private function daysBeforeToday(int $days): string
    {
        return date('Y-m-d', strtotime(self::TODAY." -{$days} days"));
    }

    // --- Ingest ---

    // Z
    public function test_should_refuse_a_resting_rate_that_does_not_say_how_it_was_taken(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => $this->daysBeforeToday(1),
                'resting_heart_rate' => 62,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('resting_hr_source');
    }

    // Z
    public function test_should_refuse_a_source_with_no_reading_to_describe(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => $this->daysBeforeToday(1),
                'resting_hr_source' => 'seated_spot',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('resting_hr_source');
    }

    // B
    public function test_should_refuse_a_source_it_does_not_recognise(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => $this->daysBeforeToday(1),
                'resting_heart_rate' => 62,
                'resting_hr_source' => 'wrist',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('resting_hr_source');
    }

    // O
    public function test_should_carry_the_source_back_out_the_way_it_came_in(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => $this->daysBeforeToday(1),
                'resting_heart_rate' => 67,
                'resting_hr_source' => 'seated_spot',
            ])
            ->assertCreated()
            ->assertJsonPath('data.resting_heart_rate', 67)
            ->assertJsonPath('data.resting_hr_source', 'seated_spot');
    }

    // B
    public function test_should_not_let_a_check_in_overwrite_a_nights_rate_and_keep_its_label(): void
    {
        $user = User::factory()->create();
        $date = $this->daysBeforeToday(1);

        HealthSnapshot::factory()->for($user)->on($date)->restingHeartRate(55.0)->create();

        // The merge writes only what a request carries, so without the pairing rule this
        // would leave 67 sitting under the word `overnight` -- a seated figure filed into
        // the overnight baseline, which is the whole defect wearing a new hat.
        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', [
                'recorded_on' => $date,
                'resting_heart_rate' => 67,
                'resting_hr_source' => 'seated_spot',
            ])
            ->assertCreated();

        $row = HealthSnapshot::query()->sole();

        $this->assertSame(67.0, $row->resting_heart_rate);
        $this->assertSame(RestingHeartRateSource::SeatedSpot->value, $row->resting_hr_source);
    }

    // I
    public function test_should_leave_the_nights_rate_alone_when_only_water_arrives(): void
    {
        $user = User::factory()->create();
        $date = $this->daysBeforeToday(1);

        HealthSnapshot::factory()->for($user)->on($date)->restingHeartRate(55.0)->create();

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/health-snapshots', ['recorded_on' => $date, 'water_ml' => 500])
            ->assertCreated();

        $row = HealthSnapshot::query()->sole();

        // The pairing rule fires on a rate being written, not on every write -- a water tap
        // must not blank the provenance of a reading it never touched.
        $this->assertSame(55.0, $row->resting_heart_rate);
        $this->assertSame(RestingHeartRateSource::Overnight->value, $row->resting_hr_source);
    }

    // --- One baseline per source ---

    // M
    public function test_should_score_a_seated_morning_against_seated_mornings_only(): void
    {
        $user = User::factory()->create();

        $this->givenOvernightNights($user, fromDaysAgo: 6);
        $this->givenSeatedMornings($user);

        // Sleep left out so the score is the autonomic component alone and the arithmetic is
        // visible: 68.0 against a seated mean of 68.0 is a deviation of zero, which is 50.0.
        //
        // Pooled across all fourteen days the mean would be 59.6 and the deviation 6.3, so
        // the same morning would score 23.5 and read as a bad day. That gap is the bug: not
        // a rounding difference, half the scale.
        HealthSnapshot::factory()
            ->for($user)
            ->on(self::TODAY)
            ->withoutSleep()
            ->seatedRestingHeartRate(68.0)
            ->create();

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.provisional', false)
            // 50, not 50.0: a whole score serialises as an integer over the wire.
            ->assertJsonPath('data.score', 50)
            // A typical morning, so no warning. Against the overnight nights this same
            // reading is +16 SD and the user would be told they are ill.
            ->assertJsonPath('data.illness_warning', false);
    }

    // I
    public function test_should_leave_an_overnight_score_untouched_by_seated_mornings_in_the_same_window(): void
    {
        $user = User::factory()->create();

        $this->givenOvernightNights($user, fromDaysAgo: 6);
        HealthSnapshot::factory()
            ->for($user)
            ->on(self::TODAY)
            ->withoutSleep()
            ->restingHeartRate(55.0)
            ->create();

        $before = $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->json('data.score');

        // The same fortnight, plus five check-ins the user started doing alongside the
        // watch. Nothing about their nights changed, so nothing about the night score may.
        $this->givenSeatedMornings($user);

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->assertJsonPath('data.score', $before)
            ->assertJsonPath('data.provisional', false)
            ->assertJsonPath('data.resting_hr_source', 'overnight');

        $this->assertSame(50, $before);
    }

    // E
    public function test_should_stay_provisional_when_the_seated_series_is_too_short(): void
    {
        $user = User::factory()->create();

        // A fortnight of nights sitting right there, and four mornings. The nights are not
        // offered as a substitute: borrowing them would produce an established-looking score
        // measured against a reference that describes a different measurement.
        $this->givenOvernightNights($user, fromDaysAgo: 5);
        $this->givenSeatedMornings($user, [66, 68, 70, 68]);

        HealthSnapshot::factory()
            ->for($user)
            ->on(self::TODAY)
            ->seatedRestingHeartRate(68.0)
            ->create();

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.provisional', true)
            // Null rather than `seated_spot`: the autonomic component did not run, so there
            // is no baseline for the disclosure to be about.
            ->assertJsonPath('data.resting_hr_source', null);
    }

    // S
    public function test_should_report_which_kind_of_baseline_the_score_rests_on(): void
    {
        $user = User::factory()->create();
        $this->givenSeatedMornings($user);

        HealthSnapshot::factory()
            ->for($user)
            ->on(self::TODAY)
            ->seatedRestingHeartRate(69.0)
            ->create();

        // The one field the app needs to know that E-015's number does not cover this score.
        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->assertJsonPath('data.provisional', false)
            ->assertJsonPath('data.resting_hr_source', 'seated_spot');
    }

    // E
    public function test_should_name_the_history_a_new_check_in_user_is_actually_short_of(): void
    {
        $user = User::factory()->create();
        $this->givenOvernightNights($user, fromDaysAgo: 2);

        // Seated, no sleep, and no seated history: nothing can be computed. Telling this
        // person to log five more nights would send them to the wrong screen entirely.
        HealthSnapshot::factory()
            ->for($user)
            ->on(self::TODAY)
            ->withoutSleep()
            ->seatedRestingHeartRate(67.0)
            ->create();

        $response = $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/recovery/'.self::TODAY)
            ->assertOk()
            ->assertJsonPath('data.available', false);

        $this->assertStringContainsString('seated mornings', (string) $response->json('data.reason'));
    }
}
