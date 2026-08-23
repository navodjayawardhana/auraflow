<?php

namespace App\Infrastructure\Profile\Persistence;

use App\Domain\Profile\Model\UserProfile;
use App\Domain\Profile\ValueObject\ActivityLevel;
use App\Domain\Profile\ValueObject\BmiScale;
use App\Domain\Profile\ValueObject\Sex;
use App\Domain\Wellbeing\ValueObject\UserId;
use App\Models\UserProfile as EloquentUserProfile;
use DateTimeImmutable;

final class UserProfileMapper
{
    public static function toDomain(EloquentUserProfile $model): UserProfile
    {
        return UserProfile::reconstitute(
            UserId::fromString((string) $model->user_id),
            $model->date_of_birth === null ? null : new DateTimeImmutable($model->date_of_birth->format('Y-m-d')),
            // A stored value the enum no longer recognises reads as Unspecified rather
            // than throwing. The read path has to survive a row written before a case was
            // renamed; the plan already knows how to be missing a sex.
            Sex::tryFrom((string) $model->sex) ?? Sex::Unspecified,
            $model->height_cm,
            $model->weight_kg,
            ActivityLevel::tryFrom((string) $model->activity_level),
            BmiScale::tryFrom((string) $model->bmi_scale),
            $model->updated_at === null ? null : new DateTimeImmutable($model->updated_at->toAtomString()),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public static function toEloquentAttributes(UserProfile $profile): array
    {
        return [
            'user_id' => $profile->userId()->toString(),
            'date_of_birth' => $profile->dateOfBirth()?->format('Y-m-d'),
            'sex' => $profile->sex()->value,
            'height_cm' => $profile->heightCm(),
            'weight_kg' => $profile->weightKg(),
            // The stated level, not the effective one. Writing back the sedentary default
            // would turn "never asked" into "answered sedentary" on the first save, and
            // the plan's `basis.missing` would stop asking.
            'activity_level' => $profile->statedActivityLevel()?->value,
            // Likewise stated rather than effective: an unchosen scale must keep
            // following the default if the default ever moves.
            'bmi_scale' => $profile->statedBmiScale()?->value,
        ];
    }
}
