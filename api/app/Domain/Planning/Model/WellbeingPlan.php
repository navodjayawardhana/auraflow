<?php

namespace App\Domain\Planning\Model;

use App\Domain\Planning\ValueObject\HeartRateZones;
use App\Domain\Planning\ValueObject\PlanBasis;
use App\Domain\Planning\ValueObject\PlanSource;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * One version of a user's daily targets.
 *
 * Immutable. An override does not change a plan, it produces the next one -- which is
 * what makes the history readable rather than a log of edits to a moving object. A day
 * charted against version 3 keeps meaning what it meant after version 4 exists.
 *
 * Two of the six figures are nullable, and they are the two the phase brief singles out
 * as health advice: an active-kilocalorie target and a heart-rate range. Both need terms
 * a profile may not carry -- body mass and sex for one, age for the other -- and there
 * is no population substitute that would not amount to telling someone to train at a
 * heart rate calculated for a person who is not them. Absent, plus a line in
 * `basis.missing`, is the honest form.
 */
final class WellbeingPlan
{
    /** The goals a user may set by hand. Heart-rate zones are not among them. */
    public const OVERRIDABLE_FIELDS = ['step_goal', 'water_ml', 'active_kcal_goal', 'sleep_need_hours'];

    /**
     * @param  string[]  $editedFields
     */
    private function __construct(
        private readonly UserId $userId,
        private readonly int $version,
        private readonly PlanSource $source,
        private readonly int $stepGoal,
        private readonly int $waterMl,
        private readonly ?int $activeKcalGoal,
        private readonly float $sleepNeedHours,
        private readonly ?HeartRateZones $heartRateZones,
        private readonly PlanBasis $basis,
        private readonly array $editedFields,
        private readonly ?string $clientUuid,
        private readonly ?DateTimeImmutable $createdAt,
    ) {
    }

    public static function derived(
        UserId $userId,
        int $version,
        int $stepGoal,
        int $waterMl,
        ?int $activeKcalGoal,
        float $sleepNeedHours,
        ?HeartRateZones $heartRateZones,
        PlanBasis $basis,
        ?DateTimeImmutable $createdAt = null,
    ): self {
        return new self(
            $userId,
            $version,
            PlanSource::Derived,
            $stepGoal,
            $waterMl,
            $activeKcalGoal,
            $sleepNeedHours,
            $heartRateZones,
            $basis,
            [],
            // A derived plan has no client behind it, so nothing to be idempotent on.
            null,
            $createdAt,
        );
    }

    /**
     * @param  string[]  $editedFields
     */
    public static function reconstitute(
        UserId $userId,
        int $version,
        PlanSource $source,
        int $stepGoal,
        int $waterMl,
        ?int $activeKcalGoal,
        float $sleepNeedHours,
        ?HeartRateZones $heartRateZones,
        PlanBasis $basis,
        array $editedFields,
        ?string $clientUuid,
        ?DateTimeImmutable $createdAt,
    ): self {
        return new self(
            $userId,
            $version,
            $source,
            $stepGoal,
            $waterMl,
            $activeKcalGoal,
            $sleepNeedHours,
            $heartRateZones,
            $basis,
            $editedFields,
            $clientUuid,
            $createdAt,
        );
    }

