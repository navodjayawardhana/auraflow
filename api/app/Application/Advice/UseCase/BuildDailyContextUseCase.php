<?php

namespace App\Application\Advice\UseCase;

use App\Application\Wellbeing\DTO\CalculateRecoveryScoreRequest;
use App\Application\Wellbeing\UseCase\CalculateRecoveryScoreUseCase;
use App\Domain\Advice\ValueObject\DailyContext;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * Gathers one day's measurements into the closed set the briefing is allowed to see.
 *
 * Orchestration only. Nothing here decides what the advice says — that lives in the
 * prompt builder — and nothing here computes a health figure, because the recovery use
 * case already owns that.
 */
final class BuildDailyContextUseCase
{
    public function __construct(
        private readonly DailyHealthSnapshotRepository $snapshots,
        private readonly CalculateRecoveryScoreUseCase $recovery,
    ) {
    }

    /**
     * @param  int|null  $waterTargetMl  the user's derived hydration goal, where they have a
     *                                   plan. Passed in rather than read here so the pack
     *                                   builder's single read of the plan also serves this,
     *                                   and so a day with no plan keeps the cold-start
     *                                   default the value object documents.
     */
    public function execute(string $userId, string $date, ?int $waterTargetMl = null): DailyContext
    {
        $result = $this->recovery->execute(new CalculateRecoveryScoreRequest($userId, $date));

        $snapshot = $this->snapshots->findForDate(
            UserId::fromString($userId),
            new DateTimeImmutable($date),
        );

        $sleep = $snapshot?->sleep();

        return new DailyContext(
            date: $date,
            recoveryScore: $result->isAvailable() ? (int) round($result->score) : null,
            recoveryIsProvisional: $result->isAvailable() && $result->provisional,
            recoveryUnavailableReason: $result->isAvailable() ? null : $result->unavailableReason,
            illnessWarning: $result->isAvailable() && $result->illnessWarning,
            sleepMinutes: $sleep === null ? null : (int) round($sleep->hours() * 60),
            deepSleepMinutes: $sleep?->deepMinutes() === null ? null : (int) round($sleep->deepMinutes()),
            remSleepMinutes: $sleep?->remMinutes() === null ? null : (int) round($sleep->remMinutes()),
            restingHeartRate: $snapshot?->restingHeartRate()?->bpm(),
            // Carried, not dropped. The prompt now shows a fortnight of resting rates
            // beside this one, and a seated capture trended against overnight readings is
            // the exact comparison RestingHeartRate::deviationFrom refuses to make.
            restingHeartRateSource: $snapshot?->restingHeartRate()?->source(),
            steps: $snapshot?->steps(),
            stepsAreComplete: $snapshot?->stepsAreComplete(),
            waterMl: $snapshot?->waterMl(),
            waterTargetMl: $waterTargetMl ?? DailyContext::DEFAULT_WATER_TARGET_ML,
        );
    }
}
