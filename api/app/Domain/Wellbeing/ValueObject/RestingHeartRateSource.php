<?php

namespace App\Domain\Wellbeing\ValueObject;

/**
 * How a resting heart rate was taken.
 *
 * Two readings of the same heart on the same day differ by several bpm depending on which
 * of these produced them, so they are two measurements rather than one measurement of
 * varying quality. Everything that averages, compares or scores a resting rate has to know
 * which it is holding -- see RestingHeartRateBaseline for what happens when it does not.
 *
 * Deliberately not ordered or ranked. Neither is the "real" resting rate: overnight is what
 * the published research and this project's own validation used, seated is what a person
 * without a watch can actually produce every morning, and a consistent seated series is a
 * legitimate personal baseline. They simply cannot be pooled.
 */
enum RestingHeartRateSource: string
{
    /**
     * The lowest sustained rate across a night's sleep, as a wearable reports it -- or a
     * user's own transcription of one.
     */
    case Overnight = 'overnight';

    /**
     * A short capture taken awake and seated, from a finger on the node's optical pad.
     *
     * Reads above the same person's overnight rate: they are upright, digesting, and
     * whatever woke them has already happened. Useful precisely because it can be repeated
     * under the same conditions every morning, which is what makes a personal baseline out
     * of it.
     */
    case SeatedSpot = 'seated_spot';

    /**
     * Whether the recovery score's published validation covers a baseline of this kind.
     *
     * E-015 scored the Recovery Score against PMData's self-reported readiness using
     * overnight resting rates only. A seated baseline is a different input to the same
     * arithmetic, and no number from that evaluation describes it. The distinction is
     * carried in the type so a screen cannot forget to draw it.
     */
    public function isCoveredByPublishedValidation(): bool
    {
        return $this === self::Overnight;
    }
}
