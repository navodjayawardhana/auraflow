<?php

namespace App\Infrastructure\Auth;

use App\Domain\Auth\Service\ResetCodeHasher;
use App\Domain\Auth\ValueObject\ResetCode;
use Illuminate\Support\Facades\Hash;

/**
 * The configured password hasher, reused for reset codes.
 *
 * Bcrypt for a six-digit number looks like overkill until you notice what it buys: an
 * offline attacker holding a database dump cannot precompute a million digests in a
 * second, and `password_verify` compares in constant time so the check leaks nothing
 * about how many leading digits were right. A plain SHA of six digits is a rainbow table
 * you could write on a napkin.
 *
 * The cost factor is BCRYPT_ROUNDS, shared with account passwords, so it is already tuned
 * for this machine and already lowered to 4 under phpunit.
 */
final class HashedResetCodeHasher implements ResetCodeHasher
{
    public function hash(ResetCode $code): string
    {
        return Hash::make($code->toString());
    }

    public function matches(ResetCode $code, string $hash): bool
    {
        return Hash::check($code->toString(), $hash);
    }
}
