<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    private const PASSWORD = 'correct-horse-battery-staple';

    protected function setUp(): void
    {
        parent::setUp();
        RateLimiter::clear('test');
    }

    private function existingUser(string $email = 'navod@example.com'): User
    {
        return User::factory()->create([
            'email' => $email,
            'password' => Hash::make(self::PASSWORD),
        ]);
    }

    /**
     * Drop the guard's cached user between requests.
     *
     * A test reuses one application instance across requests, so once a guard has
     * resolved a user it keeps returning it -- a token revoked mid-test would still
     * appear to work. Production boots the application per request, so this compensates
     * for the test harness rather than for anything in the application.
     *
     * Without it, "revoking a token actually locks the device out" is untestable, which
     * is precisely the assertion that matters.
     */
    private function forgetResolvedUser(): void
    {
        $this->app['auth']->forgetGuards();
    }

    // --- Slice A: registration ---

    // Z
    public function test_should_reject_registration_with_no_fields(): void
    {
        $this->postJson('/api/v1/register', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'email', 'password']);
    }

    // B
    public function test_should_reject_a_password_below_the_minimum_length(): void
    {
        $this->postJson('/api/v1/register', [
            'name' => 'Navod',
            'email' => 'navod@example.com',
            'password' => 'short1!',
            'password_confirmation' => 'short1!',
        ])->assertStatus(422)->assertJsonValidationErrors('password');
    }

    // E
    public function test_should_reject_a_duplicate_email(): void
    {
        $this->existingUser();

        $this->postJson('/api/v1/register', [
            'name' => 'Someone Else',
            'email' => 'navod@example.com',
            'password' => self::PASSWORD,
            'password_confirmation' => self::PASSWORD,
        ])->assertStatus(422)->assertJsonValidationErrors('email');
    }

    // I
    public function test_should_never_return_the_password_hash(): void
    {
        $response = $this->postJson('/api/v1/register', [
            'name' => 'Navod',
            'email' => 'navod@example.com',
            'password' => self::PASSWORD,
            'password_confirmation' => self::PASSWORD,
        ]);

        $this->assertStringNotContainsString('password', $response->getContent());
    }

    // S
    public function test_should_register_and_return_a_usable_token(): void
    {
        $response = $this->postJson('/api/v1/register', [
            'name' => 'Navod',
            'email' => 'navod@example.com',
            'password' => self::PASSWORD,
            'password_confirmation' => self::PASSWORD,
            'device_name' => 'pixel-7',
        ])->assertCreated()->assertJsonStructure(['data' => ['user' => ['id', 'name', 'email'], 'token']]);

        // The token is only real if it opens an authenticated route.
        $this->withToken($response->json('data.token'))
            ->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.email', 'navod@example.com');
    }

    // --- Slice B: sign in ---

    // E
    public function test_should_reject_a_wrong_password(): void
    {
        $this->existingUser();

        $this->postJson('/api/v1/login', [
            'email' => 'navod@example.com',
            'password' => 'not-the-password',
        ])->assertStatus(422);
    }

    // I
    public function test_should_not_reveal_whether_an_email_is_registered(): void
    {
        // Distinguishing "no such account" from "wrong password" turns the login form
        // into an account-enumeration oracle.
        $this->existingUser();

        $known = $this->postJson('/api/v1/login', [
            'email' => 'navod@example.com',
            'password' => 'wrong',
        ]);
        $unknown = $this->postJson('/api/v1/login', [
            'email' => 'nobody@example.com',
            'password' => 'wrong',
        ]);

        $this->assertSame($known->status(), $unknown->status());
        $this->assertSame(
            $known->json('errors.email'),
            $unknown->json('errors.email'),
        );
    }

    // S
    public function test_should_sign_in_with_correct_credentials(): void
    {
        $this->existingUser();

        $this->postJson('/api/v1/login', [
            'email' => 'navod@example.com',
            'password' => self::PASSWORD,
        ])->assertOk()->assertJsonStructure(['data' => ['user', 'token']]);
    }

    // --- Slice C: brute-force protection ---

    // B
    public function test_should_lock_out_after_repeated_failures(): void
    {
        $this->existingUser();

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/v1/login', [
                'email' => 'navod@example.com',
                'password' => 'wrong',
            ])->assertStatus(422);
        }

        $this->postJson('/api/v1/login', [
            'email' => 'navod@example.com',
            'password' => 'wrong',
        ])->assertStatus(429);
    }

    // I
    public function test_should_lock_out_the_correct_password_too_once_throttled(): void
    {
        // Otherwise the limiter is trivially bypassed: an attacker who guesses right on
        // the sixth attempt would still be let in.
        $this->existingUser();

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/v1/login', ['email' => 'navod@example.com', 'password' => 'wrong']);
        }

        $this->postJson('/api/v1/login', [
            'email' => 'navod@example.com',
            'password' => self::PASSWORD,
        ])->assertStatus(429);
    }

    // --- Slice D: token lifecycle ---

    // O
    public function test_should_replace_the_token_for_a_device_on_re_login(): void
    {
        // Without this every re-install leaves a live credential behind that the user
        // cannot see or revoke.
        $user = $this->existingUser();

        foreach ([1, 2] as $ignored) {
            $this->postJson('/api/v1/login', [
                'email' => 'navod@example.com',
                'password' => self::PASSWORD,
                'device_name' => 'pixel-7',
            ])->assertOk();
        }

        $this->assertSame(1, $user->tokens()->where('name', 'pixel-7')->count());
    }

    // M
    public function test_should_keep_other_devices_signed_in_when_one_signs_out(): void
    {
        $user = $this->existingUser();
        $phone = $user->createToken('pixel-7')->plainTextToken;
        $tablet = $user->createToken('ipad')->plainTextToken;

        $this->withToken($phone)->postJson('/api/v1/logout')->assertOk();
        $this->forgetResolvedUser();

        $this->withToken($phone)->getJson('/api/v1/me')->assertUnauthorized();
        $this->forgetResolvedUser();

        $this->withToken($tablet)->getJson('/api/v1/me')->assertOk();
    }

    // M
    public function test_should_revoke_every_device_on_logout_everywhere(): void
    {
        $user = $this->existingUser();
        $phone = $user->createToken('pixel-7')->plainTextToken;
        $tablet = $user->createToken('ipad')->plainTextToken;

        $this->withToken($phone)->postJson('/api/v1/logout-everywhere')->assertOk();
        $this->forgetResolvedUser();

        $this->withToken($tablet)->getJson('/api/v1/me')->assertUnauthorized();
    }

    // Z
    public function test_should_reject_an_unauthenticated_request_for_the_profile(): void
    {
        $this->getJson('/api/v1/me')->assertUnauthorized();
    }
}
