<?php

namespace App\Application\Auth\UseCase;

use App\Domain\Auth\Exception\InvalidResetCodeException;
use App\Domain\Auth\Exception\PasswordResetFailedException;
use App\Domain\Auth\Repository\AccountRepository;
use App\Domain\Auth\Repository\PasswordResetChallengeRepository;
use App\Domain\Auth\Service\ResetCodeHasher;
use App\Domain\Auth\ValueObject\EmailKey;
use App\Domain\Auth\ValueObject\ResetCode;
use Carbon\CarbonImmutable;

/**
 * Check the code and set the new password, in one call.
 *
 * Deliberately not split into "verify the code" and "then set a password", which is the
 * shape most reset flows take. A separate verify endpoint has to do one of two things
 * with the code, and both are worse: consume it, leaving the second call nothing to
 * authenticate with beyond a ticket that is now the real credential; or not consume it,
 * in which case it is a free oracle that says yes or no to a guess and has to be given
 * its own attempt budget on top of this one. Two budgets over one secret is how the
 * five-guess bound becomes ten. One call, one budget, one consumption point.
 *
 * The mobile flow still shows two screens -- ask for a code, then enter it -- because
 * that is a rendering choice. It just submits once.
 */
final class ResetPasswordUseCase
{
    public function __construct(
        private readonly AccountRepository $accounts,
        private readonly PasswordResetChallengeRepository $challenges,
        private readonly ResetCodeHasher $hasher,
    ) {
    }

    /**
     * @return int the id of the account whose password was replaced, so the caller can
     *             mint a session for it
     *
     * @throws PasswordResetFailedException
     */
    public function execute(string $email, string $submittedCode, string $newPassword): int
    {
        $email = EmailKey::normalise($email);
        $now = CarbonImmutable::now();

        $challenge = $this->challenges->findFor($email);

        // Nothing outstanding. Reported as a wrong code rather than as "you never asked",
        // because the latter answers a question about the address.
        if ($challenge === null) {
            throw PasswordResetFailedException::codeIsWrong();
        }

        // Expiry is checked before the code is compared, so a stale code costs an attempt
        // from nobody's budget -- and so the person is told to ask for a new one instead of
        // burning their five guesses on a code that could never have worked.
        if ($challenge->hasExpiredBy($now)) {
            $this->challenges->forget($email);

            throw PasswordResetFailedException::codeHasExpired();
        }

        if (! $this->matchesStoredCode($submittedCode, $challenge->codeHash())) {
            $challenge->recordFailure();

            // Consumed on the last permitted failure, not merely refused. Leaving the row
            // behind in a locked state would either expire into a fresh guessing window or
            // let anyone who knows an address keep its owner locked out of resetting.
            if ($challenge->isExhausted()) {
                $this->challenges->forget($email);

                throw PasswordResetFailedException::tooManyAttempts();
            }

            $this->challenges->save($challenge);

            throw PasswordResetFailedException::codeIsWrong();
        }

        $userId = $this->accounts->findIdByEmail($email);

        // A challenge outliving its account -- deleted between request and reset -- is not
        // a case worth a distinct message, but it is worth clearing up after.
        if ($userId === null) {
            $this->challenges->forget($email);

            throw PasswordResetFailedException::codeIsWrong();
        }

        $this->accounts->replacePassword($userId, $newPassword);

        // Every existing session dies here, *before* the caller issues a new token, so the
        // token the caller mints is the only one alive. An attacker sitting on a stolen
        // token is signed out by the same act that locks them out of the password.
        $this->accounts->revokeAllSessions($userId);

        // Single use. Consumed on success as firmly as on exhaustion, so a code read from
        // a shared inbox cannot be replayed by the second reader.
        $this->challenges->forget($email);

        return $userId;
    }

    /**
     * A code that is not even six digits is a failed guess, not a server error.
     *
     * The form request rejects malformed input long before this, so reaching the catch
     * means something bypassed the boundary -- and the safe reading of that is "wrong",
     * which costs an attempt, rather than "exception", which would not.
     */
    private function matchesStoredCode(string $submitted, string $storedHash): bool
    {
        try {
            $code = ResetCode::fromString($submitted);
        } catch (InvalidResetCodeException) {
            return false;
        }

        return $this->hasher->matches($code, $storedHash);
    }
}
