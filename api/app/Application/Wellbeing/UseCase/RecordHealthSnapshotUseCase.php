<?php

namespace App\Application\Wellbeing\UseCase;

use App\Application\Wellbeing\DTO\RecordHealthSnapshotRequest;
use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\ValueObject\RestingHeartRate;
use App\Domain\Wellbeing\ValueObject\SleepSummary;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * Records one night for one user.
 *
 * The value objects validate themselves, so an out-of-range figure that slips past the
 * form request still cannot reach storage. Half-populated snapshots are deliberately
 * allowed -- a watch worn by day but not at night reports a resting heart rate with no
 * sleep, and the score's components already degrade independently.
 */
final class RecordHealthSnapshotUseCase
{
    public function __construct(private readonly DailyHealthSnapshotRepository $snapshots)
    {
    }

    public function execute(RecordHealthSnapshotRequest $request): DailyHealthSnapshot
    {
        $snapshot = DailyHealthSnapshot::record(
            UserId::fromString($request->userId),
            new DateTimeImmutable($request->date),
            $this->toSleep($request),
            // The source is not defaulted when absent. The form request has already refused
            // a rate that did not state one, so a null here means no rate at all -- and if
            // that ever stops being true, the type error is the point.
            $request->restingHeartRate === null || $request->restingHrSource === null
                ? null
                : RestingHeartRate::fromBpm($request->restingHeartRate, $request->restingHrSource),
            $request->steps,
            $request->stepsAreComplete,
            $request->waterMl,
        );

        // Idempotent per (user, day) in the repository: a device re-syncing the same
        // night updates rather than duplicates, which is what makes a retry-on-reconnect
        // client safe to write.
        $this->snapshots->save($snapshot);

        return $snapshot;
    }

    private function toSleep(RecordHealthSnapshotRequest $request): ?SleepSummary
    {
        if ($request->sleepMinutes === null) {
            return null;
        }

        return SleepSummary::of(
            $request->sleepMinutes / 60,
            $request->deepSleepMinutes === null ? null : (float) $request->deepSleepMinutes,
            $request->remSleepMinutes === null ? null : (float) $request->remSleepMinutes,
        );
    }
}
