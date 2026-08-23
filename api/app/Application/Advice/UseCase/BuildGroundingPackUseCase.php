<?php

namespace App\Application\Advice\UseCase;

use App\Application\Wellbeing\DTO\ScoredDay;
use App\Application\Wellbeing\Service\RecoveryScoreSeriesReader;
use App\Domain\Advice\ValueObject\DayPart;
use App\Domain\Advice\ValueObject\GroundingPack;
use App\Domain\Advice\ValueObject\HistoryDay;
use App\Domain\Advice\ValueObject\PlanTargets;
use App\Domain\Advice\ValueObject\RecentMeal;
use App\Domain\Movement\Repository\CompletedSessionRepository;
use App\Domain\Nutrition\Repository\LoggedMealRepository;
use App\Domain\Nutrition\Service\NutritionAggregator;
use App\Domain\Nutrition\ValueObject\DateRange;
use App\Domain\Nutrition\ValueObject\LoggedMeal;
use App\Domain\Nutrition\ValueObject\NutritionTotals;
use App\Domain\Nutrition\ValueObject\Period;
use App\Domain\Planning\Model\WellbeingPlan;
use App\Domain\Planning\Repository\WellbeingPlanRepository;
use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * Assembles everything the briefing and the assistant may know, from one user's own rows.
 *
 * Orchestration only, and that word is doing more work here than usual. Nothing in this
 * class computes a health figure: the recovery scores come from the same reader the
 * insights screen and the score endpoint use, and the calorie totals come from the same
 * aggregator the meals screen uses. A score or a total worked out a second way here is a
 * score that eventually disagrees with the chart the user is looking at while they ask
 * about it, which is the one failure mode a grounded assistant cannot survive.
 *
 * ## Scoping
 *
 * Every read below takes `$userId` and nothing else identifies a row. There is no
 * parameter through which a caller could widen the scope, no filter derived from anything
 * a model produced, and no path from a reply back into a query — the pack is built, then
 * the model is called, and the model's output never becomes an input to a read.
 *
 * ## Why not the insights read
 *
 * `BuildInsightsSeriesUseCase` assembles a very similar fortnight, and reusing it was the
 * first thing tried. It is shaped for a chart: it carries a resting heart rate without
 * saying how it was taken, and a meal count without the calories. Both matter here and
 * neither is drawn, so reusing it would have meant widening a client payload for a
 * server-side reader. The shared parts — the scoring and the totalling — are shared; only
 * the mapping into a prompt-shaped value is written twice, and a mapping is not a claim.
 */
final class BuildGroundingPackUseCase
{
    public function __construct(
        private readonly BuildDailyContextUseCase $buildToday,
        private readonly DailyHealthSnapshotRepository $snapshots,
        private readonly RecoveryScoreSeriesReader $recoveryScores,
        private readonly LoggedMealRepository $meals,
        private readonly NutritionAggregator $aggregator,
        private readonly CompletedSessionRepository $sessions,
        private readonly WellbeingPlanRepository $plans,
    ) {
    }

    public function execute(string $userId, string $date, ?DayPart $dayPart = null): GroundingPack
    {
        $id = UserId::fromString($userId);
        $today = new DateTimeImmutable($date);

        // Ending today, not yesterday. Today's own row appears in the table as well as in
        // the day's fuller description above it, and the repetition is worth the alternative:
        // a fourteen-row table with a hole where the last row should be is harder for
        // anything to read than one that simply ends where the reader is standing.
        $window = new DateRange($today->modify('-'.(GroundingPack::HISTORY_DAYS - 1).' days'), $today);

        $plan = $this->plans->findCurrent($id);

        $meals = $this->meals->findForUserInRange($userId, $window);

        return new GroundingPack(
            today: $this->buildToday->execute($userId, $date, $plan?->waterMl()),
            history: $this->history($id, $window, $meals),
            recentMeals: $this->recentMeals($meals, $today),
            sessions: $this->sessions->findForUserInRange($userId, $window, GroundingPack::SESSION_LIMIT),
            targets: $plan === null ? null : $this->targets($plan),
            dayPart: $dayPart,
        );
    }

