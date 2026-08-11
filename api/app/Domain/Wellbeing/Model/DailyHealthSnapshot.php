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
    ) {
    }

    public static function record(
        UserId $userId,
        DateTimeImmutable $date,
        ?SleepSummary $sleep = null,
        ?RestingHeartRate $restingHeartRate = null,
    ): self {
        return new self($userId, $date->setTime(0, 0), $sleep, $restingHeartRate);
    }

    /** Rebuild from storage without re-running creation rules. */
    public static function reconstitute(
        UserId $userId,
        DateTimeImmutable $date,
        ?SleepSummary $sleep,
        ?RestingHeartRate $restingHeartRate,
    ): self {
        return new self($userId, $date->setTime(0, 0), $sleep, $restingHeartRate);
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

    public function hasSleep(): bool
    {
        return $this->sleep !== null;
    }

    public function hasRestingHeartRate(): bool
    {
        return $this->restingHeartRate !== null;
    }
}
