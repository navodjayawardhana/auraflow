<?php

namespace App\Domain\Wellbeing\Repository;

use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

interface DailyHealthSnapshotRepository
{
    public function findForDate(UserId $userId, DateTimeImmutable $date): ?DailyHealthSnapshot;

    /**
     * Snapshots from the days strictly before `$before`, oldest first.
     *
     * Strictly before, because a baseline that includes the day being scored lets that
     * reading pull its own reference -- and across a multi-day illness the baseline
     * climbs with the symptom until the anomaly disappears into it.
     *
     * @return DailyHealthSnapshot[]
     */
    public function findPrecedingDays(UserId $userId, DateTimeImmutable $before, int $days): array;

    public function save(DailyHealthSnapshot $snapshot): void;
}
