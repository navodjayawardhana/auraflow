<?php

namespace App\Infrastructure\Auth\Persistence;

use App\Domain\Auth\Model\PasswordResetChallenge;
use App\Domain\Auth\Repository\PasswordResetChallengeRepository;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Backed by Laravel's own `password_reset_tokens` table, plus one added column.
 *
 * "Database" rather than "Eloquent" in the name, unlike its siblings, because there is no
 * model here and deliberately so: giving a credential store an Eloquent model invites it
 * into `with()` chains, factories and API resources, none of which should ever be able to
 * reach a reset token. The query builder keeps it reachable only from this file.
 *
 * The table shipped with three columns -- email (primary), token, created_at -- which is
 * two thirds of what a bounded code needs. `attempts` was added by migration rather than
 * by editing the users migration, and it is the only change: the primary key on `email`
 * already gives the "at most one outstanding challenge per address" rule for free, and
 * `token` is a string wide enough for a bcrypt digest.
 *
 * Every lookup here is by email. That is worth saying out loud given the trap documented
 * at the foot of DailyBriefController: `where('col', $date)` against a cast-written
 * `Y-m-d 00:00:00` matches nothing, and it has bitten this codebase twice. Expiry is
 * decided in PasswordResetChallenge by comparing timestamps in PHP, so no date ever
 * appears in a where clause and the trap has no surface to bite.
 */
final class DatabasePasswordResetChallengeRepository implements PasswordResetChallengeRepository
{
    private const TABLE = 'password_reset_tokens';

    public function findFor(string $email): ?PasswordResetChallenge
    {
        $row = DB::table(self::TABLE)->where('email', $email)->first();

        if ($row === null) {
            return null;
        }

        return PasswordResetChallenge::restore(
            (string) $row->email,
            (string) $row->token,
            // Parsed rather than cast: the driver hands back a string on SQLite and a
            // string on MySQL, and CarbonImmutable is a DateTimeImmutable, which is all
            // the domain asked for.
            CarbonImmutable::parse($row->created_at),
            (int) ($row->attempts ?? 0),
        );
    }

    public function save(PasswordResetChallenge $challenge): void
    {
        // `updateOrInsert` matched on the primary key, which is what enforces one live
        // challenge per address: asking for a second code overwrites the first rather
        // than stacking beside it.
        DB::table(self::TABLE)->updateOrInsert(
            ['email' => $challenge->email()],
            [
                'token' => $challenge->codeHash(),
                'attempts' => $challenge->failedAttempts(),
                'created_at' => $challenge->issuedAt(),
            ],
        );
    }

    public function forget(string $email): void
    {
        DB::table(self::TABLE)->where('email', $email)->delete();
    }
}
