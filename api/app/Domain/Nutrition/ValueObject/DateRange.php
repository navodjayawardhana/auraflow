<?php

namespace App\Domain\Nutrition\ValueObject;

use DateTimeImmutable;
use InvalidArgumentException;

/** An inclusive span of calendar days. Both ends count — the last day is a day you ate. */
final class DateRange
{
    public function __construct(
        public readonly DateTimeImmutable $from,
        public readonly DateTimeImmutable $to,
    ) {
        if ($to < $from) {
            throw new InvalidArgumentException('A range cannot end before it starts.');
        }
    }

    public static function of(string $fromIso, string $toIso): self
    {
        return new self(CalendarDate::fromIso($fromIso), CalendarDate::fromIso($toIso));
    }

    /** One day, which is the whole range for the day view. */
    public static function ofDay(string $isoDate): self
    {
        return self::of($isoDate, $isoDate);
    }

    public function contains(DateTimeImmutable $date): bool
    {
        return $date >= $this->from && $date <= $this->to;
    }

    public function lengthInDays(): int
    {
        return (int) $this->from->diff($this->to)->format('%a') + 1;
    }

    /** The overlap with another range, or null when they do not touch. */
    public function intersect(self $other): ?self
    {
        $from = max($this->from, $other->from);
        $to = min($this->to, $other->to);

        return $to < $from ? null : new self($from, $to);
    }

    public function fromIso(): string
    {
        return CalendarDate::toIso($this->from);
    }

    public function toIso(): string
    {
        return CalendarDate::toIso($this->to);
    }
}
