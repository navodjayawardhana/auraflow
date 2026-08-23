<?php

namespace App\Application\Profile\DTO;

use App\Domain\Profile\Model\UserProfile;
use App\Domain\Profile\ValueObject\ActivityLevel;
use App\Domain\Profile\ValueObject\BmiScale;

/**
 * What leaves the application layer for the profile screen.
 *
 * A DTO rather than the aggregate, so the wire shape and the domain model can move
 * independently -- and so the derived fields are computed on the way out rather than
 * living on the model as cached state that can go stale against the mass beside it.
 */
final class ProfileView
{
    /**
     * @param  array<string, string>|null  $bmiBands  every scale's reading of the same value
     */
    private function __construct(
        public readonly ?string $dateOfBirth,
        public readonly string $sex,
        public readonly ?int $heightCm,
        public readonly ?float $weightKg,
        public readonly string $activityLevel,
        public readonly ?float $bmi,
        public readonly ?string $bmiBand,
        public readonly string $bmiScale,
        public readonly ?array $bmiBands,
        public readonly ?string $updatedAt,
    ) {
    }

    public static function fromDomain(UserProfile $profile): self
    {
        $bmi = $profile->bodyMassIndex();
        $scale = $profile->bmiScale();

        return new self(
            $profile->dateOfBirth()?->format('Y-m-d'),
            $profile->sex()->value,
            $profile->heightCm(),
            $profile->weightKg(),
            // The effective level, so the client renders the same assumption the plan
            // made. That it was assumed rather than answered is visible in the plan's
            // `basis.missing`, which is where the app asks for it.
            ($profile->statedActivityLevel() ?? ActivityLevel::DEFAULT)->value,
            $bmi?->value(),
            $bmi?->bandOn($scale)->value,
            $scale->value,
            $bmi?->allBands(),
            $profile->updatedAt()?->format(DATE_ATOM),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'date_of_birth' => $this->dateOfBirth,
            'sex' => $this->sex,
            'height_cm' => $this->heightCm,
            'weight_kg' => $this->weightKg,
            'activity_level' => $this->activityLevel,
            'bmi' => $this->bmi,
            'bmi_band' => $this->bmiBand,
            'bmi_scale' => $this->bmiScale,
            // Both scales, always. A band is meaningless without the cut-off behind it,
            // and a user in Sri Lanka shown only the European reading is being told
            // something different from what the evidence for their population says.
            'bmi_bands' => $this->bmiBands,
            'updated_at' => $this->updatedAt,
        ];
    }
}
