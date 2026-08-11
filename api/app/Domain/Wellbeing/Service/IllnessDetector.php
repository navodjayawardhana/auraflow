<?php

namespace App\Domain\Wellbeing\Service;

use App\Domain\Wellbeing\ValueObject\RestingHeartRate;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateBaseline;

/**
 * Flags a resting heart rate that is anomalously high against the user's own normal.
 *
 * Validated on 1,214 days with an established baseline: 13.0% of days were flagged, and
 * mean self-reported readiness on those days was 4.58 against 5.05 on unflagged days.
 * That is *consistent with* the detector working. It is not evidence that it detects
 * illness -- the cohort carries no ground-truth illness labels, and nothing here should
 * be presented to a user as a diagnosis.
 */
final class IllnessDetector
{
    /**
     * Deliberately sensitive at 1.5 standard deviations. A missed warning costs the user
     * more than an occasional false one, which they can dismiss in a tap.
     */
    public const THRESHOLD_STANDARD_DEVIATIONS = 1.5;

    public function isWarranted(
        ?RestingHeartRate $restingHeartRate,
        ?RestingHeartRateBaseline $baseline,
    ): bool {
        // Without an established baseline there is no "normal" to be abnormal against,
        // and every unusual-looking first week would raise a warning.
        if ($restingHeartRate === null || $baseline === null) {
            return false;
        }

        return $restingHeartRate->isElevatedAgainst($baseline, self::THRESHOLD_STANDARD_DEVIATIONS);
    }
}
