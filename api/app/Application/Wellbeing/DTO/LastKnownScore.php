<?php

namespace App\Application\Wellbeing\DTO;

/**
 * The most recent day that could be scored, when today cannot be.
 *
 * It travels with its date and never without one. A recovery score describes the night that
 * ended on a particular morning, so showing one undated -- or showing it where today's would
 * go -- would be answering a question nobody asked. The date is what makes it honest, and
 * the client is expected to render it.
 */
final class LastKnownScore
{
    public function __construct(
        public readonly string $date,
        public readonly float $score,
        public readonly bool $provisional,
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'date' => $this->date,
            'score' => round($this->score, 1),
            'provisional' => $this->provisional,
        ];
    }
}
