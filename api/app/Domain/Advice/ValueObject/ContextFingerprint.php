<?php

namespace App\Domain\Advice\ValueObject;

/**
 * A briefing is a function of the context it was written from, so this is that context's
 * identity — and the only honest answer to "may this advice be rewritten yet".
 *
 * The old rule was that a `ready` brief is never rewritten, on the sound grounds that
 * advice changing under the reader on a reopen is its own kind of broken. The trouble is
 * that a brief written at 07:00 goes on telling someone at 21:00 that they have drunk
 * 250 ml when they have since drunk two litres, and no amount of stability makes that
 * true. A timer would resolve it in the wrong currency: it would rewrite a brief that
 * nothing has changed about, and still miss the day someone logs a night at noon.
 *
 * ## Bucketing is the whole design
 *
 * A fingerprint over raw values is a fingerprint that moves every time somebody taps
 * "+250 ml", and every move is a paid model call. So each input is reduced to the
 * coarseness at which it would change a sentence, and the bucket widths below are the
 * argument:
 *
 *   Water, {@see WATER_BUCKET_ML}.  A quarter of the 2,000 ml default target, and twice
 *     the size of the glass the app logs. At most one tap in two can cross a boundary, and
 *     when one does, "you are a quarter of the way there" really has stopped being true.
 *     Absolute widths rather than a delta from the last brief on purpose: a threshold
 *     measured from wherever the last one happened to land would drift with the day and
 *     make the trigger depend on when the reader first opened the app.
 *
 *   Steps, {@see STEPS_BUCKET}.  Roughly a quarter of a derived step goal. Below this the
 *     trigger would fire on a walk to the kitchen; above it, a genuinely active afternoon
 *     would go unremarked.
 *
 *   Recovery, {@see RECOVERY_BUCKET}.  A score of 62 and a score of 64 do not want
 *     different advice. A score of 62 and a score of 71 do.
 *
 *   Sleep, {@see SLEEP_BUCKET_MINUTES}.  Half an hour is the smallest difference in a
 *     night anybody words differently.
 *
 *   Resting rate, {@see RESTING_HR_BUCKET_BPM}.  Written once a day, so this exists to
 *     absorb a correction rather than a stream.
 *
 * Everything that is a fact rather than a magnitude — the illness flag, whether a step
 * count is complete, whether a score is provisional, how a resting rate was taken — is
 * carried exactly. Those do not have degrees, and each one changes what may be said at all
 * rather than by how much.
 *
 * The day part is in here too, which is what makes the same figures at nine in the evening
 * a different context from the same figures at breakfast. Bucketed to three, so a passing
 * clock is worth at most two rewrites in a day.
 *
 * Pure, and no I/O: the value is a hash of a canonical string, so two contexts that would
 * produce the same advice produce the same short token, and the job can compare what it is
 * about to write against what it already wrote without holding either brief.
 */
final class ContextFingerprint
{
    public const RECOVERY_BUCKET = 5;

    public const SLEEP_BUCKET_MINUTES = 30;

    public const RESTING_HR_BUCKET_BPM = 2;

    public const STEPS_BUCKET = 2000;

    public const WATER_BUCKET_ML = 500;

    public const KCAL_BUCKET = 400;

    /** Weather is scenery, not a measurement, so it moves the brief only in whole seasons of a day. */
    public const TEMPERATURE_BUCKET_C = 5;

    /**
     * Coarser than the day's own buckets, on purpose.
     *
     * The history's only independent mover is a backfill — a night logged late, a day
     * imported — and the question it has to answer is "does the story of the fortnight
     * read differently now", not "did a derived score shift by a point".
     */
    public const HISTORY_RECOVERY_BUCKET = 10;

    public const HISTORY_SLEEP_BUCKET_MINUTES = 60;

    private function __construct(public readonly string $value)
    {
    }

    public static function of(GroundingPack $pack): self
    {
        return new self(hash('sha256', implode('|', self::canonicalParts($pack))));
    }

