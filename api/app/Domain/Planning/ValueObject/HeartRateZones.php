<?php

namespace App\Domain\Planning\ValueObject;

/**
 * Three training bands in beats per minute, and the two numbers they were built from.
 *
 * The resting rate and the maximum travel with the zones rather than being recomputed
 * later, because a zone is only interpretable against them: 132-148 bpm means one thing
 * for a resting-48 runner and something else entirely for a resting-78 beginner.
 */
final class HeartRateZones
{
    /**
     * @param  array{int, int}  $easy
     * @param  array{int, int}  $moderate
     * @param  array{int, int}  $hard
     */
    public function __construct(
        public readonly array $easy,
        public readonly array $moderate,
        public readonly array $hard,
        public readonly int $restingBpm,
        public readonly int $maximumBpm,
    ) {
    }

    /**
     * @return array{easy: array{int, int}, moderate: array{int, int}, hard: array{int, int}}
     */
    public function toArray(): array
    {
        return [
            'easy' => $this->easy,
            'moderate' => $this->moderate,
            'hard' => $this->hard,
        ];
    }

    /**
     * @param  array<string, mixed>  $stored
     */
    public static function fromArray(array $stored): self
    {
        return new self(
            array_map(intval(...), $stored['easy']),
            array_map(intval(...), $stored['moderate']),
            array_map(intval(...), $stored['hard']),
            (int) $stored['resting_bpm'],
            (int) $stored['maximum_bpm'],
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toStorage(): array
    {
        return $this->toArray() + [
            'resting_bpm' => $this->restingBpm,
            'maximum_bpm' => $this->maximumBpm,
        ];
    }
}
