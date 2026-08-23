<?php

namespace App\Application\Planning\UseCase;

use App\Application\Planning\DTO\PlanView;
use App\Application\Wellbeing\Service\TrailingWindowReader;
use App\Domain\Planning\Model\WellbeingPlan;
use App\Domain\Planning\Repository\WellbeingPlanRepository;
use App\Domain\Planning\Service\PlanDeriver;
use App\Domain\Planning\Service\StepGoalCalculator;
use App\Domain\Planning\ValueObject\MeasuredHistory;
use App\Domain\Profile\Model\UserProfile;
use App\Domain\Profile\Repository\UserProfileRepository;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;
use RuntimeException;

/**
 * Gathers the profile and the measurements, and asks the domain for a plan.
 *
 * Orchestration only. Not one of the six formulas appears here; the single decision this
 * class makes is whether the answer differs enough from the last one to be worth a
 * version, and even that question is answered by the aggregate.
 */
final class RecalculatePlanUseCase
{
    public function __construct(
        private readonly UserProfileRepository $profiles,
        private readonly WellbeingPlanRepository $plans,
        private readonly TrailingWindowReader $trailingWindow,
        private readonly PlanDeriver $deriver,
        private readonly StepGoalCalculator $steps,
    ) {
    }

    public function execute(string $userId, ?DateTimeImmutable $on = null): PlanView
    {
        $id = UserId::fromString($userId);
        $date = ($on ?? new DateTimeImmutable('today'))->setTime(0, 0);

        // An empty profile is a profile. Every formula that cannot run on it reports the
        // gap in `basis.missing` and the plan falls back to the app's own constants --
        // the same discipline the recovery score's `provisional` flag follows.
        $profile = $this->profiles->findFor($id) ?? UserProfile::empty($id);

        $window = $this->trailingWindow->before($id, $date);
        $current = $this->plans->findCurrent($id);

        $derived = $this->deriver->derive(
            $profile,
            new MeasuredHistory(
                // Either kind will do here, overnight first. Zones want a resting figure to
                // subtract, not a like-for-like comparison -- see the window's own note.
                $window->preferredRestingHeartRate(),
                $this->steps->medianDailySteps($window->completeDailySteps),
            ),
            $date,
            ($current?->version() ?? 0) + 1,
        );

        if ($current !== null && $current->hasSameContentAs($derived)) {
            return PlanView::fromDomain($current);
        }

        $this->plans->save($derived);

        return PlanView::fromDomain($this->plans->findCurrent($id) ?? $derived);
    }

    /**
     * The plan a caller can rely on existing.
     *
     * Derives and stores one on first ask rather than returning null, so nothing
     * downstream has to carry a "no plan yet" branch. GET /plan deliberately does not use
     * this -- a read should not write, and the client wants to know the difference
     * between "no plan" and "a plan of defaults".
     */
    public function ensureExists(string $userId, ?DateTimeImmutable $on = null): WellbeingPlan
    {
        $id = UserId::fromString($userId);

        $current = $this->plans->findCurrent($id);

        if ($current !== null) {
            return $current;
        }

        $this->execute($userId, $on);

        $stored = $this->plans->findCurrent($id);

        if ($stored === null) {
            // The write went through and the read came back empty, which means the two
            // are not looking at the same thing. Failing loudly beats returning a plan
            // the caller would then override into a second version 1.
            throw new RuntimeException('A plan was derived but could not be read back.');
        }

        return $stored;
    }
}
