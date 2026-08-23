<?php

namespace App\Domain\Profile\ValueObject;

enum BmiBand: string
{
    case Underweight = 'underweight';
    case Healthy = 'healthy';
    case Overweight = 'overweight';
    case Obese = 'obese';
}
