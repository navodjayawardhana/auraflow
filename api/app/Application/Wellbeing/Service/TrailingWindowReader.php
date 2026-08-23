<?php

namespace App\Application\Wellbeing\Service;

use App\Application\Wellbeing\DTO\TrailingWindow;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
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
 * Two of the three reductions here drop rows rather than accept them on trust, and for the
 * same reason: a step count that does not say what part of the day it covers, and a resting
 * rate pooled with a rate taken a different way, are both plausible numbers that are wrong
 * in a direction nothing downstream can detect.
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
        // Bucketed by how each reading was taken, never pooled. A person who wore a watch
        // for nine nights and then switched to the morning check-in for five has two short
        // series, not one fortnight: the seated mornings sit several bpm above the nights
        // for reasons that have nothing to do with their recovery, so a single mean would
        // land between the two and a single deviation would mostly measure the gap.
        $restingRatesBySource = [];
        $stagedNights = [];
        $completeDailySteps = [];

        foreach ($preceding as $snapshot) {
            if ($snapshot->hasRestingHeartRate()) {
                $rate = $snapshot->restingHeartRate();
                $restingRatesBySource[$rate->source()->value][] = $rate->bpm();
            }

            $sleep = $snapshot->sleep();
            if ($sleep !== null && $sleep->hasStageBreakdown()) {
                $stagedNights[] = [$sleep->deepMinutes(), $sleep->remMinutes()];
            }

            if ($snapshot->hasCompleteStepCount()) {
                $completeDailySteps[] = $snapshot->steps();
            }
        }

        $baselines = [];

        foreach ($restingRatesBySource as $source => $rates) {
            // The minimum applies per source rather than across them. Five seated mornings
            // are five observations of one thing; five days split three and two are not
            // enough of either, and the honest answer there is the provisional score the
            // cold-start path already produces.
            if (RestingHeartRateBaseline::canBeBuiltFrom($rates)) {
                $baselines[$source] = RestingHeartRateBaseline::fromPriorReadings(
                    $rates,
                    RestingHeartRateSource::from($source),
                );
            }
        }

        return new TrailingWindow(
            $baselines,
            SleepArchitectureBaseline::fromPriorNights($stagedNights),
            $completeDailySteps,
        );
    }
}
