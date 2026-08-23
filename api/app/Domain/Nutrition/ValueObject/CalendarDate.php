<?php

namespace App\Domain\Nutrition\ValueObject;

use DateTimeImmutable;
use DateTimeZone;
use InvalidArgumentException;

/**
 * `Y-m-d` in, midnight out — and always in the same zone.
 *
 * Nutrition history is bucketed by calendar day, so every date the aggregator handles has
 * to be comparable to every other one. Building them through here rather than through
 * `new DateTimeImmutable(...)` at a dozen call sites is what guarantees that: a date built
 * under one default timezone and a date built under another are not equal even when they
 * name the same day, and the bug that produces is a week boundary that moves depending on
 * where the server is running.
 *
 * UTC is a bookkeeping choice, not a claim about when anyone ate. The zone that matters is
 * already baked into `eaten_on` by the client that wrote it.
 */
final class CalendarDate
{
    public static function zone(): DateTimeZone
    {
        return new DateTimeZone('UTC');
    }

    public static function fromIso(string $isoDate): DateTimeImmutable
    {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $isoDate, self::zone());

        // The round trip is the real check. `createFromFormat` accepts the 32nd of a month
        // and quietly rolls it into the next one, so a typo would become a valid date
        // several buckets away from the one intended rather than an error.
        if ($date === false || $date->format('Y-m-d') !== $isoDate) {
            throw new InvalidArgumentException("Not a calendar date: {$isoDate}");
        }

        return $date;
    }

    public static function toIso(DateTimeImmutable $date): string
    {
        return $date->format('Y-m-d');
    }
}
