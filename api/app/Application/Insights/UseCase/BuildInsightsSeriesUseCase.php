<?php

namespace App\Application\Insights\UseCase;

use App\Application\Insights\DTO\InsightsDay;
use App\Application\Insights\DTO\InsightsSeries;
use App\Application\Wellbeing\Service\RecoveryScoreSeriesReader;
use App\Domain\Nutrition\Repository\LoggedMealRepository;
use App\Domain\Nutrition\Service\NutritionAggregator;
use App\Domain\Nutrition\ValueObject\DateRange;
use App\Domain\Nutrition\ValueObject\Period;
use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\ValueObject\UserId;

/**
 * Everything the insights screen draws, in one reply.
 *
 * The screen wants six things about each of the last fortnight's days -- a recovery score,
 * a night, a resting heart rate, a step count, a water total and whether anything was
 * eaten. Fetched the obvious way that is a request per day for the score alone, which is
 * what the screen used to do for seven days and would have done for fourteen. One request
 * is not an optimisation here so much as the difference between a screen that opens and a
 * screen that opens fourteen times.
 *
 * Assembly only, and deliberately no arithmetic beyond it. Nothing here averages, counts
 * coverage or correlates anything: those are claims about the data rather than the data,
 * they are what can be silently wrong, and they live in a tested pure module on the client
 * where the wording that qualifies them lives too.
 */
final class BuildInsightsSeriesUseCase
{
    public function __construct(
        private readonly DailyHealthSnapshotRepository $snapshots,
        private readonly RecoveryScoreSeriesReader $recoveryScores,
        private readonly LoggedMealRepository $meals,
        private readonly NutritionAggregator $aggregator,
    ) {
    }

    public function execute(string $userId, DateRange $window): InsightsSeries
    {
        $id = UserId::fromString($userId);

        $snapshots = $this->indexByDate(
            $this->snapshots->findRange($id, $window->from, $window->to),
        );

        $scores = $this->recoveryScores->scoreDays($id, $window->from, $window->to);

        // Through the aggregator rather than counted here. It already returns a bucket for
        // every day in the range including the empty ones, and it already keeps measured
        // energy apart from estimated -- writing a second tally next to it would be a
        // second chance to disagree with the meals screen about the same day.
        $nutrition = [];
        foreach ($this->aggregator->summarise(
            $this->meals->findForUserInRange($userId, $window),
            $window,
            Period::Day,
        ) as $bucket) {
            $nutrition[$bucket->span->fromIso()] = $bucket;
        }

        $days = [];

        for ($date = $window->from; $date <= $window->to; $date = $date->modify('+1 day')) {
            $iso = $date->format('Y-m-d');

            $snapshot = $snapshots[$iso] ?? null;
            $score = $scores[$iso] ?? null;
            $totals = ($nutrition[$iso] ?? null)?->totals;

            $sleep = $snapshot?->sleep();

            $days[] = new InsightsDay(
                date: $iso,
                recoveryScore: $score?->score,
                recoveryProvisional: $score?->provisional ?? false,
                sleepMinutes: $sleep === null ? null : (int) round($sleep->hours() * 60),
                restingHeartRate: $snapshot?->restingHeartRate()?->bpm(),
                steps: $snapshot?->steps(),
                stepsAreComplete: $snapshot?->stepsAreComplete(),
                waterMl: $snapshot?->waterMl(),
                mealCount: $totals?->mealCount ?? 0,
                estimatedMealCount: $totals?->estimatedCount ?? 0,
            );
        }

        return new InsightsSeries($window->fromIso(), $window->toIso(), $days);
    }

    /**
     * @param  DailyHealthSnapshot[]  $snapshots
     * @return array<string, DailyHealthSnapshot>
     */
    private function indexByDate(array $snapshots): array
    {
        $byDate = [];

        foreach ($snapshots as $snapshot) {
            $byDate[$snapshot->date()->format('Y-m-d')] = $snapshot;
        }

        return $byDate;
    }
}
