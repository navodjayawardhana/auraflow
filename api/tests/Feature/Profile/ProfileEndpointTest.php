<?php

namespace Tests\Feature\Profile;

use App\Models\User;
use App\Models\UserProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * End to end: HTTP through the use case, the Eloquent repository and the database.
 *
 * The domain tests already prove the rules. What can only be proved here is the wiring --
 * that the container resolves the repository interface, that the mapper round-trips, and
 * that the merge semantics survive a real request rather than a hand-built array.
 */
class ProfileEndpointTest extends TestCase
{
    use RefreshDatabase;

    // --- Slice A: authentication ---

    // Z
    public function test_should_reject_an_unauthenticated_read(): void
    {
        $this->getJson('/api/v1/profile')->assertUnauthorized();
    }

    // Z
    public function test_should_reject_an_unauthenticated_write(): void
    {
        $this->putJson('/api/v1/profile', ['height_cm' => 175])->assertUnauthorized();
    }

    // --- Slice B: nothing saved yet ---

    // Z
    public function test_should_return_null_rather_than_a_blank_profile_before_anything_is_saved(): void
    {
        // Null and an object of nulls are different facts, and the client uses the
        // difference to decide between rendering the screen and prompting.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/profile')
            ->assertOk()
            ->assertJsonPath('data', null);
    }

    // O
    public function test_should_accept_a_profile_with_only_one_field_filled_in(): void
    {
        // Nothing is required to use the app. A partial profile is the normal case.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->putJson('/api/v1/profile', ['weight_kg' => 72.3])
            ->assertOk()
            ->assertJsonPath('data.weight_kg', 72.3)
            ->assertJsonPath('data.height_cm', null)
            ->assertJsonPath('data.bmi', null)
            ->assertJsonPath('data.sex', 'unspecified')
            ->assertJsonPath('data.activity_level', 'sedentary');
    }

    // --- Slice C: validation at the boundary ---

    // B
    public function test_should_reject_a_height_no_person_has(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->putJson('/api/v1/profile', ['height_cm' => 400])
            ->assertStatus(422);
    }

    // B
    public function test_should_reject_a_date_of_birth_in_the_future(): void
    {
        // A wrong device clock. Left through, Tanaka and the NSF bands would both
        // evaluate at a negative age and return entirely plausible numbers.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->putJson('/api/v1/profile', ['date_of_birth' => date('Y-m-d', strtotime('+1 year'))])
            ->assertStatus(422);
    }

    // E
    public function test_should_reject_a_sex_outside_the_published_set(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->putJson('/api/v1/profile', ['sex' => 'yes'])
            ->assertStatus(422);
    }

    // --- Slice D: merge, not replace ---

    // M
    public function test_should_leave_a_field_alone_when_the_request_omits_it(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->putJson('/api/v1/profile', ['height_cm' => 172, 'weight_kg' => 68.0]);

        $this->actingAs($user, 'sanctum')
            ->putJson('/api/v1/profile', ['weight_kg' => 66.5])
            ->assertOk()
            ->assertJsonPath('data.height_cm', 172)
            ->assertJsonPath('data.weight_kg', 66.5);
    }

    // B
    public function test_should_clear_a_field_sent_explicitly_as_null(): void
    {
        // Absence and null are different instructions. Someone who typed the wrong year
        // of birth has to be able to take it back out.
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')
            ->putJson('/api/v1/profile', ['date_of_birth' => '1990-04-11']);

        $this->actingAs($user, 'sanctum')
            ->putJson('/api/v1/profile', ['date_of_birth' => null])
            ->assertOk()
            ->assertJsonPath('data.date_of_birth', null);
    }

    // B
    public function test_should_return_sex_to_unspecified_when_it_is_cleared(): void
    {
        // The domain has no third state: Unspecified is the cleared value.
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')->putJson('/api/v1/profile', ['sex' => 'female']);

        $this->actingAs($user, 'sanctum')
            ->putJson('/api/v1/profile', ['sex' => null])
            ->assertOk()
            ->assertJsonPath('data.sex', 'unspecified');
    }

    // I
    public function test_should_keep_one_profile_per_user_however_many_times_it_is_saved(): void
    {
        $user = User::factory()->create();

        foreach ([170, 171, 172] as $height) {
            $this->actingAs($user, 'sanctum')->putJson('/api/v1/profile', ['height_cm' => $height]);
        }

        $this->assertSame(1, UserProfile::query()->where('user_id', $user->id)->count());
    }

    // --- Slice E: the two BMI scales ---

    // M
    public function test_should_report_both_scales_readings_of_the_same_body(): void
    {
        // BMI 24.1 is healthy under the international classification and overweight
        // under the WHO Asian cut-offs. Showing only the first to a user in Sri Lanka
        // would be a real error, so both are always returned.
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->putJson('/api/v1/profile', ['height_cm' => 175, 'weight_kg' => 73.8])
            ->assertOk()
            ->assertJsonPath('data.bmi', 24.1)
            ->assertJsonPath('data.bmi_scale', 'who_asian')
            ->assertJsonPath('data.bmi_band', 'overweight')
            ->assertJsonPath('data.bmi_bands.who_standard', 'healthy')
            ->assertJsonPath('data.bmi_bands.who_asian', 'overweight');
    }

    // I
    public function test_should_let_the_profile_choose_which_population_applies(): void
    {
        // Writable, and stored: the same body must not read as healthy on one device and
        // overweight on another.
        $user = User::factory()->create();

        $this->actingAs($user, 'sanctum')->putJson('/api/v1/profile', [
            'height_cm' => 175,
            'weight_kg' => 73.8,
            'bmi_scale' => 'who_standard',
        ])->assertOk()->assertJsonPath('data.bmi_band', 'healthy');

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/profile')
            ->assertOk()
            ->assertJsonPath('data.bmi_scale', 'who_standard')
            ->assertJsonPath('data.bmi_band', 'healthy');
    }

    // --- Slice F: isolation between users ---

    // I
    public function test_should_not_let_one_user_read_anothers_profile(): void
    {
        $other = User::factory()->create();
        $this->actingAs($other, 'sanctum')->putJson('/api/v1/profile', ['height_cm' => 190]);

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/profile')
            ->assertOk()
            ->assertJsonPath('data', null);
    }

    // --- Slice G: happy path ---

    // S
    public function test_should_save_and_return_a_complete_profile(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum')
            ->putJson('/api/v1/profile', [
                'date_of_birth' => '1986-08-22',
                'sex' => 'male',
                'height_cm' => 178,
                'weight_kg' => 76.0,
                'activity_level' => 'moderate',
            ])
            ->assertOk()
            ->assertJsonPath('data.date_of_birth', '1986-08-22')
            ->assertJsonPath('data.sex', 'male')
            ->assertJsonPath('data.activity_level', 'moderate')
            ->assertJsonStructure(['data' => [
                'date_of_birth', 'sex', 'height_cm', 'weight_kg', 'activity_level',
                'bmi', 'bmi_band', 'bmi_scale', 'bmi_bands', 'updated_at',
            ]]);
    }
}
