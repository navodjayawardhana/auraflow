<?php

namespace App\Application\Wellbeing\DTO;

/**
 * One day that could be scored.
 *
 * Deliberately thinner than RecoveryScoreResult: a series has no use for an unavailable
 * reason, because a day that cannot be scored is simply absent from it, and the client
 * counting how many days carry a score is the whole point of showing one.
 *
 * `provisional` travels with the value and is never dropped on the way to a chart. A score
 * computed without a personal resting-HR baseline is a different measurement on the same
 * scale -- E-015 records that mixing the two cost the score half its rank correlation --
 * so anything that plots or averages these has to be able to tell them apart.
 */
final class ScoredDay
{
    public function __construct(
        public readonly string $date,
        public readonly float $score,
        public readonly bool $provisional,
    ) {
    }
}
