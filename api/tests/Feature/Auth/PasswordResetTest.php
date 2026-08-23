<?php

namespace Tests\Feature\Auth;

use App\Domain\Auth\Model\PasswordResetChallenge;
use App\Infrastructure\Auth\Mail\PasswordResetCodeMail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Forgotten passwords, end to end.
 *
 * Every test here names the thing it prevents rather than the thing it does, because this
 * is the one flow in the app where a regression hands over an account. A test called
 * "resets the password" tells the next person nothing about why the assertion below it
 * cannot be relaxed.
 */
class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    private const OLD_PASSWORD = 'zephyr-quartz-lantern-92';

    private const NEW_PASSWORD = 'sandpiper-vellum-thistle-41';

    private const EMAIL = 'navod@example.com';

    protected function setUp(): void
    {
        parent::setUp();

        // CACHE_STORE is `array` under phpunit, so the rate limiter starts empty for each
        // test without any clearing of its own.
        Mail::fake();
    }

    private function existingUser(string $email = self::EMAIL): User
    {
        return User::factory()->create([
            'email' => $email,
            'password' => Hash::make(self::OLD_PASSWORD),
        ]);
    }

    /**
     * Ask for a code and read the one the server actually generated.
     *
     * There is no other way to learn it -- which is the point of the design, and the
     * reason PasswordResetCodeMail exposes the code as a property.
     */
    private function requestCodeFor(string $email = self::EMAIL): string
    {
        $this->postJson('/api/v1/password/forgot', ['email' => $email])->assertStatus(202);

        $code = null;
        Mail::assertSent(PasswordResetCodeMail::class, function (PasswordResetCodeMail $mail) use (&$code) {
            $code = $mail->code;

            return true;
        });

        $this->assertNotNull($code, 'no reset code was mailed');

        return $code;
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function submitReset(array $overrides = []): TestResponse
    {
        return $this->postJson('/api/v1/password/reset', array_merge([
            'email' => self::EMAIL,
            'code' => '000000',
            'password' => self::NEW_PASSWORD,
            'password_confirmation' => self::NEW_PASSWORD,
        ], $overrides));
    }

    /**
     * Drop the guard's cached user between requests -- see the note on the same helper in
     * AuthenticationTest. Without it a token revoked mid-test still appears to work, which
     * is precisely the assertion that matters here.
     */
    private function forgetResolvedUser(): void
    {
        $this->app['auth']->forgetGuards();
    }

    // --- Slice A: the request must not answer questions about who has an account ---

    // I
    public function test_should_answer_a_request_for_an_unknown_address_identically(): void
    {
        // Prevents account enumeration. A reset form that says "we don't know that
        // address" is a free membership list, and it would undo the care AuthController's
        // login path already takes to give one message for both failures.
        $this->existingUser();

        $known = $this->postJson('/api/v1/password/forgot', ['email' => self::EMAIL]);
        $unknown = $this->postJson('/api/v1/password/forgot', ['email' => 'nobody@example.com']);

        $this->assertSame($known->status(), $unknown->status());
        $this->assertSame($known->json(), $unknown->json());
        $this->assertSame($known->getContent(), $unknown->getContent());
    }

    // Z
    public function test_should_send_no_mail_at_all_for_an_unknown_address(): void
    {
        // Prevents the enumeration oracle moving from the response body into the outbox:
        // a bounce, a delivery receipt or a mail server log would answer the same question
        // the endpoint refuses to.
        $this->postJson('/api/v1/password/forgot', ['email' => 'nobody@example.com'])->assertStatus(202);

        Mail::assertNothingSent();
    }

    // --- Slice B: what a stolen database gives an attacker ---

    // I
    public function test_should_store_the_code_hashed_rather_than_in_the_clear(): void
    {
        // Prevents a database dump -- a backup on a laptop, a leaked snapshot -- from
        // being a set of working reset codes for every account mid-reset.
        $this->existingUser();
        $code = $this->requestCodeFor();

        $stored = DB::table('password_reset_tokens')->where('email', self::EMAIL)->first();

        $this->assertNotSame($code, $stored->token);
        $this->assertStringNotContainsString($code, $stored->token);
        $this->assertTrue(Hash::check($code, $stored->token), 'the stored digest is not this code');
    }

    // --- Slice C: the code is short-lived and single-use ---

    // B
    public function test_should_refuse_a_code_older_than_fifteen_minutes(): void
    {
        // Prevents a code sitting in an abandoned or later-compromised inbox from staying
        // a live key to the account.
        $this->existingUser();
        $code = $this->requestCodeFor();

        $this->travel(PasswordResetChallenge::TTL_MINUTES + 1)->minutes();

        $this->submitReset(['code' => $code])
            ->assertStatus(422)
            ->assertJsonValidationErrors('code');

        $this->assertDatabaseMissing('password_reset_tokens', ['email' => self::EMAIL]);
    }

    // I
    public function test_should_refuse_to_use_the_same_code_twice(): void
    {
        // Prevents replay. A code read over a shoulder, or by the second reader of a
        // shared inbox, must be spent the moment it works once.
        $this->existingUser();
        $code = $this->requestCodeFor();

        $this->submitReset(['code' => $code])->assertOk();

        $this->submitReset([
            'code' => $code,
            'password' => 'another-passphrase-entirely-77',
            'password_confirmation' => 'another-passphrase-entirely-77',
        ])->assertStatus(422)->assertJsonValidationErrors('code');
    }

    // --- Slice D: six digits cannot be walked ---

    // B
    public function test_should_destroy_the_code_after_five_wrong_guesses(): void
    {
        // Prevents brute force. Six digits is a million possibilities; unbounded, a script
        // finishes in minutes. On the fifth failure the challenge is destroyed, not merely
        // refused -- so even the *correct* code stops working and the person must ask for
        // a new one.
        $this->existingUser();
        $code = $this->requestCodeFor();

        for ($guess = 0; $guess < PasswordResetChallenge::MAX_ATTEMPTS; $guess++) {
            $this->submitReset(['code' => $this->aWrongCode($code)])
                ->assertStatus(422)
                ->assertJsonValidationErrors('code');
        }

        $this->assertDatabaseMissing('password_reset_tokens', ['email' => self::EMAIL]);

        $this->submitReset(['code' => $code])->assertStatus(422);

        // And the account is untouched by all of it.
        $this->postJson('/api/v1/login', ['email' => self::EMAIL, 'password' => self::OLD_PASSWORD])
            ->assertOk();
    }

    // I
    public function test_should_not_let_a_changed_capitalisation_buy_a_second_budget(): void
    {
        // Prevents the bound being sidestepped: if "Navod@Example.com" held its own
        // challenge row, an attacker would get five fresh guesses per spelling.
        $this->existingUser();
        $code = $this->requestCodeFor();

        for ($guess = 0; $guess < PasswordResetChallenge::MAX_ATTEMPTS - 1; $guess++) {
            $this->submitReset(['email' => 'NAVOD@Example.COM', 'code' => $this->aWrongCode($code)])
                ->assertStatus(422);
        }

        // One budget, shared: the fifth failure lands whichever spelling spends it.
        $this->submitReset(['code' => $this->aWrongCode($code)])->assertStatus(422);

        $this->assertDatabaseMissing('password_reset_tokens', ['email' => self::EMAIL]);
    }

    // --- Slice E: both endpoints are rate limited ---

    // B
    public function test_should_throttle_repeated_requests_for_a_code(): void
    {
        // Prevents using the reset form as a mail bomb, and prevents an attacker
        // invalidating a code the owner is halfway through typing by spamming new ones.
        $this->existingUser();

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/v1/password/forgot', ['email' => self::EMAIL])->assertStatus(202);
        }

        $this->postJson('/api/v1/password/forgot', ['email' => self::EMAIL])
            ->assertStatus(429)
            ->assertJsonValidationErrors('email');
    }

    // B
    public function test_should_throttle_repeated_attempts_to_spend_a_code(): void
    {
        // The backstop behind the per-code counter: prevents an attacker burning a code,
        // asking for another and continuing indefinitely from the same place.
        $this->existingUser();
        $this->requestCodeFor();

        for ($attempt = 0; $attempt < 10; $attempt++) {
            $this->submitReset(['code' => '111111'])->assertStatus(422);
        }

        $this->submitReset(['code' => '111111'])
            ->assertStatus(429)
            ->assertJsonValidationErrors('code');
    }

    // I
    public function test_should_not_spend_the_login_throttle_budget(): void
    {
        // Prevents the worst possible coupling: five failed sign-ins are exactly when
        // somebody reaches for "forgot password", and a shared bucket would refuse them.
        $this->existingUser();

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/v1/login', ['email' => self::EMAIL, 'password' => 'wrong']);
        }

        $this->postJson('/api/v1/login', ['email' => self::EMAIL, 'password' => 'wrong'])
            ->assertStatus(429);

        $this->postJson('/api/v1/password/forgot', ['email' => self::EMAIL])->assertStatus(202);
    }

    // --- Slice F: a reset ends every other session ---

    // M
    public function test_should_revoke_every_existing_token_on_a_successful_reset(): void
    {
        // Prevents the whole exercise being theatre. Someone resets a password *because*
        // the account is compromised; leaving the attacker's token alive means they never
        // lost access.
        $user = $this->existingUser();
        $attackerToken = $user->createToken('attacker-laptop')->plainTextToken;
        $ownersOtherDevice = $user->createToken('ipad')->plainTextToken;

        $code = $this->requestCodeFor();
        $fresh = $this->submitReset(['code' => $code, 'device_name' => 'pixel-7'])->assertOk();

        $this->forgetResolvedUser();
        $this->withToken($attackerToken)->getJson('/api/v1/me')->assertUnauthorized();

        $this->forgetResolvedUser();
        $this->withToken($ownersOtherDevice)->getJson('/api/v1/me')->assertUnauthorized();

        // The token minted by the reset itself is issued after the revocation, so it is
        // the one session left standing.
        $this->forgetResolvedUser();
        $this->withToken($fresh->json('data.token'))->getJson('/api/v1/me')->assertOk();
    }

    // --- Slice G: the new password is held to the registration policy ---

    // B
    public function test_should_reject_a_new_password_the_registration_form_would_reject(): void
    {
        // Prevents the reset path becoming the weak door. Two copies of a password policy
        // is how one of them ends up laxer, and it is always the one nobody demos.
        $this->existingUser();
        $code = $this->requestCodeFor();

        $this->submitReset(['code' => $code, 'password' => 'short1!', 'password_confirmation' => 'short1!'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('password');

        // Same policy, same rejection, from the other form.
        $this->postJson('/api/v1/register', [
            'name' => 'Someone',
            'email' => 'someone@example.com',
            'password' => 'short1!',
            'password_confirmation' => 'short1!',
        ])->assertStatus(422)->assertJsonValidationErrors('password');
    }

    // B
    public function test_should_reject_a_new_password_that_is_not_confirmed(): void
    {
        // Prevents locking someone out of their own account with a typo they never saw.
        $this->existingUser();
        $code = $this->requestCodeFor();

        $this->submitReset(['code' => $code, 'password_confirmation' => 'something-else-entirely'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('password');
    }

    // --- Slice H: nothing secret reaches the log ---

    // I
    public function test_should_write_neither_the_code_nor_the_password_to_the_log(): void
    {
        // Prevents a secret leaking into a file that is routinely tailed, shared in a bug
        // report and shipped off the box by a log collector. The mail transport is faked
        // here, so anything the log received would have come from the application itself.
        $this->existingUser();
        Log::spy();

        $code = $this->requestCodeFor();
        $this->submitReset(['code' => $code])->assertOk();

        foreach (['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug', 'log'] as $level) {
            Log::shouldNotHaveReceived($level);
        }
    }

    // I
    public function test_should_never_return_the_code_or_the_password_in_a_response(): void
    {
        // Prevents the code travelling back over the wire, where it would be readable by
        // anything sitting in front of the API and would make the mail step pointless.
        $this->existingUser();
        $code = $this->requestCodeFor();

        $requestBody = $this->postJson('/api/v1/password/forgot', ['email' => self::EMAIL])->getContent();
        $resetBody = $this->submitReset(['code' => $code])->getContent();

        $this->assertStringNotContainsString($code, $requestBody);
        $this->assertStringNotContainsString($code, $resetBody);
        $this->assertStringNotContainsString(self::NEW_PASSWORD, $resetBody);
    }

    // --- Slice I: the flow actually works ---

    // S
    public function test_should_reset_the_password_and_sign_the_user_in(): void
    {
        $this->existingUser();
        $code = $this->requestCodeFor();

        $response = $this->submitReset(['code' => $code, 'device_name' => 'pixel-7'])
            ->assertOk()
            ->assertJsonStructure(['data' => ['user' => ['id', 'name', 'email'], 'token']]);

        $this->postJson('/api/v1/login', ['email' => self::EMAIL, 'password' => self::NEW_PASSWORD])
            ->assertOk();

        // The token is only real if it opens an authenticated route. Asserted last, and
        // deliberately so: a request that authenticates with Sanctum leaves that guard as
        // the application's default for the rest of the test, and `Auth::attempt` on a
        // token guard is a fatal. Production boots per request and never sees this, so the
        // ordering compensates for the harness rather than for the application.
        $this->withToken($response->json('data.token'))
            ->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.email', self::EMAIL);
    }

    // I
    public function test_should_stop_the_old_password_working_after_a_reset(): void
    {
        // Prevents the reset appearing to succeed while leaving the previous credential
        // live -- the failure mode a mass update that bypasses the hashing cast produces.
        $this->existingUser();
        $code = $this->requestCodeFor();

        $this->submitReset(['code' => $code])->assertOk();

        $this->postJson('/api/v1/login', ['email' => self::EMAIL, 'password' => self::OLD_PASSWORD])
            ->assertStatus(422);
    }

    // M
    public function test_should_let_a_new_code_be_requested_without_starting_over(): void
    {
        // The "didn't get it, send another" path. The replacement must work and the
        // superseded code must not -- otherwise every resend widens the set of codes an
        // attacker may guess and the five-attempt bound stops meaning anything.
        $this->existingUser();

        $first = $this->requestCodeFor();
        Mail::fake();
        $second = $this->requestCodeFor();

        $this->assertNotSame($first, $second);

        $this->submitReset(['code' => $first])->assertStatus(422);
        $this->submitReset(['code' => $second])->assertOk();
    }

    /** A code guaranteed to be wrong, so a lucky draw can never make a test flaky. */
    private function aWrongCode(string $realCode): string
    {
        return $realCode === '000000' ? '111111' : '000000';
    }
}
