<?php

namespace Tests\Unit\Application\Wellbeing\UseCase\Fake;

use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * In-memory stand-in, so use-case tests run without a database or a mocking framework.
 * A fake that really implements the interface also proves the interface is usable --
 * a mock would happily pretend to satisfy a contract nothing could actually meet.
 */
final class FakeDailyHealthSnapshotRepository implements DailyHealthSnapshotRepository
{
    /** @var DailyHealthSnapshot[] */
    private array $snapshots = [];

    public function add(DailyHealthSnapshot $snapshot): void
    {
        $this->save($snapshot);
    }

    public function findForDate(UserId $userId, DateTimeImmutable $date): ?DailyHealthSnapshot
    {
        foreach ($this->snapshots as $snapshot) {
            if ($this->matches($snapshot, $userId, $date)) {
                return $snapshot;
            }
        }

        return null;
    }

    public function findPrecedingDays(UserId $userId, DateTimeImmutable $before, int $days): array
    {
        $earliest = $before->modify(sprintf('-%d days', $days));

        $found = array_filter(
            $this->snapshots,
            fn (DailyHealthSnapshot $s) => $s->userId()->equals($userId)
                && $s->date() < $before->setTime(0, 0)
                && $s->date() >= $earliest->setTime(0, 0),
        );

        usort($found, fn ($a, $b) => $a->date() <=> $b->date());

        return array_values($found);
    }

    public function findRange(UserId $userId, DateTimeImmutable $from, DateTimeImmutable $to): array
    {
        $found = array_filter(
            $this->snapshots,
            fn (DailyHealthSnapshot $s) => $s->userId()->equals($userId)
                && $s->date() >= $from->setTime(0, 0)
                && $s->date() <= $to->setTime(0, 0),
        );

        usort($found, fn ($a, $b) => $a->date() <=> $b->date());

        return array_values($found);
    }

    public function save(DailyHealthSnapshot $snapshot): void
    {
        foreach ($this->snapshots as $index => $existing) {
            if ($this->matches($existing, $snapshot->userId(), $snapshot->date())) {
                $this->snapshots[$index] = $snapshot;

                return;
            }
        }

        $this->snapshots[] = $snapshot;
    }

    private function matches(DailyHealthSnapshot $snapshot, UserId $userId, DateTimeImmutable $date): bool
    {
        return $snapshot->userId()->equals($userId)
            && $snapshot->date()->format('Y-m-d') === $date->format('Y-m-d');
    }
}
