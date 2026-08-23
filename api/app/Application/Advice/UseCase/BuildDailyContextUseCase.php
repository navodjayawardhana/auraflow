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

    public function execute(string $userId, string $date): DailyContext
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
            steps: $snapshot?->steps(),
            stepsAreComplete: $snapshot?->stepsAreComplete(),
            waterMl: $snapshot?->waterMl(),
        );
    }
}
