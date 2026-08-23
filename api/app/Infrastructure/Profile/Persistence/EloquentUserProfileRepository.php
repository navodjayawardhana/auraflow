<?php

namespace App\Infrastructure\Profile\Persistence;

use App\Domain\Profile\Model\UserProfile;
use App\Domain\Profile\Repository\UserProfileRepository;
use App\Domain\Wellbeing\ValueObject\UserId;
use App\Models\UserProfile as EloquentUserProfile;

final class EloquentUserProfileRepository implements UserProfileRepository
{
    public function findFor(UserId $userId): ?UserProfile
    {
        $model = EloquentUserProfile::query()
            ->where('user_id', $userId->toString())
            ->first();

        return $model === null ? null : UserProfileMapper::toDomain($model);
    }

    public function save(UserProfile $profile): void
    {
        $attributes = UserProfileMapper::toEloquentAttributes($profile);

        // updateOrCreate is safe here where it is not for health snapshots: the match is
        // on an integer foreign key, not on a date column whose cast writes back
        // `Y-m-d 00:00:00` and never matches a plain 'Y-m-d' comparison.
        //
        // Full replacement rather than a merge, also unlike health snapshots. A profile
        // arrives from one screen that holds the whole person, so a null here means the
        // user cleared the field -- and clearing a wrong date of birth has to be
        // possible. The merge rule exists for a table written by several unrelated
        // syncs; this table has one writer.
        EloquentUserProfile::query()->updateOrCreate(
            ['user_id' => $attributes['user_id']],
            $attributes,
        );
    }
}
