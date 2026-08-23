<?php

namespace App\Application\Wellbeing\Service;

use App\Application\Wellbeing\DTO\ScoredDay;
use App\Domain\Planning\Repository\WellbeingPlanRepository;
use App\Domain\Wellbeing\Exception\InsufficientBaselineHistoryException;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Domain\Wellbeing\Service\RecoveryScoreCalculator;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * Every day in a window that can be scored, from one read.
 *
 * Scores are derived on read and never stored, so a fortnight of them is a fortnight of
 * calculations -- and the naive shape of that is a query per day, plus a second query per
 * day for the baseline behind it. Instead the window is fetched once with the preceding
 * fortnight attached, and each day's baseline is reduced from the part of the array that
 * precedes it.
 *
 * Two callers wanted that loop: the insights series, and CalculateRecoveryScoreUseCase
 * looking for the last day it can show when today has nothing. They had it once each
 * before this class existed. A score computed two ways is a score that eventually
 * disagrees with itself, and the user sees the same night with two different numbers on
 * two different screens -- the daily-brief controller carries a docblock about what
 * happens when a lookup lives in two places.
 *
 * Orchestration only. What a score is, what makes it provisional and how many nights a
 * baseline needs are all the domain's rules.
 */
final class RecoveryScoreSeriesReader
{
    public function __construct(
        private readonly DailyHealthSnapshotRepository $snapshots,
        private readonly RecoveryScoreCalculator $calculator,
        private readonly TrailingWindowReader $trailingWindow,
        private readonly WellbeingPlanRepository $plans,
    ) {
    }

    /**
     * The scorable days in `[$from, $to]`, oldest first, keyed by `Y-m-d`.
     *
     * Days that were never recorded, and days whose every component is missing, are absent
     * rather than present with a null. A caller counting the keys is counting days it can
     * honestly average, which is the number the coverage panel exists to show.
     *
     * @return array<string, ScoredDay>
     */
    public function scoreDays(UserId $userId, DateTimeImmutable $from, DateTimeImmutable $to): array
    {
        // The window plus the fortnight in front of it. That older stretch is never scored
        // and never returned -- it exists only so the first day asked for has a baseline of
        // its own, rather than reading as provisional purely because of where the window
        // was cut.
        $history = $this->snapshots->findRange(
            $userId,
            $from->modify(sprintf('-%d days', RestingHeartRateBaseline::WINDOW_DAYS)),
            $to,
        );

        $sleepNeed = $this->plans->findCurrent($userId)?->sleepNeedHours();

        $fromIso = $from->format('Y-m-d');
        $toIso = $to->format('Y-m-d');

        $scored = [];

        foreach ($history as $index => $snapshot) {
            $day = $snapshot->date()->format('Y-m-d');

            if ($day < $fromIso || $day > $toIso) {
                continue;
            }

            // Strictly the days before this one. `findRange` returns oldest first, so the
            // slice up to $index is exactly the history that existed on the morning of it.
            $window = $this->trailingWindow->fromSnapshots(array_slice($history, 0, $index));

            try {
                $score = $this->calculator->calculate(
                    $snapshot->sleep(),
                    $snapshot->restingHeartRate(),
                    // Matched to how that day's rate was taken. A user who changed method
                    // mid-window has each day scored against its own kind of history, so the
                    // series does not acquire a step at the changeover that belongs to the
                    // measurement rather than to them.
                    $window->restingHeartRateFor($snapshot->restingHeartRate()?->source()),
                    $sleepNeed,
                    $window->sleepArchitecture?->deepMinutes(),
                    $window->sleepArchitecture?->remMinutes(),
                );
            } catch (InsufficientBaselineHistoryException) {
                continue;
            }

            $scored[$day] = new ScoredDay($day, $score->value(), $score->isProvisional());
        }

        return $scored;
    }
}