    /** A value read back off a row, which may predate the column and so be absent. */
    public static function fromStored(?string $value): ?self
    {
        return $value === null || $value === '' ? null : new self($value);
    }

    /**
     * Null never equals anything, including another null.
     *
     * A brief written before this column existed carries no fingerprint, and the truthful
     * reading of that is "we do not know what it was written from" — which is a reason to
     * rewrite it once, not a reason to treat it as current forever.
     */
    public function equals(?self $other): bool
    {
        return $other !== null && hash_equals($this->value, $other->value);
    }

    /**
     * @return list<string>
     */
    private static function canonicalParts(GroundingPack $pack): array
    {
        $today = $pack->today;

        $parts = [
            'date:'.$today->date,
            'part:'.($pack->dayPart?->value ?? 'none'),

            // Facts, carried exactly: each changes what may be said at all.
            'prov:'.($today->recoveryIsProvisional ? '1' : '0'),
            'noscore:'.($today->recoveryUnavailableReason ?? ''),
            'ill:'.($today->illnessWarning ? '1' : '0'),
            'rhrsrc:'.($today->restingHeartRateSource?->value ?? 'none'),
            'stepsfull:'.self::flag($today->stepsAreComplete),

            // Magnitudes, bucketed to the width at which they would change a sentence.
            'rec:'.self::bucket($today->recoveryScore, self::RECOVERY_BUCKET),
            'sleep:'.self::bucket($today->sleepMinutes, self::SLEEP_BUCKET_MINUTES),
            'deep:'.self::flag($today->deepSleepMinutes !== null),
            'rhr:'.self::bucket($today->restingHeartRate, self::RESTING_HR_BUCKET_BPM),
            'steps:'.self::bucket($today->steps, self::STEPS_BUCKET),
            'water:'.self::bucket($today->waterMl, self::WATER_BUCKET_ML),
            'wtarget:'.$today->waterTargetMl,

            'weather:'.($today->weatherDescription ?? ''),
            'temp:'.self::bucket($today->temperatureC, self::TEMPERATURE_BUCKET_C),
            'where:'.($today->locationContext ?? ''),
            'focus:'.($today->bestFocusWindow ?? ''),
        ];

        foreach ($pack->history as $day) {
            $parts[] = 'h:'.$day->date
                .':r'.self::bucket($day->recoveryScore, self::HISTORY_RECOVERY_BUCKET)
                .':s'.self::bucket($day->sleepMinutes, self::HISTORY_SLEEP_BUCKET_MINUTES)
                .':k'.self::bucket($day->kcal, self::KCAL_BUCKET);
        }

        // Counted rather than described. A session logged this afternoon is news; which
        // exercise it was is not the kind of difference that earns a rewrite.
        $parts[] = 'sessions:'.count($pack->sessions);
        $parts[] = 'sessionstoday:'.count(array_filter(
            $pack->sessions,
            static fn ($session): bool => $session->performedOn->format('Y-m-d') === $today->date,
        ));

        if ($pack->targets !== null) {
            // Goals are exact. They move only when the user edits their profile or the plan
            // recalculates, and either is a change the advice should acknowledge at once.
            $parts[] = 'targets:'.$pack->targets->stepGoal
                .':'.$pack->targets->waterMl
                .':'.$pack->targets->sleepNeedHours
                .':'.($pack->targets->activeKcalGoal ?? 'none');
        }

        return $parts;
    }

    /**
     * The bucket index, or a marker that says "not recorded".
     *
     * A missing figure must not collapse onto bucket zero: a day with no step count and a
     * day with four hundred steps are the same integer after division, and they are not
     * the same day. The first time a count arrives should move the fingerprint.
     */
    private static function bucket(int|float|null $value, int $width): string
    {
        return $value === null ? 'x' : (string) (int) floor($value / $width);
    }

    /** Three states, kept apart: unstated provenance is not the same as a stated no. */
    private static function flag(?bool $value): string
    {
        return match ($value) {
            true => '1',
            false => '0',
            null => 'x',
        };
    }
}
