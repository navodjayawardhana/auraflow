<?php

namespace App\Domain\Auth\Repository;

use App\Domain\Auth\Model\PasswordResetChallenge;

/**
 * At most one outstanding challenge per address.
 *
 * That is a rule, not an implementation detail: asking for a second code must retire the
 * first, otherwise every "resend" tap widens the set of codes an attacker may guess and
 * the five-attempt bound quietly becomes five per code rather than five per reset.
 */
interface PasswordResetChallengeRepository
{
    public function findFor(string $email): ?PasswordResetChallenge;

    /** Replaces any challenge already held for the same address. */
    public function save(PasswordResetChallenge $challenge): void;

    public function forget(string $email): void;
}
