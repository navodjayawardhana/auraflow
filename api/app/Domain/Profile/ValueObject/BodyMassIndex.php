<?php

namespace App\Domain\Profile\ValueObject;

/**
 * Mass over height squared, and the band that value falls in on a named scale.
 *
 * Derived on every read and never stored: a stored BMI and a stored weight can disagree
 * the moment one is written without the other, and a BMI that quietly describes last
 * month's body is worse than no BMI at all.
 *
 * The band is always reported with the scale it came from. A bare "overweight" means
 * nothing without knowing whether the boundary was 23 or 25 -- see BmiScale for why this
 * app has to answer both.
 */
final class BodyMassIndex
{
    /** Below this, both WHO scales agree: underweight. */
    private const UNDERWEIGHT_BELOW = 18.5;

    private function __construct(private readonly float $value)
    {
    }

    public static function of(int $heightCm, float $weightKg): self
    {
        $metres = $heightCm / 100;

        return new self(round($weightKg / ($metres ** 2), 1));
    }

    public function value(): float
    {
        return $this->value;
    }

    public function bandOn(BmiScale $scale): BmiBand
    {
        $bounds = $scale->upperBands();

        return match (true) {
            $this->value < self::UNDERWEIGHT_BELOW => BmiBand::Underweight,
            $this->value < $bounds['overweight'] => BmiBand::Healthy,
            $this->value < $bounds['obese'] => BmiBand::Overweight,
            default => BmiBand::Obese,
        };
    }

    /**
     * Every scale's reading of the same number, so the client can show the comparison
     * rather than being handed one verdict and no way to see the other.
     *
     * @return array<string, string> scale value => band value
     */
    public function allBands(): array
    {
        $bands = [];

        foreach (BmiScale::cases() as $scale) {
            $bands[$scale->value] = $this->bandOn($scale)->value;
        }

        return $bands;
    }
}
