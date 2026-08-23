<?php

namespace App\Application\Wellbeing\UseCase;

use App\Application\Wellbeing\DTO\CalculateRecoveryScoreRequest;
use App\Application\Wellbeing\DTO\RecoveryScoreResult;
use App\Application\Wellbeing\Service\TrailingWindowReader;
use App\Domain\Planning\Repository\WellbeingPlanRepository;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\Service\IllnessDetector;
use App\Domain\Wellbeing\Service\RecoveryScoreCalculator;
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
    ) {
    }

    public function execute(CalculateRecoveryScoreRequest $request): RecoveryScoreResult
    {
        $userId = UserId::fromString($request->userId);
        $date = new DateTimeImmutable($request->date);

        $today = $this->snapshots->findForDate($userId, $date);

        if ($today === null || ! $today->hasSleep()) {
            return RecoveryScoreResult::unavailable(
                $date->format('Y-m-d'),
                'No sleep was recorded for this night.',
            );
        }

        // Null on the cold-start path -- not a failure. The domain turns a missing
        // resting-HR baseline into a provisional score, and falls back to population
        // figures for the two sleep baselines.
        $window = $this->trailingWindow->before($userId, $date);
        $architecture = $window->sleepArchitecture;

        $score = $this->calculator->calculate(
            $today->sleep(),
            $today->restingHeartRate(),
            $window->restingHeartRate,
            $this->plans->findCurrent($userId)?->sleepNeedHours(),
            $architecture?->deepMinutes(),
            $architecture?->remMinutes(),
        );

        $warning = $this->illnessDetector->isWarranted($today->restingHeartRate(), $window->restingHeartRate);

        return new RecoveryScoreResult(
            $date->format('Y-m-d'),
            $score->value(),
            $score->isProvisional(),
            $score->componentsUsed(),
            $warning,
        );
    }
}
