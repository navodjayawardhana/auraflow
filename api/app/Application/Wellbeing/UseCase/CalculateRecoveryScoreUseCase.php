<?php

namespace App\Application\Wellbeing\UseCase;

use App\Application\Wellbeing\DTO\CalculateRecoveryScoreRequest;
use App\Application\Wellbeing\DTO\RecoveryScoreResult;
use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\Service\IllnessDetector;
use App\Domain\Wellbeing\Service\RecoveryScoreCalculator;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * Assembles what the day's score needs and hands it to the domain. Orchestration only:
 * every rule about what a recovery score means lives in the domain services.
 */
final class CalculateRecoveryScoreUseCase
{
    public function __construct(
        private readonly DailyHealthSnapshotRepository $snapshots,
        private readonly RecoveryScoreCalculator $calculator,
        private readonly IllnessDetector $illnessDetector,
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

        $baseline = $this->buildBaseline($userId, $date);

        $score = $this->calculator->calculate(
            $today->sleep(),
            $today->restingHeartRate(),
            $baseline,
        );

        $warning = $this->illnessDetector->isWarranted($today->restingHeartRate(), $baseline);

        return new RecoveryScoreResult(
            $date->format('Y-m-d'),
            $score->value(),
            $score->isProvisional(),
            $score->componentsUsed(),
            $warning,
        );
    }

    /**
     * Null when the user has not worn the device long enough. That is the cold-start
     * path, not a failure: the domain turns a missing baseline into a provisional score.
     */
    private function buildBaseline(UserId $userId, DateTimeImmutable $date): ?RestingHeartRateBaseline
    {
        $preceding = $this->snapshots->findPrecedingDays(
            $userId,
            $date,
            RestingHeartRateBaseline::WINDOW_DAYS,
        );

        $readings = [];
        foreach ($preceding as $snapshot) {
            if ($snapshot->hasRestingHeartRate()) {
                $readings[] = $snapshot->restingHeartRate()->bpm();
            }
        }

        return RestingHeartRateBaseline::canBeBuiltFrom($readings)
            ? RestingHeartRateBaseline::fromPriorReadings($readings)
            : null;
    }
}