    /**
     * @param  list<LoggedMeal>  $meals
     * @return list<HistoryDay>
     */
    private function history(UserId $id, DateRange $window, array $meals): array
    {
        $snapshots = [];
        foreach ($this->snapshots->findRange($id, $window->from, $window->to) as $snapshot) {
            $snapshots[$snapshot->date()->format('Y-m-d')] = $snapshot;
        }

        $scores = $this->recoveryScores->scoreDays($id, $window->from, $window->to);

        $nutrition = [];
        foreach ($this->aggregator->summarise($meals, $window, Period::Day) as $bucket) {
            $nutrition[$bucket->span->fromIso()] = $bucket->totals;
        }

        $days = [];

        for ($date = $window->from; $date <= $window->to; $date = $date->modify('+1 day')) {
            $iso = $date->format('Y-m-d');

            $days[] = $this->historyDay(
                $iso,
                $snapshots[$iso] ?? null,
                $scores[$iso] ?? null,
                $nutrition[$iso] ?? null,
            );
        }

        return $days;
    }

    private function historyDay(
        string $iso,
        ?DailyHealthSnapshot $snapshot,
        ?ScoredDay $score,
        ?NutritionTotals $totals,
    ): HistoryDay {
        $sleep = $snapshot?->sleep();

        return new HistoryDay(
            date: $iso,
            // Rounded here and nowhere else. The score is a float the length of a division,
            // and a prompt is not the place to hand a model six decimal places it will then
            // quote back at somebody.
            recoveryScore: $score === null ? null : (int) round($score->score),
            recoveryIsProvisional: $score?->provisional ?? false,
            sleepMinutes: $sleep === null ? null : (int) round($sleep->hours() * 60),
            restingHeartRate: $snapshot?->restingHeartRate()?->bpm(),
            restingHeartRateSource: $snapshot?->restingHeartRate()?->source(),
            steps: $snapshot?->steps(),
            stepsAreComplete: $snapshot?->stepsAreComplete(),
            waterMl: $snapshot?->waterMl(),
            // Null, not zero, on a day nobody logged. The aggregator returns an empty
            // bucket for every day in the window including the ones with no meals in them,
            // and passing that through as `0 kcal` would tell the model a fortnight of
            // unlogged days was a fortnight of fasting.
            kcal: $totals === null || $totals->isEmpty() ? null : $totals->kcal,
            mealCount: $totals?->mealCount ?? 0,
            estimatedKcal: $totals?->estimatedKcal ?? 0,
            estimatedMealCount: $totals?->estimatedCount ?? 0,
        );
    }

    /**
     * The most recent days' meals, by name.
     *
     * Filtered from the fortnight already in hand rather than fetched again: the wide read
     * has happened, and a second query for a subset of its own rows is a second chance for
     * the two to disagree about what was eaten.
     *
     * @param  list<LoggedMeal>  $meals
     * @return list<RecentMeal>
     */
    private function recentMeals(array $meals, DateTimeImmutable $today): array
    {
        $earliest = $today->modify('-'.(GroundingPack::NAMED_MEAL_DAYS - 1).' days')->format('Y-m-d');

        $recent = [];

        foreach ($meals as $meal) {
            $day = $meal->eatenOn->format('Y-m-d');

            if ($day < $earliest || $meal->name === null) {
                continue;
            }

            $recent[] = new RecentMeal($day, $meal->name, $meal->kcal, $meal->source);
        }

        // The cap takes the newest, not the first. A day whose logging ran long should lose
        // its breakfast from the pack rather than its dinner -- the question is almost
        // always about what has been eaten so far, and the most recent meals are the ones
        // that answer it.
        return array_slice($recent, -GroundingPack::NAMED_MEAL_LIMIT);
    }

    private function targets(WellbeingPlan $plan): PlanTargets
    {
        $zones = $plan->heartRateZones();
        $basis = $plan->basis();

        return new PlanTargets(
            stepGoal: $plan->stepGoal(),
            waterMl: $plan->waterMl(),
            sleepNeedHours: $plan->sleepNeedHours(),
            activeKcalGoal: $plan->activeKcalGoal(),
            heartRateZoneSummary: $zones === null ? null : sprintf(
                'easy %d-%d, moderate %d-%d, hard %d-%d bpm',
                $zones->easy[0], $zones->easy[1],
                $zones->moderate[0], $zones->moderate[1],
                $zones->hard[0], $zones->hard[1],
            ),
            stepGoalSource: $basis->stepGoalSource,
            waterSource: $basis->waterSource,
            sleepNeedSource: $basis->sleepNeedSource,
            missingFromProfile: $basis->missing,
        );
    }
}
