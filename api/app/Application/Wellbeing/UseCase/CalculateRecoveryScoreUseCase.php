<?php

namespace App\Application\Wellbeing\UseCase;

use App\Application\Wellbeing\DTO\CalculateRecoveryScoreRequest;
use App\Application\Wellbeing\DTO\LastKnownScore;
use App\Application\Wellbeing\DTO\RecoveryScoreResult;
use App\Application\Wellbeing\Service\RecoveryScoreSeriesReader;
use App\Application\Wellbeing\Service\TrailingWindowReader;
use App\Domain\Planning\Repository\WellbeingPlanRepository;
use App\Domain\Wellbeing\Exception\InsufficientBaselineHistoryException;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\Service\IllnessDetector;
use App\Domain\Wellbeing\Service\RecoveryScoreCalculator;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * Assembles what the day's score needs and hands it to the domain. Orchestration only:
 * every rule about what a recovery score means lives in the domain services.
 *
 * Three of the calculator's parameters were unreachable from here until the plan existed.
 * `$personalSleepNeedHours` now comes from the user's plan, which derives it from the NSF
 * age bands; `$personalDeepMinutes` and `$personalRemMinutes` come from their own
 * preceding fortnight. Before this, every user in the app was scored against 8.0 hours,
 * 60 minutes of deep and 90 of REM -- population figures that the architecture
 * component's own docblock already described as "the user's own baseline".
 *
 * Each stays optional. A user with no plan and no staged nights is scored exactly as they
 * were before, on the calculator's cold-start constants, which is what keeps this a
 * personalisation rather than a new requirement.
 */
final class CalculateRecoveryScoreUseCase
{
    public function __construct(
        private readonly DailyHealthSnapshotRepository $snapshots,
        private readonly RecoveryScoreCalculator $calculator,
        private readonly IllnessDetector $illnessDetector,
        private readonly TrailingWindowReader $trailingWindow,
        private readonly WellbeingPlanRepository $plans,
        private readonly RecoveryScoreSeriesReader $series,
    ) {
    }

    public function execute(CalculateRecoveryScoreRequest $request): RecoveryScoreResult
    {
        $userId = UserId::fromString($request->userId);
        $date = new DateTimeImmutable($request->date);

        $today = $this->snapshots->findForDate($userId, $date);

        if ($today === null) {
            return RecoveryScoreResult::unavailable(
                $date->format('Y-m-d'),
                'Nothing was recorded for this night.',
                $this->lastKnownBefore($userId, $date),
            );
        }

        // Null on the cold-start path -- not a failure. The domain turns a missing
        // resting-HR baseline into a provisional score, and falls back to population
        // figures for the two sleep baselines.
        $window = $this->trailingWindow->before($userId, $date);
        $architecture = $window->sleepArchitecture;

        /*
         * A night that was not logged is a missing component, not a missing score.
         *
         * The gate here used to demand sleep, which refused to score a snapshot carrying
         * only a resting heart rate -- and the log-night form lets someone save exactly
         * that. It was the app declining to use the one input the evidence favours: the
         * autonomic component carries 0.80 of the weight, and resting-HR z alone matched
         * the full score's rank correlation against self-reported readiness (E-015,
         * rho 0.123 either way). The domain already drops what it cannot compute and
         * reweights around the rest, so it is left to say what it can.
         */
        try {
            $score = $this->calculator->calculate(
                $today->sleep(),
                $today->restingHeartRate(),
                $window->restingHeartRate,
                $this->plans->findCurrent($userId)?->sleepNeedHours(),
                $architecture?->deepMinutes(),
                $architecture?->remMinutes(),
            );
        } catch (InsufficientBaselineHistoryException) {
            // Something was recorded, but no component survived. Naming which one is
            // missing is the difference between an answer and a shrug.
            return RecoveryScoreResult::unavailable(
                $date->format('Y-m-d'),
                $today->hasRestingHeartRate()
                    ? 'A resting heart rate needs '.RestingHeartRateBaseline::MIN_DAYS
                        ." earlier nights to compare against. Log a night's sleep for a score today."
                    : 'No sleep or resting heart rate was recorded for this night.',
                $this->lastKnownBefore($userId, $date),
            );
        }

        $warning = $this->illnessDetector->isWarranted($today->restingHeartRate(), $window->restingHeartRate);

        return new RecoveryScoreResult(
            $date->format('Y-m-d'),
            $score->value(),
            $score->isProvisional(),
            $score->componentsUsed(),
            $warning,
        );
    }

    /**
     * The most recent day before this one that can still be scored.
     *
     * Scores are derived on read and never stored, so "the last one" has to be worked out
     * again rather than looked up. Affordable because the series reader fetches the whole
     * stretch once and reduces each day's baseline from the part of it that precedes that
     * day, rather than a query per candidate.
     *
     * Bounded at the baseline window. Past a fortnight a stale score stops being context and
     * starts being archaeology, and the dash is the more honest answer.
     */
    private function lastKnownBefore(UserId $userId, DateTimeImmutable $date): ?LastKnownScore
    {
        $scored = $this->series->scoreDays(
            $userId,
            $date->modify(sprintf('-%d days', RestingHeartRateBaseline::WINDOW_DAYS)),
            $date->modify('-1 day'),
        );

        // The most recent that scores, not the best that does -- the series comes back
        // oldest first, so the answer is its last entry.
        $latest = end($scored);

        return $latest === false
            ? null
            : new LastKnownScore($latest->date, $latest->score, $latest->provisional);
    }
}
