<?php

namespace App\Domain\Wellbeing\Service;

use App\Domain\Wellbeing\ValueObject\RecoveryScore;
use App\Domain\Wellbeing\ValueObject\RestingHeartRate;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;
use App\Domain\Wellbeing\ValueObject\SleepSummary;

/**
 * Turns a night's signals into a Recovery Score.
 *
 * A direct port of `ml/recovery.py`, which was validated against 1,729 days of
 * self-reported readiness from 16 participants (EVIDENCE-LOG E-015). **The constants
 * below must stay in step with that file**, or the app stops behaving like the model
 * that was evaluated and the report's numbers no longer describe the shipped product.
 *
 * Rule-based rather than trained, for three reasons: it has to explain itself to a user
 * asking "why is my recovery 48?", it has to produce something on day one before any
 * history exists, and it has to run on device as pure arithmetic.
 *
 * The weights are not intuition. The first version led with sleep duration (0.40) and
 * scored rho 0.068 against self-reported readiness -- worse than simply inverting the
 * resting-heart-rate deviation (0.123). A weight grid searched on training participants
 * and scored on participants it had never seen chose autonomic-only in all five folds,
 * unanimously. The sleep weights below are 0.10 rather than 0.0 for one engineering
 * reason: the autonomic component needs five days of history, and at zero weight a new
 * user's score would be undefined for their first week. **They are not there because
 * sleep improves the estimate. It does not.**
 */
final class RecoveryScoreCalculator
{
    public const WEIGHT_DURATION = 0.10;
    public const WEIGHT_ARCHITECTURE = 0.10;
    public const WEIGHT_AUTONOMIC = 0.80;

    private const DEFAULT_SLEEP_NEED_HOURS = 8.0;

    /** Population values for a user with no personal sleep-stage history yet. */
    private const COLD_START_DEEP_MINUTES = 60.0;
    private const COLD_START_REM_MINUTES = 90.0;

    /**
     * Short sleep is penalised about twice as hard as long sleep. An hour over the need
     * costs little; an hour under is a real deficit, which is how sleep debt accrues.
     */
    private const SHORT_SLEEP_PENALTY_PER_HOUR = 18.0;
    private const LONG_SLEEP_PENALTY_PER_HOUR = 9.0;

    /** Standard deviations of resting-HR elevation mapped onto score points. */
    private const AUTONOMIC_POINTS_PER_SD = 20.0;

    public function calculate(
        SleepSummary $sleep,
        ?RestingHeartRate $restingHeartRate,
        ?RestingHeartRateBaseline $baseline,
        ?float $personalSleepNeedHours = null,
        ?float $personalDeepMinutes = null,
        ?float $personalRemMinutes = null,
    ): RecoveryScore {
        $autonomic = $this->autonomicScore($restingHeartRate, $baseline);

        // A list of [weight, score] pairs rather than a weight-keyed map: PHP silently
        // casts float array keys to int, so 0.10, 0.10 and 0.80 would all collapse into
        // key 0 and two of the three components would vanish without an error.
        $components = [
            [self::WEIGHT_DURATION, $this->durationScore(
                $sleep,
                $personalSleepNeedHours ?? self::DEFAULT_SLEEP_NEED_HOURS,
            )],
            [self::WEIGHT_ARCHITECTURE, $this->architectureScore(
                $sleep,
                $personalDeepMinutes ?? self::COLD_START_DEEP_MINUTES,
                $personalRemMinutes ?? self::COLD_START_REM_MINUTES,
            )],
            [self::WEIGHT_AUTONOMIC, $autonomic],
        ];

        $weightedSum = 0.0;
        $weightTotal = 0.0;
        $used = 0;

        foreach ($components as [$weight, $score]) {
            if ($score === null) {
                continue;
            }
            $weightedSum += $weight * $score;
            $weightTotal += $weight;
            $used++;
        }

        if ($weightTotal === 0.0) {
            throw new \App\Domain\Wellbeing\Exception\InsufficientBaselineHistoryException(
                'No component of the recovery score could be computed for this night.'
            );
        }

        $value = $weightedSum / $weightTotal;

        // Without the autonomic component this is a sleep-only score wearing the same
        // 0-100 scale. Flagging it keeps the two from being compared -- mixing them
        // measurably degrades the ranking (rho 0.123 -> 0.063).
        return $autonomic === null
            ? RecoveryScore::provisional($value, $used)
            : RecoveryScore::established($value, $used);
    }

    /**
     * 0-100 from hours slept, asymmetric around the personal need.
     */
    public function durationScore(SleepSummary $sleep, float $needHours): float
    {
        $deficit = $needHours - $sleep->hours();

        $penalty = $deficit > 0
            ? self::SHORT_SLEEP_PENALTY_PER_HOUR * $deficit
            : self::LONG_SLEEP_PENALTY_PER_HOUR * abs($deficit);

        return $this->clamp(100.0 - $penalty);
    }

    /**
     * 0-100 from restorative sleep against the user's own baseline.
     *
     * Centred at 50 so "typical for you" sits mid-scale rather than reading as a pass
     * mark, leaving room for a genuinely restorative night to score above it.
     */
    public function architectureScore(SleepSummary $sleep, float $baselineDeep, float $baselineRem): ?float
    {
        if (! $sleep->hasStageBreakdown()) {
            return null;
        }

        $deepRatio = $sleep->deepMinutes() / max($baselineDeep, 1.0);
        $remRatio = $sleep->remMinutes() / max($baselineRem, 1.0);

        // Deep sleep weighted slightly higher: it is the more protected stage, so a
        // shortfall there is a stronger signal than the same shortfall in REM.
        $combined = 0.55 * $deepRatio + 0.45 * $remRatio;

        return $this->clamp(50.0 + 50.0 * ($combined - 1.0));
    }

    /**
     * 0-100 from resting heart rate against the personal baseline. Below baseline scores
     * above 50. Null when there is no reading or no established baseline -- the caller
     * turns that into a provisional score.
     */
    public function autonomicScore(?RestingHeartRate $heartRate, ?RestingHeartRateBaseline $baseline): ?float
    {
        if ($heartRate === null || $baseline === null) {
            return null;
        }

        return $this->clamp(50.0 - self::AUTONOMIC_POINTS_PER_SD * $heartRate->deviationFrom($baseline));
    }

    private function clamp(float $value): float
    {
        return max(0.0, min(100.0, $value));
    }
}
