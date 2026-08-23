<?php

namespace App\Domain\Wellbeing\Model;

use App\Domain\Wellbeing\ValueObject\RestingHeartRate;
use App\Domain\Wellbeing\ValueObject\SleepSummary;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * One user's health signals for one day.
 *
 * Sleep and resting heart rate are both nullable because a device can report either
 * without the other -- the watch may be worn overnight but not charged, or worn by day
 * and removed at night. The components of the recovery score degrade independently by
 * design, so a snapshot with only half the picture is valid data, not a broken record.
 */
final class DailyHealthSnapshot
{
    private function __construct(
        private readonly UserId $userId,
        private readonly DateTimeImmutable $date,
        private ?SleepSummary $sleep,
        private ?RestingHeartRate $restingHeartRate,
        // Plain nullable integers rather than value objects, unlike sleep and heart rate.
        // Those two carry physiological rules the domain has to enforce -- a night of
        // forty minutes is not sleep, a rate of 500 is not a pulse. A step count has no
        // equivalent invariant beyond "not negative", so wrapping it would be ceremony
        // without a rule to justify it; the range check lives at the HTTP boundary.
        private ?int $steps = null,
        // Whether that count covers the whole day or only the part a phone was watching.
        // It travels with the count because it changes what the count means: iOS reads
        // the operating system's pedometer history and answers for the day, Android can
        // only report what it saw while foregrounded. Anything deriving a target from
        // these numbers has to be able to tell the two apart.
        private ?bool $stepsAreComplete = null,
        private ?int $waterMl = null,
    ) {
    }

    public static function record(
        UserId $userId,
        DateTimeImmutable $date,
        ?SleepSummary $sleep = null,
        ?RestingHeartRate $restingHeartRate = null,
        ?int $steps = null,
        ?bool $stepsAreComplete = null,
        ?int $waterMl = null,
    ): self {
        return new self(
            $userId,
            $date->setTime(0, 0),
            $sleep,
            $restingHeartRate,
            $steps,
            $stepsAreComplete,
            $waterMl,
        );
    }

    /** Rebuild from storage without re-running creation rules. */
    public static function reconstitute(
        UserId $userId,
        DateTimeImmutable $date,
        ?SleepSummary $sleep,
        ?RestingHeartRate $restingHeartRate,
        ?int $steps = null,
        ?bool $stepsAreComplete = null,
        ?int $waterMl = null,
    ): self {
        return new self(
            $userId,
            $date->setTime(0, 0),
            $sleep,
            $restingHeartRate,
            $steps,
            $stepsAreComplete,
            $waterMl,
        );
    }

    public function recordSleep(SleepSummary $sleep): void
    {
        $this->sleep = $sleep;
    }

    public function recordRestingHeartRate(RestingHeartRate $rate): void
    {
        $this->restingHeartRate = $rate;
    }

    public function userId(): UserId
    {
        return $this->userId;
    }

    public function date(): DateTimeImmutable
    {
        return $this->date;
    }

    public function sleep(): ?SleepSummary
    {
        return $this->sleep;
    }

    public function restingHeartRate(): ?RestingHeartRate
    {
        return $this->restingHeartRate;
    }

    public function steps(): ?int
    {
        return $this->steps;
    }

    /**
     * Whether `steps` is a day or only the witnessed part of one.
     *
     * Null where the count arrived without saying, which is not the same as false but is
     * treated the same by anything that needs a whole day: an unstated provenance is a
     * reason to leave the count out of a median, never a reason to assume the best of it.
     */
    public function stepsAreComplete(): ?bool
    {
        return $this->stepsAreComplete;
    }

    /** The one question every consumer of a daily total actually wants answered. */
    public function hasCompleteStepCount(): bool
    {
        return $this->steps !== null && $this->stepsAreComplete === true;
    }

    public function waterMl(): ?int
    {
        return $this->waterMl;
    }

    public function hasSleep(): bool
    {
        return $this->sleep !== null;
    }

    public function hasRestingHeartRate(): bool
    {
        return $this->restingHeartRate !== null;
    }
}
