<?php

namespace App\Domain\Advice\ValueObject;

/**
 * Which third of the day the advice is being written in.
 *
 * Advice at breakfast and advice at nine in the evening are different genres: one is about
 * how to spend a day, the other about how to close one. A briefing that does not know
 * which it is writing will always write the first, and by evening that reads as an app
 * that has not noticed the day happened.
 *
 * Three parts rather than an hour, because the hour is not the thing the wording turns on
 * and because this feeds the fingerprint: bucketing to three caps the rewrites a passing
 * clock can cause at two for the whole day.
 */
enum DayPart: string
{
    case Morning = 'morning';

    case Afternoon = 'afternoon';

    case Evening = 'evening';

    /**
     * The boundaries are the ones the advice turns on rather than any clock convention.
     * Noon is when "plan your day" stops being useful, and five is when "there is still
     * time to" stops being true.
     */
    public static function fromHour(int $hour): self
    {
        return match (true) {
            $hour < 12 => self::Morning,
            $hour < 17 => self::Afternoon,
            default => self::Evening,
        };
    }

    /** How the prompt says it, so the wording lives beside the boundaries that decide it. */
    public function describe(): string
    {
        return match ($this) {
            self::Morning => 'It is the morning; the day is still ahead of them.',
            self::Afternoon => 'It is the afternoon; part of the day is already spent.',
            self::Evening => 'It is the evening; the day is nearly over, so advice about how to '
                .'spend it is largely too late. Prefer what tonight and tomorrow can still change.',
        };
    }
}
