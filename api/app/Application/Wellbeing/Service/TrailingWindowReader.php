<?php

namespace App\Application\Wellbeing\Service;

use App\Application\Wellbeing\DTO\TrailingWindow;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\SleepArchitectureBaseline;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * Reads the days before a given date and turns them into the personal baselines that
 * everything downstream is measured against.
 *
 * Strictly before, never including the date itself. That rule is load-bearing twice
 * over: a resting-HR baseline containing the night being scored damps its own anomaly
 * (RestingHeartRateBaseline documents the defect this caused in the Python pipeline),
 * and today's step count is a partial day that would drag a weekly median down every
 * morning.
 *
 * Orchestration only. What a baseline is, and how many days it takes before one can be
 * trusted, are the domain value objects' rules.
 */
final class TrailingWindowReader
{
    public function __construct(private readonly DailyHealthSnapshotRepository $snapshots)
    {
    }

    public function before(UserId $userId, DateTimeImmutable $date): TrailingWindow
    {
        return $this->fromSnapshots($this->snapshots->findPrecedingDays(
            $userId,
            $date,
            RestingHeartRateBaseline::WINDOW_DAYS,
        ));
    }

    /**
     * The same reduction, over days already in hand.
     *
     * Scoring several past days at once would otherwise mean a query per day, or a second
     * copy of this loop written against an array. The second copy is the worse of the two:
     * a baseline computed two different ways is a baseline that disagrees with itself.
     *
     * @param  list<\App\Domain\Wellbeing\Model\DailyHealthSnapshot>  $preceding
     */
    public function fromSnapshots(array $preceding): TrailingWindow
    {
        $restingRates = [];
        $stagedNights = [];
        $dailySteps = [];

        foreach ($preceding as $snapshot) {
            if ($snapshot->hasRestingHeartRate()) {
                $restingRates[] = $snapshot->restingHeartRate()->bpm();
            }

            $sleep = $snapshot->sleep();
            if ($sleep !== null && $sleep->hasStageBreakdown()) {
                $stagedNights[] = [$sleep->deepMinutes(), $sleep->remMinutes()];
            }

            if ($snapshot->steps() !== null) {
                $dailySteps[] = $snapshot->steps();
            }
        }

        return new TrailingWindow(
            RestingHeartRateBaseline::canBeBuiltFrom($restingRates)
                ? RestingHeartRateBaseline::fromPriorReadings($restingRates)
                : null,
            SleepArchitectureBaseline::fromPriorNights($stagedNights),
            $dailySteps,
        );
    }
}
