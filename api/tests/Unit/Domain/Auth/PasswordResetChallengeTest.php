<?php

namespace Tests\Unit\Domain\Auth;

use App\Domain\Auth\Exception\InvalidResetCodeException;
use App\Domain\Auth\Model\PasswordResetChallenge;
use App\Domain\Auth\ValueObject\EmailKey;
use App\Domain\Auth\ValueObject\ResetCode;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

/**
 * The rules, without a database or a request in the way.
 *
 * The feature test proves the endpoints behave; this proves the boundaries are where the
 * comments say they are, including the off-by-one at exactly fifteen minutes and exactly
 * five attempts, which is fiddly to reach through HTTP.
 */
class PasswordResetChallengeTest extends TestCase
{
    private function challengeIssuedAt(string $iso): PasswordResetChallenge
    {
        return PasswordResetChallenge::issue('navod@example.com', 'irrelevant-hash', new DateTimeImmutable($iso));
    }

    public function test_should_still_accept_a_code_on_the_last_second_of_its_life(): void
    {
        // The boundary is inclusive. A person typing the last digit as the clock turns
        // should not be told their code expired.
        $challenge = $this->challengeIssuedAt('2026-08-23T10:00:00+00:00');

        $this->assertFalse($challenge->hasExpiredBy(new DateTimeImmutable('2026-08-23T10:15:00+00:00')));
    }

    public function test_should_refuse_a_code_once_past_fifteen_minutes(): void
    {
        // Prevents a code left sitting in an abandoned inbox staying usable indefinitely.
        $challenge = $this->challengeIssuedAt('2026-08-23T10:00:00+00:00');

        $this->assertTrue($challenge->hasExpiredBy(new DateTimeImmutable('2026-08-23T10:15:01+00:00')));
    }

    public function test_should_not_be_exhausted_before_the_fifth_failure(): void
    {
        // Prevents an over-eager bound locking someone out on a typo or two.
        $challenge = $this->challengeIssuedAt('2026-08-23T10:00:00+00:00');

        for ($guess = 1; $guess < PasswordResetChallenge::MAX_ATTEMPTS; $guess++) {
            $challenge->recordFailure();
            $this->assertFalse($challenge->isExhausted(), "exhausted after $guess failure(s)");
        }
    }

    public function test_should_be_exhausted_on_the_fifth_failure(): void
    {
        // Prevents six digits being walked: one million possibilities is only safe while
        // the number of guesses is bounded.
        $challenge = $this->challengeIssuedAt('2026-08-23T10:00:00+00:00');

        for ($guess = 0; $guess < PasswordResetChallenge::MAX_ATTEMPTS; $guess++) {
            $challenge->recordFailure();
        }

        $this->assertTrue($challenge->isExhausted());
    }

    public function test_should_carry_the_attempt_count_back_from_storage(): void
    {
        // Prevents the bound being reset by a server restart or a second process: the
        // count is durable, and restoring must not quietly zero it.
        $challenge = PasswordResetChallenge::restore(
            'navod@example.com',
            'irrelevant-hash',
            new DateTimeImmutable('2026-08-23T10:00:00+00:00'),
            PasswordResetChallenge::MAX_ATTEMPTS - 1,
        );

        $challenge->recordFailure();

        $this->assertTrue($challenge->isExhausted());
    }

    public function test_should_generate_a_six_digit_code_including_leading_zeros(): void
    {
        // Prevents the classic bug where a numeric code loses its leading zero and the
        // user is handed five digits the server will never match.
        for ($draw = 0; $draw < 200; $draw++) {
            $this->assertMatchesRegularExpression('/^\d{6}$/', ResetCode::generate()->toString());
        }
    }

    public function test_should_refuse_a_code_that_is_not_six_digits(): void
    {
        // Prevents anything but a code reaching the hash comparison.
        $this->expectException(InvalidResetCodeException::class);

        ResetCode::fromString('12345a');
    }

    public function test_should_key_an_address_the_same_however_it_is_capitalised(): void
    {
        // Prevents an attacker buying a second five-guess budget by changing the case of
        // a letter, which would make the bound meaningless.
        $this->assertSame(
            EmailKey::normalise('navod@example.com'),
            EmailKey::normalise('  Navod@Example.COM  '),
        );
    }
}