    /**
     * The next version, with the user's own numbers in place of the derived ones.
     *
     * Only fields whose value actually differs count as edited. Re-submitting the whole
     * form unchanged is how a profile screen saves, and it must not turn a derived plan
     * into an edited one -- that flag is what stops a later recalculation from quietly
     * reclaiming a goal the user chose.
     *
     * That same comparison is what makes the endpoint safe to replay: a retried write
     * arrives carrying the values that are already current, finds nothing changed, and
     * returns the version that exists instead of minting a second one. A replay is
     * therefore indistinguishable from a no-op edit, which is exactly what it is.
     *
     * @param  array<string, int|float>  $overrides  keyed by OVERRIDABLE_FIELDS
     * @param  string|null  $clientUuid  the client's id for this edit, recorded so a
     *                                   replay can be recognised even when an
     *                                   intervening edit has moved the values on
     */
    public function overriddenWith(array $overrides, ?string $clientUuid = null): self
    {
        $current = [
            'step_goal' => $this->stepGoal,
            'water_ml' => $this->waterMl,
            'active_kcal_goal' => $this->activeKcalGoal,
            'sleep_need_hours' => $this->sleepNeedHours,
        ];

        $changed = [];

        foreach (self::OVERRIDABLE_FIELDS as $field) {
            if (! array_key_exists($field, $overrides) || $overrides[$field] === null) {
                continue;
            }

            $value = $field === 'sleep_need_hours'
                ? round((float) $overrides[$field], 1)
                : (int) $overrides[$field];

            if ($value === $current[$field]) {
                continue;
            }

            $current[$field] = $value;
            $changed[] = $field;
        }

        // Nothing moved, so nothing is versioned. Writing an identical row would leave
        // the history telling the user they changed something on a day they did not.
        if ($changed === []) {
            return $this;
        }

        return new self(
            $this->userId,
            $this->version + 1,
            PlanSource::Edited,
            $current['step_goal'],
            $current['water_ml'],
            $current['active_kcal_goal'],
            $current['sleep_need_hours'],
            $this->heartRateZones,
            $this->basisWithUserEdits($changed),
            $changed,
            $clientUuid,
            null,
        );
    }

    /**
     * Whether two plans say the same thing, version and timestamp aside.
     *
     * Used to decide whether a recalculation is worth a version. Opening the profile
     * screen and saving it unchanged recalculates; if that wrote a row every time, the
     * history would fill with versions the user never caused and the ones they did cause
     * would be lost among them.
     *
     * The basis counts, not just the goals. A step goal of 7,500 that was a population
     * default yesterday and is a measured median today is the same number making a
     * different claim, and the user should be able to see the day it became theirs.
     */
    public function hasSameContentAs(WellbeingPlan $other): bool
    {
        return $this->stepGoal === $other->stepGoal
            && $this->waterMl === $other->waterMl
            && $this->activeKcalGoal === $other->activeKcalGoal
            && $this->sleepNeedHours === $other->sleepNeedHours
            && $this->heartRateZones?->toStorage() === $other->heartRateZones?->toStorage()
            && $this->basis->toArray() === $other->basis->toArray();
    }

    public function userId(): UserId
    {
        return $this->userId;
    }

    public function version(): int
    {
        return $this->version;
    }

    public function source(): PlanSource
    {
        return $this->source;
    }

    public function stepGoal(): int
    {
        return $this->stepGoal;
    }

    public function waterMl(): int
    {
        return $this->waterMl;
    }

    public function activeKcalGoal(): ?int
    {
        return $this->activeKcalGoal;
    }

    public function sleepNeedHours(): float
    {
        return $this->sleepNeedHours;
    }

    public function heartRateZones(): ?HeartRateZones
    {
        return $this->heartRateZones;
    }

    public function basis(): PlanBasis
    {
        return $this->basis;
    }

    /** @return string[] */
    public function editedFields(): array
    {
        return $this->editedFields;
    }

    public function clientUuid(): ?string
    {
        return $this->clientUuid;
    }

    public function createdAt(): ?DateTimeImmutable
    {
        return $this->createdAt;
    }

    /**
     * A basis that still explains the plan after a hand edit.
     *
     * The provenance of an overridden number is the user, not the paper it used to come
     * from. Leaving `step_goal_source: measured_7d` beside a goal the user typed would
     * be the basis lying about the only thing it is there to do.
     *
     * @param  string[]  $changed
     */
    private function basisWithUserEdits(array $changed): PlanBasis
    {
        $sources = [
            'step_goal' => $this->basis->stepGoalSource,
            'water_ml' => $this->basis->waterSource,
            'sleep_need_hours' => $this->basis->sleepNeedSource,
        ];

        foreach ($changed as $field) {
            if (array_key_exists($field, $sources)) {
                $sources[$field] = PlanSource::USER_EDITED;
            }
        }

        return new PlanBasis(
            $this->basis->bmrKcal,
            $this->basis->tdeeKcal,
            $this->basis->activityFactor,
            $this->basis->maxHrBpm,
            $this->basis->restingHrBpm,
            $this->basis->restingHrSource,
            $sources['step_goal'],
            $sources['water_ml'],
            $sources['sleep_need_hours'],
            $this->basis->sleepNeedRange,
            $this->basis->missing,
        );
    }
}
