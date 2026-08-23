<?php

namespace App\Application\Auth\UseCase;

use App\Domain\Auth\Model\PasswordResetChallenge;
use App\Domain\Auth\Repository\AccountRepository;
use App\Domain\Auth\Repository\PasswordResetChallengeRepository;
use App\Domain\Auth\Service\ResetCodeHasher;
use App\Domain\Auth\Service\ResetCodeNotifier;
use App\Domain\Auth\ValueObject\EmailKey;
use App\Domain\Auth\ValueObject\ResetCode;
use Carbon\CarbonImmutable;

/**
 * Issue a code to an address, and say nothing about whether anyone lives there.
 *
 * The return type is the security property: `void`. There is no branch a caller could
 * inspect, no exception for "unknown address" and no boolean to accidentally surface in
 * a response body. AuthController::forgotPassword therefore *cannot* answer differently
 * for a registered and an unregistered address even if someone later edits it carelessly
 * -- it has nothing to answer differently about.
 *
 * The same reasoning already governs AuthController::login, which returns one message for
 * "no such account" and "wrong password". A reset form that helpfully said "we don't know
 * that address" would hand back the enumeration oracle the login form refuses to be.
 */
final class RequestPasswordResetUseCase
{
    public function __construct(
        private readonly AccountRepository $accounts,
        private readonly PasswordResetChallengeRepository $challenges,
        private readonly ResetCodeHasher $hasher,
        private readonly ResetCodeNotifier $notifier,
    ) {
    }

    public function execute(string $email): void
    {
        $email = EmailKey::normalise($email);

        $userId = $this->accounts->findIdByEmail($email);

        // No account, no mail, no challenge, no complaint. Note that the work skipped here
        // is also the *slow* work -- a bcrypt hash and an SMTP round trip -- so a patient
        // attacker could in principle time the difference. Mitigated by the rate limiter
        // rather than by padding: five attempts per quarter hour is not enough samples to
        // pull a signal out of network jitter.
        if ($userId === null) {
            return;
        }

        $code = ResetCode::generate();

        // Saved before the mail is sent. The other order loses the race where delivery
        // succeeds and the write then fails, which leaves a person holding a code the
        // server has never heard of.
        $this->challenges->save(PasswordResetChallenge::issue(
            $email,
            $this->hasher->hash($code),
            CarbonImmutable::now(),
        ));

        // Asking again simply replaces the stored challenge, so "resend" is this same path
        // and the person never has to start the flow over. The old code stops working the
        // instant the new one is written, which is what keeps a resend from widening the
        // guessable set.
        $this->notifier->send($email, $code, PasswordResetChallenge::TTL_MINUTES);
    }
}
