<?php

namespace App\Application\Wellbeing\DTO;

final class CalculateRecoveryScoreRequest
{
    public function __construct(
        public readonly string $userId,
        public readonly string $date,
    ) {
    }
}
