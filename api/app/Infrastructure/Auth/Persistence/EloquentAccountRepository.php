<?php

namespace App\Infrastructure\Auth\Persistence;

use App\Domain\Auth\Repository\AccountRepository;
use App\Models\User;

final class EloquentAccountRepository implements AccountRepository
{
    /**
     * Matched case-insensitively, and that is not merely a kindness to people who
     * capitalise their own name.
     *
     * The challenge is keyed by a lower-cased address (see EmailKey), so looking the
     * account up with a plain `where('email', ...)` would silently miss on SQLite --
     * which is case-sensitive where MySQL's default collation is not -- and the reset
     * would fail in development while working in production, or the reverse. Comparing
     * `LOWER(email)` behaves the same on both. The index cost is irrelevant on a path
     * that runs twice per reset.
     */
    public function findIdByEmail(string $email): ?int
    {
        $id = User::query()
            ->whereRaw('LOWER(email) = ?', [mb_strtolower($email)])
            ->value('id');

        return $id === null ? null : (int) $id;
    }

    /**
     * Set on the model and saved, never `update(['password' => Hash::make(...)])`.
     *
     * The `hashed` cast on User is the single place a password becomes a digest, exactly
     * as AuthController::register relies on. A mass update goes round the cast, and the
     * failure mode is a plaintext password sitting in the users table that still lets
     * nobody sign in -- silent, and discovered by whoever dumps the table.
     */
    public function replacePassword(int $userId, string $newPassword): void
    {
        $user = User::query()->findOrFail($userId);

        $user->password = $newPassword;
        $user->save();
    }

    /**
     * The one implementation of "sign this account out everywhere".
     *
     * AuthController::logoutEverywhere calls this too. Two copies of a one-line token
     * delete would look harmless right up to the day one of them learns about a second
     * credential type and the other does not -- and the copy that forgets is the one
     * behind the password reset, where a surviving token defeats the entire flow.
     */
    public function revokeAllSessions(int $userId): void
    {
        User::query()->findOrFail($userId)->tokens()->delete();
    }
}
