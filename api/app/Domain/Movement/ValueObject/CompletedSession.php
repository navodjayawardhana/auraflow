<?php

namespace App\Domain\Movement\ValueObject;

use App\Domain\Nutrition\ValueObject\CalendarDate;
use DateTimeImmutable;

/**
 * One finished session, reduced to the parts anything outside the movement screen needs.
 *
 * Deliberately not the Eloquent row, for the reason `LoggedMeal` is not either: a client
 * uuid, an id and a heart-rate sample change nothing about "how many sessions did I do
 * this week", and a value that can be written out by hand in a test is a value whose
 * consumers can be tested without a database.
 *
 * `goodFormReps` is nullable and stays nullable. A guided session carries no depth
 * judgement because nothing watched for one, and a null there is the honest form of that
 * -- filling it with `totalReps` would turn an assumption into a grade.
 */
final class CompletedSession
{
    public function __construct(
        public readonly DateTimeImmutable $performedOn,
        public readonly string $exercise,
        public readonly SessionSource $source,
        public readonly int $totalReps,
        public readonly ?int $goodFormReps = null,
        public readonly ?int $durationSeconds = null,
        /** Which of the score's three prescriptions the session was performed under, if any. */
        public readonly ?string $prescribedIntensity = null,
    ) {
    }

    /**
     * `Y-m-d`, the shape the column and every fixture use.
     *
     * Through `CalendarDate` rather than `new DateTimeImmutable`, so a session date and a
     * meal date built in the same request are comparable: two dates naming the same day
     * under two default timezones are not equal, and the bug that produces is a day
     * boundary that moves with the server.
     */
    public static function on(
        string $isoDate,
        string $exercise,
        SessionSource $source,
        int $totalReps,
        ?int $goodFormReps = null,
        ?int $durationSeconds = null,
        ?string $prescribedIntensity = null,
    ): self {
        return new self(
            CalendarDate::fromIso($isoDate),
            $exercise,
            $source,
            $totalReps,
            $goodFormReps,
            $durationSeconds,
            $prescribedIntensity,
        );
    }
}
