<?php

namespace App\Domain\Auth\Repository;

/**
 * The three things a password reset needs to do to an account, and nothing else.
 *
 * Narrow on purpose. A reset must be able to find an account, replace its password and
 * end its sessions; it has no business reading a name, an email verification state or a
 * health snapshot, and an interface that offered those would eventually be used for them.
 */
interface AccountRepository
{
    /**
     * Null when nobody has registered that address.
     *
     * The caller must not turn that null into a different response than a hit -- see
     * RequestPasswordResetUseCase.
     */
    public function findIdByEmail(string $email): ?int;

    /** Takes the password in the clear; hashing is the implementation's job, not the caller's. */
    public function replacePassword(int $userId, string $newPassword): void;

    /**
     * Ends every session on every device.
     *
     * Someone resetting a password is quite often doing it *because* the account is
     * compromised. Leaving the attacker's token alive would make the whole exercise
     * theatre, so this is not optional politeness -- it is the point.
     */
    public function revokeAllSessions(int $userId): void;
}
