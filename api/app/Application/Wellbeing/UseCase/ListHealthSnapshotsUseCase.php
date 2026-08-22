<?php

namespace App\Application\Wellbeing\UseCase;

use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * Raw snapshots for a window.
 *
 * Distinct from the recovery endpoint on purpose: that one returns a score, and a client
 * doing its own arithmetic -- an on-device model needing sleep hours, stage ratios and a
 * trailing resting-heart-rate delta -- needs the inputs, not the conclusion.
 */
final class ListHealthSnapshotsUseCase
{
    public function __construct(private readonly DailyHealthSnapshotRepository $snapshots)
    {
    }

    /**
     * @return DailyHealthSnapshot[]
     */
    public function execute(string $userId, string $from, string $to): array
    {
        return $this->snapshots->findRange(
            UserId::fromString($userId),
            new DateTimeImmutable($from),
            new DateTimeImmutable($to),
        );
    }
}
